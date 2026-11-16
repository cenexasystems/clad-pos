-- ====================================================================
-- ONLY the barcode code-format SQL (added with the barcode-scanning fix).
-- Use this if you ALREADY ran RUN_ALL_IN_ONE.sql before this fix.
-- (If you have not run RUN_ALL_IN_ONE.sql yet, run that file instead: it already includes this.)
-- Run in the MAIN Supabase: SQL Editor > New query > paste > Run. Safe to run twice.
-- Result: generated item codes are CLAD + 7 digits (CLAD1000000, CLAD1000001, ...).
-- ====================================================================

-- >>>>>>>>>> 20261102_0028_clad_barcode_format.sql <<<<<<<<<<

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

-- >>>>>>>>>> 20261102_0029_clad_item_code_format.sql <<<<<<<<<<

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
