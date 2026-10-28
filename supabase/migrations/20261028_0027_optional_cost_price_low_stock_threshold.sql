-- Optional cost price (purchase price) + low stock threshold.
-- "Cost price" and "purchase price" are the SAME value -> one column: purchase_price.
-- Safe to run multiple times.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchase_price  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS low_stock_alert NUMERIC(12,3);

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,2);

-- Make both optional (blank in the form is stored as NULL)
ALTER TABLE public.products ALTER COLUMN purchase_price  DROP NOT NULL;
ALTER TABLE public.products ALTER COLUMN purchase_price  DROP DEFAULT;
ALTER TABLE public.products ALTER COLUMN low_stock_alert DROP NOT NULL;
ALTER TABLE public.products ALTER COLUMN low_stock_alert DROP DEFAULT;

NOTIFY pgrst, 'reload schema';
