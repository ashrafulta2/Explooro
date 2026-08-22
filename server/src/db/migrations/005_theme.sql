-- 005_theme.sql (Prompt 3.5)
-- Implements theme_palettes table for Granular Component-Level Color Studio (technologyused.md §Layer 1).

CREATE TABLE theme_palettes (
  id                  BIGSERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  preset_key          TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT false,
  is_published        BOOLEAN NOT NULL DEFAULT false,
  tokens_json         JSONB NOT NULL,
  created_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure only one active palette is marked at any time
CREATE UNIQUE INDEX idx_theme_palettes_active ON theme_palettes (is_active) WHERE (is_active = true);
CREATE INDEX idx_theme_palettes_published ON theme_palettes (is_published);
