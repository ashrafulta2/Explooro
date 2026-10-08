-- 057_home_rails_settings.sql (personalized feed, Phase C: home page rails)
--
-- The home page shows themed rails above the catalog grid. WHICH rails appear, in what order, and
-- how many products each carries are business decisions, so they live here and not in code
-- (CLAUDE.md: "Configuration, not code"). What each rail MEANS (which ranking signals it uses) is
-- structure and stays in services/homeRails.service.js; the strength of every signal is already
-- admin-tunable through 056's recommendation.weights.
--
-- One OBJECT row, same shape and group as 056 so the whole recommendation policy reads as a unit:
--   rails      ordered list; the first rail to claim a product keeps it, later rails skip it, so the
--              order here is also the de-duplication priority.
--              key       one of: continue_browsing, for_you, trending, bestsellers, new_arrivals, near_you
--              enabled   false hides the rail without losing its position
--              limit     products in the rail (1..30)
--              window_days  new_arrivals only: how recent a listing must be to count as "new"
--   min_items  a rail that would show fewer products than this is not shown at all — a rail of one
--              looks broken, and an empty one is clutter.
--
-- ON CONFLICT DO NOTHING keeps a re-run from stamping a live platform's tuned values back to the
-- defaults.

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'recommendation.rails',
    '{
      "min_items": 4,
      "rails": [
        { "key": "continue_browsing", "enabled": true, "limit": 10 },
        { "key": "for_you", "enabled": true, "limit": 12 },
        { "key": "trending", "enabled": true, "limit": 12 },
        { "key": "bestsellers", "enabled": true, "limit": 12 },
        { "key": "new_arrivals", "enabled": true, "limit": 12, "window_days": 30 },
        { "key": "near_you", "enabled": true, "limit": 12 }
      ]
    }'::jsonb,
    'OBJECT',
    'Home page recommendation rails',
    'হোম পেজের সুপারিশ সারি',
    'recommendation',
    false
  )
ON CONFLICT (key) DO NOTHING;
