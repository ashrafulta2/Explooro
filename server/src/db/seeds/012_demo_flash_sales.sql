-- 012_demo_flash_sales.sql (Prompt 9.2: Flash Sales Demo Data)
-- Seeds realistic active flash sales into PostgreSQL.
--
-- WHY prices and titles come from the product: retail is derived from the supplier price (seed.ts
-- re-prices products right after 005), so typed prices went stale and some sat below the supplier's
-- price. Each sale names only a discount %: the deal is that much off today's retail, rounded down to
-- ৳10, never below the supplier price (base_cost + wholesale_margin) and always under retail, which
-- flashSale.service refuses otherwise. The title is the product's own, so it can never name another item.

INSERT INTO flash_sales (
  id, ref, title, product_id, discount_price, original_price, allocated_qty, sold_qty, reserved_qty, per_user_limit, starts_at, ends_at, status
)
SELECT d.id, d.ref, 'Flash Deal: ' || p.title_en, p.id,
       GREATEST(p.base_cost + p.wholesale_margin, floor(p.default_retail_price * (100 - d.pct) / 1000) * 10),
       p.default_retail_price, d.allocated_qty, d.sold_qty, 0, d.per_user_limit,
       now() - INTERVAL '1 hour', now() + INTERVAL '4 hours', 'ACTIVE'
FROM (VALUES
  (1, 'FLS-DHK-001', 1, 10, 50, 12, 2),
  (2, 'FLS-DHK-002', 2, 10, 40, 8, 2),
  (3, 'FLS-DHK-005', 5, 8, 15, 5, 1),
  (4, 'FLS-DHK-008', 8, 10, 60, 22, 3),
  (5, 'FLS-DHK-009', 9, 12, 100, 45, 5),
  (6, 'FLS-DHK-010', 10, 10, 30, 14, 2),
  (7, 'FLS-DHK-014', 14, 12, 40, 16, 2),
  (8, 'FLS-DHK-015', 15, 10, 50, 19, 3),
  (9, 'FLS-DHK-019', 19, 8, 35, 11, 2),
  (10, 'FLS-DHK-021', 21, 12, 45, 18, 2),
  (11, 'FLS-DHK-023', 23, 10, 25, 9, 2),
  (12, 'FLS-DHK-030', 30, 10, 20, 7, 1)
) AS d(id, ref, product_id, pct, allocated_qty, sold_qty, per_user_limit)
JOIN products p ON p.id = d.product_id
ON CONFLICT (ref) DO UPDATE
SET status = 'ACTIVE',
    title = EXCLUDED.title,
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    discount_price = EXCLUDED.discount_price,
    original_price = EXCLUDED.original_price;
