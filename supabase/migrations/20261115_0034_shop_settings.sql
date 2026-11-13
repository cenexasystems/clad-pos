-- ====================================================================
-- Migration 0034: Shop Settings page
--   Extends the single-row store_settings table with the fields on the Settings page:
--   Tamil name, WhatsApp / owner numbers, city, business hours, Instagram, GSTIN, theme colour,
--   and the (hashed) admin / staff passwords that can be changed from Settings.
--   Existing columns (name, owner_name, phone, email, address, gst_enabled) are left as they are.
-- Safe to run multiple times.
-- ====================================================================

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS name_ta TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_hours TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS instagram TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gstin TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '#D4AF37',
  -- The shop profile columns hold old seed text until the owner saves the Settings page once.
  -- The app ignores them (and keeps showing the built-in CLAD details) until this flag is TRUE.
  ADD COLUMN IF NOT EXISTS profile_saved BOOLEAN NOT NULL DEFAULT FALSE,
  -- SHA-256 of "<role>:<password>"; empty = the password from the app's environment settings is still in use
  ADD COLUMN IF NOT EXISTS admin_password_hash TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS staff_password_hash TEXT NOT NULL DEFAULT '';

-- Make sure the single settings row exists
INSERT INTO public.store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
