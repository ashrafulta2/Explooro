-- 103_journey_metrics.sql — Prompt 13.7: the events behind /admin/platform/guided-experience.
--
-- One row the first time a user is seen on a journey step (REACHED: it was their current step) and
-- one the first time it is seen done (COMPLETED). Written by services/nextStep.service.ts whenever
-- it computes a user's answer, read only by services/journeyMetrics.service.ts.
--
-- WHY first-seen rows and not a log of every look: the metrics ask "how many got here, how many got
-- through, how long it took". The first sighting answers all three, and the UNIQUE key keeps the
-- table at most (users x steps x 2) rows however often the card is loaded.
CREATE TABLE IF NOT EXISTS journey_step_events (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey      TEXT NOT NULL,
  step_id      TEXT NOT NULL,
  event        TEXT NOT NULL CHECK (event IN ('REACHED', 'COMPLETED')),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, journey, step_id, event)
);

CREATE INDEX IF NOT EXISTS journey_step_events_step_idx ON journey_step_events (journey, step_id);

-- The abandon threshold and the wait before a stalled user counts as gone are configuration, not
-- code (Prompt 13.7 ACCEPTANCE). Existing settings win over these defaults.
UPDATE platform_modules
SET settings_json = '{"abandon_threshold_pct": 40, "abandon_after_days": 7}'::jsonb || COALESCE(settings_json, '{}'::jsonb),
    settings_schema = jsonb_set(
      jsonb_set(
        COALESCE(settings_schema, '{"type": "object", "properties": {}}'::jsonb),
        '{properties,abandon_threshold_pct}',
        '{"type": "integer", "minimum": 5, "maximum": 95, "default": 40}'::jsonb
      ),
      '{properties,abandon_after_days}',
      '{"type": "integer", "minimum": 1, "maximum": 90, "default": 7}'::jsonb
    )
WHERE key = 'guided_experience';
