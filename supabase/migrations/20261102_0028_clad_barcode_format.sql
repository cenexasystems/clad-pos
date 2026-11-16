-- Keep automatically generated barcodes in the same 8-digit format as labels.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.barcode_item_code_seq
  START WITH 10000000
  MINVALUE 10000000
  MAXVALUE 99999999
  NO CYCLE;

CREATE OR REPLACE FUNCTION public.generate_barcode_value(p_entity_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_barcode_value TEXT;
BEGIN
  LOOP
    v_barcode_value := nextval('public.barcode_item_code_seq')::TEXT;

    IF NOT EXISTS (
      SELECT 1
      FROM public.barcode_registry
      WHERE UPPER(barcode_value) = v_barcode_value
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.products
      WHERE UPPER(barcode) = v_barcode_value
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.product_variants
      WHERE UPPER(barcode) = v_barcode_value
    ) THEN
      RETURN v_barcode_value;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
