-- 051_unify_commission_split_setting.sql
--
-- The platform's global profit split lived in two shapes: the scalar keys default_saler_split_pct /
-- default_platform_split_pct (seeded, read by the Finance screen) and the object key
-- commission.default_splits (written by the Finance screen, read by pricing). A seeded GLOBAL
-- commission_rules row also outranked the setting in pricing, so editing the default changed
-- nothing the engine used. One home now: commission.default_splits.
--
-- Safe to re-run: the object is only created when absent, and the scalar rows / GLOBAL rule are
-- only removed after it exists.

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
SELECT 'commission.default_splits',
       jsonb_build_object(
         'saler_split_pct',   COALESCE((SELECT (value_json #>> '{}')::numeric FROM platform_settings WHERE key = 'default_saler_split_pct'), 40),
         'platform_split_pct', 100 - COALESCE((SELECT (value_json #>> '{}')::numeric FROM platform_settings WHERE key = 'default_saler_split_pct'), 40),
         'min_margin_pct', 5,
         'platform_default_profit_pct', 10,
         'saler_default_profit_pct', 20,
         'extra_markup_platform_pct', 20
       ),
       'OBJECT', 'Default Commission Splits', 'ডিফল্ট কমিশন বণ্টন', 'finance', false
ON CONFLICT (key) DO NOTHING;

DELETE FROM platform_settings WHERE key IN ('default_saler_split_pct', 'default_platform_split_pct');
DELETE FROM commission_rules WHERE scope_type = 'GLOBAL';
