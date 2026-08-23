-- 026_cart_recovery.sql (Prompt 9.6: Abandoned Cart Recovery)
-- Implements DFD Subsystem 12.0 schema enhancements: cart_recovery_logs and cart_recovery platform module.

-- 1. Cart Recovery Logs Table (Attribution & Step Tracking)
CREATE TABLE IF NOT EXISTS cart_recovery_logs (
  id                  BIGSERIAL PRIMARY KEY,
  abandoned_cart_id   BIGINT NOT NULL REFERENCES abandoned_carts(id) ON DELETE CASCADE,
  cart_id             BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  user_id             BIGINT REFERENCES users(id) ON DELETE CASCADE,
  sequence_step       INTEGER NOT NULL CHECK (sequence_step BETWEEN 1 AND 4), -- 1: 1h reminder, 2: 24h 5% incentive, 3: 72h 10% final, 4: manual offer
  channel             TEXT NOT NULL DEFAULT 'IN_APP'
                      CHECK (channel IN ('IN_APP', 'SMS', 'PUSH', 'WHATSAPP', 'EMAIL')),
  discount_pct        NUMERIC(5,2) DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  coupon_code         TEXT,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_recovery_logs_cart ON cart_recovery_logs (cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_recovery_logs_abandoned ON cart_recovery_logs (abandoned_cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_recovery_logs_user ON cart_recovery_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_cart_recovery_logs_step ON cart_recovery_logs (sequence_step, sent_at);

-- 2. Enhance Indexes on abandoned_carts
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_step_nudge
  ON abandoned_carts (sequence_step, last_nudge_at)
  WHERE recovered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_token
  ON abandoned_carts (recovery_token);

-- 3. Upsert Cart Recovery Platform Module
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, default_enabled, settings_json, settings_schema, depends_on)
VALUES
  ('cart_recovery', 'growth', 'Abandoned Cart Recovery', 'পরিত্যক্ত কার্ট পুনরুদ্ধার',
   'Detects inactive carts, runs 3-step automated recovery sequences with coupon incentives, and attributes recovered revenue.',
   'নিষ্ক্রিয় কার্ট শনাক্তকরণ, কুপন সুবিধাসহ ৩-ধাপের পুনরুদ্ধার বার্তা এবং উদ্ধারকৃত রাজস্ব পর্যবেক্ষণ।',
   true, true,
   '{"inactivity_minutes": 60, "step1_hours": 1, "step2_hours": 24, "step3_hours": 72, "step2_discount_pct": 5, "step3_discount_pct": 10, "max_discount_cap_pct": 15, "user_cooldown_days": 7, "quiet_hours_start": 22, "quiet_hours_end": 8}'::jsonb,
   '{"type": "object", "properties": { "inactivity_minutes": { "type": "integer", "default": 60 }, "step1_hours": { "type": "integer", "default": 1 }, "step2_hours": { "type": "integer", "default": 24 }, "step3_hours": { "type": "integer", "default": 72 }, "step2_discount_pct": { "type": "number", "default": 5 }, "step3_discount_pct": { "type": "number", "default": 10 }, "max_discount_cap_pct": { "type": "number", "default": 15 }, "user_cooldown_days": { "type": "integer", "default": 7 }, "quiet_hours_start": { "type": "integer", "default": 22 }, "quiet_hours_end": { "type": "integer", "default": 8 } } }'::jsonb,
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
