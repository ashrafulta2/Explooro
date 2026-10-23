-- 087_ads_for_everyone.sql
--
-- Phase C of the shop-partner-as-advertiser model: anyone can advertise, through one simple format.
--
--   * `easy_boost` — "Boost": a native card in the home feed, priced per thousand views (CPM, the same
--     model and auction as Home Feed Promotion). It needs no product, so a customer can boost their
--     own community post, a shop partner their store, a supplier a product. Open to every account
--     type; the nine existing formats keep their own `allowed_roles` and the full wizard.
--   * `ads.audience` — the business numbers behind audience selection (services/adAudience.service.ts):
--       min_audience_size     a narrowed audience smaller than this is refused, so an ad can never be
--                             aimed at a handful of identifiable people
--       interest_window_days  "interested in X" = viewed, carted, wishlisted or bought in category X
--                             within this many days
--
-- The `growth.ad.manage_own` permission now also reaches customers (docs/permission-catalog.json,
-- re-seeded); the `can_run_ads` restriction still blocks anyone an admin has stopped.
--
-- Safe to re-run.

INSERT INTO ad_products (
  key, name_en, name_bn, tagline_en, tagline_bn, description_en, description_bn,
  icon, placement, pricing_model, rate_card, allowed_roles, requires_review, requires_product,
  badge_key, is_enabled, sort_order
) VALUES (
  'easy_boost', 'Boost', 'বুস্ট',
  'Show your post, store or product to the people you choose', 'আপনার পোস্ট, দোকান বা পণ্য আপনার বেছে নেওয়া মানুষদের দেখান',
  'A card in the home feed, shown only to the audience you pick. You set a budget and the number of days; it is spent per thousand views.',
  'হোম ফিডে একটি কার্ড, শুধু আপনার বেছে নেওয়া মানুষদের দেখানো হয়। আপনি বাজেট আর কত দিন চলবে ঠিক করেন; প্রতি হাজার বার দেখানোয় খরচ হয়।',
  '🚀', 'FEED', 'CPM',
  '{"cpm_rate": 80, "min_budget": 200, "min_days": 1, "max_days": 30, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
  ARRAY['customer', 'saler', 'supplier']::text[], true, false, 'NEW', true, 5
)
ON CONFLICT (key) DO NOTHING;   -- an admin's later price edit is never overwritten

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'ads.audience',
  '{"min_audience_size": 20, "interest_window_days": 90}'::jsonb,
  'OBJECT', 'Ad audience rules', 'বিজ্ঞাপনের দর্শকের নিয়ম', 'growth', false
)
ON CONFLICT (key) DO NOTHING;
