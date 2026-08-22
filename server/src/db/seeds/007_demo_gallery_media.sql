-- 007_demo_gallery_media.sql (Prompt 4.6)
-- Seeds media_assets + product_images so ImageGallery has real rows to read (gallery thumbnails,
-- primary image, per-variant image_id). storage_key paths point to files that do not exist on disk
-- in a fresh dev checkout — GET /api/v1/storage/* 404s for them, same as any other missing upload —
-- ImageGallery.js falls back to the same initials placeholder ProductCard.js already uses, so this
-- degrades visibly but harmlessly rather than being silently faked.

INSERT INTO media_assets (ref, owner_id, purpose, storage_driver, storage_key, mime_type, size_bytes, width, height, moderation_status)
SELECT x.ref, p.supplier_id, 'PRODUCT', 'LOCAL', x.storage_key, 'image/jpeg', 128000, 1200, 1200, 'APPROVED'
FROM (VALUES
  ('MED-SEED-P1-1', 1, 'seed/products/p1-1.jpg'),
  ('MED-SEED-P1-2', 1, 'seed/products/p1-2.jpg'),
  ('MED-SEED-P1-3', 1, 'seed/products/p1-3.jpg'),
  ('MED-SEED-P5-1', 5, 'seed/products/p5-1.jpg'),
  ('MED-SEED-P5-2', 5, 'seed/products/p5-2.jpg'),
  ('MED-SEED-P11-1', 11, 'seed/products/p11-1.jpg'),
  ('MED-SEED-P11-2', 11, 'seed/products/p11-2.jpg'),
  ('MED-SEED-P12-1', 12, 'seed/products/p12-1.jpg'),
  ('MED-SEED-P41-1', 41, 'seed/products/p41-1.jpg')
) AS x(ref, product_id, storage_key)
JOIN products p ON p.id = x.product_id
ON CONFLICT (ref) DO NOTHING;

INSERT INTO product_images (product_id, media_id, display_order, is_primary)
SELECT x.product_id, m.id, x.display_order, x.is_primary
FROM (VALUES
  (1, 'MED-SEED-P1-1', 0, true),
  (1, 'MED-SEED-P1-2', 1, false),
  (1, 'MED-SEED-P1-3', 2, false),
  (5, 'MED-SEED-P5-1', 0, true),
  (5, 'MED-SEED-P5-2', 1, false),
  (11, 'MED-SEED-P11-1', 0, true),
  (11, 'MED-SEED-P11-2', 1, false),
  (12, 'MED-SEED-P12-1', 0, true),
  (41, 'MED-SEED-P41-1', 0, true)
) AS x(product_id, media_ref, display_order, is_primary)
JOIN media_assets m ON m.ref = x.media_ref
WHERE NOT EXISTS (
  SELECT 1 FROM product_images pi WHERE pi.product_id = x.product_id AND pi.media_id = m.id
);

-- Attach an image to two of product 1's variants so VariantSelector's "image swaps with variant" behaviour is real.
UPDATE product_variants SET image_id = (SELECT id FROM media_assets WHERE ref = 'MED-SEED-P1-2')
WHERE sku = 'PANJ-MRN-L';
UPDATE product_variants SET image_id = (SELECT id FROM media_assets WHERE ref = 'MED-SEED-P1-3')
WHERE sku = 'PANJ-MRN-XL';
