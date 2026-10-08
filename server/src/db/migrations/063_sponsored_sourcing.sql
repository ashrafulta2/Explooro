-- 063_sponsored_sourcing.sql (supplier attraction, step 2: the Sponsored Sourcing Slot)
--
-- Suppliers could already buy ads, but every placement sold to shoppers. Salers choosing what to
-- stock were a second audience with real purchase intent and nothing to sell them. This adds the
-- placement and the product that fills it:
--
--   1. SOURCING_CATALOG joins the placement vocabulary (a campaign row cannot carry a value the
--      CHECK does not list).
--   2. `sourcing_boost` is ONE ad_products row. It prices like CPC, so the seller's Ad Store, the
--      wizard, the quote engine and the metered click billing all work unchanged
--      (CLAUDE.md: "Add a new kind of ad the platform sells").
--   3. `supplier.sponsored_sourcing` holds the two rules that are specific to this placement.
--
-- WHY suppliers only: a saler advertising to other salers would sell a supplier's margin back to
-- the people who compete for it. The slot exists to help a supplier reach salers.
--
-- The seeded prices are STARTING prices; /admin/growth/ad-pricing owns them afterwards.

ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_placement_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_placement_check
  CHECK (placement IN (
    'SEARCH_RESULTS', 'CATEGORY_BANNER', 'FEED', 'PRODUCT_PAGE',
    'HOME_HERO', 'STORE_DIRECTORY', 'LIVE_LOBBY', 'FLASH_STRIP', 'PUSH_INBOX',
    'SOURCING_CATALOG'
  ));

INSERT INTO ad_products (
  key, name_en, name_bn, tagline_en, tagline_bn, description_en, description_bn,
  icon, placement, pricing_model, rate_card, allowed_roles, requires_review, requires_product,
  badge_key, is_enabled, sort_order
) VALUES
  ('sourcing_boost', 'Sponsored Sourcing Slot', 'স্পনসর্ড সোর্সিং স্লট',
   'Get your product in front of salers choosing what to stock', 'কী স্টক করবেন তা ঠিক করছেন এমন সেলারদের সামনে পণ্য তুলে ধরুন',
   'Your product is pinned above the Sourcing Catalog, marked Sponsored. You pay only when a saler clicks, and a better Supplier Scorecard grade ranks you higher for the same bid.',
   'আপনার পণ্য সোর্সিং ক্যাটালগের উপরে "স্পনসর্ড" চিহ্নসহ দেখানো হয়। সেলার ক্লিক করলেই কেবল টাকা কাটা হয়, আর ভালো স্কোরকার্ড গ্রেড থাকলে একই বিডে উপরে থাকবেন।',
   '📦', 'SOURCING_CATALOG', 'CPC',
   '{"floor_cpc": 2.00, "suggested_cpc": 4.00, "min_budget": 500, "min_days": 1, "max_days": 60, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['supplier']::text[], true, true, 'NEW', true, 15)
ON CONFLICT (key) DO NOTHING;   -- WHY DO NOTHING: never overwrite a price an admin has edited.

-- Business numbers live in platform_settings, never in code (CLAUDE.md). One OBJECT row.
--   max_slots          how many sponsored cards one catalog view may show (1..6)
--   grade_rank_bonus   added to a campaign's quality multiplier by the supplier's scorecard grade.
--                      Positive lifts, negative sinks; "NEW" is a supplier with no grade yet
--   blocked_grades     grades that may neither buy this slot nor keep serving it
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'supplier.sponsored_sourcing',
    '{
      "max_slots": 2,
      "grade_rank_bonus": { "A": 0.3, "B": 0.15, "C": 0, "D": -0.25, "NEW": 0 },
      "blocked_grades": ["D"]
    }'::jsonb,
    'OBJECT',
    'Sponsored sourcing slot rules',
    'স্পনসর্ড সোর্সিং স্লটের নিয়ম',
    'scorecard',
    false
  )
ON CONFLICT (key) DO NOTHING;
