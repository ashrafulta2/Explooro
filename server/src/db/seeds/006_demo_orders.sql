-- 006_demo_orders.sql (Prompt 4.6)
-- Minimal DELIVERED orders for the dev customer so the review "must have a delivered order" gate
-- (docs/prompt.md Prompt 4.6 ACCEPTANCE) is genuinely enforceable and demoable, not faked. One
-- item (Sundarbans honey, product 41) is deliberately left un-reviewed so the "write a review" CTA
-- on a purchased-but-not-yet-reviewed product can be exercised live. One item (keyboard, product
-- 16) is left SHIPPED, not DELIVERED, so "purchased but not yet delivered" is distinguishable from
-- "never purchased" (both correctly cannot review, for different reasons).
--
-- Split figures use the 40% saler / 60% platform DEFAULT_FALLBACK from pricing.service.js — this
-- is historical seed data, not a live-computed transaction, so it does not call the service.

INSERT INTO orders (
  ref, customer_id, total_amount, items_amount, shipping_amount, discount_amount,
  payment_method, payment_status, is_otp_verified, recipient_name, recipient_phone,
  division, district, address_line, placed_at
)
SELECT x.ref, u.id, x.total_amount, x.items_amount, 60.00, 0,
       'BKASH', 'PAID', true, 'Dev Customer', '+8801700000007',
       'Dhaka', 'Dhaka', 'House 12, Road 5, Dhanmondi, Dhaka-1209', x.placed_at::timestamptz
FROM (VALUES
  ('ORD-DEMO-0001', 1710.00, 1650.00, now() - interval '20 days'),
  ('ORD-DEMO-0002', 3310.00, 3250.00, now() - interval '15 days'),
  ('ORD-DEMO-0003', 810.00,  750.00,  now() - interval '10 days'),
  ('ORD-DEMO-0004', 6560.00, 6500.00, now() - interval '25 days'),
  ('ORD-DEMO-0005', 2210.00, 2150.00, now() - interval '8 days'),
  ('ORD-DEMO-0006', 3160.00, 3100.00, now() - interval '2 days')
) AS x(ref, total_amount, items_amount, placed_at)
CROSS JOIN (SELECT id FROM users WHERE phone = '+8801700000007') AS u
ON CONFLICT (ref) DO NOTHING;

INSERT INTO sub_orders (
  ref, order_id, supplier_id, subtotal_base, wholesale_margin, net_retail_margin,
  saler_commission, platform_margin, shipping_amount, total_amount, status, delivered_at
)
SELECT x.ref, o.id, x.supplier_id, x.subtotal_base, x.wholesale_margin, x.net_retail_margin,
       x.saler_commission, x.platform_margin, 60.00, x.total_amount, x.status, x.delivered_at::timestamptz
FROM (VALUES
  -- supplier_id 5/102/103 — see 005_demo_catalog.sql's header note: phone +8801700000005 resolves
  -- to user id 5 (002_dev_users.sql owns it), not the literal 101 the business-identity rows use.
  ('SUB-DEMO-0001-1', 'ORD-DEMO-0001', 5,   1100.00, 150.00, 400.00, 160.00, 240.00, 1710.00, 'DELIVERED', now() - interval '14 days'),
  ('SUB-DEMO-0002-1', 'ORD-DEMO-0002', 102, 2200.00, 300.00, 750.00, 300.00, 450.00, 3310.00, 'DELIVERED', now() - interval '10 days'),
  ('SUB-DEMO-0003-1', 'ORD-DEMO-0003', 103,  450.00,  70.00, 230.00,  92.00, 138.00,  810.00, 'DELIVERED', now() - interval '6 days'),
  ('SUB-DEMO-0004-1', 'ORD-DEMO-0004', 5,   4200.00, 600.00,1700.00, 680.00,1020.00, 6560.00, 'DELIVERED', now() - interval '18 days'),
  ('SUB-DEMO-0005-1', 'ORD-DEMO-0005', 102, 1400.00, 200.00, 550.00, 220.00, 330.00, 2210.00, 'DELIVERED', now() - interval '4 days'),
  ('SUB-DEMO-0006-1', 'ORD-DEMO-0006', 102, 2100.00, 280.00, 720.00, 288.00, 432.00, 3160.00, 'SHIPPED', NULL)
) AS x(ref, order_ref, supplier_id, subtotal_base, wholesale_margin, net_retail_margin,
       saler_commission, platform_margin, total_amount, status, delivered_at)
JOIN orders o ON o.ref = x.order_ref
ON CONFLICT (ref) DO NOTHING;

INSERT INTO order_items (
  sub_order_id, product_id, variant_id, title_snapshot, qty, base_price, retail_price, line_total
)
SELECT so.id, x.product_id, variant_sku_lookup.id, x.title_snapshot, 1, x.base_price, x.retail_price, x.retail_price
FROM (VALUES
  ('SUB-DEMO-0001-1', 1,  'PANJ-MRN-L', 'Premium Combed Cotton Semi-Long Panjabi - Maroon (L)', 1100.00, 1650.00),
  ('SUB-DEMO-0002-1', 11, 'WATCH-BLK',  'Ultra 2 Smartwatch (Black Silicone)',                  2200.00, 3250.00),
  ('SUB-DEMO-0003-1', 41, NULL,         '100% Pure Raw Sundarbans Mangrove Forest Honey 500g',    450.00,  750.00),
  ('SUB-DEMO-0004-1', 5,  NULL,         'Authentic Handloom Dhakai Jamdani Saree - Crimson Red',  4200.00, 6500.00),
  ('SUB-DEMO-0005-1', 12, 'TWS-BLK',    'Noise-Cancelling TWS Wireless Earbuds (Matte Black)',   1400.00, 2150.00),
  ('SUB-DEMO-0006-1', 16, 'KB-RED-SW',  '75% Mechanical Keyboard (Linear Red)',                  2100.00, 3100.00)
) AS x(sub_order_ref, product_id, variant_sku, title_snapshot, base_price, retail_price)
JOIN sub_orders so ON so.ref = x.sub_order_ref
LEFT JOIN LATERAL (
  SELECT id FROM product_variants WHERE sku = x.variant_sku
) AS variant_sku_lookup ON true
WHERE NOT EXISTS (
  SELECT 1 FROM order_items oi WHERE oi.sub_order_id = so.id AND oi.product_id = x.product_id
);
