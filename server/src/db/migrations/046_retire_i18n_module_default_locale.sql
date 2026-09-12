-- 046_retire_i18n_module_default_locale.sql (one writer for the default language)
--
-- The `i18n` platform module shipped with a `default_locale` key inside its settings_json and
-- settings_schema (003_modules.sql, from modules.seed.json). Nothing ever read it — the real
-- default came from the client's VITE_DEFAULT_LOCALE env var — so it was dead config that
-- nonetheless *looked* authoritative in the Module Settings drawer.
--
-- 045 gave the default language a real home in platform_settings. Leaving the module key in place
-- would create two editable surfaces for one value, with two different guards:
--   - the Module Settings drawer, gated by `platform.module.settings` (CRITICAL, delegable:false)
--   - the Language Settings page, gated by `platform.localization.update` (MEDIUM, delegable)
-- Whichever was written last would win, and a MEDIUM-tier holder would be able to move a value
-- that the CRITICAL gate was supposed to protect. Retiring the module key removes the ambiguity:
-- platform_settings is the only writer.
--
-- `allow_bengali_numerals` is untouched — it is a genuine per-module presentation setting.

UPDATE platform_modules
SET settings_json = settings_json - 'default_locale',
    settings_schema = jsonb_set(
      settings_schema,
      '{properties}',
      (settings_schema -> 'properties') - 'default_locale'
    ),
    updated_at = now()
WHERE key = 'i18n'
  AND (
    settings_json ? 'default_locale'
    OR settings_schema -> 'properties' ? 'default_locale'
  );
