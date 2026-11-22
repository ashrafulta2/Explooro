-- 111_home_band_ads.sql
--
-- Three premium formats for the band at the top of the home page: one per panel (left, centre,
-- right). A booked ad does not replace the panel; it takes turns with it, so the panel's own
-- content (orders to pack, top partners, shortcuts) is always the first thing shown and comes back
-- after every ad (client/src/components/home/BandAdRotator.ts).
--
--   1. HOME_BAND_LEFT / HOME_BAND_CENTER / HOME_BAND_RIGHT join the placement vocabulary.
--   2. Three ad_products rows. They price as FLAT_DAILY, like Homepage Spotlight, so the Ad Store,
--      the wizard, the quote engine, slot booking and /admin/growth/ad-pricing work unchanged
--      (CLAUDE.md: "Add a new kind of ad the platform sells"). The slot key is the placement itself.
--
-- WHY priced above Homepage Spotlight (৳1,500/day): these panels are the first thing every signed-in
-- supplier, partner and customer sees, above the fold, and only three ads share each panel a day.
-- The centre panel is the widest and gets the higher rate.
--
-- The seeded prices are STARTING prices; /admin/growth/ad-pricing owns them afterwards.
-- Safe to re-run.

ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_placement_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_placement_check
  CHECK (placement IN (
    'SEARCH_RESULTS', 'CATEGORY_BANNER', 'FEED', 'PRODUCT_PAGE',
    'HOME_HERO', 'STORE_DIRECTORY', 'LIVE_LOBBY', 'FLASH_STRIP', 'PUSH_INBOX',
    'SOURCING_CATALOG',
    'HOME_BAND_LEFT', 'HOME_BAND_CENTER', 'HOME_BAND_RIGHT'
  ));

INSERT INTO ad_products (
  key, name_en, name_bn, tagline_en, tagline_bn, description_en, description_bn,
  icon, placement, pricing_model, rate_card, allowed_roles, requires_review, requires_product,
  badge_key, is_enabled, sort_order
) VALUES
  ('home_band_center', 'Home Top Band — Centre', 'হোম টপ ব্যান্ড — মাঝখান',
   'The widest panel at the very top of the home page', 'হোম পেজের একদম উপরের সবচেয়ে চওড়া প্যানেল',
   'Your ad takes turns with the centre panel at the top of the home page, seen first by shoppers, Explooro partners and suppliers. Use a wide 16:9 image. Reserved by the day; three ads share the panel.',
   'হোম পেজের একদম উপরের মাঝখানের প্যানেলে আপনার বিজ্ঞাপন পালা করে দেখানো হয়, ক্রেতা, এক্সপ্লোরো পার্টনার আর সাপ্লায়ার সবাই প্রথমেই দেখেন। চওড়া ১৬:৯ ছবি দিন। দিন হিসেবে সংরক্ষিত; একটি প্যানেলে দিনে তিনটি বিজ্ঞাপন।',
   '🏆', 'HOME_BAND_CENTER', 'FLAT_DAILY',
   '{"daily_rate": 3000, "min_days": 1, "max_days": 14, "slots_per_period": 3, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, false, 'PREMIUM', true, 41),

  ('home_band_left', 'Home Top Band — Left', 'হোম টপ ব্যান্ড — বাম',
   'A tall panel at the top left of the home page', 'হোম পেজের উপরে বাম পাশের লম্বা প্যানেল',
   'Your ad takes turns with the left panel at the top of the home page. Use a tall 3:4 image. Reserved by the day; three ads share the panel.',
   'হোম পেজের উপরের বাম প্যানেলে আপনার বিজ্ঞাপন পালা করে দেখানো হয়। লম্বা ৩:৪ ছবি দিন। দিন হিসেবে সংরক্ষিত; একটি প্যানেলে দিনে তিনটি বিজ্ঞাপন।',
   '◧', 'HOME_BAND_LEFT', 'FLAT_DAILY',
   '{"daily_rate": 2000, "min_days": 1, "max_days": 14, "slots_per_period": 3, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, false, 'PREMIUM', true, 42),

  ('home_band_right', 'Home Top Band — Right', 'হোম টপ ব্যান্ড — ডান',
   'A tall panel at the top right of the home page', 'হোম পেজের উপরে ডান পাশের লম্বা প্যানেল',
   'Your ad takes turns with the right panel at the top of the home page. Use a tall 3:4 image. Reserved by the day; three ads share the panel.',
   'হোম পেজের উপরের ডান প্যানেলে আপনার বিজ্ঞাপন পালা করে দেখানো হয়। লম্বা ৩:৪ ছবি দিন। দিন হিসেবে সংরক্ষিত; একটি প্যানেলে দিনে তিনটি বিজ্ঞাপন।',
   '◨', 'HOME_BAND_RIGHT', 'FLAT_DAILY',
   '{"daily_rate": 2000, "min_days": 1, "max_days": 14, "slots_per_period": 3, "service_fee_percent": 0, "vat_percent": 0, "tier_discounts": {"STARTER": 0, "VERIFIED_TRADER": 5, "ELITE_PARTNER": 10}}'::jsonb,
   ARRAY['saler', 'supplier']::text[], true, false, 'PREMIUM', true, 43)
ON CONFLICT (key) DO NOTHING;   -- WHY DO NOTHING: never overwrite a price an admin has edited.
