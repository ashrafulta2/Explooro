-- 079_partner_scores.sql — the Partner Score: how well a shop partner promotes and sells (Phase B).
--
-- A shop partner is a promoter: suppliers pay them for bringing buyers. The owner wants earning to
-- follow how much and how well a partner promotes, decided by an algorithm, not by a per-product
-- percentage shown up front. This is the measuring half: one snapshot row per partner, rebuilt daily
-- by the `partner_score` job from the orders attribution (076) now credits to them.
--
-- The score does not move money yet. `multiplier` is what the earning engine (Phase C) will apply;
-- until then it is shown to the partner only, so they can see what they are building towards.
--
-- Same shape and invariants as supplier_scorecards (062):
--   * every metric is nullable: "no data" is not "0%";
--   * score, band and multiplier stay NULL / 1.00 until `min_sample_orders` is reached ("New");
--   * a metric with no denominator is left out and the other weights re-scale to 100.

CREATE TABLE IF NOT EXISTS partner_scores (
  saler_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_days          INTEGER NOT NULL CHECK (window_days BETWEEN 7 AND 365),
  sample_orders        INTEGER NOT NULL DEFAULT 0 CHECK (sample_orders >= 0),
  delivered_volume     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (delivered_volume >= 0), -- goods only
  -- Percentages, 0..100, two decimals.
  return_rate_pct      NUMERIC(5,2) CHECK (return_rate_pct BETWEEN 0 AND 100),
  cancel_rate_pct      NUMERIC(5,2) CHECK (cancel_rate_pct BETWEEN 0 AND 100),
  repeat_customer_pct  NUMERIC(5,2) CHECK (repeat_customer_pct BETWEEN 0 AND 100),
  new_customer_pct     NUMERIC(5,2) CHECK (new_customer_pct BETWEEN 0 AND 100),
  link_conversion_pct  NUMERIC(5,2) CHECK (link_conversion_pct BETWEEN 0 AND 100),
  score                INTEGER CHECK (score BETWEEN 0 AND 100),
  band                 TEXT,                                  -- a band key from the rules, NULL while New
  multiplier           NUMERIC(4,2) NOT NULL DEFAULT 1.00 CHECK (multiplier > 0),
  components_json      JSONB NOT NULL DEFAULT '{}'::jsonb,    -- points earned per metric, for "why"
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_scores_score ON partner_scores (score DESC NULLS LAST);

-- The touches a partner's links received, by time: the conversion rate is clicks in the window.
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_clicked ON short_link_clicks (clicked_at);

-- Business numbers live in platform_settings, never in code. One OBJECT row.
--   window_days         how far back orders count (7..365)
--   min_sample_orders   fewer orders than this and the partner is "New", not scored
--   weights             how much each metric moves the 0..100 score; must sum to 100
--   targets             the value at which a "higher is better" metric earns full marks
--                       (delivered_volume in BDT, the others in %)
--   penalty_ceilings    the rate (%) at which a "lower is better" metric earns zero points
--   bands               ascending min_score -> multiplier the earning engine will apply (Phase C)
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'partner.score_rules',
  '{
    "window_days": 60,
    "min_sample_orders": 5,
    "weights": { "delivered_volume": 35, "return_rate": 20, "repeat_customers": 15, "new_customers": 15, "link_conversion": 10, "cancel_rate": 5 },
    "targets": { "delivered_volume": 100000, "repeat_customers": 30, "new_customers": 50, "link_conversion": 5 },
    "penalty_ceilings": { "return_rate": 20, "cancel_rate": 20 },
    "bands": [
      { "key": "STARTER", "min_score": 0,  "multiplier": 1.00 },
      { "key": "RISING",  "min_score": 40, "multiplier": 1.05 },
      { "key": "PRO",     "min_score": 60, "multiplier": 1.10 },
      { "key": "STAR",    "min_score": 80, "multiplier": 1.20 }
    ]
  }'::jsonb,
  'OBJECT',
  'Partner score rules',
  'পার্টনার স্কোরের নিয়ম',
  'growth',
  false
)
ON CONFLICT (key) DO NOTHING;
