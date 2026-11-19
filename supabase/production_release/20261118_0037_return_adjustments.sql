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
