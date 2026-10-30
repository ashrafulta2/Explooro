-- 092_vault_checkout.sql
--
-- A shopper may pay a normal checkout from their own vault (services/vaultCheckout.service.ts), so
-- money earned inside Explooro (referral commissions, top-ups) can be spent on an order instead of
-- sitting unused. Customers cannot withdraw, so this is the way their vault money is used.
--
-- Two ledger categories:
--   VAULT_PAYMENT  the shopper's AVAILABLE -> EXTERNAL_CLEARING, exactly the order total, at checkout
--   VAULT_REFUND   EXTERNAL_CLEARING -> the shopper's AVAILABLE, exactly the order total, on cancel
--
-- WHY through the clearing wallet and not straight into escrow: escrow is funded from the clearing
-- wallet for every paid order (payment.service lockEscrowForPaidOrder), and its deposit is the order
-- before any coupon. Paying the clearing wallet the discounted total keeps a vault order on exactly
-- the path a bKash order takes, and the shopper is never charged the coupon back.
--
-- orders.payment_method already accepts WALLET (migration 068). Safe to re-run.

DO $$
DECLARE
  old_name TEXT;
BEGIN
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
                        'PARTNER_REWARD','WALLET_TOPUP','VAULT_PAYMENT','VAULT_REFUND'));
END $$;
