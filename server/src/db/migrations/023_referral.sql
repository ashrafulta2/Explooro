-- 023_referral.sql (Prompt 9.3: Multi-Tier Referral & Network Growth Engine)
-- Implements DFD Subsystem 14.0 schema: user_referral_codes, referrals, referral_earnings, and module configuration.

-- 1. User Referral Codes Table
CREATE TABLE IF NOT EXISTS user_referral_codes (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code                TEXT UNIQUE NOT NULL,                   -- e.g. REF-S8X2P9
  custom_slug         TEXT UNIQUE,                            -- e.g. /join/fahim-store
  clicks_count        INTEGER NOT NULL DEFAULT 0 CHECK (clicks_count >= 0),
  signups_count       INTEGER NOT NULL DEFAULT 0 CHECK (signups_count >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_referral_codes_user ON user_referral_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_user_referral_codes_code ON user_referral_codes (code);

-- 2. Multi-Tier Referrals Table
CREATE TABLE IF NOT EXISTS referrals (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,                   -- REF-LINK-XXXXXXXX
  referrer_user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referred_user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tier_level          INTEGER NOT NULL DEFAULT 1 CHECK (tier_level IN (1, 2, 3)),
  parent_referral_id  BIGINT REFERENCES referrals(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'QUALIFIED', 'REJECTED', 'FRAUD_FLAGGED')),
  qualifying_event    TEXT NOT NULL DEFAULT 'FIRST_ORDER'
                      CHECK (qualifying_event IN ('SIGNUP', 'FIRST_ORDER', 'FIRST_SALE', 'KYC_VERIFIED')),
  qualified_at        TIMESTAMPTZ,
  fraud_reason        TEXT,
  device_fingerprint  TEXT,
  ip_address          TEXT,
  meta_json           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ,
  CONSTRAINT no_self_referral CHECK (referrer_user_id != referred_user_id),
  CONSTRAINT uq_referrer_referred UNIQUE (referrer_user_id, referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals (referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_parent ON referrals (parent_referral_id);

-- 3. Referral Earnings Table
CREATE TABLE IF NOT EXISTS referral_earnings (
  id                  BIGSERIAL PRIMARY KEY,
  referral_id         BIGINT NOT NULL REFERENCES referrals(id) ON DELETE RESTRICT,
  beneficiary_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tier_level          INTEGER NOT NULL CHECK (tier_level >= 1),
  trigger_event       TEXT NOT NULL,                         -- 'FIRST_ORDER_COMPLETED', 'SIGNUP_BONUS', 'KYC_BONUS'
  trigger_order_id    BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  order_amount        NUMERIC(14,2) CHECK (order_amount >= 0),
  commission_rate_pct NUMERIC(5,2) NOT NULL CHECK (commission_rate_pct >= 0),
  commission_amount   NUMERIC(14,2) NOT NULL CHECK (commission_amount >= 0),
  status              TEXT NOT NULL DEFAULT 'PENDING_ESCROW'
                      CHECK (status IN ('PENDING_ESCROW', 'AVAILABLE', 'CLAWED_BACK', 'VOIDED')),
  escrow_release_at   TIMESTAMPTZ NOT NULL,
  released_at         TIMESTAMPTZ,
  wallet_id           BIGINT REFERENCES wallets(id) ON DELETE RESTRICT,
  txn_group_id        UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referral_earnings_user ON referral_earnings (beneficiary_user_id, status);
CREATE INDEX IF NOT EXISTS idx_referral_earnings_escrow ON referral_earnings (status, escrow_release_at) WHERE status = 'PENDING_ESCROW';

-- 4. Upsert referral_engine platform module
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, default_enabled, settings_json, settings_schema, depends_on)
VALUES
  ('referral_engine', 'growth', 'Referral & network growth', 'রেফারেল ও নেটওয়ার্ক গ্রোথ',
   'Multi-tier referral commissions with holding period escrow and fraud protection.',
   'হোল্ডিং পিরিয়ড এসক্রো ও জালিয়াতি সুরক্ষাসহ মাল্টি-টিয়ার রেফারেল কমিশন।',
   true, true,
   '{"tier_1_rate_pct": 5.0, "tier_2_rate_pct": 2.0, "max_tier_depth": 2, "holding_period_days": 7, "qualifying_event": "FIRST_ORDER", "daily_velocity_limit": 20}'::jsonb,
   '{"type": "object", "properties": { "tier_1_rate_pct": { "type": "number", "default": 5.0 }, "tier_2_rate_pct": { "type": "number", "default": 2.0 }, "max_tier_depth": { "type": "integer", "default": 2 }, "holding_period_days": { "type": "integer", "default": 7 }, "qualifying_event": { "type": "string", "default": "FIRST_ORDER" }, "daily_velocity_limit": { "type": "integer", "default": 20 } } }'::jsonb,
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
