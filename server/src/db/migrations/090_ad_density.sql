-- 090_ad_density.sql
--
-- Sponsored cards are placed INSIDE the search results and home feed grids
-- (client/src/components/ads/adPlacement.ts). How often they appear decides whether ads are seen
-- or resented, so it is configuration, not a constant (CLAUDE.md: business numbers live in settings).
--
--   ads.density.<PLACEMENT>.first_at  the organic card the first ad goes in front of (0 = first)
--   ads.density.<PLACEMENT>.every     organic cards from one ad to the next
--
-- Edited at /admin/growth/ad-pricing behind `growth.ad.govern` (HIGH, delegable). Bounds live in
-- server/src/services/adDensity.service.ts, not in a CHECK, so retuning them needs no migration.
--
-- ON CONFLICT DO NOTHING: safe to re-run, and never stamps an admin's choice back to the default.

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'ads.density',
  '{"SEARCH_RESULTS": {"first_at": 0, "every": 8}, "FEED": {"first_at": 2, "every": 8}}'::jsonb,
  'OBJECT', 'Sponsored card density', 'স্পন্সর্ড কার্ডের ঘনত্ব', 'growth', false
)
ON CONFLICT (key) DO NOTHING;
