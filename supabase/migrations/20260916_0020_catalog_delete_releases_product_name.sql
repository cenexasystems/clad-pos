-- A catalog delete is a true deletion.  Order and inventory history preserve
-- their audit records with NULL product/variant references, while the barcode
-- registry follows its catalog item automatically.

BEGIN;

-- Older clients soft-deleted products. Keep those historical rows from
-- reserving a catalog name while continuing to enforce case-insensitive names
-- among active products.
DROP INDEX IF EXISTS public.products_category_name_unique;
CREATE UNIQUE INDEX products_category_name_unique
  ON public.products (category_id, LOWER(BTRIM(name)))
  WHERE is_active = TRUE;

ALTER TABLE public.barcode_registry
  DROP CONSTRAINT IF EXISTS barcode_registry_product_id_fkey,
  ADD CONSTRAINT barcode_registry_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.barcode_registry
  DROP CONSTRAINT IF EXISTS barcode_registry_variant_id_fkey,
  ADD CONSTRAINT barcode_registry_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;

COMMIT;
