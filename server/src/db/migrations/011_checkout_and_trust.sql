-- 011_checkout_and_trust.sql (Prompt 5.2)
-- Implements Trust Scores, Coupons, and Coupon Redemptions per docs/erd.md §1 & §4.

-- 1. Trust Scores (Customer Risk & Seller Quality Metric)
CREATE TABLE IF NOT EXISTS trust_scores (
  user_id               BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score                 INTEGER NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
  tier                  TEXT NOT NULL DEFAULT 'STARTER'
                        CHECK (tier IN ('STARTER','VERIFIED_TRADER','ELITE_PARTNER')),
  delivery_success_rate NUMERIC(5,2) CHECK (delivery_success_rate BETWEEN 0 AND 100),
  return_rate           NUMERIC(5,2) CHECK (return_rate BETWEEN 0 AND 100),
  dispute_rate          NUMERIC(5,2) CHECK (dispute_rate BETWEEN 0 AND 100),
  cod_refusal_count     INTEGER NOT NULL DEFAULT 0 CHECK (cod_refusal_count >= 0),
  completed_orders      INTEGER NOT NULL DEFAULT 0 CHECK (completed_orders >= 0),
  manual_adjustment     INTEGER NOT NULL DEFAULT 0,
  adjusted_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  computed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trust_scores_tier ON trust_scores (tier, score);

-- 2. Coupons
CREATE TABLE IF NOT EXISTS coupons (
  id                  BIGSERIAL PRIMARY KEY,
  code                TEXT UNIQUE NOT NULL,
  discount_type       TEXT NOT NULL
                      CHECK (discount_type IN ('PERCENT','FIXED','FREE_SHIPPING','BUY_X_GET_Y')),
  discount_value      NUMERIC(14,2) NOT NULL CHECK (discount_value >= 0),
  max_discount        NUMERIC(14,2) CHECK (max_discount >= 0),
  min_spend           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (min_spend >= 0),
  budget_cap          NUMERIC(14,2) CHECK (budget_cap >= 0),
  budget_used         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (budget_used >= 0),
  usage_limit         INTEGER CHECK (usage_limit > 0),
  usage_count         INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  per_user_limit      INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  first_order_only    BOOLEAN NOT NULL DEFAULT false,
  is_stackable        BOOLEAN NOT NULL DEFAULT false,
  scope_type          TEXT NOT NULL CHECK (scope_type IN ('PLATFORM','SUPPLIER','SALER','CATEGORY','PRODUCT')),
  scope_ref           TEXT,
  funded_by           TEXT NOT NULL CHECK (funded_by IN ('PLATFORM','SUPPLIER','SALER')),
  funded_by_user_id   BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  starts_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budget_within_cap CHECK (budget_cap IS NULL OR budget_used <= budget_cap)
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons (code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_coupons_scope ON coupons (scope_type, scope_ref) WHERE is_active = true;

-- 3. Coupon Redemptions
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id                  BIGSERIAL PRIMARY KEY,
  coupon_id           BIGINT NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id            BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  discount_amount     NUMERIC(14,2) NOT NULL CHECK (discount_amount >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user ON coupon_redemptions (user_id, coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_order ON coupon_redemptions (order_id);
