-- 062_supplier_scorecards.sql (supplier attraction, step 1: the Supplier Scorecard)
--
-- Salers choose which supplier to build a store on, but the Sourcing Catalog only showed a tier
-- label and a hardcoded "24h / 48h dispatch" tag derived from it. This adds the measured version:
-- one snapshot row per supplier, rebuilt daily by the supplier_scorecard job from sub_orders,
-- shipments, return_requests and dispute_threads.
--
-- WHY a snapshot table and not a live aggregate: the catalog lists up to 50 products per page and
-- each needs its supplier's numbers; four joins per row per request would be the slowest query on
-- the page. One indexed primary-key lookup is not.
--
-- WHY every metric is nullable: "no data" is not "0%". A supplier with no delivered orders in the
-- window has an unknown dispatch time, and showing 0h would reward them for being new. The grade
-- stays NULL until `sample_orders` reaches `min_sample_orders` (below), and the UI says "New".

CREATE TABLE IF NOT EXISTS supplier_scorecards (
  supplier_id          BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_days          INTEGER NOT NULL CHECK (window_days BETWEEN 7 AND 365),
  sample_orders        INTEGER NOT NULL DEFAULT 0 CHECK (sample_orders >= 0),
  -- Hours from sub-order creation to the shipment being booked, median over the window.
  median_dispatch_hours NUMERIC(8,2) CHECK (median_dispatch_hours >= 0),
  -- Percentages, 0..100, two decimals.
  on_time_dispatch_pct NUMERIC(5,2) CHECK (on_time_dispatch_pct BETWEEN 0 AND 100),
  delivery_success_pct NUMERIC(5,2) CHECK (delivery_success_pct BETWEEN 0 AND 100),
  return_rate_pct      NUMERIC(5,2) CHECK (return_rate_pct BETWEEN 0 AND 100),
  dispute_rate_pct     NUMERIC(5,2) CHECK (dispute_rate_pct BETWEEN 0 AND 100),
  -- A, B, C, D, or NULL while there is too little data to judge.
  grade                TEXT CHECK (grade IN ('A','B','C','D')),
  score                INTEGER CHECK (score BETWEEN 0 AND 100),
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_scorecards_grade ON supplier_scorecards (grade, score DESC);

-- Business numbers live in platform_settings, never in code (CLAUDE.md). One OBJECT row.
--   window_days         how far back orders count (7..365)
--   min_sample_orders   fewer orders than this and the supplier is "New", not graded
--   dispatch_sla_hours  an order shipped within this many hours counts as on time
--   weights             how much each metric moves the 0..100 score; must sum to 100
--   grade_cutoffs       minimum score for A, B and C; below C is D
--   penalty_ceilings    the return / dispute rate (%) at which that metric earns zero points;
--                       lower rates scale linearly up to full marks at 0%
--
-- ON CONFLICT DO NOTHING keeps a re-run from stamping a tuned platform back to these defaults.
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'supplier.scorecard',
    '{
      "window_days": 90,
      "min_sample_orders": 10,
      "dispatch_sla_hours": 48,
      "weights": { "on_time_dispatch": 30, "delivery_success": 30, "return_rate": 20, "dispute_rate": 20 },
      "grade_cutoffs": { "A": 85, "B": 70, "C": 50 },
      "penalty_ceilings": { "return_rate": 20, "dispute_rate": 10 }
    }'::jsonb,
    'OBJECT',
    'Supplier scorecard rules',
    'সরবরাহকারী স্কোরকার্ডের নিয়ম',
    'scorecard',
    false
  )
ON CONFLICT (key) DO NOTHING;
