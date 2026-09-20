-- 049_genie_effect_settings.sql (popup "genie" open/close governance)
--
-- Every popup (Modal) now opens and closes with the genie effect from client/src/lib/genie.js. The
-- effect's on/off state, duration and drawing quality were constants in code, which meant turning
-- it off for a slow-device audience, or tuning it, required a redeploy, left no audit trail and
-- could not be handed to anyone. Business numbers live in settings, not in code (CLAUDE.md).
--
-- Three rows, one group, so the whole policy reads and writes as a unit (same shape as 045):
--   genie.enabled      whether the genie plays at all; false = the plain CSS fade
--   genie.duration_ms  how long one open or close takes, in milliseconds (250-1500)
--   genie.quality      'light' | 'balanced' | 'smooth' - how many slices the popup is cut into
--
-- WHY duration is NUMBER and quality is STRING: platform_settings.value_type allows only
-- NUMBER/STRING/BOOLEAN/OBJECT (004_platform_config.sql). The ranges are enforced by
-- server/src/services/genie.service.js, not here - a CHECK on a JSONB value would have to be
-- edited by a migration every time the bounds are retuned.
--
-- ON CONFLICT DO NOTHING keeps this safe to re-run and stops a re-run from stamping a live
-- platform's chosen values back to the defaults.

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'genie.enabled',
    'true'::jsonb,
    'BOOLEAN',
    'Popup genie effect',
    'পপআপ জিনি ইফেক্ট',
    'genie',
    false
  ),
  (
    'genie.duration_ms',
    '650'::jsonb,
    'NUMBER',
    'Genie duration (ms)',
    'জিনি ইফেক্টের সময় (ms)',
    'genie',
    false
  ),
  (
    'genie.quality',
    '"balanced"'::jsonb,
    'STRING',
    'Genie smoothness',
    'জিনি ইফেক্টের মসৃণতা',
    'genie',
    false
  )
ON CONFLICT (key) DO NOTHING;
