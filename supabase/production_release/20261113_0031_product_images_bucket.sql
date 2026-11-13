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
