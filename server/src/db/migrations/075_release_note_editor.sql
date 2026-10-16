-- 075_release_note_editor.sql — the What's New editor writes the table the popup reads.
--
-- WHY: migration 020 created `release_notes` for the popup (GET /notifications/whats-new), but the
-- editor's What's New manager posted to /editor/whats-new, which had no server route, and nothing
-- else ever inserted a row. So the popup could only ever show a hand-inserted row (or, in mock mode,
-- a constant). The editor form also carries a category and a target audience that the table had no
-- columns for. This adds them so the editor and the popup share one table.
--
-- Idempotent: safe to run twice.

ALTER TABLE release_notes
  ADD COLUMN IF NOT EXISTS category        TEXT NOT NULL DEFAULT 'FEATURE',
  ADD COLUMN IF NOT EXISTS target_audience TEXT NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'release_notes_category_check') THEN
    ALTER TABLE release_notes
      ADD CONSTRAINT release_notes_category_check
      CHECK (category IN ('FEATURE', 'IMPROVEMENT', 'SECURITY', 'FIX'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'release_notes_target_audience_check') THEN
    ALTER TABLE release_notes
      ADD CONSTRAINT release_notes_target_audience_check
      CHECK (target_audience IN ('ALL', 'SALERS', 'SUPPLIERS'));
  END IF;
END $$;

-- The popup asks for "the newest published note for this audience" on every page load.
CREATE INDEX IF NOT EXISTS idx_release_notes_published ON release_notes (published_at DESC);
