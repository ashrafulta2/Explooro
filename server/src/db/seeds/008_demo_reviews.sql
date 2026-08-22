-- 008_demo_reviews.sql (Prompt 4.6)
-- Historical reviews inserted directly (bypassing the submission endpoint), the same way any
-- seed represents pre-existing fact. Deliberately does NOT cover product 41 (Sundarbans honey,
-- SUB-DEMO-0003-1) — that order is left un-reviewed so "write a review" can be exercised live by
-- the dev customer for a product they genuinely purchased and received.

INSERT INTO reviews (product_id, order_item_id, user_id, rating, title, body, is_verified_purchase, helpful_count, status, coins_awarded)
SELECT x.product_id, oi.id, u.id, x.rating, x.title, x.body, true, x.helpful_count, 'PUBLISHED', x.coins
FROM (VALUES
  (1,  'SUB-DEMO-0001-1', 5, 'Beautiful fabric, true to size',
   'The maroon color is richer in person than the photos show. The embroidery on the collar is neat and the cotton feels premium — no itching even after a full day of Eid visiting. Ordered L, fit was perfect for my height.',
   12, 20),
  (11, 'SUB-DEMO-0002-1', 4, 'Great smartwatch for the price',
   'Display is genuinely AMOLED-bright even in Dhaka afternoon sun. Battery lasts just under a week with always-on off. Bluetooth calling is a bit muffled outdoors but fine for home use. Docked one star for the stock strap feeling cheap.',
   8, 15),
  (5,  'SUB-DEMO-0004-1', 5, 'Authentic Jamdani, worth every taka',
   'You can tell this is genuinely hand-woven — the motifs are not printed, the thread count feels dense. Arrived well packed in a cloth bag, not crushed. This is the second saree I have bought from this supplier and both were exactly as described.',
   24, 25),
  (12, 'SUB-DEMO-0005-1', 4, 'Good noise cancellation, mic could be better',
   'ANC handles bus and rickshaw noise well. Call quality drops if there is wind. Charging case shows battery percentage which is a nice touch. Comfortable for 2+ hour listening sessions.',
   5, 15)
) AS x(product_id, sub_order_ref, rating, title, body, helpful_count, coins)
JOIN sub_orders so ON so.ref = x.sub_order_ref
JOIN order_items oi ON oi.sub_order_id = so.id AND oi.product_id = x.product_id
CROSS JOIN (SELECT id FROM users WHERE phone = '+8801700000007') AS u
ON CONFLICT (order_item_id, user_id) DO NOTHING;

-- One photo review, so ReviewList's photo/video grid has something real to render.
INSERT INTO media_assets (ref, owner_id, purpose, storage_driver, storage_key, mime_type, size_bytes, width, height, moderation_status)
SELECT 'MED-SEED-REVIEW-1', u.id, 'REVIEW', 'LOCAL', 'seed/reviews/r1-panjabi-1.jpg', 'image/jpeg', 96000, 900, 900, 'APPROVED'
FROM (SELECT id FROM users WHERE phone = '+8801700000007') AS u
ON CONFLICT (ref) DO NOTHING;

INSERT INTO review_media (review_id, media_id, media_kind, moderation_status, display_order)
SELECT r.id, m.id, 'IMAGE', 'APPROVED', 0
FROM reviews r
JOIN order_items oi ON oi.id = r.order_item_id
JOIN sub_orders so ON so.id = oi.sub_order_id AND so.ref = 'SUB-DEMO-0001-1'
CROSS JOIN (SELECT id FROM media_assets WHERE ref = 'MED-SEED-REVIEW-1') AS m
WHERE r.product_id = 1
  AND NOT EXISTS (SELECT 1 FROM review_media rm WHERE rm.review_id = r.id AND rm.media_id = m.id);
