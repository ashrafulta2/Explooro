-- 041_default_locale_en.sql (default UI language switched from Bangla to English)
--
-- The product now ships English-first: VITE_DEFAULT_LOCALE is `en`, and the i18n engine's
-- FALLBACK_LANG has always been `en`. `users.locale` was the one place still defaulting to 'bn'
-- (001_identity.sql), so a freshly registered account stored a Bangla preference that disagreed
-- with the language the app actually rendered.
--
-- WHY a forward migration instead of editing 001: applied migrations are checksum-immutable
-- (docs/erd.md §13 rule 3) — the runner refuses to start if a ran file's sha256 changes.
--
-- Existing rows are left untouched: a locale already stored is a user's own choice, not a default.

ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'en';
