-- 071_referral_ledger_categories.sql
-- Referral commissions were written to the ledger as 'REFERRAL_COMMISSION' since migration 023, but no
-- version of ledger_transactions_category_check ever listed it, so on a real database every referral
-- earning would have been refused. This also adds the reversal category used when an admin voids a held
-- commission, and 'LEADERBOARD_BONUS' (leaderboard.service.js), which was missing for the same reason.
--
-- WHY the union and not just 068's list: 068 re-created the constraint from its own list and dropped
-- FAST_PAYOUT_FEE / RETURN_PROTECTION_* that 066 had added. Widening can never reject an existing row,
-- so this list is every category any migration or service has used. Re-runnable.

DO $$
DECLARE
  old_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%REFERRAL_REVERSAL%'
  ) THEN
    RETURN;
  END IF;

  FOR old_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%ESCROW_RELEASE%'
  LOOP
    EXECUTE format('ALTER TABLE ledger_transactions DROP CONSTRAINT %I', old_name);
  END LOOP;

  ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_category_check
    CHECK (category IN ('SALE_COMMISSION','SUPPLIER_PAYMENT','ESCROW_LOCK','ESCROW_RELEASE',
                        'CLAWBACK','REFUND','PAYOUT','PAYOUT_FEE','ADJUSTMENT','AD_SPEND',
                        'COIN_REDEMPTION','REFERRAL_BONUS','QUEST_REWARD','COD_SETTLEMENT',
                        'SUBSCRIPTION_FEE','VOLUME_INCENTIVE',
                        'SAMPLE_HOLD','SAMPLE_RELEASE','SAMPLE_REFUND',
                        'TEAM_PURCHASE_HOLD','TEAM_PURCHASE_RELEASE',
                        'FAST_PAYOUT_FEE','RETURN_PROTECTION_PREMIUM','RETURN_PROTECTION_CLAIM',
                        'REFERRAL_COMMISSION','REFERRAL_REVERSAL','LEADERBOARD_BONUS'));
END $$;
