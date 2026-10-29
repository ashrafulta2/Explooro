-- 089_api_key_prefix_width.sql
--
-- api_keys.key_prefix was VARCHAR(16), but apiKey.service.ts stores the visible prefix as
-- `exp_live_` + 6 characters + `...`, which is 18. Every key creation and rotation failed with
-- "value too long for type character varying(16)" (500), so no partner could ever get a key.
-- Found 2026-10-30 while testing POST /public/orders against the dev database.
--
-- Widening a VARCHAR keeps every existing row and needs no rewrite. Safe to re-run.

ALTER TABLE api_keys ALTER COLUMN key_prefix TYPE VARCHAR(32);
