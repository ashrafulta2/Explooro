-- 088_wallet_topup.sql
--
-- Adding money to an Explooro vault through bKash, Nagad or a card (SSLCommerz), so anyone can pay for
-- a Boost (migration 087) without first earning a balance.
--
-- A top-up rides the existing payment pipeline instead of a parallel one: a `payment_transactions` row
-- with intent TOPUP and no order, created by services/walletTopup.service.ts, paid through the same
-- gateway drivers (each with its mock driver in development), confirmed by the same authenticated
-- execute call, signed webhook or reconcile sweep. When the gateway confirms, the vault is credited
-- in one balanced ledger group in the new WALLET_TOPUP category:
--     EXTERNAL_CLEARING  DEBIT   (the money now sits in the company's merchant account)
--     the user's wallet  CREDIT  AVAILABLE
-- The credit is keyed by the transaction, so a replayed webhook or a retried execute never pays twice.
--
-- wallet.topup — the business numbers (bounds in walletTopup.service.ts RULE_LIMITS):
--   min_amount / max_amount   one top-up, in BDT
--   daily_limit               what one account may add in 24 hours (started or paid), a fraud brake
--   methods                   which ways to pay are offered
--
-- Safe to re-run.

DO $$
DECLARE
  old_name TEXT;
BEGIN
  FOR old_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'payment_transactions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%AUTHORIZE%'
  LOOP
    EXECUTE format('ALTER TABLE payment_transactions DROP CONSTRAINT %I', old_name);
  END LOOP;
  ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_intent_check
    CHECK (intent IN ('SALE','AUTHORIZE','CAPTURE','REFUND','PAYOUT','TOPUP'));

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
                        'REFERRAL_COMMISSION','REFERRAL_REVERSAL','LEADERBOARD_BONUS',
                        'PARTNER_REWARD','WALLET_TOPUP'));
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_txns_user_intent ON payment_transactions (user_id, intent, created_at DESC);

INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'wallet.topup',
  '{"min_amount": 50, "max_amount": 25000, "daily_limit": 50000, "methods": ["BKASH", "NAGAD", "CARD"]}'::jsonb,
  'OBJECT', 'Vault top-up rules', 'ভল্টে টাকা যোগের নিয়ম', 'finance', false
)
ON CONFLICT (key) DO NOTHING;
