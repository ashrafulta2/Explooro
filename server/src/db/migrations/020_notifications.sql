-- 020_notifications.sql (Prompt 8.2)
-- Unified Notification Service & Preference Center (DFD Subsystem 4.5, 7.0 / Master Spec §H).

CREATE TABLE IF NOT EXISTS notification_templates (
  id                        BIGSERIAL PRIMARY KEY,
  template_key              TEXT UNIQUE NOT NULL,              -- OTP_VERIFICATION, ORDER_PLACED, etc.
  category                  TEXT NOT NULL
                            CHECK (category IN ('TRANSACTIONAL', 'SECURITY', 'ORDER', 'FINANCE', 'MARKETING', 'SYSTEM')),
  priority                  TEXT NOT NULL DEFAULT 'NORMAL'
                            CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  title_en                  TEXT NOT NULL,
  title_bn                  TEXT NOT NULL,
  body_template_en          TEXT NOT NULL,
  body_template_bn          TEXT NOT NULL,
  default_channels          JSONB NOT NULL DEFAULT '["INAPP"]'::jsonb,
  can_override_preferences  BOOLEAN NOT NULL DEFAULT false,
  version                   INTEGER NOT NULL DEFAULT 1,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_key ON notification_templates (template_key);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id                   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category                  TEXT NOT NULL
                            CHECK (category IN ('TRANSACTIONAL', 'SECURITY', 'ORDER', 'FINANCE', 'MARKETING', 'SYSTEM')),
  inapp_enabled             BOOLEAN NOT NULL DEFAULT true,
  sms_enabled               BOOLEAN NOT NULL DEFAULT true,
  push_enabled              BOOLEAN NOT NULL DEFAULT true,
  email_enabled             BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start         TIME,                              -- e.g. '22:00:00'
  quiet_hours_end           TIME,                              -- e.g. '08:00:00'
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS notifications (
  id                        BIGSERIAL PRIMARY KEY,
  ref                       TEXT UNIQUE NOT NULL,              -- NTF-8X2P9K1L
  user_id                   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_key              TEXT REFERENCES notification_templates(template_key) ON DELETE SET NULL,
  category                  TEXT NOT NULL,
  priority                  TEXT NOT NULL DEFAULT 'NORMAL',
  title_en                  TEXT NOT NULL,
  title_bn                  TEXT NOT NULL,
  body_en                   TEXT NOT NULL,
  body_bn                   TEXT NOT NULL,
  data_json                 JSONB DEFAULT '{}'::jsonb,
  channels                  JSONB NOT NULL DEFAULT '["INAPP"]'::jsonb,
  delivery_status           JSONB NOT NULL DEFAULT '{}'::jsonb, -- {"INAPP":"DELIVERED","SMS":"SENT"}
  is_read                   BOOLEAN NOT NULL DEFAULT false,
  read_at                   TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications (user_id, category);

CREATE TABLE IF NOT EXISTS release_notes (
  id                        BIGSERIAL PRIMARY KEY,
  version_tag               TEXT UNIQUE NOT NULL,              -- v2.4.0
  title_en                  TEXT NOT NULL,
  title_bn                  TEXT NOT NULL,
  summary_en                TEXT NOT NULL,
  summary_bn                TEXT NOT NULL,
  highlights_json           JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_release_views (
  user_id                   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version_tag               TEXT NOT NULL,
  viewed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version_tag)
);
