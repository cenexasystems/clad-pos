-- ====================================================================
-- Migration 0035: Exchange (return items + take new items in one go)
--
-- create_exchange() does, in ONE transaction (so a half-done exchange can never be saved):
--   1. returns the chosen items from the original bill (credit note RTN-xxxxxxxx, delivery
--      charge never refunded, admin chooses per item whether it goes back into stock),
--   2. creates a NEW bill for the replacement items (own invoice number, stock deducted),
--   3. settles the difference:
--        new items cost more  -> the customer pays the difference (cash / card / GPay / split)
--        new items cost less  -> the shop pays back the difference (cash / card / GPay / split)
--        same value           -> nothing changes hands
--   The credit note and the new bill point at each other.
-- Also replaces create_order_return() with a version that understands exchanges.
-- Safe to run multiple times.
-- ====================================================================

ALTER TABLE public.order_returns
  ADD COLUMN IF NOT EXISTS exchange_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exchange_invoice_no TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS exchange_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_applied NUMERIC(12,2) NOT NULL DEFAULT 0;

-- the earlier 6-argument version is replaced by the one below (extra arguments have defaults)
DROP FUNCTION IF EXISTS public.create_order_return(UUID, JSONB, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_order_return(
  p_order_id UUID,
  p_items JSONB,                       -- [{ "line_index": 0, "quantity": 1, "restock": true }, ...]
  p_refund_method TEXT DEFAULT 'cash', -- cash | card | qr | split
  p_refund_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT '',      -- who approved the refund (the admin)
  p_exchange_total NUMERIC DEFAULT 0,  -- > 0 = this return is part of an exchange worth this much
  p_back_method TEXT DEFAULT 'cash',   -- exchange only: how the shop pays back any difference
  p_back_split JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_lines JSONB;
  v_subtotal NUMERIC := 0;
  v_discount_ratio NUMERIC := 0;
  v_gst_ratio NUMERIC := 0;
  v_pick JSONB;
  v_line JSONB;
  v_idx INTEGER;
  v_qty NUMERIC;
  v_restock BOOLEAN;
  v_ordered NUMERIC;
  v_already NUMERIC;
  v_line_total NUMERIC;
  v_base NUMERIC;
  v_disc NUMERIC;
  v_gst NUMERIC;
  v_refund NUMERIC;
  v_is_manual BOOLEAN;
  v_product_id BIGINT;
  v_variant_id UUID;
  v_before NUMERIC;
  v_restocked BOOLEAN;
  v_out JSONB := '[]'::JSONB;
  v_items_total NUMERIC := 0;
  v_disc_total NUMERIC := 0;
  v_gst_total NUMERIC := 0;
  v_refund_total NUMERIC := 0;
  v_return_no TEXT;
  v_counter BIGINT;
  v_return_id UUID;
  v_method TEXT := lower(COALESCE(NULLIF(BTRIM(p_refund_method), ''), 'cash'));
  v_split_sum NUMERIC;
  v_split_json JSONB := '{}'::JSONB;
  v_seen INTEGER[] := ARRAY[]::INTEGER[];
  v_is_exchange BOOLEAN := COALESCE(p_exchange_total, 0) > 0;
  v_applied NUMERIC := 0;
  v_back NUMERIC := 0;
  v_back_method TEXT;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_lines := v_order.items;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'This bill has no items to return';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Choose at least one item to return';
  END IF;
  IF NOT v_is_exchange AND v_method NOT IN ('cash', 'card', 'qr', 'split') THEN
    RAISE EXCEPTION 'Choose a refund method (cash, card, GPay or split)';
  END IF;

  -- Bill subtotal, and each item's share of the discount and GST
  SELECT COALESCE(SUM(COALESCE((e ->> 'line_total')::NUMERIC,
           ROUND(COALESCE((e ->> 'quantity')::NUMERIC, 0) * COALESCE((e ->> 'base_price')::NUMERIC, (e ->> 'price')::NUMERIC, 0), 2))), 0)
    INTO v_subtotal
  FROM jsonb_array_elements(v_lines) e;

  IF v_subtotal > 0 THEN
    v_discount_ratio := LEAST(1, (COALESCE(v_order.discount_amount, 0) + COALESCE(v_order.manual_discount_amount, 0)) / v_subtotal);
    v_gst_ratio := COALESCE(v_order.total_gst, 0) / v_subtotal;
  END IF;

  UPDATE public.order_return_counter SET counter = counter + 1 WHERE id = 1 RETURNING counter INTO v_counter;
  v_return_no := 'RTN-' || LPAD(v_counter::TEXT, 8, '0');

  FOR v_pick IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := (v_pick ->> 'line_index')::INTEGER;
    v_qty := COALESCE((v_pick ->> 'quantity')::NUMERIC, 0);
    v_restock := COALESCE((v_pick ->> 'restock')::BOOLEAN, FALSE);

    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;
    IF v_idx = ANY (v_seen) THEN
      RAISE EXCEPTION 'The same item was chosen twice';
    END IF;
    v_seen := v_seen || v_idx;

    v_line := v_lines -> v_idx;
    IF v_line IS NULL THEN
      RAISE EXCEPTION 'Item % is not on this bill', v_idx + 1;
    END IF;

    v_ordered := COALESCE((v_line ->> 'quantity')::NUMERIC, 0);
    v_line_total := COALESCE((v_line ->> 'line_total')::NUMERIC,
                             ROUND(v_ordered * COALESCE((v_line ->> 'base_price')::NUMERIC, (v_line ->> 'price')::NUMERIC, 0), 2));

    SELECT COALESCE(SUM((ri ->> 'quantity')::NUMERIC), 0) INTO v_already
    FROM public.order_returns r, jsonb_array_elements(r.items) ri
    WHERE r.order_id = p_order_id AND (ri ->> 'line_index')::INTEGER = v_idx;

    IF v_ordered <= 0 OR v_qty > v_ordered - v_already THEN
      RAISE EXCEPTION 'Cannot return % of "%": only % left to return',
        v_qty, COALESCE(v_line ->> 'name', v_line ->> 'product_name', 'item'), GREATEST(0, v_ordered - v_already);
    END IF;

    v_base := ROUND(v_line_total * v_qty / v_ordered, 2);
    v_disc := ROUND(v_base * v_discount_ratio, 2);
    v_gst := ROUND(v_base * v_gst_ratio, 2);
    v_refund := v_base - v_disc + v_gst;

    v_is_manual := COALESCE((v_line ->> 'is_manual')::BOOLEAN, FALSE);
    v_product_id := NULLIF(v_line ->> 'product_id', '')::BIGINT;
    v_variant_id := NULLIF(v_line ->> 'variant_id', '')::UUID;
    v_restocked := FALSE;

    -- Put the items back in stock only when the shop chose to (manual items have no stock)
    IF v_restock AND NOT v_is_manual THEN
      IF v_variant_id IS NOT NULL THEN
        SELECT stock INTO v_before FROM public.product_variants WHERE id = v_variant_id FOR UPDATE;
        IF v_before IS NOT NULL THEN
          UPDATE public.product_variants SET stock = stock + v_qty, updated_at = NOW() WHERE id = v_variant_id;
          IF v_product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock_quantity = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE),
                stock = FLOOR((SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE))::INTEGER,
                updated_at = NOW()
            WHERE id = v_product_id;
          END IF;
          v_restocked := TRUE;
        END IF;
      ELSIF v_product_id IS NOT NULL THEN
        SELECT stock_quantity INTO v_before FROM public.products WHERE id = v_product_id FOR UPDATE;
        IF v_before IS NOT NULL THEN
          UPDATE public.products
          SET stock_quantity = stock_quantity + v_qty, stock = stock + CEIL(v_qty)::INTEGER, updated_at = NOW()
          WHERE id = v_product_id;
          v_restocked := TRUE;
        END IF;
      END IF;

      IF v_restocked THEN
        INSERT INTO public.inventory_movements (
          product_id, variant_id, barcode_id, movement_type,
          quantity_delta, quantity_before, quantity_after,
          reference_type, reference_id, note
        )
        VALUES (
          v_product_id, v_variant_id, NULL, 'RETURN',
          v_qty, v_before, v_before + v_qty,
          'return', v_return_no,
          CASE WHEN v_is_exchange THEN 'Exchange (returned item added back to stock)' ELSE 'Customer return (added back to stock)' END
        );
      END IF;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_index', v_idx,
      'name', COALESCE(v_line ->> 'name', v_line ->> 'product_name', 'Item'),
      'product_id', v_line ->> 'product_id',
      'variant_id', v_line ->> 'variant_id',
      'variant_name', v_line ->> 'variant_name',
      'unit', COALESCE(v_line ->> 'unit', 'piece'),
      'is_manual', v_is_manual,
      'quantity', v_qty,
      'unit_price', ROUND(v_line_total / v_ordered, 2),
      'base_total', v_base,
      'discount_share', v_disc,
      'gst_share', v_gst,
      'refund_amount', v_refund,
      'restock', v_restock,
      'restocked', v_restocked
    ));

    v_items_total := v_items_total + v_base;
    v_disc_total := v_disc_total + v_disc;
    v_gst_total := v_gst_total + v_gst;
    v_refund_total := v_refund_total + v_refund;
  END LOOP;

  IF jsonb_array_length(v_out) = 0 THEN
    RAISE EXCEPTION 'Choose at least one item to return';
  END IF;

  IF v_is_exchange THEN
    -- The returned items' value becomes credit against the new bill; only a surplus is paid back in money
    v_applied := LEAST(v_refund_total, p_exchange_total);
    v_back := v_refund_total - v_applied;
    IF v_back > 0.004 THEN
      v_back_method := lower(COALESCE(NULLIF(BTRIM(p_back_method), ''), 'cash'));
      IF v_back_method NOT IN ('cash', 'card', 'qr', 'split') THEN
        RAISE EXCEPTION 'Choose how the difference is paid back (cash, card, GPay or split)';
      END IF;
      IF v_back_method = 'split' THEN
        v_split_sum := COALESCE((p_back_split ->> 'cash')::NUMERIC, 0) + COALESCE((p_back_split ->> 'card')::NUMERIC, 0) + COALESCE((p_back_split ->> 'qr')::NUMERIC, 0);
        IF ABS(v_split_sum - v_back) > 0.005 THEN
          RAISE EXCEPTION 'Split amounts (%) must add up to the amount paid back (%)', v_split_sum, v_back;
        END IF;
        v_split_json := jsonb_build_object('exchange', v_applied,
          'cash', COALESCE((p_back_split ->> 'cash')::NUMERIC, 0), 'card', COALESCE((p_back_split ->> 'card')::NUMERIC, 0), 'qr', COALESCE((p_back_split ->> 'qr')::NUMERIC, 0));
      ELSE
        v_split_json := jsonb_build_object('exchange', v_applied, v_back_method, v_back);
      END IF;
      v_method := 'split';
    ELSE
      v_method := 'exchange';
      v_split_json := jsonb_build_object('exchange', v_applied);
    END IF;
  ELSIF v_method = 'split' THEN
    v_split_sum := COALESCE((p_refund_split ->> 'cash')::NUMERIC, 0)
                 + COALESCE((p_refund_split ->> 'card')::NUMERIC, 0)
                 + COALESCE((p_refund_split ->> 'qr')::NUMERIC, 0);
    IF ABS(v_split_sum - v_refund_total) > 0.005 THEN
      RAISE EXCEPTION 'Split refund amounts (%) must add up to the refund (%)', v_split_sum, v_refund_total;
    END IF;
    v_split_json := COALESCE(p_refund_split, '{}'::JSONB);
  END IF;

  INSERT INTO public.order_returns (
    return_no, order_id, invoice_no, customer_name, phone, items,
    items_total, discount_share, gst_share, refund_total, delivery_charge_kept,
    refund_method, refund_split, reason, confirmed_by, exchange_total, credit_applied
  )
  VALUES (
    v_return_no, p_order_id, v_order.invoice_no, COALESCE(v_order.customer_name, ''), COALESCE(v_order.phone, ''), v_out,
    v_items_total, v_disc_total, v_gst_total, v_refund_total, COALESCE(v_order.delivery_charge, 0),
    v_method, v_split_json,
    COALESCE(BTRIM(p_reason), ''), COALESCE(BTRIM(p_confirmed_by), ''),
    CASE WHEN v_is_exchange THEN p_exchange_total ELSE 0 END, v_applied
  )
  RETURNING id INTO v_return_id;

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'return_no', v_return_no,
    'refund_total', v_refund_total,
    'credit_applied', v_applied,
    'pay', GREATEST(0, COALESCE(p_exchange_total, 0) - v_applied),
    'back', v_back
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_return(UUID, JSONB, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_exchange(
  p_order_id UUID,
  p_return_items JSONB,                -- [{ "line_index": 0, "quantity": 1, "restock": true }, ...]
  p_new_items JSONB,                   -- the replacement items, in the same shape the POS sends to a sale
  p_pay_method TEXT DEFAULT 'cash',    -- how the customer pays any extra (cash | card | qr | split)
  p_pay_split JSONB DEFAULT '{}'::JSONB,
  p_back_method TEXT DEFAULT 'cash',   -- how the shop pays back any difference
  p_back_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_new_total NUMERIC;
  v_ret JSONB;
  v_sale JSONB;
  v_applied NUMERIC;
  v_pay NUMERIC;
  v_method TEXT := lower(COALESCE(NULLIF(BTRIM(p_pay_method), ''), 'cash'));
  v_payment_method TEXT;
  v_split JSONB;
  v_split_sum NUMERIC;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF p_new_items IS NULL OR jsonb_typeof(p_new_items) <> 'array' OR jsonb_array_length(p_new_items) = 0 THEN
    RAISE EXCEPTION 'Choose the new items for the exchange';
  END IF;

  SELECT COALESCE(SUM(COALESCE((e ->> 'line_total')::NUMERIC,
           ROUND(COALESCE((e ->> 'quantity')::NUMERIC, 0) * COALESCE((e ->> 'unit_price')::NUMERIC, (e ->> 'base_price')::NUMERIC, 0), 2))), 0)
    INTO v_new_total
  FROM jsonb_array_elements(p_new_items) e;
  IF v_new_total <= 0 THEN
    RAISE EXCEPTION 'The new items need a price';
  END IF;

  -- 1. the return (credit note). Anything wrong here cancels the whole exchange.
  v_ret := public.create_order_return(p_order_id, p_return_items, 'cash', '{}'::JSONB, p_reason, p_confirmed_by, v_new_total, p_back_method, p_back_split);
  v_applied := (v_ret ->> 'credit_applied')::NUMERIC;
  v_pay := v_new_total - v_applied;

  -- 2. how the new bill is paid: credit from the returned items plus whatever the customer adds
  IF v_pay > 0.004 THEN
    IF v_method NOT IN ('cash', 'card', 'qr', 'split') THEN
      RAISE EXCEPTION 'Choose how the customer pays the difference (cash, card, GPay or split)';
    END IF;
    IF v_method = 'split' THEN
      v_split_sum := COALESCE((p_pay_split ->> 'cash')::NUMERIC, 0) + COALESCE((p_pay_split ->> 'card')::NUMERIC, 0) + COALESCE((p_pay_split ->> 'qr')::NUMERIC, 0);
      IF ABS(v_split_sum - v_pay) > 0.005 THEN
        RAISE EXCEPTION 'Split payment amounts (%) must add up to the amount to pay (%)', v_split_sum, v_pay;
      END IF;
    END IF;
  END IF;

  IF v_pay <= 0.004 THEN
    v_payment_method := 'exchange';
    v_split := jsonb_build_object('exchange', v_applied);
  ELSIF v_applied <= 0.004 THEN
    v_payment_method := v_method;
    v_split := CASE WHEN v_method = 'split' THEN COALESCE(p_pay_split, '{}'::JSONB) ELSE '{}'::JSONB END;
  ELSE
    v_payment_method := 'split';
    v_split := jsonb_build_object('exchange', v_applied) ||
      CASE WHEN v_method = 'split'
        THEN jsonb_build_object('cash', COALESCE((p_pay_split ->> 'cash')::NUMERIC, 0), 'card', COALESCE((p_pay_split ->> 'card')::NUMERIC, 0), 'qr', COALESCE((p_pay_split ->> 'qr')::NUMERIC, 0))
        ELSE jsonb_build_object(v_method, v_pay)
      END;
  END IF;

  -- 3. the new bill (checks and deducts stock; if a new item is out of stock, everything above is undone)
  v_sale := public.complete_pos_sale_with_inventory(
    p_customer_name => v_order.customer_name,
    p_phone => v_order.phone,
    p_address => v_order.address,
    p_items => p_new_items,
    p_payment_method => v_payment_method,
    p_split_details => v_split,
    p_remarks => 'Exchange for bill ' || v_order.invoice_no || ' (' || (v_ret ->> 'return_no') || ')'
  );

  -- 4. link the credit note and the new bill both ways
  UPDATE public.order_returns
  SET exchange_order_id = (v_sale ->> 'order_id')::UUID,
      exchange_invoice_no = COALESCE(v_sale ->> 'invoice_no', '')
  WHERE id = (v_ret ->> 'return_id')::UUID;

  RETURN v_ret || jsonb_build_object(
    'new_order_id', v_sale ->> 'order_id',
    'new_invoice_no', v_sale ->> 'invoice_no',
    'new_total', v_new_total,
    'payment_method', v_payment_method
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_exchange(UUID, JSONB, JSONB, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
