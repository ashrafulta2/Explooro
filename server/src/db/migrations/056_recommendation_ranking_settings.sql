-- 056_recommendation_ranking_settings.sql (personalized feed, Phase B: blended ranking)
--
-- The `recommended` catalog sort used to be a single affinity boost (three integer constants in
-- discoveryFeed.service.js) with a sold_count tiebreak. Phase B replaces it with a blended score
-- (services/recommendation.service.js). Every coefficient of that score is a business number, so it
-- lives here and not in code (CLAUDE.md: "Configuration, not code") and can be retuned without a
-- deploy.
--
-- Two OBJECT rows in one group, so the whole ranking policy reads as a unit (same shape as 045/049):
--   recommendation.weights  how much each signal contributes to a product's score. 0 turns a signal
--                           off; the *_penalty keys are SUBTRACTED, so they are written as positives.
--   recommendation.tuning   the shape of each signal: windows, caps and the Bayesian rating prior.
--
-- WHY OBJECT rows and not one row per key (genie's pattern): 14 weights and 10 tuning values would be
-- 24 rows to lock and upsert together. Ranges are enforced by recommendation.service.js on read, so
-- an out-of-range value written by hand falls back to its default instead of ranking nonsense.
--
-- ON CONFLICT DO NOTHING keeps a re-run from stamping a live platform's tuned values back to the
-- defaults.

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'recommendation.weights',
    '{
      "affinity_category": 3,
      "affinity_brand": 2,
      "affinity_supplier": 2,
      "recently_viewed": 1.5,
      "trending": 2.5,
      "bestseller": 1.5,
      "recent_sales": 1.5,
      "quality": 2,
      "freshness": 1,
      "trust_tier": 0.5,
      "locality": 1,
      "out_of_stock_penalty": 5,
      "return_rate_penalty": 2,
      "already_bought_penalty": 3
    }'::jsonb,
    'OBJECT',
    'Recommendation ranking weights',
    'সুপারিশ র‍্যাঙ্কিংয়ের ওজন',
    'recommendation',
    false
  ),
  (
    'recommendation.tuning',
    '{
      "trend_recent_hours": 48,
      "trend_baseline_days": 7,
      "recent_sales_days": 30,
      "recent_sales_cap": 100,
      "bestseller_cap": 500,
      "quality_prior_mean": 4,
      "quality_prior_count": 10,
      "freshness_halflife_days": 30,
      "viewed_window_days": 14,
      "purchased_window_days": 60
    }'::jsonb,
    'OBJECT',
    'Recommendation ranking tuning',
    'সুপারিশ র‍্যাঙ্কিংয়ের টিউনিং',
    'recommendation',
    false
  )
ON CONFLICT (key) DO NOTHING;
