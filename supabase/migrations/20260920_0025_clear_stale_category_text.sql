-- Clean up stale category text on products whose category_id is NULL
-- This happens when a category is deleted and the legacy `category` text column was not cleared.
-- We can safely blank it out for products that no longer have a valid category FK.

UPDATE public.products
SET category = ''
WHERE category_id IS NULL
  AND category IS NOT NULL
  AND trim(category) != '';
