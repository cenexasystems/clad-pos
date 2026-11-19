-- ====================================================================
-- CLAD POS: everything added after migration 0027, in ONE file.
-- Run this ONCE in the MAIN (production) Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Every part is safe to run twice. Production already has migrations 0001-0027.
--
--   261102-0028  Barcode codes part 1 (other developer): 8-digit item codes. Part 2 replaces it, so it is safe even if already applied
--   261102-0029  Barcode codes part 2 (other developer): generated item codes are CLAD + 7 digits
--   261111-0028  Birthdays tab: customer birthdays, offers, message template
--   261111-0029  Coupons on WhatsApp: coupon image + send log
--   261112-0030  Edit bills in Order History (stock stays correct)
--   261113-0031  product-images storage bucket (product + coupon pictures)
--   261113-0032  Blank remarks / reference number no longer break a sale
--   261114-0033  Returns and refunds, return invoices
--   261115-0034  Settings page: shop profile, theme colour, passwords
--   261116-0035  Exchange: credit note + new bill in one step
--   261117-0036  Exchange bill: coupon, discount, GST, delivery
--   261118-0037  Refund adjustments on a plain return
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

-- >>>>>>>>>> 20261111_0028_customer_birthdays.sql <<<<<<<<<<

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

-- >>>>>>>>>> 20261111_0029_coupon_whatsapp_sharing.sql <<<<<<<<<<

-- ====================================================================
-- Migration 0029: Send coupons on WhatsApp (+ optional coupon image)
-- Safe to run multiple times.
-- ====================================================================

BEGIN;

-- Optional picture shown to the customer in the WhatsApp message (public URL)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Who each coupon was sent to, so the list can show "sent to N" and mark customers already messaged
CREATE TABLE IF NOT EXISTS public.coupon_sends (
  id BIGSERIAL PRIMARY KEY,
  coupon_id BIGINT NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupon_sends_coupon ON public.coupon_sends (coupon_id);

ALTER TABLE public.coupon_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coupon_sends_all ON public.coupon_sends;
CREATE POLICY coupon_sends_all ON public.coupon_sends FOR ALL USING (TRUE) WITH CHECK (TRUE);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>> 20261112_0030_update_order_with_stock.sql <<<<<<<<<<

-- ====================================================================
-- Migration 0030: Edit a bill from Order History (items, customer, payment)
-- Keeps stock correct: only the CHANGE in quantity is applied, and every change is
-- written to inventory_movements (SALE when more is sold, RETURN when less).
-- Safe to run multiple times.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.update_order_with_stock(
  p_order_id UUID,
  p_customer_name TEXT,
  p_phone TEXT,
  p_address TEXT,
  p_items JSONB,
  p_subtotal NUMERIC,
  p_total NUMERIC,
  p_delivery_charge NUMERIC DEFAULT 0,
  p_manual_discount_amount NUMERIC DEFAULT 0,
  p_total_gst NUMERIC DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_split_details JSONB DEFAULT '{}'::JSONB,
  p_remarks TEXT DEFAULT NULL,
  p_reference_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_old_items JSONB;
  v_row RECORD;
  v_item JSONB;
  v_before NUMERIC;
  v_name TEXT;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_is_manual BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A bill needs at least one item';
  END IF;

  -- What the bill held before: the order_items rows, or the items JSON on very old bills
  SELECT COALESCE(jsonb_agg(to_jsonb(oi)), '[]'::JSONB) INTO v_old_items
  FROM public.order_items oi WHERE oi.order_id = p_order_id;
  IF jsonb_array_length(v_old_items) = 0 AND jsonb_typeof(v_order.items) = 'array' THEN
    v_old_items := v_order.items;
  END IF;

  -- 1. Stock: apply only the difference between the old and the new quantities
  FOR v_row IN
    WITH old_lines AS (
      SELECT NULLIF(e ->> 'product_id', '')::BIGINT AS product_id,
             NULLIF(e ->> 'variant_id', '')::UUID AS variant_id,
             SUM(COALESCE((e ->> 'quantity')::NUMERIC, 0)) AS qty
      FROM jsonb_array_elements(v_old_items) e
      WHERE NOT COALESCE((e ->> 'is_manual')::BOOLEAN, FALSE)
        AND COALESCE((e ->> 'quantity')::NUMERIC, 0) > 0
      GROUP BY 1, 2
    ),
    new_lines AS (
      SELECT NULLIF(e ->> 'product_id', '')::BIGINT AS product_id,
             NULLIF(e ->> 'variant_id', '')::UUID AS variant_id,
             SUM(COALESCE((e ->> 'quantity')::NUMERIC, 0)) AS qty,
             MAX(COALESCE(e ->> 'product_name', e ->> 'name', 'Product')) AS item_name
      FROM jsonb_array_elements(p_items) e
      WHERE NOT COALESCE((e ->> 'is_manual')::BOOLEAN, FALSE)
        AND COALESCE((e ->> 'quantity')::NUMERIC, 0) > 0
      GROUP BY 1, 2
    )
    -- FULL JOIN needs plain equality, so NULL ids are swapped for 0 / the all-zero UUID while matching
    SELECT NULLIF(COALESCE(n.pk, o.pk), 0) AS product_id,
           NULLIF(COALESCE(n.vk, o.vk), '00000000-0000-0000-0000-000000000000'::UUID) AS variant_id,
           COALESCE(n.qty, 0) - COALESCE(o.qty, 0) AS delta,
           COALESCE(n.item_name, 'Product') AS item_name
    FROM (SELECT COALESCE(product_id, 0) AS pk, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::UUID) AS vk, qty, item_name FROM new_lines) n
    FULL OUTER JOIN (SELECT COALESCE(product_id, 0) AS pk, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::UUID) AS vk, qty FROM old_lines) o
      ON n.pk = o.pk AND n.vk = o.vk
  LOOP
    CONTINUE WHEN v_row.delta = 0;

    IF v_row.variant_id IS NOT NULL THEN
      SELECT stock INTO v_before FROM public.product_variants WHERE id = v_row.variant_id FOR UPDATE;
      CONTINUE WHEN v_before IS NULL; -- variant no longer exists

      IF v_row.delta > 0 AND v_before < v_row.delta THEN
        RAISE EXCEPTION 'Insufficient stock for % (Available: %, Extra needed: %)', v_row.item_name, v_before, v_row.delta;
      END IF;

      UPDATE public.product_variants
      SET stock = GREATEST(0, stock - v_row.delta), updated_at = NOW()
      WHERE id = v_row.variant_id;

      IF v_row.product_id IS NOT NULL THEN
        UPDATE public.products
        SET stock_quantity = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_row.product_id AND is_active = TRUE),
            stock = FLOOR((SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_row.product_id AND is_active = TRUE))::INTEGER,
            updated_at = NOW()
        WHERE id = v_row.product_id;
      END IF;
    ELSIF v_row.product_id IS NOT NULL THEN
      SELECT stock_quantity INTO v_before FROM public.products WHERE id = v_row.product_id FOR UPDATE;
      CONTINUE WHEN v_before IS NULL; -- product no longer exists

      IF v_row.delta > 0 AND v_before < v_row.delta THEN
        RAISE EXCEPTION 'Insufficient stock for % (Available: %, Extra needed: %)', v_row.item_name, v_before, v_row.delta;
      END IF;

      UPDATE public.products
      SET stock_quantity = GREATEST(0, stock_quantity - v_row.delta),
          stock = GREATEST(0, stock - CEIL(v_row.delta)::INTEGER),
          updated_at = NOW()
      WHERE id = v_row.product_id;
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, barcode_id, movement_type,
      quantity_delta, quantity_before, quantity_after,
      reference_type, reference_id, note
    )
    VALUES (
      v_row.product_id, v_row.variant_id, NULL,
      CASE WHEN v_row.delta > 0 THEN 'SALE' ELSE 'RETURN' END,
      -v_row.delta, v_before, GREATEST(0, v_before - v_row.delta),
      'order', v_order.invoice_no, 'Bill edited'
    );
  END LOOP;

  -- 2. Replace the bill lines
  DELETE FROM public.order_items WHERE order_id = p_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_name := COALESCE(v_item ->> 'product_name', v_item ->> 'name', 'Product');
    v_qty := COALESCE((v_item ->> 'quantity')::NUMERIC, 0);
    v_price := COALESCE((v_item ->> 'unit_price')::NUMERIC, (v_item ->> 'base_price')::NUMERIC, 0);
    v_is_manual := COALESCE((v_item ->> 'is_manual')::BOOLEAN, FALSE);

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, product_name, name,
      product_tamil_name, tamil_name, quantity, unit, unit_type,
      base_quantity, base_price, unit_price, line_total, image_url,
      is_manual, discount, gst_amount, gst_rate, variant_name,
      source, note, category, created_at
    )
    VALUES (
      p_order_id,
      NULLIF(v_item ->> 'product_id', '')::BIGINT,
      NULLIF(v_item ->> 'variant_id', '')::UUID,
      v_name, v_name,
      COALESCE(v_item ->> 'product_tamil_name', v_item ->> 'tamil_name', ''),
      COALESCE(v_item ->> 'product_tamil_name', v_item ->> 'tamil_name', ''),
      v_qty,
      COALESCE(v_item ->> 'unit', 'piece'),
      COALESCE(v_item ->> 'unit_type', 'unit'),
      COALESCE((v_item ->> 'base_quantity')::NUMERIC, 1),
      v_price, v_price,
      COALESCE((v_item ->> 'line_total')::NUMERIC, ROUND(v_qty * v_price, 2)),
      v_item ->> 'image_url',
      v_is_manual,
      COALESCE((v_item ->> 'discount')::NUMERIC, 0),
      COALESCE((v_item ->> 'gst_amount')::NUMERIC, 0),
      COALESCE((v_item ->> 'gst_rate')::NUMERIC, 0),
      v_item ->> 'variant_name',
      COALESCE(v_item ->> 'source', 'catalogue'),
      v_item ->> 'note',
      v_item ->> 'category',
      v_order.created_at
    );
  END LOOP;

  -- 3. Update the bill itself (invoice number, date and status stay as they were)
  UPDATE public.orders
  SET customer_name = COALESCE(NULLIF(BTRIM(p_customer_name), ''), customer_name),
      phone = COALESCE(p_phone, phone),
      address = COALESCE(p_address, address),
      items = p_items,
      subtotal = ROUND(COALESCE(p_subtotal, 0), 2),
      total = GREATEST(0, ROUND(COALESCE(p_total, 0), 2)),
      delivery_charge = COALESCE(p_delivery_charge, 0),
      manual_discount_amount = COALESCE(p_manual_discount_amount, 0),
      manual_discount_value = COALESCE(p_manual_discount_amount, 0),
      manual_discount_type = 'flat',
      total_gst = COALESCE(p_total_gst, 0),
      gst_amount = COALESCE(p_total_gst, 0),
      payment_method = COALESCE(NULLIF(BTRIM(p_payment_method), ''), payment_method),
      payment_mode = COALESCE(NULLIF(BTRIM(p_payment_method), ''), payment_mode),
      split_details = COALESCE(p_split_details, '{}'::JSONB),
      remarks = COALESCE(p_remarks, ''),
      reference_number = COALESCE(p_reference_number, ''),
      updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'invoice_no', v_order.invoice_no,
    'total', GREATEST(0, ROUND(COALESCE(p_total, 0), 2))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_order_with_stock(
  UUID, TEXT, TEXT, TEXT, JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, JSONB, TEXT, TEXT
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>> 20261113_0031_product_images_bucket.sql <<<<<<<<<<

-- ====================================================================
-- Migration 0031: 'product-images' storage bucket (product pictures + coupon images)
-- The app uploads to this bucket but no earlier migration created it.
-- Safe to run when the bucket already exists: an existing bucket is left as it is.
-- ====================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', TRUE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS product_images_public_read ON storage.objects;
CREATE POLICY product_images_public_read ON storage.objects FOR SELECT TO public USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS product_images_portal_upload ON storage.objects;
CREATE POLICY product_images_portal_upload ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS product_images_portal_update ON storage.objects;
CREATE POLICY product_images_portal_update ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'product-images') WITH CHECK (bucket_id = 'product-images');

-- >>>>>>>>>> 20261113_0032_orders_optional_remarks.sql <<<<<<<<<<

-- ====================================================================
-- Migration 0032: orders.remarks and orders.reference_number may be empty (NULL)
-- The POS sale function inserts NULL when the cashier leaves them blank, but migration 0011
-- made both columns NOT NULL, so on a database built from the migration files every sale failed
-- with: null value in column "remarks" violates not-null constraint.
-- Safe to run on a database where they are already nullable.
-- ====================================================================

ALTER TABLE public.orders ALTER COLUMN remarks DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN reference_number DROP NOT NULL;

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>> 20261114_0033_order_returns.sql <<<<<<<<<<

-- ====================================================================
-- Migration 0033: Returns & refunds
--   * order_returns: one row per return, with its own return number (RTN-00000001)
--   * create_order_return(): validates the quantities, works out the refund, optionally puts the
--     items back in stock, and saves the return. The original bill is never changed.
-- Refund rules:
--   - Delivery charge is NOT refunded.
--   - Each returned item is refunded at its price, minus its share of the bill discount (coupon +
--     extra discount), plus its share of the GST that was charged.
--   - Per item, the shop chooses whether it goes back into stock.
-- Safe to run multiple times.
-- ====================================================================

-- Return numbers come from a counter row (not a sequence) so a refund that fails leaves no gap
CREATE TABLE IF NOT EXISTS public.order_return_counter (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  counter BIGINT NOT NULL DEFAULT 0
);
INSERT INTO public.order_return_counter (id, counter) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.order_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL UNIQUE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  invoice_no TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::JSONB,
  items_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_share NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_share NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_charge_kept NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'cash',
  refund_split JSONB NOT NULL DEFAULT '{}'::JSONB,
  reason TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tables created by an earlier run of this file get the column too
ALTER TABLE public.order_returns ADD COLUMN IF NOT EXISTS confirmed_by TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_order_returns_order ON public.order_returns (order_id);
CREATE INDEX IF NOT EXISTS idx_order_returns_created ON public.order_returns (created_at DESC);

ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_returns_portal_manage ON public.order_returns;
CREATE POLICY order_returns_portal_manage ON public.order_returns FOR ALL TO anon, authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.create_order_return(
  p_order_id UUID,
  p_items JSONB,                       -- [{ "line_index": 0, "quantity": 1, "restock": true }, ...]
  p_refund_method TEXT DEFAULT 'cash', -- cash | card | qr | split
  p_refund_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT ''        -- who approved the refund (the admin)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_lines JSONB;
  v_subtotal NUMERIC := 0;
  v_discount_ratio NUMERIC := 0;
  v_gst_ratio NUMERIC := 0;
  v_pick JSONB;
  v_line JSONB;
  v_idx INTEGER;
  v_qty NUMERIC;
  v_restock BOOLEAN;
  v_ordered NUMERIC;
  v_already NUMERIC;
  v_line_total NUMERIC;
  v_base NUMERIC;
  v_disc NUMERIC;
  v_gst NUMERIC;
  v_refund NUMERIC;
  v_is_manual BOOLEAN;
  v_product_id BIGINT;
  v_variant_id UUID;
  v_before NUMERIC;
  v_restocked BOOLEAN;
  v_out JSONB := '[]'::JSONB;
  v_items_total NUMERIC := 0;
  v_disc_total NUMERIC := 0;
  v_gst_total NUMERIC := 0;
  v_refund_total NUMERIC := 0;
  v_return_no TEXT;
  v_counter BIGINT;
  v_return_id UUID;
  v_method TEXT := lower(COALESCE(NULLIF(BTRIM(p_refund_method), ''), 'cash'));
  v_split_sum NUMERIC;
  v_seen INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_lines := v_order.items;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'This bill has no items to return';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Choose at least one item to return';
  END IF;
  IF v_method NOT IN ('cash', 'card', 'qr', 'split') THEN
    RAISE EXCEPTION 'Choose a refund method (cash, card, GPay or split)';
  END IF;

  -- Bill subtotal, and each item's share of the discount and GST
  SELECT COALESCE(SUM(COALESCE((e ->> 'line_total')::NUMERIC,
           ROUND(COALESCE((e ->> 'quantity')::NUMERIC, 0) * COALESCE((e ->> 'base_price')::NUMERIC, (e ->> 'price')::NUMERIC, 0), 2))), 0)
    INTO v_subtotal
  FROM jsonb_array_elements(v_lines) e;

  IF v_subtotal > 0 THEN
    v_discount_ratio := LEAST(1, (COALESCE(v_order.discount_amount, 0) + COALESCE(v_order.manual_discount_amount, 0)) / v_subtotal);
    v_gst_ratio := COALESCE(v_order.total_gst, 0) / v_subtotal;
  END IF;

  UPDATE public.order_return_counter SET counter = counter + 1 WHERE id = 1 RETURNING counter INTO v_counter;
  v_return_no := 'RTN-' || LPAD(v_counter::TEXT, 8, '0');

  FOR v_pick IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := (v_pick ->> 'line_index')::INTEGER;
    v_qty := COALESCE((v_pick ->> 'quantity')::NUMERIC, 0);
    v_restock := COALESCE((v_pick ->> 'restock')::BOOLEAN, FALSE);

    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;
    IF v_idx = ANY (v_seen) THEN
      RAISE EXCEPTION 'The same item was chosen twice';
    END IF;
    v_seen := v_seen || v_idx;

    v_line := v_lines -> v_idx;
    IF v_line IS NULL THEN
      RAISE EXCEPTION 'Item % is not on this bill', v_idx + 1;
    END IF;

    v_ordered := COALESCE((v_line ->> 'quantity')::NUMERIC, 0);
    v_line_total := COALESCE((v_line ->> 'line_total')::NUMERIC,
                             ROUND(v_ordered * COALESCE((v_line ->> 'base_price')::NUMERIC, (v_line ->> 'price')::NUMERIC, 0), 2));

    SELECT COALESCE(SUM((ri ->> 'quantity')::NUMERIC), 0) INTO v_already
    FROM public.order_returns r, jsonb_array_elements(r.items) ri
    WHERE r.order_id = p_order_id AND (ri ->> 'line_index')::INTEGER = v_idx;

    IF v_ordered <= 0 OR v_qty > v_ordered - v_already THEN
      RAISE EXCEPTION 'Cannot return % of "%": only % left to return',
        v_qty, COALESCE(v_line ->> 'name', v_line ->> 'product_name', 'item'), GREATEST(0, v_ordered - v_already);
    END IF;

    v_base := ROUND(v_line_total * v_qty / v_ordered, 2);
    v_disc := ROUND(v_base * v_discount_ratio, 2);
    v_gst := ROUND(v_base * v_gst_ratio, 2);
    v_refund := v_base - v_disc + v_gst;

    v_is_manual := COALESCE((v_line ->> 'is_manual')::BOOLEAN, FALSE);
    v_product_id := NULLIF(v_line ->> 'product_id', '')::BIGINT;
    v_variant_id := NULLIF(v_line ->> 'variant_id', '')::UUID;
    v_restocked := FALSE;

    -- Put the items back in stock only when the shop chose to (manual items have no stock)
    IF v_restock AND NOT v_is_manual THEN
      IF v_variant_id IS NOT NULL THEN
        SELECT stock INTO v_before FROM public.product_variants WHERE id = v_variant_id FOR UPDATE;
        IF v_before IS NOT NULL THEN
          UPDATE public.product_variants SET stock = stock + v_qty, updated_at = NOW() WHERE id = v_variant_id;
          IF v_product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock_quantity = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE),
                stock = FLOOR((SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE))::INTEGER,
                updated_at = NOW()
            WHERE id = v_product_id;
          END IF;
          v_restocked := TRUE;
        END IF;
      ELSIF v_product_id IS NOT NULL THEN
        SELECT stock_quantity INTO v_before FROM public.products WHERE id = v_product_id FOR UPDATE;
        IF v_before IS NOT NULL THEN
          UPDATE public.products
          SET stock_quantity = stock_quantity + v_qty, stock = stock + CEIL(v_qty)::INTEGER, updated_at = NOW()
          WHERE id = v_product_id;
          v_restocked := TRUE;
        END IF;
      END IF;

      IF v_restocked THEN
        INSERT INTO public.inventory_movements (
          product_id, variant_id, barcode_id, movement_type,
          quantity_delta, quantity_before, quantity_after,
          reference_type, reference_id, note
        )
        VALUES (
          v_product_id, v_variant_id, NULL, 'RETURN',
          v_qty, v_before, v_before + v_qty,
          'return', v_return_no, 'Customer return (added back to stock)'
        );
      END IF;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_index', v_idx,
      'name', COALESCE(v_line ->> 'name', v_line ->> 'product_name', 'Item'),
      'product_id', v_line ->> 'product_id',
      'variant_id', v_line ->> 'variant_id',
      'variant_name', v_line ->> 'variant_name',
      'unit', COALESCE(v_line ->> 'unit', 'piece'),
      'is_manual', v_is_manual,
      'quantity', v_qty,
      'unit_price', ROUND(v_line_total / v_ordered, 2),
      'base_total', v_base,
      'discount_share', v_disc,
      'gst_share', v_gst,
      'refund_amount', v_refund,
      'restock', v_restock,
      'restocked', v_restocked
    ));

    v_items_total := v_items_total + v_base;
    v_disc_total := v_disc_total + v_disc;
    v_gst_total := v_gst_total + v_gst;
    v_refund_total := v_refund_total + v_refund;
  END LOOP;

  IF jsonb_array_length(v_out) = 0 THEN
    RAISE EXCEPTION 'Choose at least one item to return';
  END IF;

  IF v_method = 'split' THEN
    v_split_sum := COALESCE((p_refund_split ->> 'cash')::NUMERIC, 0)
                 + COALESCE((p_refund_split ->> 'card')::NUMERIC, 0)
                 + COALESCE((p_refund_split ->> 'qr')::NUMERIC, 0);
    IF ABS(v_split_sum - v_refund_total) > 0.005 THEN
      RAISE EXCEPTION 'Split refund amounts (%) must add up to the refund (%)', v_split_sum, v_refund_total;
    END IF;
  END IF;

  INSERT INTO public.order_returns (
    return_no, order_id, invoice_no, customer_name, phone, items,
    items_total, discount_share, gst_share, refund_total, delivery_charge_kept,
    refund_method, refund_split, reason, confirmed_by
  )
  VALUES (
    v_return_no, p_order_id, v_order.invoice_no, COALESCE(v_order.customer_name, ''), COALESCE(v_order.phone, ''), v_out,
    v_items_total, v_disc_total, v_gst_total, v_refund_total, COALESCE(v_order.delivery_charge, 0),
    v_method, CASE WHEN v_method = 'split' THEN COALESCE(p_refund_split, '{}'::JSONB) ELSE '{}'::JSONB END,
    COALESCE(BTRIM(p_reason), ''), COALESCE(BTRIM(p_confirmed_by), '')
  )
  RETURNING id INTO v_return_id;

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'return_no', v_return_no,
    'refund_total', v_refund_total
  );
END;
$$;

-- an earlier version of this function had no p_confirmed_by argument
DROP FUNCTION IF EXISTS public.create_order_return(UUID, JSONB, TEXT, JSONB, TEXT);

GRANT EXECUTE ON FUNCTION public.create_order_return(UUID, JSONB, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- >>>>>>>>>> 20261115_0034_shop_settings.sql <<<<<<<<<<

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

-- >>>>>>>>>> 20261116_0035_order_exchange.sql <<<<<<<<<<

-- ====================================================================
-- Migration 0035: Exchange (return items + take new items in one go)
--
-- create_exchange() does, in ONE transaction (so a half-done exchange can never be saved):
--   1. returns the chosen items from the original bill (credit note RTN-xxxxxxxx, delivery
--      charge never refunded, admin chooses per item whether it goes back into stock),
--   2. creates a NEW bill for the replacement items (own invoice number, stock deducted),
--   3. settles the difference:
--        new items cost more  -> the customer pays the difference (cash / card / GPay / split)
--        new items cost less  -> the shop pays back the difference (cash / card / GPay / split)
--        same value           -> nothing changes hands
--   The credit note and the new bill point at each other.
-- Also replaces create_order_return() with a version that understands exchanges.
-- Safe to run multiple times.
-- ====================================================================

ALTER TABLE public.order_returns
  ADD COLUMN IF NOT EXISTS exchange_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exchange_invoice_no TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS exchange_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_applied NUMERIC(12,2) NOT NULL DEFAULT 0;

-- the earlier 6-argument version is replaced by the one below (extra arguments have defaults)
DROP FUNCTION IF EXISTS public.create_order_return(UUID, JSONB, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_order_return(
  p_order_id UUID,
  p_items JSONB,                       -- [{ "line_index": 0, "quantity": 1, "restock": true }, ...]
  p_refund_method TEXT DEFAULT 'cash', -- cash | card | qr | split
  p_refund_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT '',      -- who approved the refund (the admin)
  p_exchange_total NUMERIC DEFAULT 0,  -- > 0 = this return is part of an exchange worth this much
  p_back_method TEXT DEFAULT 'cash',   -- exchange only: how the shop pays back any difference
  p_back_split JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_lines JSONB;
  v_subtotal NUMERIC := 0;
  v_discount_ratio NUMERIC := 0;
  v_gst_ratio NUMERIC := 0;
  v_pick JSONB;
  v_line JSONB;
  v_idx INTEGER;
  v_qty NUMERIC;
  v_restock BOOLEAN;
  v_ordered NUMERIC;
  v_already NUMERIC;
  v_line_total NUMERIC;
  v_base NUMERIC;
  v_disc NUMERIC;
  v_gst NUMERIC;
  v_refund NUMERIC;
  v_is_manual BOOLEAN;
  v_product_id BIGINT;
  v_variant_id UUID;
  v_before NUMERIC;
  v_restocked BOOLEAN;
  v_out JSONB := '[]'::JSONB;
  v_items_total NUMERIC := 0;
  v_disc_total NUMERIC := 0;
  v_gst_total NUMERIC := 0;
  v_refund_total NUMERIC := 0;
  v_return_no TEXT;
  v_counter BIGINT;
  v_return_id UUID;
  v_method TEXT := lower(COALESCE(NULLIF(BTRIM(p_refund_method), ''), 'cash'));
  v_split_sum NUMERIC;
  v_split_json JSONB := '{}'::JSONB;
  v_seen INTEGER[] := ARRAY[]::INTEGER[];
  v_is_exchange BOOLEAN := COALESCE(p_exchange_total, 0) > 0;
  v_applied NUMERIC := 0;
  v_back NUMERIC := 0;
  v_back_method TEXT;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_lines := v_order.items;
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'This bill has no items to return';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Choose at least one item to return';
  END IF;
  IF NOT v_is_exchange AND v_method NOT IN ('cash', 'card', 'qr', 'split') THEN
    RAISE EXCEPTION 'Choose a refund method (cash, card, GPay or split)';
  END IF;

  -- Bill subtotal, and each item's share of the discount and GST
  SELECT COALESCE(SUM(COALESCE((e ->> 'line_total')::NUMERIC,
           ROUND(COALESCE((e ->> 'quantity')::NUMERIC, 0) * COALESCE((e ->> 'base_price')::NUMERIC, (e ->> 'price')::NUMERIC, 0), 2))), 0)
    INTO v_subtotal
  FROM jsonb_array_elements(v_lines) e;

  IF v_subtotal > 0 THEN
    v_discount_ratio := LEAST(1, (COALESCE(v_order.discount_amount, 0) + COALESCE(v_order.manual_discount_amount, 0)) / v_subtotal);
    v_gst_ratio := COALESCE(v_order.total_gst, 0) / v_subtotal;
  END IF;

  UPDATE public.order_return_counter SET counter = counter + 1 WHERE id = 1 RETURNING counter INTO v_counter;
  v_return_no := 'RTN-' || LPAD(v_counter::TEXT, 8, '0');

  FOR v_pick IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := (v_pick ->> 'line_index')::INTEGER;
    v_qty := COALESCE((v_pick ->> 'quantity')::NUMERIC, 0);
    v_restock := COALESCE((v_pick ->> 'restock')::BOOLEAN, FALSE);

    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;
    IF v_idx = ANY (v_seen) THEN
      RAISE EXCEPTION 'The same item was chosen twice';
    END IF;
    v_seen := v_seen || v_idx;

    v_line := v_lines -> v_idx;
    IF v_line IS NULL THEN
      RAISE EXCEPTION 'Item % is not on this bill', v_idx + 1;
    END IF;

    v_ordered := COALESCE((v_line ->> 'quantity')::NUMERIC, 0);
    v_line_total := COALESCE((v_line ->> 'line_total')::NUMERIC,
                             ROUND(v_ordered * COALESCE((v_line ->> 'base_price')::NUMERIC, (v_line ->> 'price')::NUMERIC, 0), 2));

    SELECT COALESCE(SUM((ri ->> 'quantity')::NUMERIC), 0) INTO v_already
    FROM public.order_returns r, jsonb_array_elements(r.items) ri
    WHERE r.order_id = p_order_id AND (ri ->> 'line_index')::INTEGER = v_idx;

    IF v_ordered <= 0 OR v_qty > v_ordered - v_already THEN
      RAISE EXCEPTION 'Cannot return % of "%": only % left to return',
        v_qty, COALESCE(v_line ->> 'name', v_line ->> 'product_name', 'item'), GREATEST(0, v_ordered - v_already);
    END IF;

    v_base := ROUND(v_line_total * v_qty / v_ordered, 2);
    v_disc := ROUND(v_base * v_discount_ratio, 2);
    v_gst := ROUND(v_base * v_gst_ratio, 2);
    v_refund := v_base - v_disc + v_gst;

    v_is_manual := COALESCE((v_line ->> 'is_manual')::BOOLEAN, FALSE);
    v_product_id := NULLIF(v_line ->> 'product_id', '')::BIGINT;
    v_variant_id := NULLIF(v_line ->> 'variant_id', '')::UUID;
    v_restocked := FALSE;

    -- Put the items back in stock only when the shop chose to (manual items have no stock)
    IF v_restock AND NOT v_is_manual THEN
      IF v_variant_id IS NOT NULL THEN
        SELECT stock INTO v_before FROM public.product_variants WHERE id = v_variant_id FOR UPDATE;
        IF v_before IS NOT NULL THEN
          UPDATE public.product_variants SET stock = stock + v_qty, updated_at = NOW() WHERE id = v_variant_id;
          IF v_product_id IS NOT NULL THEN
            UPDATE public.products
            SET stock_quantity = (SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE),
                stock = FLOOR((SELECT COALESCE(SUM(stock), 0) FROM public.product_variants WHERE product_id = v_product_id AND is_active = TRUE))::INTEGER,
                updated_at = NOW()
            WHERE id = v_product_id;
          END IF;
          v_restocked := TRUE;
        END IF;
      ELSIF v_product_id IS NOT NULL THEN
        SELECT stock_quantity INTO v_before FROM public.products WHERE id = v_product_id FOR UPDATE;
        IF v_before IS NOT NULL THEN
          UPDATE public.products
          SET stock_quantity = stock_quantity + v_qty, stock = stock + CEIL(v_qty)::INTEGER, updated_at = NOW()
          WHERE id = v_product_id;
          v_restocked := TRUE;
        END IF;
      END IF;

      IF v_restocked THEN
        INSERT INTO public.inventory_movements (
          product_id, variant_id, barcode_id, movement_type,
          quantity_delta, quantity_before, quantity_after,
          reference_type, reference_id, note
        )
        VALUES (
          v_product_id, v_variant_id, NULL, 'RETURN',
          v_qty, v_before, v_before + v_qty,
          'return', v_return_no,
          CASE WHEN v_is_exchange THEN 'Exchange (returned item added back to stock)' ELSE 'Customer return (added back to stock)' END
        );
      END IF;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_index', v_idx,
      'name', COALESCE(v_line ->> 'name', v_line ->> 'product_name', 'Item'),
      'product_id', v_line ->> 'product_id',
      'variant_id', v_line ->> 'variant_id',
      'variant_name', v_line ->> 'variant_name',
      'unit', COALESCE(v_line ->> 'unit', 'piece'),
      'is_manual', v_is_manual,
      'quantity', v_qty,
      'unit_price', ROUND(v_line_total / v_ordered, 2),
      'base_total', v_base,
      'discount_share', v_disc,
      'gst_share', v_gst,
      'refund_amount', v_refund,
      'restock', v_restock,
      'restocked', v_restocked
    ));

    v_items_total := v_items_total + v_base;
    v_disc_total := v_disc_total + v_disc;
    v_gst_total := v_gst_total + v_gst;
    v_refund_total := v_refund_total + v_refund;
  END LOOP;

  IF jsonb_array_length(v_out) = 0 THEN
    RAISE EXCEPTION 'Choose at least one item to return';
  END IF;

  IF v_is_exchange THEN
    -- The returned items' value becomes credit against the new bill; only a surplus is paid back in money
    v_applied := LEAST(v_refund_total, p_exchange_total);
    v_back := v_refund_total - v_applied;
    IF v_back > 0.004 THEN
      v_back_method := lower(COALESCE(NULLIF(BTRIM(p_back_method), ''), 'cash'));
      IF v_back_method NOT IN ('cash', 'card', 'qr', 'split') THEN
        RAISE EXCEPTION 'Choose how the difference is paid back (cash, card, GPay or split)';
      END IF;
      IF v_back_method = 'split' THEN
        v_split_sum := COALESCE((p_back_split ->> 'cash')::NUMERIC, 0) + COALESCE((p_back_split ->> 'card')::NUMERIC, 0) + COALESCE((p_back_split ->> 'qr')::NUMERIC, 0);
        IF ABS(v_split_sum - v_back) > 0.005 THEN
          RAISE EXCEPTION 'Split amounts (%) must add up to the amount paid back (%)', v_split_sum, v_back;
        END IF;
        v_split_json := jsonb_build_object('exchange', v_applied,
          'cash', COALESCE((p_back_split ->> 'cash')::NUMERIC, 0), 'card', COALESCE((p_back_split ->> 'card')::NUMERIC, 0), 'qr', COALESCE((p_back_split ->> 'qr')::NUMERIC, 0));
      ELSE
        v_split_json := jsonb_build_object('exchange', v_applied, v_back_method, v_back);
      END IF;
      v_method := 'split';
    ELSE
      v_method := 'exchange';
      v_split_json := jsonb_build_object('exchange', v_applied);
    END IF;
  ELSIF v_method = 'split' THEN
    v_split_sum := COALESCE((p_refund_split ->> 'cash')::NUMERIC, 0)
                 + COALESCE((p_refund_split ->> 'card')::NUMERIC, 0)
                 + COALESCE((p_refund_split ->> 'qr')::NUMERIC, 0);
    IF ABS(v_split_sum - v_refund_total) > 0.005 THEN
      RAISE EXCEPTION 'Split refund amounts (%) must add up to the refund (%)', v_split_sum, v_refund_total;
    END IF;
    v_split_json := COALESCE(p_refund_split, '{}'::JSONB);
  END IF;

  INSERT INTO public.order_returns (
    return_no, order_id, invoice_no, customer_name, phone, items,
    items_total, discount_share, gst_share, refund_total, delivery_charge_kept,
    refund_method, refund_split, reason, confirmed_by, exchange_total, credit_applied
  )
  VALUES (
    v_return_no, p_order_id, v_order.invoice_no, COALESCE(v_order.customer_name, ''), COALESCE(v_order.phone, ''), v_out,
    v_items_total, v_disc_total, v_gst_total, v_refund_total, COALESCE(v_order.delivery_charge, 0),
    v_method, v_split_json,
    COALESCE(BTRIM(p_reason), ''), COALESCE(BTRIM(p_confirmed_by), ''),
    CASE WHEN v_is_exchange THEN p_exchange_total ELSE 0 END, v_applied
  )
  RETURNING id INTO v_return_id;

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'return_no', v_return_no,
    'refund_total', v_refund_total,
    'credit_applied', v_applied,
    'pay', GREATEST(0, COALESCE(p_exchange_total, 0) - v_applied),
    'back', v_back
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_return(UUID, JSONB, TEXT, JSONB, TEXT, TEXT, NUMERIC, TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_exchange(
  p_order_id UUID,
  p_return_items JSONB,                -- [{ "line_index": 0, "quantity": 1, "restock": true }, ...]
  p_new_items JSONB,                   -- the replacement items, in the same shape the POS sends to a sale
  p_pay_method TEXT DEFAULT 'cash',    -- how the customer pays any extra (cash | card | qr | split)
  p_pay_split JSONB DEFAULT '{}'::JSONB,
  p_back_method TEXT DEFAULT 'cash',   -- how the shop pays back any difference
  p_back_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_new_total NUMERIC;
  v_ret JSONB;
  v_sale JSONB;
  v_applied NUMERIC;
  v_pay NUMERIC;
  v_method TEXT := lower(COALESCE(NULLIF(BTRIM(p_pay_method), ''), 'cash'));
  v_payment_method TEXT;
  v_split JSONB;
  v_split_sum NUMERIC;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF p_new_items IS NULL OR jsonb_typeof(p_new_items) <> 'array' OR jsonb_array_length(p_new_items) = 0 THEN
    RAISE EXCEPTION 'Choose the new items for the exchange';
  END IF;

  SELECT COALESCE(SUM(COALESCE((e ->> 'line_total')::NUMERIC,
           ROUND(COALESCE((e ->> 'quantity')::NUMERIC, 0) * COALESCE((e ->> 'unit_price')::NUMERIC, (e ->> 'base_price')::NUMERIC, 0), 2))), 0)
    INTO v_new_total
  FROM jsonb_array_elements(p_new_items) e;
  IF v_new_total <= 0 THEN
    RAISE EXCEPTION 'The new items need a price';
  END IF;

  -- 1. the return (credit note). Anything wrong here cancels the whole exchange.
  v_ret := public.create_order_return(p_order_id, p_return_items, 'cash', '{}'::JSONB, p_reason, p_confirmed_by, v_new_total, p_back_method, p_back_split);
  v_applied := (v_ret ->> 'credit_applied')::NUMERIC;
  v_pay := v_new_total - v_applied;

  -- 2. how the new bill is paid: credit from the returned items plus whatever the customer adds
  IF v_pay > 0.004 THEN
    IF v_method NOT IN ('cash', 'card', 'qr', 'split') THEN
      RAISE EXCEPTION 'Choose how the customer pays the difference (cash, card, GPay or split)';
    END IF;
    IF v_method = 'split' THEN
      v_split_sum := COALESCE((p_pay_split ->> 'cash')::NUMERIC, 0) + COALESCE((p_pay_split ->> 'card')::NUMERIC, 0) + COALESCE((p_pay_split ->> 'qr')::NUMERIC, 0);
      IF ABS(v_split_sum - v_pay) > 0.005 THEN
        RAISE EXCEPTION 'Split payment amounts (%) must add up to the amount to pay (%)', v_split_sum, v_pay;
      END IF;
    END IF;
  END IF;

  IF v_pay <= 0.004 THEN
    v_payment_method := 'exchange';
    v_split := jsonb_build_object('exchange', v_applied);
  ELSIF v_applied <= 0.004 THEN
    v_payment_method := v_method;
    v_split := CASE WHEN v_method = 'split' THEN COALESCE(p_pay_split, '{}'::JSONB) ELSE '{}'::JSONB END;
  ELSE
    v_payment_method := 'split';
    v_split := jsonb_build_object('exchange', v_applied) ||
      CASE WHEN v_method = 'split'
        THEN jsonb_build_object('cash', COALESCE((p_pay_split ->> 'cash')::NUMERIC, 0), 'card', COALESCE((p_pay_split ->> 'card')::NUMERIC, 0), 'qr', COALESCE((p_pay_split ->> 'qr')::NUMERIC, 0))
        ELSE jsonb_build_object(v_method, v_pay)
      END;
  END IF;

  -- 3. the new bill (checks and deducts stock; if a new item is out of stock, everything above is undone)
  v_sale := public.complete_pos_sale_with_inventory(
    p_customer_name => v_order.customer_name,
    p_phone => v_order.phone,
    p_address => v_order.address,
    p_items => p_new_items,
    p_payment_method => v_payment_method,
    p_split_details => v_split,
    p_remarks => 'Exchange for bill ' || v_order.invoice_no || ' (' || (v_ret ->> 'return_no') || ')'
  );

  -- 4. link the credit note and the new bill both ways
  UPDATE public.order_returns
  SET exchange_order_id = (v_sale ->> 'order_id')::UUID,
      exchange_invoice_no = COALESCE(v_sale ->> 'invoice_no', '')
  WHERE id = (v_ret ->> 'return_id')::UUID;

  RETURN v_ret || jsonb_build_object(
    'new_order_id', v_sale ->> 'order_id',
    'new_invoice_no', v_sale ->> 'invoice_no',
    'new_total', v_new_total,
    'payment_method', v_payment_method
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_exchange(UUID, JSONB, JSONB, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- >>>>>>>>>> 20261117_0036_exchange_bill_options.sql <<<<<<<<<<
-- ====================================================================
-- Migration 0036: Exchange bill options
--
-- The new bill created by an exchange can now carry the same options as a normal POS bill:
-- coupon code, manual discount (flat or %), GST and a delivery charge.
--   new bill total = new items - coupon - manual discount + GST + delivery
-- The credit from the returned items is applied against that total.
-- Replaces create_exchange() (new arguments all have defaults, so older calls still work).
-- Safe to run multiple times. Requires migration 0035.
-- ====================================================================

DROP FUNCTION IF EXISTS public.create_exchange(UUID, JSONB, JSONB, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_exchange(
  p_order_id UUID,
  p_return_items JSONB,
  p_new_items JSONB,
  p_pay_method TEXT DEFAULT 'cash',
  p_pay_split JSONB DEFAULT '{}'::JSONB,
  p_back_method TEXT DEFAULT 'cash',
  p_back_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT '',
  p_delivery_charge NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,          -- coupon discount
  p_manual_discount_amount NUMERIC DEFAULT 0,
  p_manual_discount_type TEXT DEFAULT 'flat',
  p_manual_discount_value NUMERIC DEFAULT 0,
  p_coupon_code TEXT DEFAULT NULL,
  p_coupon_percentage NUMERIC DEFAULT 0,
  p_total_gst NUMERIC DEFAULT 0,
  p_gst_enabled BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_items_total NUMERIC;
  v_new_total NUMERIC;
  v_ret JSONB;
  v_sale JSONB;
  v_applied NUMERIC;
  v_pay NUMERIC;
  v_method TEXT := lower(COALESCE(NULLIF(BTRIM(p_pay_method), ''), 'cash'));
  v_payment_method TEXT;
  v_split JSONB;
  v_split_sum NUMERIC;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF p_new_items IS NULL OR jsonb_typeof(p_new_items) <> 'array' OR jsonb_array_length(p_new_items) = 0 THEN
    RAISE EXCEPTION 'Choose the new items for the exchange';
  END IF;

  SELECT COALESCE(SUM(COALESCE((e ->> 'line_total')::NUMERIC,
           ROUND(COALESCE((e ->> 'quantity')::NUMERIC, 0) * COALESCE((e ->> 'unit_price')::NUMERIC, (e ->> 'base_price')::NUMERIC, 0), 2))), 0)
    INTO v_items_total
  FROM jsonb_array_elements(p_new_items) e;
  IF v_items_total <= 0 THEN
    RAISE EXCEPTION 'The new items need a price';
  END IF;

  -- the new bill's grand total, the same way the POS adds it up
  v_new_total := GREATEST(0, ROUND(
    v_items_total
    - GREATEST(0, COALESCE(p_discount_amount, 0))
    - GREATEST(0, COALESCE(p_manual_discount_amount, 0))
    + CASE WHEN COALESCE(p_gst_enabled, FALSE) THEN GREATEST(0, COALESCE(p_total_gst, 0)) ELSE 0 END
    + GREATEST(0, COALESCE(p_delivery_charge, 0)), 2));

  -- 1. the return (credit note). Anything wrong here cancels the whole exchange.
  v_ret := public.create_order_return(p_order_id, p_return_items, 'cash', '{}'::JSONB, p_reason, p_confirmed_by, v_new_total, p_back_method, p_back_split);
  v_applied := (v_ret ->> 'credit_applied')::NUMERIC;
  v_pay := v_new_total - v_applied;

  -- 2. how the new bill is paid: credit from the returned items plus whatever the customer adds
  IF v_pay > 0.004 THEN
    IF v_method NOT IN ('cash', 'card', 'qr', 'split') THEN
      RAISE EXCEPTION 'Choose how the customer pays the difference (cash, card, GPay or split)';
    END IF;
    IF v_method = 'split' THEN
      v_split_sum := COALESCE((p_pay_split ->> 'cash')::NUMERIC, 0) + COALESCE((p_pay_split ->> 'card')::NUMERIC, 0) + COALESCE((p_pay_split ->> 'qr')::NUMERIC, 0);
      IF ABS(v_split_sum - v_pay) > 0.005 THEN
        RAISE EXCEPTION 'Split payment amounts (%) must add up to the amount to pay (%)', v_split_sum, v_pay;
      END IF;
    END IF;
  END IF;

  IF v_pay <= 0.004 THEN
    v_payment_method := 'exchange';
    v_split := jsonb_build_object('exchange', v_applied);
  ELSIF v_applied <= 0.004 THEN
    v_payment_method := v_method;
    v_split := CASE WHEN v_method = 'split' THEN COALESCE(p_pay_split, '{}'::JSONB) ELSE '{}'::JSONB END;
  ELSE
    v_payment_method := 'split';
    v_split := jsonb_build_object('exchange', v_applied) ||
      CASE WHEN v_method = 'split'
        THEN jsonb_build_object('cash', COALESCE((p_pay_split ->> 'cash')::NUMERIC, 0), 'card', COALESCE((p_pay_split ->> 'card')::NUMERIC, 0), 'qr', COALESCE((p_pay_split ->> 'qr')::NUMERIC, 0))
        ELSE jsonb_build_object(v_method, v_pay)
      END;
  END IF;

  -- 3. the new bill (checks and deducts stock; if a new item is out of stock, everything above is undone)
  v_sale := public.complete_pos_sale_with_inventory(
    p_customer_name => v_order.customer_name,
    p_phone => v_order.phone,
    p_address => v_order.address,
    p_items => p_new_items,
    p_delivery_charge => GREATEST(0, COALESCE(p_delivery_charge, 0)),
    p_discount_amount => GREATEST(0, COALESCE(p_discount_amount, 0)),
    p_manual_discount_amount => GREATEST(0, COALESCE(p_manual_discount_amount, 0)),
    p_manual_discount_type => COALESCE(NULLIF(p_manual_discount_type, ''), 'flat'),
    p_manual_discount_value => COALESCE(p_manual_discount_value, 0),
    p_coupon_code => NULLIF(BTRIM(COALESCE(p_coupon_code, '')), ''),
    p_coupon_percentage => COALESCE(p_coupon_percentage, 0),
    p_payment_method => v_payment_method,
    p_split_details => v_split,
    p_total_gst => CASE WHEN COALESCE(p_gst_enabled, FALSE) THEN GREATEST(0, COALESCE(p_total_gst, 0)) ELSE 0 END,
    p_gst_enabled => COALESCE(p_gst_enabled, FALSE),
    p_remarks => 'Exchange for bill ' || v_order.invoice_no || ' (' || (v_ret ->> 'return_no') || ')'
  );

  -- the sale function does not subtract the manual discount or add GST to the stored total; set it right
  UPDATE public.orders SET total = v_new_total WHERE id = (v_sale ->> 'order_id')::UUID;

  -- 4. link the credit note and the new bill both ways
  UPDATE public.order_returns
  SET exchange_order_id = (v_sale ->> 'order_id')::UUID,
      exchange_invoice_no = COALESCE(v_sale ->> 'invoice_no', '')
  WHERE id = (v_ret ->> 'return_id')::UUID;

  RETURN v_ret || jsonb_build_object(
    'new_order_id', v_sale ->> 'order_id',
    'new_invoice_no', v_sale ->> 'invoice_no',
    'new_total', v_new_total,
    'payment_method', v_payment_method
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_exchange(UUID, JSONB, JSONB, TEXT, JSONB, TEXT, JSONB, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC, NUMERIC, BOOLEAN) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- >>>>>>>>>> 20261118_0037_return_adjustments.sql <<<<<<<<<<
-- ====================================================================
-- Migration 0037: Refund adjustments on a plain return
-- Coupon / manual discount / delivery are deducted from the refund, GST is added.
-- Stored on the credit note so the return invoice can print them.
-- Wraps create_order_return() (migration 0035), which is left untouched.
-- Safe to run multiple times.
-- ====================================================================

ALTER TABLE public.order_returns
  ADD COLUMN IF NOT EXISTS adj_coupon_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS adj_coupon_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adj_manual_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adj_gst NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adj_delivery NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.create_order_return_adjusted(
  p_order_id UUID,
  p_items JSONB,
  p_refund_method TEXT DEFAULT 'cash',
  p_refund_split JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT '',
  p_confirmed_by TEXT DEFAULT '',
  p_coupon_code TEXT DEFAULT NULL,
  p_coupon_discount NUMERIC DEFAULT 0,
  p_manual_discount NUMERIC DEFAULT 0,
  p_gst NUMERIC DEFAULT 0,
  p_delivery NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_method TEXT := lower(COALESCE(NULLIF(BTRIM(p_refund_method), ''), 'cash'));
  v_ret JSONB;
  v_id UUID;
  v_base NUMERIC;
  v_final NUMERIC;
  v_split_sum NUMERIC;
BEGIN
  IF v_method NOT IN ('cash', 'card', 'qr', 'split') THEN
    RAISE EXCEPTION 'Choose a refund method (cash, card, GPay or split)';
  END IF;

  v_ret := public.create_order_return(p_order_id, p_items, 'cash', '{}'::JSONB, p_reason, p_confirmed_by);
  v_id := (v_ret ->> 'return_id')::UUID;
  SELECT refund_total INTO v_base FROM public.order_returns WHERE id = v_id;

  v_final := GREATEST(0, ROUND(v_base - GREATEST(0, COALESCE(p_coupon_discount, 0)) - GREATEST(0, COALESCE(p_manual_discount, 0))
                               + GREATEST(0, COALESCE(p_gst, 0)) - GREATEST(0, COALESCE(p_delivery, 0)), 2));

  IF v_method = 'split' THEN
    v_split_sum := COALESCE((p_refund_split ->> 'cash')::NUMERIC, 0) + COALESCE((p_refund_split ->> 'card')::NUMERIC, 0) + COALESCE((p_refund_split ->> 'qr')::NUMERIC, 0);
    IF ABS(v_split_sum - v_final) > 0.005 THEN
      RAISE EXCEPTION 'Split refund amounts (%) must add up to the refund (%)', v_split_sum, v_final;
    END IF;
  END IF;

  UPDATE public.order_returns
  SET refund_total = v_final,
      refund_method = v_method,
      refund_split = CASE WHEN v_method = 'split' THEN COALESCE(p_refund_split, '{}'::JSONB) ELSE '{}'::JSONB END,
      adj_coupon_code = COALESCE(BTRIM(p_coupon_code), ''),
      adj_coupon_discount = GREATEST(0, COALESCE(p_coupon_discount, 0)),
      adj_manual_discount = GREATEST(0, COALESCE(p_manual_discount, 0)),
      adj_gst = GREATEST(0, COALESCE(p_gst, 0)),
      adj_delivery = GREATEST(0, COALESCE(p_delivery, 0))
  WHERE id = v_id;

  RETURN v_ret || jsonb_build_object('refund_total', v_final);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_return_adjusted(UUID, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
