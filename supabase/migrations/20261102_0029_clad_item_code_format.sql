-- Keep database-generated barcodes in the same CLAD + 7 digit format as labels.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.barcode_clad_seq
  START WITH 1000000
  MINVALUE 1000000
  MAXVALUE 9999999
  NO CYCLE;

WITH existing_codes AS (
  SELECT barcode_value AS barcode FROM public.barcode_registry
  UNION ALL
  SELECT barcode FROM public.products WHERE barcode IS NOT NULL
  UNION ALL
  SELECT barcode FROM public.product_variants WHERE barcode IS NOT NULL
),
latest AS (
  SELECT MAX(SUBSTRING(barcode FROM 5)::BIGINT) AS max_code
  FROM existing_codes
  WHERE barcode ~* '^CLAD[0-9]{7}$'
)
SELECT setval(
  'public.barcode_clad_seq',
  COALESCE(max_code, 1000000),
  max_code IS NOT NULL
)
FROM latest;

CREATE OR REPLACE FUNCTION public.generate_barcode_value(p_entity_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_barcode_value TEXT;
BEGIN
  LOOP
    v_barcode_value := 'CLAD' || nextval('public.barcode_clad_seq')::TEXT;

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
