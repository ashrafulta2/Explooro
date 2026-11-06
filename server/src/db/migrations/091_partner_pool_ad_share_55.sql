-- 091_partner_pool_ad_share_55.sql
--
-- The shop partner reward pool's share of monthly ad revenue moves from 20 % to 55 % by default
-- (owner decision 2026-10-30): the pool receives 55 % of a month's ad revenue, the platform keeps 45 %.
--
-- 086 seeded `partner_reward.rules.ad_revenue_share_pct` = 20. Only a row still at exactly 20 is moved,
-- so an admin who already chose another figure at /admin/growth/partner-rewards keeps it.
-- WHY no audit row: this is a shipped default, not a staff action; the admin page's rule history
-- starts from whatever is stored. No month has closed yet (the first close is 2026-11-08), so no paid
-- month was priced under the old figure.
--
-- Safe to re-run.

UPDATE platform_settings
SET value_json = jsonb_set(value_json, '{ad_revenue_share_pct}', '55'::jsonb)
WHERE key = 'partner_reward.rules'
  AND (value_json->>'ad_revenue_share_pct')::numeric = 20;
