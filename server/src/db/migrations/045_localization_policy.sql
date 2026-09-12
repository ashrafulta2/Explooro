-- 045_localization_policy.sql (Language & Localization governance)
--
-- Gives the platform's default language a real, auditable home. Before this, the default lived
-- ONLY in `VITE_DEFAULT_LOCALE` — a build-time client env var, which means changing the language
-- every visitor lands on required a redeploy, produced no audit trail, and could not be delegated
-- to anyone. Business numbers live in settings, not in code (CLAUDE.md), and a default language
-- is a business setting.
--
-- Three rows, one group, so the whole policy reads and writes as a unit:
--   localization.default_locale       the locale a visitor with no saved choice gets
--   localization.enabled_locales      which locales the switcher may offer at all
--   localization.allow_user_override  whether a visitor may pick something other than the default
--
-- WHY `enabled_locales` is value_type OBJECT: the platform_settings CHECK constraint
-- (004_platform_config.sql) allows only NUMBER/STRING/BOOLEAN/OBJECT, and a JSON array is an
-- OBJECT as far as that enum is concerned. It is stored as a real JSONB array, not a CSV string,
-- so the service can validate membership without parsing.
--
-- The seeded default is 'en', matching FALLBACK_LANG in client/src/services/i18n.js and the
-- users.locale column default set in 044_default_locale_en.sql. ON CONFLICT DO NOTHING keeps this
-- migration safe to re-run and — more importantly — stops a re-run from stamping a live
-- platform's chosen language back to 'en'.

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'localization.default_locale',
    '"en"'::jsonb,
    'STRING',
    'Default language',
    'ডিফল্ট ভাষা',
    'localization',
    false
  ),
  (
    'localization.enabled_locales',
    '["en","bn"]'::jsonb,
    'OBJECT',
    'Enabled languages',
    'সক্রিয় ভাষাসমূহ',
    'localization',
    false
  ),
  (
    'localization.allow_user_override',
    'true'::jsonb,
    'BOOLEAN',
    'Let visitors choose their own language',
    'দর্শনার্থীদের নিজের ভাষা বেছে নিতে দিন',
    'localization',
    false
  )
ON CONFLICT (key) DO NOTHING;
