-- 064_volume_incentive.sql (supplier attraction, step 3: the Volume Incentive)
--
-- A supplier can already pay to be seen (063) and be graded (062). What they could not do was reward
-- the salers who move the most of their stock. This adds a monthly, supplier-funded rebate:
--
--   * the supplier sets tiers ("sell 50,000 of mine in a month -> 1% back"),
--   * when the month closes (plus a lag so returns land first) the job pays each qualifying saler
--     from the SUPPLIER's wallet, and the platform keeps `platform_fee_pct` of every rebate.
--
-- The platform earns without touching the profit split: the rebate is an extra transfer on top of
-- an order, never a change to what the order itself pays. Money moves as ONE balanced ledger group
-- (supplier DEBIT = saler CREDIT + treasury CREDIT), category VOLUME_INCENTIVE.

-- 1. Programs are versioned, never edited in place. A change inserts a new row effective from a
--    later month, so a saler who is half way through a month is never moved onto worse tiers.
CREATE TABLE IF NOT EXISTS volume_incentive_programs (
  id            BIGSERIAL PRIMARY KEY,
  supplier_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  valid_from    DATE NOT NULL,                       -- always the first day of a month
  is_active     BOOLEAN NOT NULL DEFAULT true,       -- false = the programme is paused from valid_from
  tiers_json    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ "min_volume": 50000, "rebate_pct": 1 }, ...]
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT volume_incentive_first_of_month CHECK (EXTRACT(DAY FROM valid_from) = 1),
  UNIQUE (supplier_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_vi_programs_supplier ON volume_incentive_programs (supplier_id, valid_from DESC);

-- 2. One payout per supplier x saler x month. The unique key is what makes the monthly job safe to
--    run twice: the second run finds the row and pays nothing again.
CREATE TABLE IF NOT EXISTS volume_incentive_payouts (
  id                  BIGSERIAL PRIMARY KEY,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  saler_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,                  -- last day of the month, inclusive
  volume              NUMERIC(14,2) NOT NULL CHECK (volume >= 0),
  rebate_pct          NUMERIC(5,2) NOT NULL CHECK (rebate_pct > 0),
  gross_amount        NUMERIC(14,2) NOT NULL CHECK (gross_amount > 0),
  platform_fee        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  net_amount          NUMERIC(14,2) NOT NULL CHECK (net_amount > 0),
  tiers_snapshot      JSONB NOT NULL,                 -- the tiers this payout was judged against
  status              TEXT NOT NULL DEFAULT 'UNFUNDED'
                      CHECK (status IN ('UNFUNDED', 'PAID', 'LAPSED')),
  ledger_txn_group_id UUID,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vi_payout_reconciles CHECK (gross_amount = platform_fee + net_amount),
  UNIQUE (supplier_id, saler_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_vi_payouts_saler ON volume_incentive_payouts (saler_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_vi_payouts_supplier ON volume_incentive_payouts (supplier_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_vi_payouts_open ON volume_incentive_payouts (status) WHERE status = 'UNFUNDED';

-- 3. The ledger's category list is a CHECK constraint with a generated name (see 052), so it is found
--    by definition. Re-runnable: skipped once VOLUME_INCENTIVE is present.
DO $$
DECLARE
  old_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%VOLUME_INCENTIVE%'
  ) THEN
    RETURN;
  END IF;

  SELECT conname INTO old_name FROM pg_constraint
  WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%AD_SPEND%';
  IF old_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ledger_transactions DROP CONSTRAINT %I', old_name);
  END IF;

  ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_category_check
    CHECK (category IN ('SALE_COMMISSION','SUPPLIER_PAYMENT','ESCROW_LOCK','ESCROW_RELEASE',
                        'CLAWBACK','REFUND','PAYOUT','PAYOUT_FEE','ADJUSTMENT','AD_SPEND',
                        'COIN_REDEMPTION','REFERRAL_BONUS','QUEST_REWARD','COD_SETTLEMENT',
                        'SUBSCRIPTION_FEE','VOLUME_INCENTIVE'));
END $$;

-- 4. Business numbers live in platform_settings, never in code. One OBJECT row.
--   max_rebate_pct       highest rebate a supplier may offer on any tier
--   max_tiers            how many tiers a programme may have
--   min_threshold        smallest monthly volume a first tier may ask for (BDT)
--   platform_fee_pct     share of each rebate the platform keeps (0..50)
--   settle_lag_days      days after month end before paying, so late returns are already counted
--   funding_retry_days   how long an unpaid rebate is retried before it lapses
--   blocked_grades       scorecard grades that may not run a programme (an incentive must not be
--                        used to lure salers to a supplier the platform already rates poorly)
--   timezone             the month boundaries a saler sees
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'supplier.volume_incentive',
    '{
      "max_rebate_pct": 5,
      "max_tiers": 4,
      "min_threshold": 5000,
      "platform_fee_pct": 10,
      "settle_lag_days": 7,
      "funding_retry_days": 7,
      "blocked_grades": ["D"],
      "timezone": "Asia/Dhaka"
    }'::jsonb,
    'OBJECT',
    'Volume incentive rules',
    'ভলিউম ইনসেনটিভের নিয়ম',
    'scorecard',
    false
  )
ON CONFLICT (key) DO NOTHING;
