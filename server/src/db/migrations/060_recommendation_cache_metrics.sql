-- 060_recommendation_cache_metrics.sql (personalized feed, Phase F: cache and metrics)
--
-- Two unrelated needs, one migration because both belong to "make the feed operable":
--
--   1. recommendation.cache holds the numbers of the feed's cache (services/recoCache.service.js).
--      Business numbers are configuration, not code.
--   2. product_interaction_events.source records WHICH surface a click or an impression came from
--      (a home rail, the swipe feed, the catalog grid, search). Until now an event said "this shopper
--      opened product 42" but not "from the Trending rail", so no rail could be judged by whether
--      anyone opened what it showed. This column is what makes per-surface click-through measurable.

-- 1. The cache numbers ----------------------------------------------------------------------------
--   enabled               false turns the feed cache off entirely (every request reads the database)
--   pool_ttl_seconds      how long a ranked candidate pool is reused. It is the longest a NEW listing
--                         can go unseen by a shopper whose ranking inputs have not changed
--   settings_ttl_seconds  how long the recommendation settings are reused. It is the longest an edited
--                         weight can take to apply; 0 = read on every request
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'recommendation.cache',
    '{
      "enabled": true,
      "pool_ttl_seconds": 60,
      "settings_ttl_seconds": 30
    }'::jsonb,
    'OBJECT',
    'Recommendation cache',
    'সুপারিশের ক্যাশ',
    'recommendation',
    false
  )
ON CONFLICT (key) DO NOTHING;

-- 2. Where an event came from ---------------------------------------------------------------------
-- Free of enums on purpose: a new rail is a config change (recommendation.rails), and a column that
-- needed a migration per rail would be the wrong coupling. The shape is constrained instead:
-- `rail:<key>` for a home rail, or one of a few bare names (feed, grid, search, product), lowercase
-- with underscores, at most 40 characters. The server also validates on write and stores NULL for
-- anything else, so a bad tag never costs the event it rode on.
ALTER TABLE product_interaction_events
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE product_interaction_events
  DROP CONSTRAINT IF EXISTS product_interaction_events_source_check;

ALTER TABLE product_interaction_events
  ADD CONSTRAINT product_interaction_events_source_check
  CHECK (source IS NULL OR (char_length(source) <= 40 AND source ~ '^[a-z][a-z_]*(:[a-z][a-z_]*)?$'));

-- The funnel reads "this source's events over the last N days", grouped by source. Partial: the
-- untagged majority of rows (conversions, dwell, older history) never use it.
CREATE INDEX IF NOT EXISTS idx_pie_source_created
  ON product_interaction_events (source, created_at DESC)
  WHERE source IS NOT NULL;
