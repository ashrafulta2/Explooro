-- 025_group_buy.sql (Prompt 9.5: Social Group Buying / Team Purchase)
-- Implements DFD Subsystem 16.0 schema: team_purchases, team_purchase_members, and group_buying platform module.

-- 1. Team Purchases Table
CREATE TABLE IF NOT EXISTS team_purchases (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,                       -- e.g. TEAM-7F9X2A
  product_id            BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  initiator_user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  required_members      INTEGER NOT NULL DEFAULT 3 CHECK (required_members >= 2),
  current_members_count INTEGER NOT NULL DEFAULT 1 CHECK (current_members_count >= 1),
  group_price           NUMERIC(14,2) NOT NULL CHECK (group_price >= 0),
  original_price        NUMERIC(14,2) NOT NULL CHECK (original_price >= 0),
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  starts_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_team_purchases_status_expires ON team_purchases (status, expires_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_team_purchases_initiator ON team_purchases (initiator_user_id);
CREATE INDEX IF NOT EXISTS idx_team_purchases_product ON team_purchases (product_id);

-- 2. Team Purchase Members Table
CREATE TABLE IF NOT EXISTS team_purchase_members (
  id                    BIGSERIAL PRIMARY KEY,
  team_purchase_id      BIGINT NOT NULL REFERENCES team_purchases(id) ON DELETE CASCADE,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  shipping_address_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_method        TEXT NOT NULL DEFAULT 'COD'
                        CHECK (payment_method IN ('COD', 'BKASH', 'NAGAD', 'CARD', 'WALLET')),
  payment_hold_status   TEXT NOT NULL DEFAULT 'HELD'
                        CHECK (payment_hold_status IN ('HELD', 'CAPTURED', 'REFUNDED', 'RELEASED')),
  order_id              BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_team_member UNIQUE (team_purchase_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_purchase_members (user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_purchase_members (team_purchase_id);

-- 3. Upsert Group Buying Platform Module
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, default_enabled, settings_json, settings_schema, depends_on)
VALUES
  ('group_buying', 'growth', 'Social Group Buying (Team Purchase)', 'সোশ্যাল গ্রুপ বাইয়িং (টিম পারচেজ)',
   'Viral team purchasing with countdown windows, payment holding, and automatic stock protection.',
   'কাউন্টডাউন উইন্ডো, পেমেন্ট হোল্ড এবং অটোমেটিক স্টক প্রটেকশনসহ ভাইরাল টিম পারচেজিং।',
   true, true,
   '{"default_team_size": 3, "window_hours": 24, "discount_pct": 20}'::jsonb,
   '{"type": "object", "properties": { "default_team_size": { "type": "integer", "default": 3 }, "window_hours": { "type": "integer", "default": 24 }, "discount_pct": { "type": "integer", "default": 20 } } }'::jsonb,
   ARRAY[]::text[])
ON CONFLICT (key) DO UPDATE SET
  group_key = EXCLUDED.group_key,
  label_en = EXCLUDED.label_en,
  label_bn = EXCLUDED.label_bn,
  description_en = EXCLUDED.description_en,
  description_bn = EXCLUDED.description_bn,
  default_enabled = EXCLUDED.default_enabled,
  settings_schema = EXCLUDED.settings_schema,
  depends_on = EXCLUDED.depends_on;
