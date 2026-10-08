-- 058_recommendation_diversity_settings.sql (personalized feed, Phase D: candidate pool + diversity)
--
-- The blended score says how relevant each product is; it says nothing about the LIST. Ranked purely
-- by score a page can be eight products from one supplier, and a shopper's profile only reinforces
-- itself. services/diversity.service.js therefore takes the top `pool_size` products by score, then
-- re-orders them so no supplier / category / brand dominates any short stretch of the list, and
-- reserves a slot every few places for something unrelated to the shopper's history.
--
-- How diverse a list should be is a merchandising decision, so it lives here and not in code
-- (CLAUDE.md: "Configuration, not code"). One OBJECT row, same group as 056 and 057 so the whole
-- recommendation policy reads as a unit:
--   enabled           false = rank strictly by score (the pre-Phase-D behaviour)
--   pool_size         how many top-scored products are considered (20..500). It also bounds how deep a
--                     paged feed can scroll, because pages are cut from this pool.
--   window            the stretch of consecutive picks the caps below are measured over (2..30)
--   max_per_supplier  at most this many products from one supplier inside any `window` picks (1..30)
--   max_per_category  same, per category (1..30)
--   max_per_brand     same, per brand (1..30); products with no brand are never capped
--   explore_every     every Nth slot goes to the best product unrelated to the shopper's profile
--                     (2..50); 0 switches exploration off
--
-- A product held back by a cap is not dropped: it keeps its place in the queue and is taken as soon as
-- it fits, so the pass only ever reorders.
--
-- ON CONFLICT DO NOTHING keeps a re-run from stamping a live platform's tuned values back to the
-- defaults.

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'recommendation.diversity',
    '{
      "enabled": true,
      "pool_size": 120,
      "window": 6,
      "max_per_supplier": 2,
      "max_per_category": 3,
      "max_per_brand": 2,
      "explore_every": 5
    }'::jsonb,
    'OBJECT',
    'Recommendation diversity',
    'সুপারিশের বৈচিত্র্য',
    'recommendation',
    false
  )
ON CONFLICT (key) DO NOTHING;
