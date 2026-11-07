-- 108_integration_settings.sql
--
-- Gateway credentials an admin saves at /admin/platform/integrations, one row per service in the
-- catalog server/src/config/integrations.ts. A driver reads a value saved here first and falls back
-- to its .env variable (integrations/credentialStore.ts), so a fresh install with no rows behaves
-- exactly as before this migration.
--
--   credentials_encrypted  the whole field map as JSON, AES-256-GCM with PII_ENCRYPTION_KEY
--                          (lib/encryption.ts). Never stored or logged in plain text.
--   credential_hints       what the page may show without decrypting: a non-secret field's value,
--                          a secret's last four characters. The audit log records only these.
--   is_enabled             FALSE = paused: a payment method is no longer offered, a courier takes no
--                          new bookings. SMS and WhatsApp cannot be paused (the catalog's `pausable`).
--   last_test_*            the latest Test Connection result, so the page shows it after a reload.
--
-- WHY no seed rows: a row exists only once someone saves or pauses a service. A missing row means
-- "use .env, not paused", which is what every deployment did before.
CREATE TABLE IF NOT EXISTS integration_settings (
  integration_key        TEXT PRIMARY KEY CHECK (integration_key ~ '^[a-z0-9_]{2,64}$'),
  is_enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  credentials_encrypted  TEXT,
  credential_hints       JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_test_at           TIMESTAMPTZ,
  last_test_ok           BOOLEAN,
  last_test_message      TEXT,
  updated_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
