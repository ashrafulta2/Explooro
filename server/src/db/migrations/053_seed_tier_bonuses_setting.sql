-- 053_seed_tier_bonuses_setting.sql
--
-- finance.tier_bonuses is now the single source for trust-tier Saler split bonuses (read by the
-- Finance splits screen and the split simulator). Existing databases have no row, so every tier
-- would read as 0 until an admin saved one. Seed the previous hardcoded values; never overwrite
-- a row an admin already saved. Safe to re-run.

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES ('finance.tier_bonuses',
        '[{"tier": "BRONZE", "bonus_pct": 0}, {"tier": "SILVER", "bonus_pct": 1}, {"tier": "GOLD", "bonus_pct": 2}, {"tier": "PLATINUM", "bonus_pct": 5}]'::jsonb,
        'OBJECT', 'Trust Tier Bonuses', 'ট্রাস্ট টিয়ার বোনাস', 'finance', false)
ON CONFLICT (key) DO NOTHING;
