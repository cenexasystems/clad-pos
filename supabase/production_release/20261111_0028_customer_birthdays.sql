-- ====================================================================
-- Migration 0028: Customer birthdays + one-tap WhatsApp birthday offers
-- Safe to run multiple times.
-- ====================================================================

BEGIN;

-- Customers whose birthday we know. Phone is stored as 91XXXXXXXXXX so one
-- person is never saved twice. The year is optional (many customers only share day + month).
CREATE TABLE IF NOT EXISTS public.customer_birthdays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  birth_day SMALLINT NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
  birth_month SMALLINT NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  birth_year SMALLINT CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_customer_birthdays_phone UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_customer_birthdays_month_day
  ON public.customer_birthdays (birth_month, birth_day);

-- Offers the shop can attach to a birthday message ("40% off", "Free alteration", ...)
CREATE TABLE IF NOT EXISTS public.birthday_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_birthday_offers_title UNIQUE (title)
);

-- One row (id = 1): the editable message template and the offer chosen by default
CREATE TABLE IF NOT EXISTS public.birthday_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  message_template TEXT NOT NULL DEFAULT '',
  selected_offer_id UUID REFERENCES public.birthday_offers(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.birthday_offers (title) VALUES ('10% off')
ON CONFLICT (title) DO NOTHING;

INSERT INTO public.birthday_settings (id, message_template)
VALUES (
  1,
  E'Hi {name}! 🎂 Happy Birthday!\n\nHere''s a special treat from {shop}:\n🎁 {offer}\n\nVisit us in store or call {phone}.\nFollow us on Instagram @{instagram}\n\n– {shop}'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.customer_birthdays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.birthday_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.birthday_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_birthdays_all ON public.customer_birthdays;
CREATE POLICY customer_birthdays_all ON public.customer_birthdays FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS birthday_offers_all ON public.birthday_offers;
CREATE POLICY birthday_offers_all ON public.birthday_offers FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS birthday_settings_all ON public.birthday_settings;
CREATE POLICY birthday_settings_all ON public.birthday_settings FOR ALL USING (TRUE) WITH CHECK (TRUE);

COMMIT;

NOTIFY pgrst, 'reload schema';
