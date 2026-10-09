-- 067_physical_shop_status.sql
--
-- A supplier's walk-in showroom status (open now, opening/closing time, holiday schedule), read by the
-- supplier dashboard and edited at /supplier/store-status.
--
-- controllers/supplier.controller.js already reads and upserts this table, but no migration created it,
-- so the dashboard and both store-status endpoints failed against a real database. Salers keep their
-- equivalent on virtual_stores (physical_open_status, business_hours_json); a supplier has no virtual
-- store, hence a table keyed by the supplier's user id.

CREATE TABLE IF NOT EXISTS physical_shop_status (
  user_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_open           BOOLEAN NOT NULL DEFAULT true,
  opening_time      TEXT,
  closing_time      TEXT,
  holiday_schedule  JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ
);
