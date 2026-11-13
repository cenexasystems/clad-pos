-- ====================================================================
-- CLAD POS: everything added after migration 0027, in one file.
-- Run this ONCE in the production Supabase SQL editor (Dashboard > SQL Editor > New query).
-- Every part is safe to run twice. Production already has migrations 0001-0027.
--
--   0028  Birthdays tab: customer birthdays, offers, message template
--   0029  Coupons on WhatsApp: coupon image + send log
--   0030  Edit bills in Order History (fixes stock for quantity changes)
--   0031  product-images storage bucket (product pictures + coupon images)
--   0032  Blank remarks / reference number no longer break a sale
-- ====================================================================

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
