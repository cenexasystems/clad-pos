-- ====================================================================
-- Migration 0029: Send coupons on WhatsApp (+ optional coupon image)
-- Safe to run multiple times.
-- ====================================================================

BEGIN;

-- Optional picture shown to the customer in the WhatsApp message (public URL)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Who each coupon was sent to, so the list can show "sent to N" and mark customers already messaged
CREATE TABLE IF NOT EXISTS public.coupon_sends (
  id BIGSERIAL PRIMARY KEY,
  coupon_id BIGINT NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupon_sends_coupon ON public.coupon_sends (coupon_id);

ALTER TABLE public.coupon_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coupon_sends_all ON public.coupon_sends;
CREATE POLICY coupon_sends_all ON public.coupon_sends FOR ALL USING (TRUE) WITH CHECK (TRUE);

COMMIT;

NOTIFY pgrst, 'reload schema';
