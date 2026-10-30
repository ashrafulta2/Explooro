-- 093_referral_one_tier.sql
--
-- Referral commission pays one tier by default (owner decision 2026-10-31): only the person who
-- referred the shopper directly earns; the person who referred them earns nothing from it.
--
-- Only a stored depth still at the shipped 2 is moved, so an admin's own choice at
-- /admin/growth/referrals is kept. `tier_depth` is the older key written by seeds/003_modules.sql;
-- the engine reads `max_tier_depth`, but both are set so the row does not contradict itself.
-- The engine enforces the depth at payout too (referral.service.ts), so tier-2 referrals already
-- recorded stop paying from now on. Safe to re-run.

UPDATE platform_modules
SET settings_json = settings_json
      || jsonb_build_object('max_tier_depth', 1)
      || CASE WHEN settings_json ? 'tier_depth' THEN jsonb_build_object('tier_depth', 1) ELSE '{}'::jsonb END
WHERE key = 'referral_engine'
  AND COALESCE((settings_json->>'max_tier_depth')::int, 2) = 2;
