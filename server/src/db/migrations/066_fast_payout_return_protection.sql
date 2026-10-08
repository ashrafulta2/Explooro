-- 066_fast_payout_return_protection.sql (supplier attraction, step 5)
--
-- Two things a supplier or saler wants from the vault, and a way for the platform to earn from each:
--
--   FAST PAYOUT        Money sits in escrow until the return window ends. An earner may take it early for
--                      a fee (a share of the amount, set by the supplier's scorecard grade): the escrow
--                      entry is released now, the platform keeps the fee.
--   RETURN PROTECTION  A supplier opts in. If an order of theirs is later returned, the saler keeps the
--                      commission the clawback took from them; the platform pays it out of the treasury
--                      and is paid for that risk by a premium on the protected orders that complete.
--
-- Nothing here changes the profit split. Every movement is a balanced ledger group.

-- 1. One early release per escrow entry. The UNIQUE key is what stops a double click paying twice.
CREATE TABLE IF NOT EXISTS fast_payouts (
  id                  BIGSERIAL PRIMARY KEY,
  escrow_entry_id     BIGINT NOT NULL UNIQUE REFERENCES escrow_entries(id) ON DELETE RESTRICT,
  sub_order_id        BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  wallet_id           BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  beneficiary_role    TEXT NOT NULL CHECK (beneficiary_role IN ('SUPPLIER','SALER')),
  gross_amount        NUMERIC(14,2) NOT NULL CHECK (gross_amount > 0),
  fee_pct             NUMERIC(5,2) NOT NULL CHECK (fee_pct >= 0),
  fee_amount          NUMERIC(14,2) NOT NULL CHECK (fee_amount >= 0),
  net_amount          NUMERIC(14,2) NOT NULL CHECK (net_amount > 0),
  grade               CHAR(1),                       -- the scorecard grade the fee was judged on (NULL = ungraded)
  original_hold_until TIMESTAMPTZ NOT NULL,          -- when the money would have been released anyway
  days_saved          INTEGER NOT NULL CHECK (days_saved >= 0),
  ledger_txn_group_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fast_payout_reconciles CHECK (gross_amount = fee_amount + net_amount)
);

CREATE INDEX IF NOT EXISTS idx_fast_payouts_user ON fast_payouts (user_id, created_at DESC);
-- The outstanding-exposure check reads "this user's early releases whose original hold has not ended".
CREATE INDEX IF NOT EXISTS idx_fast_payouts_exposure ON fast_payouts (user_id, original_hold_until);

-- 2. Enrolment is a history, not a flag: an order is covered if its supplier was enrolled when the order
--    was PLACED, so leaving the programme never strips cover from orders already sold under it.
CREATE TABLE IF NOT EXISTS return_protection_enrollments (
  id            BIGSERIAL PRIMARY KEY,
  supplier_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  CONSTRAINT rp_enrollment_order CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- At most one open enrolment per supplier.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rp_enrollment_open ON return_protection_enrollments (supplier_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rp_enrollment_supplier ON return_protection_enrollments (supplier_id, started_at DESC);

-- 3. One cover per sub-order. The rate and the insured amount are snapshotted when the cover is made.
CREATE TABLE IF NOT EXISTS return_protection_covers (
  id                      BIGSERIAL PRIMARY KEY,
  sub_order_id            BIGINT NOT NULL UNIQUE REFERENCES sub_orders(id) ON DELETE RESTRICT,
  supplier_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  saler_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  insured_amount          NUMERIC(14,2) NOT NULL CHECK (insured_amount > 0),   -- the saler's commission
  premium_pct             NUMERIC(5,2) NOT NULL CHECK (premium_pct >= 0),
  premium_amount          NUMERIC(14,2) NOT NULL CHECK (premium_amount >= 0),
  premium_charged_at      TIMESTAMPTZ,
  premium_txn_group_id    UUID,
  status                  TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLAIMED','DENIED')),
  claim_amount            NUMERIC(14,2) CHECK (claim_amount IS NULL OR claim_amount > 0),
  claim_txn_group_id      UUID,
  claimed_at              TIMESTAMPTZ,
  denied_reason           TEXT,
  return_request_id       BIGINT REFERENCES return_requests(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rp_cover_claim_consistent CHECK (
    (status = 'CLAIMED' AND claim_amount IS NOT NULL AND claimed_at IS NOT NULL)
    OR (status <> 'CLAIMED' AND claim_amount IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_rp_covers_supplier ON return_protection_covers (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rp_covers_saler ON return_protection_covers (saler_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rp_covers_unpaid_premium ON return_protection_covers (id)
  WHERE status = 'ACTIVE' AND premium_charged_at IS NULL;

-- 4. Ledger categories. The category list is a CHECK with a generated name (see 052/064/065), found by
--    definition. Re-runnable: skipped once the new categories are present.
DO $$
DECLARE
  old_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%RETURN_PROTECTION_CLAIM%'
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
                        'FAST_PAYOUT_FEE','RETURN_PROTECTION_PREMIUM','RETURN_PROTECTION_CLAIM'));
END $$;

-- 5. Business numbers live in platform_settings, never in code. Two OBJECT rows.
--
-- supplier.fast_payout
--   fee_pct_by_grade    share of the released amount the platform keeps, by scorecard grade. A grade
--                       missing from this map (or listed in blocked_grades) cannot take an early payout.
--   ungraded_fee_pct    the same for a supplier with no scorecard yet
--   min_amount          smallest entry worth releasing early (BDT)
--   max_per_request     largest single entry that may be released early (BDT)
--   max_outstanding     most one person may hold in early releases whose original hold has not yet ended
--                       (BDT) - this is the exposure a later return could claw back from
--   min_days_saved      an entry with less than this left to wait is not worth a fee
--   blocked_grades      grades that may not take an early payout
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'supplier.fast_payout',
    '{
      "fee_pct_by_grade": { "A": 1, "B": 1.5, "C": 2.5 },
      "ungraded_fee_pct": 2,
      "min_amount": 100,
      "max_per_request": 50000,
      "max_outstanding": 100000,
      "min_days_saved": 2,
      "blocked_grades": ["D"]
    }'::jsonb,
    'OBJECT',
    'Fast payout rules',
    'ফাস্ট পেআউটের নিয়ম',
    'scorecard',
    false
  )
ON CONFLICT (key) DO NOTHING;

-- supplier.return_protection
--   enabled                    false stops new enrolments; covers already issued still pay out
--   premium_pct                share of the insured commission charged to the supplier when a protected
--                              order completes without a return (0..50). This is a starting estimate: set
--                              it from the real return rate, because it is what the treasury lives on.
--   max_claim_amount           most the treasury pays for one order (BDT)
--   max_claims_per_saler_30d   claims one saler may have paid in 30 days; beyond it a claim is DENIED,
--                              which is what stops a saler farming returns against the pool
--   blocked_grades             grades that may not enrol
--   premium_batch              covers priced per job run
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES
  (
    'supplier.return_protection',
    '{
      "enabled": true,
      "premium_pct": 10,
      "max_claim_amount": 5000,
      "max_claims_per_saler_30d": 5,
      "blocked_grades": ["D"],
      "premium_batch": 200
    }'::jsonb,
    'OBJECT',
    'Return protection rules',
    'রিটার্ন প্রোটেকশনের নিয়ম',
    'scorecard',
    false
  )
ON CONFLICT (key) DO NOTHING;
