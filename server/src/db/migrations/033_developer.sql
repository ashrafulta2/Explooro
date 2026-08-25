-- Migration 033: Open Marketplace API, Webhooks & Developer SDK (Prompt 10.7)

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGSERIAL PRIMARY KEY,
  ref VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(16) NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  ip_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  ref VARCHAR(32) UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  secret VARCHAR(64) NOT NULL,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'DISABLED')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_user ON webhook_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_status ON webhook_subscriptions(status);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_name VARCHAR(64) NOT NULL,
  payload_json JSONB NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  response_status INTEGER,
  response_body TEXT,
  error_message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED', 'DEAD_LETTER')),
  next_retry_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliv_sub ON webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliv_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliv_created ON webhook_deliveries(created_at DESC);

-- Platform module registration
-- Registered under the canonical key 'open_api' from modules.seed.json / 003_modules.sql. An
-- earlier draft of this migration invented a second key ('open_developer_api') for the same
-- feature, which would have left two rows competing to gate one set of routes.
INSERT INTO platform_modules (key, group_key, label_en, label_bn, description_en, description_bn, is_enabled, created_at, updated_at)
VALUES (
  'open_api',
  'system',
  'Open Marketplace API & Webhooks',
  'ওপেন মার্কেটপ্লেস এপিআই ও ওয়েবহুক',
  'Extensible REST API, scoped API keys, webhooks delivery with DLQ, and embeddable widgets for developers',
  'সম্প্রসারণযোগ্য REST এপিআই, স্কোপড এপিআই কী, ডিএলকিউসহ ওয়েবহুক ডেলিভারি এবং ডেভেলপারদের জন্য এম্বেডযোগ্য উইজেট',
  true,
  now(),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  description_en = EXCLUDED.description_en,
  updated_at = now();
