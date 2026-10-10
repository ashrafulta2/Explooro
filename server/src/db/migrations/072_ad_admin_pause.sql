-- 072_ad_admin_pause.sql — an admin pause that the merchant cannot undo.
--
-- WHY: /admin/growth/ads can pause a campaign for policy reasons. Without a marker the merchant's
-- own Resume button would silently reverse it, so the pause is recorded here and the merchant-side
-- resume refuses while it is set. Only an admin resume clears it.

ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS admin_paused_at TIMESTAMPTZ;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS admin_pause_reason TEXT;
