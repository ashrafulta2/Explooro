-- 076_order_attribution.sql — record which shop partner's promotion brought each sale.
--
-- WHY: a shop partner earns for promoting a supplier's product, so an order must remember whose
-- storefront or tracked link the shopper came through. Before this, nothing did: the client never
-- sent a shop partner on add-to-cart, `saler_ref` in a short link's target was never read, and
-- `recordShortLinkConversion` had no caller. Every order was therefore unattributed and the shop
-- partner's share fell to the platform (see vault.service.ts).
--
-- The shopper's last touch (a storefront visit or a short link click) travels with the cart line;
-- attribution.service.ts decides whether it still counts. Idempotent: safe to run twice.

-- 1. Where a cart line's shop partner came from.
ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS short_link_id      BIGINT REFERENCES short_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_source TEXT;

-- 2. The same on the parcel that pays the shop partner.
ALTER TABLE sub_orders
  ADD COLUMN IF NOT EXISTS short_link_id      BIGINT REFERENCES short_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_source TEXT;

-- 3. Each sold line keeps its own shop partner. A parcel pays one shop partner, so when one
--    supplier's parcel mixes lines from two partners the per-line truth is kept here for the
--    earning engine (Phase C) instead of being lost.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS saler_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_attribution_source_check') THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_items_attribution_source_check
      CHECK (attribution_source IS NULL OR attribution_source IN ('STOREFRONT', 'SHORT_LINK'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sub_orders_attribution_source_check') THEN
    ALTER TABLE sub_orders ADD CONSTRAINT sub_orders_attribution_source_check
      CHECK (attribution_source IS NULL OR attribution_source IN ('STOREFRONT', 'SHORT_LINK'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sub_orders_short_link ON sub_orders (short_link_id) WHERE short_link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_saler ON order_items (saler_id) WHERE saler_id IS NOT NULL;

-- 4. Business numbers live in platform_settings, never in code. One OBJECT row.
--   window_days   how long a storefront visit or link click keeps counting (1..90)
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'attribution.rules',
  '{ "window_days": 7 }'::jsonb,
  'OBJECT',
  'Sale attribution rules',
  'বিক্রয় অ্যাট্রিবিউশনের নিয়ম',
  'growth',
  false
)
ON CONFLICT (key) DO NOTHING;
