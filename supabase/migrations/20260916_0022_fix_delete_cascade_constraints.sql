-- Fix foreign key constraints that may have been created without ON DELETE SET NULL
-- due to early schema versions missing them.

BEGIN;

-- 1. order_items
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_product_id_fkey,
  ADD CONSTRAINT order_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_variant_id_fkey,
  ADD CONSTRAINT order_items_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;

-- 2. inventory_movements
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_product_id_fkey,
  ADD CONSTRAINT inventory_movements_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_variant_id_fkey,
  ADD CONSTRAINT inventory_movements_variant_id_fkey
    FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_barcode_id_fkey,
  ADD CONSTRAINT inventory_movements_barcode_id_fkey
    FOREIGN KEY (barcode_id) REFERENCES public.barcode_registry(id) ON DELETE SET NULL;

-- 3. advance_order_timeline and payments
ALTER TABLE public.advance_order_timeline
  DROP CONSTRAINT IF EXISTS advance_order_timeline_advance_order_id_fkey,
  ADD CONSTRAINT advance_order_timeline_advance_order_id_fkey
    FOREIGN KEY (advance_order_id) REFERENCES public.advance_orders(id) ON DELETE CASCADE;

ALTER TABLE public.advance_order_payments
  DROP CONSTRAINT IF EXISTS advance_order_payments_advance_order_id_fkey,
  ADD CONSTRAINT advance_order_payments_advance_order_id_fkey
    FOREIGN KEY (advance_order_id) REFERENCES public.advance_orders(id) ON DELETE CASCADE;

COMMIT;
