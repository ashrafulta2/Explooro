-- 074_shop_partner_display_names.sql — "Saler" and "Seller" become "Shop Partner" in stored display text.
--
-- WHY: the customer-facing role name changed from Saler to Shop Partner. The seeds are
-- `ON CONFLICT DO NOTHING`, so a database that was already seeded keeps the old words in its rows
-- (role and permission labels, module names, plan names, ad product copy, notification templates,
-- quest titles, setting labels). Editing migrations 001-073 would break their stored checksums, so
-- the rename is its own forward step.
--
-- Scope: only the config tables below, and only their *_en / *_bn text columns. Role and permission
-- KEYS, enum values (target_role 'SALER') and every user-written text (product titles, reviews,
-- chat) are left alone.
--
-- Kept on purpose: "Best Seller", "Top Seller" (a product that sells well) and "Cross-Seller"
-- (cross-selling, a different thing).
--
-- Idempotent: a second run finds nothing to change.

CREATE OR REPLACE FUNCTION pg_temp.shop_partner_text(t TEXT) RETURNS TEXT AS $$
DECLARE
  s TEXT := t;
BEGIN
  IF s IS NULL THEN
    RETURN NULL;
  END IF;

  -- protect the phrases that must not change
  s := replace(s, 'Cross-Seller', 'Cross-@@S@@');
  s := replace(s, 'Cross-seller', 'Cross-@@s@@');
  s := replace(s, 'cross-seller', 'cross-@@s@@');
  s := replace(s, 'Best Seller', 'Best @@S@@');
  s := replace(s, 'Top Seller', 'Top @@S@@');
  s := replace(s, 'best seller', 'best @@s@@');
  s := replace(s, 'ক্রস-সেলার', 'ক্রস-@@B@@');

  -- rows seeded before the earlier reseller -> Saler rename still carry the old word
  s := replace(s, 'Branded reseller shops', 'Branded shop partner stores');
  s := regexp_replace(s, '\mResellers\M', 'Shop Partners', 'g');
  s := regexp_replace(s, '\mReseller\M', 'Shop Partner', 'g');
  s := regexp_replace(s, '\mresellers\M', 'shop partners', 'g');
  s := regexp_replace(s, '\mreseller\M', 'shop partner', 'g');
  s := replace(s, 'রিসেলার', 'শপ পার্টনার');

  s := regexp_replace(s, '\mSalers\M', 'Shop Partners', 'g');
  s := regexp_replace(s, '\mSaler\M', 'Shop Partner', 'g');
  s := regexp_replace(s, '\msalers\M', 'shop partners', 'g');
  s := regexp_replace(s, '\msaler\M', 'shop partner', 'g');
  s := regexp_replace(s, '\mSellers\M', 'Shop Partners', 'g');
  s := regexp_replace(s, '\mSeller\M', 'Shop Partner', 'g');
  s := regexp_replace(s, '\msellers\M', 'shop partners', 'g');
  s := regexp_replace(s, '\mseller\M', 'shop partner', 'g');
  s := replace(s, 'সেলার', 'শপ পার্টনার');

  s := replace(s, '@@S@@', 'Seller');
  s := replace(s, '@@s@@', 'seller');
  s := replace(s, '@@B@@', 'সেলার');
  RETURN s;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
  col RECORD;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'roles', 'permissions', 'platform_settings', 'platform_modules', 'ad_products',
    'notification_templates', 'subscription_plans', 'quests'
  ]
  LOOP
    FOR col IN
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = tbl
         AND data_type IN ('text', 'character varying')
         AND (column_name ~ '_(en|bn)$')
    LOOP
      EXECUTE format(
        'UPDATE %I SET %I = pg_temp.shop_partner_text(%I) WHERE %I IS DISTINCT FROM pg_temp.shop_partner_text(%I)',
        tbl, col.column_name, col.column_name, col.column_name, col.column_name
      );
    END LOOP;
  END LOOP;
END $$;
