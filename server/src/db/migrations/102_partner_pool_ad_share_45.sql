-- 102_partner_pool_ad_share_45.sql
--
-- Owner decision 2026-11-04: the platform keeps 55% of net monthly ad revenue and
-- 45% goes to the Explooro Partner reward pool. The platform needs room to fund referral rewards.
-- Only move the previous shipped default (55% pool); preserve any value an admin customized.
-- No month has closed yet, so no paid partner reward is repriced.
-- Safe to re-run.

UPDATE platform_settings
SET value_json = jsonb_set(value_json, '{ad_revenue_share_pct}', '45'::jsonb)
WHERE key = 'partner_reward.rules'
  AND (value_json->>'ad_revenue_share_pct')::numeric = 55;
