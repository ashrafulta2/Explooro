-- 041_ad_marketplace.sql — Multi-format ad marketplace with admin-governed pricing.
--
-- 021_ads.sql shipped exactly one thing a seller could buy: a CPC sponsored slot, priced by
-- whatever the seller typed into a "Max CPC Bid" box. The platform had no way to say what an ad
-- costs, and no second format to sell. This migration turns advertising into a priced catalogue:
--
--   1. ad_products    — the sellable ad formats. Each carries a rate_card (JSONB) that anyone with
--                       `growth.ad.govern` edits from /admin/growth/ad-pricing. Pricing is DATA,
--                       per CLAUDE.md ("Change the profit split / any business number →
--                       configuration, not code"), so a new price is an admin action, not a deploy.
--   2. ad_slot_bookings — day-level inventory for the formats that rent a fixed placement
--                       (category banner, homepage spotlight, live spotlight). One row per slot
--                       per day makes "is this slot free next Tuesday?" a unique-index question
--                       instead of a range-overlap query, and stops two sellers buying the same
--                       banner for the same day.
--   3. ad_campaigns extensions — which product was bought, under which pricing model, the quote
--                       frozen at purchase, and what was prepaid. The frozen quote matters: an
--                       admin raising the daily rate tomorrow must not retroactively re-price a
--                       campaign a seller already paid for.
--
-- The seeded rate card values below are STARTING prices only. They are the defaults a fresh
-- install boots with; the admin rate-card editor owns them from that point on.

-- ---------------------------------------------------------------------------------------------
-- 1. Ad product catalogue
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_products (
  id                BIGSERIAL PRIMARY KEY,
  key               TEXT UNIQUE NOT NULL,
  name_en           TEXT NOT NULL,
  name_bn           TEXT NOT NULL,
  tagline_en        TEXT NOT NULL DEFAULT '',
  tagline_bn        TEXT NOT NULL DEFAULT '',
  description_en    TEXT NOT NULL DEFAULT '',
  description_bn    TEXT NOT NULL DEFAULT '',
  icon              TEXT NOT NULL DEFAULT '📢',
  placement         TEXT NOT NULL,
  pricing_model     TEXT NOT NULL CHECK (pricing_model IN ('CPC', 'CPM', 'FLAT_DAILY', 'FLAT_SLOT', 'CPS', 'CPA')),
  rate_card         JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_roles     TEXT[] NOT NULL DEFAULT ARRAY['saler', 'supplier']::text[],
  requires_review   BOOLEAN NOT NULL DEFAULT true,
  requires_product  BOOLEAN NOT NULL DEFAULT true,   -- does the creative need a product attached?
  badge_key         TEXT,                            -- POPULAR | PREMIUM | NEW | BEST_VALUE
  is_enabled        BOOLEAN NOT NULL DEFAULT true,
  sort_order        INT NOT NULL DEFAULT 100,
  updated_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ad_products_enabled ON ad_products (is_enabled, sort_order);

-- ---------------------------------------------------------------------------------------------
-- 2. Reserved-placement inventory (one row per slot per day)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_slot_bookings (
  id                BIGSERIAL PRIMARY KEY,
  campaign_id       BIGINT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  ad_product_id     BIGINT NOT NULL REFERENCES ad_products(id) ON DELETE RESTRICT,
  slot_key          TEXT NOT NULL,                   -- 'HOME_HERO' | 'CATEGORY:42' | 'LIVE_LOBBY'
  slot_index        INT NOT NULL,                    -- which of slots_per_period this booking holds
  booking_date      DATE NOT NULL,
  amount            NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WHY a unique index and not an EXCLUDE constraint: expanding a booking to one row per day makes
-- double-booking a plain uniqueness violation, which needs no btree_gist extension (Neon free
-- tier) and reads the same in every query plan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_slot_bookings_slot_day
  ON ad_slot_bookings (slot_key, slot_index, booking_date);
CREATE INDEX IF NOT EXISTS idx_ad_slot_bookings_campaign ON ad_slot_bookings (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_slot_bookings_date ON ad_slot_bookings (booking_date, slot_key);

-- ---------------------------------------------------------------------------------------------
-- 3. ad_campaigns — carry the purchased product, its pricing model and the frozen quote
-- ---------------------------------------------------------------------------------------------
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS ad_product_id BIGINT REFERENCES ad_products(id) ON DELETE SET NULL;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS pricing_model TEXT NOT NULL DEFAULT 'CPC';
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'METERED';
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS prepaid_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS duration_days INT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS quantity INT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS slot_key TEXT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS quote_json JSONB;

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_product ON ad_campaigns (ad_product_id);

-- Widen the placement vocabulary: 021 only knew the four surfaces the CPC format could appear on.
ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_placement_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_placement_check
  CHECK (placement IN (
    'SEARCH_RESULTS', 'CATEGORY_BANNER', 'FEED', 'PRODUCT_PAGE',
    'HOME_HERO', 'STORE_DIRECTORY', 'LIVE_LOBBY', 'FLASH_STRIP', 'PUSH_INBOX'
  ));

-- SCHEDULED: a prepaid placement that is paid for and approved but whose first booked day has not
-- arrived yet. Without it those campaigns had to sit in ACTIVE and would have been served early.
ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_status_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_status_check
  CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'REJECTED'));

-- Prepaid formats do not bid, so a positive CPC bid can no longer be required of every campaign.
ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_bid_amount_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_bid_amount_check CHECK (bid_amount >= 0);

ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_billing_mode_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_billing_mode_check
  CHECK (billing_mode IN ('METERED', 'PREPAID'));

-- ---------------------------------------------------------------------------------------------
-- 4. Seed the sellable formats
-- ---------------------------------------------------------------------------------------------
INSERT INTO ad_products (
  key, name_en, name_bn, tagline_en, tagline_bn, description_en, description_bn,
  icon, placement, pricing_model, rate_card, allowed_roles, requires_review, requires_product,
  badge_key, is_enabled, sort_order
) VALUES
  ('search_boost', 'Search Boost', 'সার্চ বুস্ট',
   'Appear at the top when shoppers search', 'ক্রেতারা খুঁজলেই সবার উপরে দেখান',
   'Your product is placed above organic results for the keywords you choose. You pay only when a shopper actually clicks.',
   'আপনার বেছে নেওয়া কিওয়ার্ডে সার্চ ফলাফলের সবার উপরে পণ্য দেখানো হয়। ক্রেতা ক্লিক করলেই কেবল টাকা কাটা হয়।',
   '🔍', 'SEARCH_RESULTS', 'CPC',
   '{"floor_cpc": 1.00, "suggested_cpc": 2.50, "min_budget": 300, "min_days": 1, "max_days": 90, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, true, 'POPULAR', true, 10),

  ('feed_promotion', 'Home Feed Promotion', 'হোম ফিড প্রমোশন',
   'Blend into the shopper''s home feed', 'ক্রেতার হোম ফিডে স্বাভাবিকভাবে দেখান',
   'A native card inside the scrolling home feed. Priced per thousand views, so a large audience stays affordable.',
   'হোম ফিডের ভেতরে স্বাভাবিক কার্ড হিসেবে দেখানো হয়। প্রতি হাজার ভিউ হিসেবে দাম, তাই বড় অডিয়েন্সেও খরচ কম।',
   '📱', 'FEED', 'CPM',
   '{"cpm_rate": 80, "min_budget": 500, "min_days": 1, "max_days": 60, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, true, NULL, true, 20),

  ('category_banner', 'Category Banner Takeover', 'ক্যাটেগরি ব্যানার',
   'Own the banner above a whole category', 'পুরো ক্যাটেগরির উপরের ব্যানার দখল করুন',
   'A full-width banner at the top of one category page, reserved for the days you book. Fixed price, no bidding.',
   'একটি ক্যাটেগরি পেজের উপরে পুরো প্রস্থের ব্যানার, আপনার বুক করা দিনগুলোর জন্য সংরক্ষিত। নির্দিষ্ট দাম, কোনো নিলাম নেই।',
   '🏷️', 'CATEGORY_BANNER', 'FLAT_DAILY',
   '{"daily_rate": 450, "min_days": 3, "max_days": 30, "slots_per_period": 4, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, false, 'BEST_VALUE', true, 30),

  ('home_spotlight', 'Homepage Spotlight', 'হোমপেজ স্পটলাইট',
   'The first thing every visitor sees', 'প্রতিটি ভিজিটর প্রথমেই যা দেখে',
   'A slide in the homepage hero carousel. The highest-traffic surface on Explooro, sold as a reserved daily slot.',
   'হোমপেজের প্রধান ক্যারোসেলে একটি স্লাইড। এক্সপ্লোরোর সবচেয়ে বেশি ট্রাফিকের জায়গা, দৈনিক সংরক্ষিত স্লট হিসেবে বিক্রি হয়।',
   '🌟', 'HOME_HERO', 'FLAT_DAILY',
   '{"daily_rate": 1500, "min_days": 1, "max_days": 14, "slots_per_period": 5, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, false, 'PREMIUM', true, 40),

  ('product_page_ads', 'Competitor Page Ads', 'প্রতিযোগীর পেজে বিজ্ঞাপন',
   'Show up on similar products'' pages', 'একই ধরনের পণ্যের পেজে দেখান',
   'Your product appears in the "Sponsored" strip on other sellers'' product pages, in front of shoppers already ready to buy.',
   'অন্য বিক্রেতার পণ্য পেজের "স্পনসর্ড" অংশে আপনার পণ্য দেখানো হয় — যেখানে ক্রেতা এমনিতেই কিনতে প্রস্তুত।',
   '🎯', 'PRODUCT_PAGE', 'CPC',
   '{"floor_cpc": 1.50, "suggested_cpc": 3.00, "min_budget": 300, "min_days": 1, "max_days": 90, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, true, NULL, true, 50),

  ('store_boost', 'Storefront Boost', 'স্টোরফ্রন্ট বুস্ট',
   'Promote your whole shop, not one product', 'একটি পণ্য নয় — পুরো দোকান প্রচার করুন',
   'Your storefront is featured in the store directory and "Shops you may like" for the days you book.',
   'আপনার বুক করা দিনগুলোতে স্টোর ডিরেক্টরি ও "আপনার পছন্দ হতে পারে" অংশে আপনার দোকান দেখানো হয়।',
   '🏬', 'STORE_DIRECTORY', 'FLAT_DAILY',
   '{"daily_rate": 180, "min_days": 7, "max_days": 90, "slots_per_period": 8, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, false, NULL, true, 60),

  ('live_spotlight', 'Live Stream Spotlight', 'লাইভ স্ট্রিম স্পটলাইট',
   'Feature your live show on the lobby', 'লাইভ লবিতে আপনার শো হাইলাইট করুন',
   'Your live stream is pinned to the top of the live lobby and pushed to followers when it starts. Sold per stream.',
   'আপনার লাইভ স্ট্রিম লাইভ লবির শীর্ষে পিন করা হয় এবং শুরু হলে ফলোয়ারদের জানানো হয়। প্রতি স্ট্রিম হিসেবে বিক্রি।',
   '🎥', 'LIVE_LOBBY', 'FLAT_SLOT',
   '{"slot_rate": 600, "min_quantity": 1, "max_quantity": 20, "slots_per_period": 3, "min_days": 1, "max_days": 30, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, false, NULL, true, 70),

  ('flash_slot', 'Flash Sale Featured Slot', 'ফ্ল্যাশ সেল ফিচার্ড স্লট',
   'Get into the countdown strip', 'কাউন্টডাউন স্ট্রিপে জায়গা নিন',
   'A guaranteed position in the homepage flash-sale strip for one sale event. You set the discount; we bring the traffic.',
   'একটি সেল ইভেন্টের জন্য হোমপেজ ফ্ল্যাশ সেল স্ট্রিপে নিশ্চিত জায়গা। ছাড় আপনি ঠিক করবেন, ট্রাফিক আমরা আনব।',
   '⚡', 'FLASH_STRIP', 'FLAT_SLOT',
   '{"slot_rate": 2000, "min_quantity": 1, "max_quantity": 10, "slots_per_period": 6, "min_days": 1, "max_days": 14, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, true, NULL, true, 80),

  ('push_blast', 'Push Notification Blast', 'পুশ নোটিফিকেশন ব্লাস্ট',
   'Land directly in the shopper''s notifications', 'সরাসরি ক্রেতার নোটিফিকেশনে পৌঁছান',
   'A single promotional push to opted-in shoppers who match your targeting. Priced per recipient delivered.',
   'আপনার টার্গেটিং-এর সাথে মেলে এমন সম্মতি দেওয়া ক্রেতাদের কাছে একটি প্রচারমূলক পুশ। প্রতি প্রাপক হিসেবে দাম।',
   '🔔', 'PUSH_INBOX', 'CPS',
   '{"cps_rate": 0.35, "min_quantity": 1000, "max_quantity": 200000, "min_days": 1, "max_days": 1, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, false, NULL, true, 90)
ON CONFLICT (key) DO NOTHING;   -- WHY DO NOTHING: re-running the migration must never overwrite
                                -- prices an admin has since edited in the rate-card editor.

-- ---------------------------------------------------------------------------------------------
-- 5. Backfill: every campaign created before this migration was a CPC search ad.
-- ---------------------------------------------------------------------------------------------
UPDATE ad_campaigns c
SET ad_product_id = p.id,
    pricing_model = 'CPC',
    billing_mode = 'METERED'
FROM ad_products p
WHERE c.ad_product_id IS NULL
  AND p.key = CASE c.placement
                WHEN 'PRODUCT_PAGE' THEN 'product_page_ads'
                WHEN 'FEED' THEN 'feed_promotion'
                WHEN 'CATEGORY_BANNER' THEN 'category_banner'
                ELSE 'search_boost'
              END;

-- ---------------------------------------------------------------------------------------------
-- 6. Module settings gain the marketplace-wide switches
-- ---------------------------------------------------------------------------------------------
UPDATE platform_modules
SET settings_schema = '{"type": "object", "properties": {
      "max_ads_per_page": { "type": "integer", "default": 3 },
      "min_daily_budget": { "type": "number", "default": 50 },
      "require_creative_review": { "type": "boolean", "default": true },
      "allow_self_serve_purchase": { "type": "boolean", "default": true },
      "blocked_keywords": { "type": "array", "items": { "type": "string" } }
    } }'::jsonb,
    settings_json = settings_json || '{"allow_self_serve_purchase": true}'::jsonb
WHERE key = 'sponsored_ads';
