-- 068_team_purchase_checkout.sql
--
-- Lets a completed team purchase become real orders.
--
-- Until now a team that filled up tried to insert into orders columns that do not exist (user_id,
-- status, shipping_address_json), so no team ever completed. Completing one needs four things the
-- schema did not have:
--
--   1. orders.payment_method must accept WALLET. A team member may pay from their Explooro wallet;
--      the money is held in their own HELD bucket while the team fills and is spent when it completes.
--   2. Two ledger categories for that hold: TEAM_PURCHASE_HOLD (AVAILABLE -> HELD when joining) and
--      TEAM_PURCHASE_RELEASE (HELD -> AVAILABLE when the team expires, or just before the order's
--      escrow deposit spends it).
--   3. team_purchases.shipping_charge: the per-member delivery charge, snapshotted when the team is
--      started so a later admin edit never changes what an open team pays.
--   4. team_purchase_members.hold_txn_group_id: the ledger group that holds a WALLET member's money.
--
-- The shipping charge itself is a business number, so it lives in the group_buying module's
-- settings_json (edited at /admin/growth/group-buy), next to the per-size discounts.

-- 1. orders.payment_method: add WALLET. The constraint name is generated, so it is found by definition.
DO $$
DECLARE
  old_name TEXT;
BEGIN
  SELECT conname INTO old_name FROM pg_constraint
  WHERE conrelid = 'orders'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%payment_method%';
  IF old_name IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = old_name AND pg_get_constraintdef(oid) LIKE '%WALLET%'
  ) THEN
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', old_name);
    ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
      CHECK (payment_method IN ('BKASH','NAGAD','ROCKET','CARD','COD','WALLET'));
  END IF;
END $$;

-- 2. Ledger categories (same find-by-definition pattern as 052/064/065). Re-runnable.
DO $$
DECLARE
  old_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%TEAM_PURCHASE_HOLD%'
  ) THEN
    RETURN;
  END IF;

  SELECT conname INTO old_name FROM pg_constraint
  WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%SAMPLE_HOLD%';
  IF old_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ledger_transactions DROP CONSTRAINT %I', old_name);
  END IF;

  ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_category_check
    CHECK (category IN ('SALE_COMMISSION','SUPPLIER_PAYMENT','ESCROW_LOCK','ESCROW_RELEASE',
                        'CLAWBACK','REFUND','PAYOUT','PAYOUT_FEE','ADJUSTMENT','AD_SPEND',
                        'COIN_REDEMPTION','REFERRAL_BONUS','QUEST_REWARD','COD_SETTLEMENT',
                        'SUBSCRIPTION_FEE','VOLUME_INCENTIVE',
                        'SAMPLE_HOLD','SAMPLE_RELEASE','SAMPLE_REFUND',
                        'TEAM_PURCHASE_HOLD','TEAM_PURCHASE_RELEASE'));
END $$;

-- 3 & 4. Snapshot and hold columns.
ALTER TABLE team_purchases
  ADD COLUMN IF NOT EXISTS shipping_charge NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (shipping_charge >= 0);

ALTER TABLE team_purchase_members
  ADD COLUMN IF NOT EXISTS hold_txn_group_id UUID;

-- 5. The group_buying module's settings: shipping charge and one discount per team size.
--    Existing values win over these defaults (`defaults || current`), so a re-run never resets an edit.
UPDATE platform_modules
SET settings_json = '{"shipping_charge": 60, "discount_pct_2": 15, "discount_pct_3": 25}'::jsonb
                    || COALESCE(settings_json, '{}'::jsonb),
    settings_schema = '{
      "type": "object",
      "properties": {
        "default_team_size": { "type": "integer", "minimum": 2, "maximum": 3, "default": 3 },
        "window_hours":      { "type": "integer", "minimum": 1, "maximum": 168, "default": 24 },
        "discount_pct":      { "type": "integer", "minimum": 0, "maximum": 90, "default": 20 },
        "discount_pct_2":    { "type": "integer", "minimum": 0, "maximum": 90, "default": 15 },
        "discount_pct_3":    { "type": "integer", "minimum": 0, "maximum": 90, "default": 25 },
        "shipping_charge":   { "type": "number",  "minimum": 0, "maximum": 5000, "default": 60 }
      }
    }'::jsonb
WHERE key = 'group_buying';
