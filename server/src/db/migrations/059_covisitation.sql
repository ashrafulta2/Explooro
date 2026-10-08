-- 059_covisitation.sql (personalized feed, Phase E: "shoppers who opened this also opened that")
--
-- Phases A-D rank a product by what the shopper's OWN history says (affinity, recently viewed) and
-- by what the whole platform does (trending, best seller). Neither can say "this shopper looked at
-- the Redmi 12 - people who looked at the Redmi 12 also looked at this power bank". That is
-- co-visitation: two products are related when the same actors keep interacting with both.
--
-- Three things change here:
--   1. product_covisits holds the result as an AGGREGATE. It is rebuilt by a job
--      (services/covisit.service.js) from product_interaction_events, so the request path reads a
--      small indexed table instead of self-joining the event log on every home load.
--   2. recommendation.covisit holds the numbers of the rebuild and of the signal (business numbers
--      are configuration, not code).
--   3. recommendation.weights gains `covisited`, and recommendation.rails gains an `also_viewed`
--      rail, so the signal is tuned and placed like every other one.
--
-- PRIVACY: the table stores product pairs and a count of distinct actors, never WHO the actors were,
-- and a pair is stored only when at least `min_actors` different actors produced it. A shopper who
-- opted out is never recorded in the event log in the first place, so they cannot appear in it.

-- 1. The aggregate ------------------------------------------------------------------------------
-- `score` is cosine similarity over the actor sets: together / sqrt(actors_of_p * actors_of_q).
-- WHY cosine and not the raw count: a raw count can only say "popular products co-occur with
-- everything", and every product would be related to the best seller. Dividing by both products'
-- audiences makes two niche products that the same few people open score higher than a niche product
-- and a best seller that happen to overlap by the same number of people.
-- Rows are written in both directions (p->q and q->p) so a lookup is one indexed range scan.
CREATE TABLE IF NOT EXISTS product_covisits (
  product_id         BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  related_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  actors             INTEGER NOT NULL CHECK (actors > 0),
  score              REAL NOT NULL CHECK (score > 0 AND score <= 1),
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, related_product_id),
  CONSTRAINT chk_pcv_distinct CHECK (product_id <> related_product_id)
);

-- The primary key serves "what is related to these products". This one serves the cascade when a
-- product is deleted.
CREATE INDEX IF NOT EXISTS idx_pcv_related ON product_covisits (related_product_id);

-- 2. The numbers ----------------------------------------------------------------------------------
--   enabled                 false stops the rebuild, the signal and the rail
--   window_days             how far back the event log is read
--   min_actors              a pair needs this many distinct actors (>= 2, so no pair is one person)
--   max_related             related products kept per product
--   max_products_per_actor  an actor's strongest N products are paired; bounds the self-join, which
--                           grows with the square of an actor's basket, and stops a crawler that
--                           touched 3,000 products from relating all of them to each other
--   full_score              a similarity at or above this counts as a full 1.0 for the score signal
--   seed_limit              how many of the shopper's own products are used as the starting points
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'recommendation.covisit',
    '{
      "enabled": true,
      "window_days": 60,
      "min_actors": 3,
      "max_related": 30,
      "max_products_per_actor": 25,
      "full_score": 0.3,
      "seed_limit": 8
    }'::jsonb,
    'OBJECT',
    'Co-visitation (shoppers also viewed)',
    'সহ-দর্শন (ক্রেতারা আরও দেখেছেন)',
    'recommendation',
    false
  )
ON CONFLICT (key) DO NOTHING;

-- 3a. The weight ----------------------------------------------------------------------------------
-- `'{"covisited": 2}' || value_json`: the right-hand side wins, so an admin's tuned value (or an
-- admin who already added the key) is kept and only a missing key is filled in.
UPDATE platform_settings
SET value_json = '{"covisited": 2}'::jsonb || value_json
WHERE key = 'recommendation.weights'
  AND jsonb_typeof(value_json) = 'object';

-- 3b. The rail ------------------------------------------------------------------------------------
-- Inserted right after continue_browsing: the order of the list is also the de-duplication priority,
-- and this rail is more specific than "for you", so it should keep a product both would show. An
-- admin who already has the rail (or removed continue_browsing) is respected: with no
-- continue_browsing the rail goes first.
UPDATE platform_settings
SET value_json = jsonb_set(
  value_json,
  '{rails}',
  (
    SELECT COALESCE(jsonb_agg(s.elem ORDER BY s.pos), '[]'::jsonb)
    FROM (
      SELECT e.elem, e.ord * 2 AS pos
      FROM jsonb_array_elements(platform_settings.value_json -> 'rails') WITH ORDINALITY AS e(elem, ord)
      UNION ALL
      SELECT
        '{"key": "also_viewed", "enabled": true, "limit": 12}'::jsonb,
        COALESCE(
          (
            SELECT x.ord * 2 + 1
            FROM jsonb_array_elements(platform_settings.value_json -> 'rails') WITH ORDINALITY AS x(elem, ord)
            WHERE x.elem ->> 'key' = 'continue_browsing'
          ),
          0
        )
    ) AS s
  )
)
WHERE key = 'recommendation.rails'
  AND jsonb_typeof(value_json -> 'rails') = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(platform_settings.value_json -> 'rails') AS r
    WHERE r ->> 'key' = 'also_viewed'
  );
