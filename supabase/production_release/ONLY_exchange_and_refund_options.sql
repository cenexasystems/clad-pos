-- RUN THIS ONE FILE (needs 0035 exchange migration already run): exchange bill options + refund adjustments

-- ====================================================================
-- Migration 0036: Exchange bill options
--
-- The new bill created by an exchange can now carry the same options as a normal POS bill:
-- coupon code, manual discount (flat or %), GST and a delivery charge.
--   new bill total = new items - coupon - manual discount + GST + delivery
-- The credit from the returned items is applied against that total.
-- Replaces create_exchange() (new arguments all have defaults, so older calls still work).
-- Safe to run multiple times. Requires migration 0035.
-- ====================================================================

DROP FUNCTION IF EXISTS public.create_exchange(UUID, JSONB, JSONB, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_exchange(
  p_order_id UUID,
  p_return_items JSONB,
  p_new_items JSONB,
  p_pay_method TEXT DEFAULT 'cash',
  p_pay_split JSONB DEFAULT '{}'::JSONB,
  p_back_method TEXT DEFAULT 'cash',
  p_back_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT '',
  p_delivery_charge NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,          -- coupon discount
  p_manual_discount_amount NUMERIC DEFAULT 0,
  p_manual_discount_type TEXT DEFAULT 'flat',
  p_manual_discount_value NUMERIC DEFAULT 0,
  p_coupon_code TEXT DEFAULT NULL,
  p_coupon_percentage NUMERIC DEFAULT 0,
  p_total_gst NUMERIC DEFAULT 0,
  p_gst_enabled BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_items_total NUMERIC;
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
    INTO v_items_total
  FROM jsonb_array_elements(p_new_items) e;
  IF v_items_total <= 0 THEN
    RAISE EXCEPTION 'The new items need a price';
  END IF;

  -- the new bill's grand total, the same way the POS adds it up
  v_new_total := GREATEST(0, ROUND(
    v_items_total
    - GREATEST(0, COALESCE(p_discount_amount, 0))
    - GREATEST(0, COALESCE(p_manual_discount_amount, 0))
    + CASE WHEN COALESCE(p_gst_enabled, FALSE) THEN GREATEST(0, COALESCE(p_total_gst, 0)) ELSE 0 END
    + GREATEST(0, COALESCE(p_delivery_charge, 0)), 2));

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
    p_delivery_charge => GREATEST(0, COALESCE(p_delivery_charge, 0)),
    p_discount_amount => GREATEST(0, COALESCE(p_discount_amount, 0)),
    p_manual_discount_amount => GREATEST(0, COALESCE(p_manual_discount_amount, 0)),
    p_manual_discount_type => COALESCE(NULLIF(p_manual_discount_type, ''), 'flat'),
    p_manual_discount_value => COALESCE(p_manual_discount_value, 0),
    p_coupon_code => NULLIF(BTRIM(COALESCE(p_coupon_code, '')), ''),
    p_coupon_percentage => COALESCE(p_coupon_percentage, 0),
    p_payment_method => v_payment_method,
    p_split_details => v_split,
    p_total_gst => CASE WHEN COALESCE(p_gst_enabled, FALSE) THEN GREATEST(0, COALESCE(p_total_gst, 0)) ELSE 0 END,
    p_gst_enabled => COALESCE(p_gst_enabled, FALSE),
    p_remarks => 'Exchange for bill ' || v_order.invoice_no || ' (' || (v_ret ->> 'return_no') || ')'
  );

  -- the sale function does not subtract the manual discount or add GST to the stored total; set it right
  UPDATE public.orders SET total = v_new_total WHERE id = (v_sale ->> 'order_id')::UUID;

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

GRANT EXECUTE ON FUNCTION public.create_exchange(UUID, JSONB, JSONB, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, BOOLEAN) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ====================================================================
-- Migration 0037: Refund adjustments on a plain return
-- Coupon / manual discount / delivery are deducted from the refund, GST is added.
-- Stored on the credit note so the return invoice can print them.
-- Wraps create_order_return() (migration 0035), which is left untouched.
-- Safe to run multiple times.
-- ====================================================================

ALTER TABLE public.order_returns
  ADD COLUMN IF NOT EXISTS adj_coupon_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS adj_coupon_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adj_manual_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adj_gst NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adj_delivery NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.create_order_return_adjusted(
  p_order_id UUID,
  p_items JSONB,
  p_refund_method TEXT DEFAULT 'cash',
  p_refund_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT '',
  p_coupon_code TEXT DEFAULT NULL,
  p_coupon_discount NUMERIC DEFAULT 0,
  p_manual_discount NUMERIC DEFAULT 0,
  p_gst NUMERIC DEFAULT 0,
  p_delivery NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_method TEXT := lower(COALESCE(NULLIF(BTRIM(p_refund_method), ''), 'cash'));
  v_ret JSONB;
  v_id UUID;
  v_base NUMERIC;
  v_final NUMERIC;
  v_split_sum NUMERIC;
BEGIN
  IF v_method NOT IN ('cash', 'card', 'qr', 'split') THEN
    RAISE EXCEPTION 'Choose a refund method (cash, card, GPay or split)';
  END IF;

  v_ret := public.create_order_return(p_order_id, p_items, 'cash', '{}'::JSONB, p_reason, p_confirmed_by);
  v_id := (v_ret ->> 'return_id')::UUID;
  SELECT refund_total INTO v_base FROM public.order_returns WHERE id = v_id;

  v_final := GREATEST(0, ROUND(v_base - GREATEST(0, COALESCE(p_coupon_discount, 0)) - GREATEST(0, COALESCE(p_manual_discount, 0))
                               + GREATEST(0, COALESCE(p_gst, 0)) - GREATEST(0, COALESCE(p_delivery, 0)), 2));

  IF v_method = 'split' THEN
    v_split_sum := COALESCE((p_refund_split ->> 'cash')::NUMERIC, 0) + COALESCE((p_refund_split ->> 'card')::NUMERIC, 0) + COALESCE((p_refund_split ->> 'qr')::NUMERIC, 0);
    IF ABS(v_split_sum - v_final) > 0.005 THEN
      RAISE EXCEPTION 'Split refund amounts (%) must add up to the refund (%)', v_split_sum, v_final;
    END IF;
  END IF;

  UPDATE public.order_returns
  SET refund_total = v_final,
      refund_method = v_method,
      refund_split = CASE WHEN v_method = 'split' THEN COALESCE(p_refund_split, '{}'::JSONB) ELSE '{}'::JSONB END,
      adj_coupon_code = COALESCE(BTRIM(p_coupon_code), ''),
      adj_coupon_discount = GREATEST(0, COALESCE(p_coupon_discount, 0)),
      adj_manual_discount = GREATEST(0, COALESCE(p_manual_discount, 0)),
      adj_gst = GREATEST(0, COALESCE(p_gst, 0)),
      adj_delivery = GREATEST(0, COALESCE(p_delivery, 0))
  WHERE id = v_id;

  RETURN v_ret || jsonb_build_object('refund_total', v_final);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_return_adjusted(UUID, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
