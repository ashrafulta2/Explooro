-- 004_platform_config.sql (Prompt 3.1)
-- Implements platform_settings, platform_modules, module_targeting_rules, and commission_rules
-- exactly as defined in docs/erd.md §2.

CREATE TABLE platform_settings (
  key                 TEXT PRIMARY KEY,
  value_json          JSONB NOT NULL,
  value_type          TEXT NOT NULL CHECK (value_type IN ('NUMBER','STRING','BOOLEAN','OBJECT')),
  label_en            TEXT NOT NULL,
  label_bn            TEXT NOT NULL,
  group_key           TEXT NOT NULL,
  is_sensitive        BOOLEAN NOT NULL DEFAULT false,
  updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE platform_modules (
  key                 TEXT PRIMARY KEY,
  group_key           TEXT NOT NULL,
  label_en            TEXT NOT NULL,
  label_bn            TEXT NOT NULL,
  description_en      TEXT,
  description_bn      TEXT,
  is_enabled          BOOLEAN NOT NULL DEFAULT true,
  default_enabled     BOOLEAN NOT NULL DEFAULT true,
  settings_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings_schema     JSONB,                             -- JSON Schema for sub-settings
  depends_on          TEXT[] NOT NULL DEFAULT '{}',
  scheduled_on_at     TIMESTAMPTZ,
  scheduled_off_at    TIMESTAMPTZ,
  last_reason         TEXT,
  updated_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE TABLE module_targeting_rules (
  id                  BIGSERIAL PRIMARY KEY,
  module_key          TEXT NOT NULL REFERENCES platform_modules(key) ON DELETE CASCADE,
  target_type         TEXT NOT NULL
                      CHECK (target_type IN ('ROLE','TIER','DISTRICT','USER','PERCENTAGE')),
  target_value        TEXT NOT NULL,
  is_enabled          BOOLEAN NOT NULL,
  priority            INTEGER NOT NULL DEFAULT 0,        -- USER > DISTRICT > TIER > ROLE > PERCENTAGE
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commission_rules (
  id                  BIGSERIAL PRIMARY KEY,
  scope_type          TEXT NOT NULL CHECK (scope_type IN ('GLOBAL','CATEGORY','PRODUCT','SELLER')),
  scope_ref           TEXT,
  saler_split_pct     NUMERIC(5,2) NOT NULL CHECK (saler_split_pct BETWEEN 0 AND 100),
  platform_split_pct  NUMERIC(5,2) NOT NULL CHECK (platform_split_pct BETWEEN 0 AND 100),
  min_margin_pct      NUMERIC(5,2),
  effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to        TIMESTAMPTZ,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT splits_sum_to_100 CHECK (saler_split_pct + platform_split_pct = 100)
);

CREATE INDEX idx_module_targeting_rules_module_key ON module_targeting_rules(module_key);
CREATE INDEX idx_platform_modules_group ON platform_modules(group_key);
