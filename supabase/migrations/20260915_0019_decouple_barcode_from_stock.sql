-- Migration: 20260915_0019_decouple_barcode_from_stock.sql
-- Description: Allow create_barcode_and_receive_stock to accept 0 quantity (barcode generation without stock increment)
--              and normalize barcodes to uppercase.

CREATE OR REPLACE FUNCTION public.create_barcode_and_receive_stock(
  p_product_id BIGINT,
  p_variant_id UUID DEFAULT NULL,
  p_quantity_received NUMERIC DEFAULT 0,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_created_by_name TEXT DEFAULT '',
  p_custom_barcode TEXT DEFAULT NULL,
  p_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_type TEXT;
  v_barcode_id UUID;
  v_barcode_value TEXT;
  v_is_new_barcode BOOLEAN := FALSE;
  v_movement_type TEXT;
  v_qty_before NUMERIC := 0;
  v_qty_after NUMERIC := 0;
  v_prod_name TEXT;
  v_var_name TEXT := '';
BEGIN
  IF p_quantity_received < 0 THEN
    RAISE EXCEPTION 'Quantity received cannot be negative';
  END IF;

  -- 1. Check Parent Product Exists
  SELECT name INTO v_prod_name FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product with ID % not found', p_product_id;
  END IF;

  -- 2. Verify Variant Belongs to Product if Variant is Provided
  IF p_variant_id IS NOT NULL THEN
    v_entity_type := 'variant';
    SELECT variant_name, stock INTO v_var_name, v_qty_before
    FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant % does not belong to Product %', p_variant_id, p_product_id;
    END IF;
  ELSE
    v_entity_type := 'product';
    SELECT stock_quantity INTO v_qty_before
    FROM public.products
    WHERE id = p_product_id;
  END IF;

  -- 3. Check for Existing Active Barcode in barcode_registry (SKU Identity)
  IF v_entity_type = 'variant' THEN
    SELECT id, barcode_value INTO v_barcode_id, v_barcode_value
    FROM public.barcode_registry
    WHERE variant_id = p_variant_id AND is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    SELECT id, barcode_value INTO v_barcode_id, v_barcode_value
    FROM public.barcode_registry
    WHERE product_id = p_product_id AND variant_id IS NULL AND is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- 4. Reuse Existing or Create New Barcode
  IF v_barcode_id IS NOT NULL THEN
    v_is_new_barcode := FALSE;
    v_movement_type := CASE WHEN v_qty_before = 0 THEN 'INITIAL_BARCODE_STOCK' ELSE 'RESTOCK' END;
  ELSE
    v_is_new_barcode := TRUE;
    v_movement_type := 'INITIAL_BARCODE_STOCK';
    v_barcode_value := UPPER(COALESCE(NULLIF(BTRIM(p_custom_barcode), ''), public.generate_barcode_value(v_entity_type)));

    INSERT INTO public.barcode_registry (
      barcode_value, entity_type, product_id, variant_id, is_active, created_by_name
    )
    VALUES (
      v_barcode_value, v_entity_type, p_product_id, p_variant_id, TRUE, COALESCE(p_created_by_name, '')
    )
    RETURNING id INTO v_barcode_id;
  END IF;

  -- 5. Synchronize compatibility column on target table
  IF v_entity_type = 'variant' THEN
    UPDATE public.product_variants
    SET barcode = v_barcode_value, updated_at = NOW()
    WHERE id = p_variant_id;
  ELSE
    UPDATE public.products
    SET barcode = v_barcode_value, updated_at = NOW()
    WHERE id = p_product_id;
  END IF;

  -- 6. Apply Stock Increment & Parent Aggregate Sync (ONLY if quantity received > 0)
  IF p_quantity_received > 0 THEN
    v_qty_after := v_qty_before + p_quantity_received;

    IF v_entity_type = 'variant' THEN
      UPDATE public.product_variants
      SET stock = v_qty_after, updated_at = NOW()
      WHERE id = p_variant_id;

      -- Refresh parent aggregate stock cache
      UPDATE public.products
      SET stock_quantity = (
            SELECT COALESCE(SUM(stock), 0)
            FROM public.product_variants
            WHERE product_id = p_product_id AND is_active = TRUE
          ),
          stock = FLOOR((
            SELECT COALESCE(SUM(stock), 0)
            FROM public.product_variants
            WHERE product_id = p_product_id AND is_active = TRUE
          ))::INTEGER,
          updated_at = NOW()
      WHERE id = p_product_id;
    ELSE
      UPDATE public.products
      SET stock_quantity = v_qty_after,
          stock = FLOOR(v_qty_after)::INTEGER,
          updated_at = NOW()
      WHERE id = p_product_id;
    END IF;

    -- 7. Record Immutable Inventory Movement
    INSERT INTO public.inventory_movements (
      product_id, variant_id, barcode_id, movement_type,
      quantity_delta, quantity_before, quantity_after,
      unit_cost, reference_type, reference_id, note, created_by_name
    )
    VALUES (
      p_product_id, p_variant_id, v_barcode_id, v_movement_type,
      p_quantity_received, v_qty_before, v_qty_after,
      p_unit_cost, 'barcode_receipt', v_barcode_value,
      COALESCE(p_note, ''), COALESCE(p_created_by_name, '')
    );
  ELSE
    v_qty_after := v_qty_before;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'barcode_id', v_barcode_id,
    'barcode_value', v_barcode_value,
    'is_new_barcode', v_is_new_barcode,
    'movement_type', v_movement_type,
    'quantity_before', v_qty_before,
    'quantity_received', p_quantity_received,
    'quantity_after', v_qty_after,
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'product_name', v_prod_name,
    'variant_name', v_var_name
  );
END;
$$;
