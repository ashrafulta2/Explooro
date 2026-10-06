-- 052_saler_pro_subscriptions.sql
--
-- Seller subscription plans (Saler Pro) become real data. Until now /admin/finance/subscriptions was
-- served from hardcoded arrays in finance.controller.js: plans, subscribers and the MRR figure were
-- invented, and create/update only wrote an audit row.
--
-- WHY nothing here is switched on: the whole feature stays behind the `subscription_fees` module
-- (default OFF). Rows in these tables are inert while the module is OFF — no billing, and the
-- commission rebate is not applied in pricing. Switching it OFF later keeps every subscription.
--
-- WHY the rebate is a column and not a constant: commission_rebate_pct is the number a business
-- person will want to change, so each plan carries its own. Admins edit it from the plan editor.
--
-- Only Free Starter and Saler Pro are seeded. The mock's "Supplier Growth" and "Enterprise" plans
-- were invented numbers, so an admin creates those if they want them.

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                     BIGSERIAL PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  name_en                TEXT NOT NULL,
  name_bn                TEXT NOT NULL,
  role                   TEXT NOT NULL DEFAULT 'ALL' CHECK (role IN ('ALL', 'saler', 'supplier')),
  monthly_fee            NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (monthly_fee >= 0),
  free_listings          INTEGER NOT NULL DEFAULT 100 CHECK (free_listings >= 0),
  extra_listing_fee      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (extra_listing_fee >= 0),
  -- Percentage points moved from the platform's share to the saler's share (2.00 = 40% -> 42%).
  commission_rebate_pct  NUMERIC(5,2) NOT NULL DEFAULT 0.00
                         CHECK (commission_rebate_pct >= 0 AND commission_rebate_pct <= 100),
  features_en            JSONB NOT NULL DEFAULT '[]'::jsonb,
  features_bn            JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_id                BIGINT NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status                 TEXT NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE', 'PAST_DUE', 'WAIVED', 'CANCELLED', 'EXPIRED')),
  current_period_start   TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end     TIMESTAMPTZ NOT NULL,
  auto_renew             BOOLEAN NOT NULL DEFAULT true,
  -- Cancelling never cuts benefits early: it stops renewal and the plan runs to period end.
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  grace_ends_at          TIMESTAMPTZ,
  waiver_reason          TEXT,
  -- NULL on a WAIVED row means an indefinite exemption; otherwise the renewal job lifts the waiver then.
  waiver_ends_at         TIMESTAMPTZ,
  waived_by              BIGINT REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at           TIMESTAMPTZ,
  -- The period end a renewal reminder was last sent for; a reminder is due only while this differs
  -- from current_period_end, so the hourly job can never remind twice for the same renewal.
  renewal_reminded_for   TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WHY partial unique: a user has at most one live subscription; history rows (CANCELLED/EXPIRED)
-- accumulate freely so re-subscribing never needs an update-in-place.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_one_live
  ON subscriptions (user_id) WHERE status IN ('ACTIVE', 'PAST_DUE', 'WAIVED');
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal
  ON subscriptions (current_period_end) WHERE status IN ('ACTIVE', 'PAST_DUE');

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id                     BIGSERIAL PRIMARY KEY,
  subscription_id        BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  user_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_id                BIGINT NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  amount                 NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  period_start           TIMESTAMPTZ NOT NULL,
  period_end             TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('PAID', 'FAILED', 'WAIVED')),
  ledger_txn_group_id    UUID,
  idempotency_key        TEXT NOT NULL UNIQUE,
  failure_reason         TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WHY: one PAID/WAIVED invoice per subscription per period, so a retried or double-fired renewal job
-- can never charge the same month twice. FAILED rows are excluded so a failed attempt can be retried.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_invoice_period
  ON subscription_invoices (subscription_id, period_start) WHERE status IN ('PAID', 'WAIVED');
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_user ON subscription_invoices (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_plan ON subscription_invoices (plan_id);

-- The ledger's category list is a CHECK constraint (012_finance.sql) with a generated name, so it is
-- looked up by definition instead of by name. Re-runnable: skipped once SUBSCRIPTION_FEE is present.
DO $$
DECLARE
  old_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ledger_transactions'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%SUBSCRIPTION_FEE%'
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
                        'SUBSCRIPTION_FEE'));
END $$;

INSERT INTO subscription_plans
  (code, name_en, name_bn, role, monthly_fee, free_listings, extra_listing_fee,
   commission_rebate_pct, features_en, features_bn, sort_order)
VALUES
  ('starter', 'Free Starter', 'ফ্রি স্টার্টার', 'ALL', 0, 100, 0, 0,
   '["Up to 100 live products", "Standard escrow release", "Community support", "Basic sales dashboard"]'::jsonb,
   '["সর্বোচ্চ ১০০টি সক্রিয় পণ্য", "সাধারণ এসক্রো রিলিজ", "কমিউনিটি সহায়তা", "বেসিক সেলস ড্যাশবোর্ড"]'::jsonb,
   0),
  ('saler_pro', 'Saler Pro', 'সেলার প্রো', 'saler', 999, 1000, 2.00, 2.00,
   '["1,000 product listings", "+2% commission profit boost", "Priority support & AI tools"]'::jsonb,
   '["১,০০০ পণ্য লিস্টিং", "+২% অতিরিক্ত প্রফিট স্প্লিট", "অগ্রাধিকার সাপোর্ট ও এআই টুলস"]'::jsonb,
   10)
ON CONFLICT (code) DO NOTHING;
