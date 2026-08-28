-- 012_demo_flash_sales.sql (Prompt 9.2: Flash Sales Demo Data)
-- Seeds realistic active flash sales into PostgreSQL.

INSERT INTO flash_sales (
  id, ref, title, product_id, discount_price, original_price, allocated_qty, sold_qty, reserved_qty, per_user_limit, starts_at, ends_at, status
) VALUES
  (1, 'FLS-DHK-001', 'Flash Deal: Semi-Long Panjabi', 1, 1250.00, 1650.00, 50, 12, 0, 2, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (2, 'FLS-DHK-002', 'Flash Deal: Oxford Casual Shirt', 2, 990.00, 1350.00, 40, 8, 0, 2, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (3, 'FLS-DHK-005', 'Flash Deal: Dhakai Jamdani Saree', 5, 4950.00, 6500.00, 15, 5, 0, 1, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (4, 'FLS-DHK-008', 'Flash Deal: Leather Bifold Wallet', 8, 790.00, 1150.00, 60, 22, 0, 3, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (5, 'FLS-DHK-009', 'Flash Deal: Smartphone Case', 9, 280.00, 350.00, 100, 45, 0, 5, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (6, 'FLS-DHK-010', 'Flash Deal: Wireless Earbuds', 10, 1390.00, 1800.00, 30, 14, 0, 2, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (7, 'FLS-DHK-014', 'Flash Deal: Block Print Kurti', 14, 690.00, 890.00, 40, 16, 0, 2, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (8, 'FLS-DHK-015', 'Flash Deal: Gold Plated Bracelet', 15, 480.00, 650.00, 50, 19, 0, 3, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (9, 'FLS-DHK-019', 'Flash Deal: Handmade Chocolate', 19, 320.00, 420.00, 35, 11, 0, 2, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (10, 'FLS-DHK-021', 'Flash Deal: Women Sandal Collection', 21, 550.00, 720.00, 45, 18, 0, 2, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (11, 'FLS-DHK-023', 'Flash Deal: Educational Board Game', 23, 850.00, 1100.00, 25, 9, 0, 2, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'),
  (12, 'FLS-DHK-030', 'Flash Deal: Smart Watch Fitness Band', 30, 2690.00, 3500.00, 20, 7, 0, 1, now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE')
ON CONFLICT (ref) DO UPDATE
SET status = 'ACTIVE',
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    discount_price = EXCLUDED.discount_price;
