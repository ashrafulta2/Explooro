-- 094_retail_markup.sql
--
-- The platform sets the retail price (owner decision 2026-10-31). A supplier enters only the price
-- they want per unit; retail = that price + a markup %, rounded UP to a whole number of taka, so the
-- rounding only ever widens the margin. The markup is configuration, never code:
--   * pricing.markup (platform_settings): the default markup % and the rounding step (৳).
--   * category_markups: a per-category markup % that replaces the default for that category.
-- Both are edited at /admin/finance/splits and read only by services/retailMarkup.service.ts.
--
-- Same decision: the default margin split becomes partner pool 70% / platform 30%. Only a split still
-- at the shipped 40/60 is moved, so an admin's own choice is kept. Safe to re-run.

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, updated_at)
VALUES ('pricing.markup', '{"default_markup_pct": 15, "round_to_bdt": 10}'::jsonb, 'OBJECT',
        'Retail price markup', 'খুচরা মূল্যের markup', 'finance', now())
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS category_markups (
  category_id  BIGINT PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  markup_pct   NUMERIC(6,2) NOT NULL CHECK (markup_pct >= 0 AND markup_pct <= 300),
  updated_by   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

UPDATE platform_settings
SET value_json = value_json || '{"saler_split_pct": 70, "platform_split_pct": 30}'::jsonb,
    updated_at = now()
WHERE key = 'commission.default_splits'
  AND (value_json->>'saler_split_pct')::numeric = 40
  AND (value_json->>'platform_split_pct')::numeric = 60;
