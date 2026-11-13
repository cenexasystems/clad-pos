-- ====================================================================
-- Migration 0033: Returns & refunds
--   * order_returns: one row per return, with its own return number (RTN-00000001)
--   * create_order_return(): validates the quantities, works out the refund, optionally puts the
--     items back in stock, and saves the return. The original bill is never changed.
-- Refund rules:
--   - Delivery charge is NOT refunded.
--   - Each returned item is refunded at its price, minus its share of the bill discount (coupon +
--     extra discount), plus its share of the GST that was charged.
--   - Per item, the shop chooses whether it goes back into stock.
-- Safe to run multiple times.
-- ====================================================================

-- Return numbers come from a counter row (not a sequence) so a refund that fails leaves no gap
CREATE TABLE IF NOT EXISTS public.order_return_counter (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  counter BIGINT NOT NULL DEFAULT 0
);
INSERT INTO public.order_return_counter (id, counter) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.order_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL UNIQUE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  invoice_no TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::JSONB,
  items_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_share NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_share NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_charge_kept NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'cash',
  refund_split JSONB NOT NULL DEFAULT '{}'::JSONB,
  reason TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tables created by an earlier run of this file get the column too
ALTER TABLE public.order_returns ADD COLUMN IF NOT EXISTS confirmed_by TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_order_returns_order ON public.order_returns (order_id);
CREATE INDEX IF NOT EXISTS idx_order_returns_created ON public.order_returns (created_at DESC);

ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_returns_portal_manage ON public.order_returns;
CREATE POLICY order_returns_portal_manage ON public.order_returns FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.create_order_return(
  p_order_id UUID,
  p_items JSONB,                       -- [{ "line_index": 0, "quantity": 1, "restock": true }, ...]
  p_refund_method TEXT DEFAULT 'cash', -- cash | card | qr | split
  p_refund_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT ''        -- who approved the refund (the admin)
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
  v_seen INTEGER[] := ARRAY[]::INTEGER[];
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
  IF v_method NOT IN ('cash', 'card', 'qr', 'split') THEN
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
          'return', v_return_no, 'Customer return (added back to stock)'
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

  IF v_method = 'split' THEN
    v_split_sum := COALESCE((p_refund_split ->> 'cash')::NUMERIC, 0)
                 + COALESCE((p_refund_split ->> 'card')::NUMERIC, 0)
                 + COALESCE((p_refund_split ->> 'qr')::NUMERIC, 0);
    IF ABS(v_split_sum - v_refund_total) > 0.005 THEN
      RAISE EXCEPTION 'Split refund amounts (%) must add up to the refund (%)', v_split_sum, v_refund_total;
    END IF;
  END IF;

  INSERT INTO public.order_returns (
    return_no, order_id, invoice_no, customer_name, phone, items,
    items_total, discount_share, gst_share, refund_total, delivery_charge_kept,
    refund_method, refund_split, reason, confirmed_by
  )
  VALUES (
    v_return_no, p_order_id, v_order.invoice_no, COALESCE(v_order.customer_name, ''), COALESCE(v_order.phone, ''), v_out,
    v_items_total, v_disc_total, v_gst_total, v_refund_total, COALESCE(v_order.delivery_charge, 0),
    v_method, CASE WHEN v_method = 'split' THEN COALESCE(p_refund_split, '{}'::JSONB) ELSE '{}'::JSONB END,
    COALESCE(BTRIM(p_reason), ''), COALESCE(BTRIM(p_confirmed_by), '')
  )
  RETURNING id INTO v_return_id;

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'return_no', v_return_no,
    'refund_total', v_refund_total
  );
END;
$$;

-- an earlier version of this function had no p_confirmed_by argument
DROP FUNCTION IF EXISTS public.create_order_return(UUID, JSONB, TEXT, JSONB, TEXT);

GRANT EXECUTE ON FUNCTION public.create_order_return(UUID, JSONB, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
