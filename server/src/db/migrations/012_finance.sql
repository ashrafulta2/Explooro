-- 012_finance.sql (Prompt 6.1)
-- Implements the financial core: wallets, append-only double-entry ledger, escrow holds,
-- payout requests, payment transaction records, COD reconciliation, and B2B escrow milestones
-- per docs/erd.md §5 and prompt.md §6.1.

-- 1. Wallets
CREATE TABLE IF NOT EXISTS wallets (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  available_balance     NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  pending_escrow_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (pending_escrow_balance >= 0),
  held_balance          NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (held_balance >= 0),
  lifetime_earned       NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (lifetime_earned >= 0),
  lifetime_withdrawn    NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (lifetime_withdrawn >= 0),
  currency              TEXT NOT NULL DEFAULT 'BDT',
  version               BIGINT NOT NULL DEFAULT 0,       -- optimistic concurrency counter
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets (user_id);

-- 2. TRUE Double-Entry Append-Only Ledger Transactions
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id                    BIGSERIAL,
  txn_group_id          UUID NOT NULL,                   -- entries in a group MUST sum to zero
  wallet_id             BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  entry_type            TEXT NOT NULL CHECK (entry_type IN ('DEBIT','CREDIT')),
  amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  balance_bucket        TEXT NOT NULL
                        CHECK (balance_bucket IN ('AVAILABLE','ESCROW','HELD')),
  category              TEXT NOT NULL
                        CHECK (category IN ('SALE_COMMISSION','SUPPLIER_PAYMENT','ESCROW_LOCK',
                                            'ESCROW_RELEASE','CLAWBACK','REFUND','PAYOUT',
                                            'PAYOUT_FEE','ADJUSTMENT','AD_SPEND','COIN_REDEMPTION',
                                            'REFERRAL_BONUS','QUEST_REWARD','COD_SETTLEMENT')),
  reference_type        TEXT NOT NULL,
  reference_id          BIGINT NOT NULL,
  idempotency_key       TEXT,
  memo                  TEXT,
  created_by            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS idx_ledger_txn_group ON ledger_transactions (txn_group_id);
CREATE INDEX IF NOT EXISTS idx_ledger_wallet_bucket ON ledger_transactions (wallet_id, balance_bucket, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_reference ON ledger_transactions (reference_type, reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency ON ledger_transactions (idempotency_key, created_at)
  WHERE idempotency_key IS NOT NULL;

-- Dynamic partitions for ledger_transactions: current month + 3 months ahead
DO $$
DECLARE
  month_start DATE := date_trunc('month', now())::date;
  i INT;
  partition_name TEXT;
  range_start DATE;
  range_end DATE;
BEGIN
  FOR i IN 0..3 LOOP
    range_start := month_start + (i || ' months')::interval;
    range_end := month_start + ((i + 1) || ' months')::interval;
    partition_name := 'ledger_transactions_' || to_char(range_start, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF ledger_transactions FOR VALUES FROM (%L) TO (%L)',
      partition_name, range_start, range_end
    );
  END LOOP;
END $$;

-- Append-only trigger: UPDATE and DELETE are blocked outright on ledger_transactions
CREATE OR REPLACE FUNCTION ledger_transactions_block_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_transactions is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_block_update
  BEFORE UPDATE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_transactions_block_mutation();

CREATE TRIGGER trg_ledger_block_delete
  BEFORE DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_transactions_block_mutation();

-- 3. Escrow Entries
CREATE TABLE IF NOT EXISTS escrow_entries (
  id                    BIGSERIAL PRIMARY KEY,
  sub_order_id          BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  wallet_id             BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  beneficiary_role      TEXT NOT NULL CHECK (beneficiary_role IN ('SUPPLIER','SALER','PLATFORM')),
  amount                NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  status                TEXT NOT NULL DEFAULT 'LOCKED'
                        CHECK (status IN ('LOCKED','RELEASED','CLAWED_BACK','FROZEN','FAILED')),
  hold_until            TIMESTAMPTZ NOT NULL,
  released_at           TIMESTAMPTZ,
  frozen_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  freeze_reason         TEXT,
  failure_count         INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sub_order_id, wallet_id, beneficiary_role)
);

CREATE INDEX IF NOT EXISTS idx_escrow_sub_order ON escrow_entries (sub_order_id);
CREATE INDEX IF NOT EXISTS idx_escrow_due ON escrow_entries (hold_until) WHERE status = 'LOCKED';
CREATE INDEX IF NOT EXISTS idx_escrow_wallet ON escrow_entries (wallet_id, status);

-- 4. Payout Requests
CREATE TABLE IF NOT EXISTS payout_requests (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,            -- PAY-3M7V2WQ1
  wallet_id             BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  method                TEXT NOT NULL CHECK (method IN ('BKASH','NAGAD','ROCKET','BANK')),
  account_number        TEXT NOT NULL,                   -- 🔐 encrypted at application level
  account_name          TEXT NOT NULL,
  bank_name             TEXT,
  amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  fee_amount            NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (fee_amount >= 0),
  net_amount            NUMERIC(14,2) NOT NULL CHECK (net_amount > 0),
  status                TEXT NOT NULL DEFAULT 'REQUESTED'
                        CHECK (status IN ('REQUESTED','HELD','APPROVED','PROCESSING',
                                          'COMPLETED','FAILED','REJECTED','CANCELLED')),
  risk_flags_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  pending_action_id     BIGINT REFERENCES pending_admin_actions(id) ON DELETE SET NULL,
  approved_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,
  gateway_ref           TEXT,
  gateway_receipt       JSONB,
  failure_reason        TEXT,
  processed_at          TIMESTAMPTZ,
  idempotency_key       TEXT UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ,
  CONSTRAINT net_is_consistent CHECK (net_amount = amount - fee_amount)
);

CREATE INDEX IF NOT EXISTS idx_payouts_user ON payout_requests (user_id, status);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payout_requests (status, created_at);

-- 5. Payment Transactions
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,
  order_id              BIGINT REFERENCES orders(id) ON DELETE RESTRICT,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  gateway               TEXT NOT NULL CHECK (gateway IN ('BKASH','NAGAD','SSLCOMMERZ','COD','MOCK')),
  intent                TEXT NOT NULL CHECK (intent IN ('SALE','AUTHORIZE','CAPTURE','REFUND','PAYOUT')),
  gateway_ref           TEXT,
  amount                NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status                TEXT NOT NULL DEFAULT 'INITIATED'
                        CHECK (status IN ('INITIATED','PENDING','SUCCESS','FAILED','TIMEOUT','REVERSED')),
  raw_request           JSONB,                           -- credentials masked before write
  raw_response          JSONB,
  idempotency_key       TEXT UNIQUE,
  reconciled_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_txns_stuck ON payment_transactions (created_at)
  WHERE status IN ('INITIATED','PENDING');
CREATE INDEX IF NOT EXISTS idx_payment_txns_order ON payment_transactions (order_id);

-- 6. Payment Webhook Events (Replay protection)
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id                    BIGSERIAL PRIMARY KEY,
  gateway               TEXT NOT NULL,
  provider_event_id     TEXT NOT NULL,
  signature_valid       BOOLEAN NOT NULL,
  payload_json          JSONB NOT NULL,
  processed_at          TIMESTAMPTZ,
  process_result        TEXT,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gateway, provider_event_id)
);

-- 7. COD Reconciliation
CREATE TABLE IF NOT EXISTS cod_reconciliation (
  id                    BIGSERIAL PRIMARY KEY,
  sub_order_id          BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  courier               TEXT NOT NULL,
  consignment_id        TEXT,
  expected_amount       NUMERIC(14,2) NOT NULL CHECK (expected_amount >= 0),
  courier_reported      NUMERIC(14,2),
  deposit_received      NUMERIC(14,2),
  variance              NUMERIC(14,2),
  status                TEXT NOT NULL DEFAULT 'AWAITING'
                        CHECK (status IN ('AWAITING','MATCHED','SHORT_COLLECTION','OVER_COLLECTION',
                                          'MISSING_DEPOSIT','DUPLICATE','UNMATCHED_CONSIGNMENT',
                                          'TIMING_DIFFERENCE','RESOLVED')),
  settlement_batch_ref  TEXT,
  resolved_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  resolution_reason     TEXT,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ,
  UNIQUE (sub_order_id)
);

CREATE INDEX IF NOT EXISTS idx_cod_recon_status ON cod_reconciliation (status);

-- 8. B2B Escrow Milestones
CREATE TABLE IF NOT EXISTS b2b_escrow_milestones (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,
  sub_order_id          BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  buyer_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supplier_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sequence_no           INTEGER NOT NULL CHECK (sequence_no > 0),
  label_en              TEXT NOT NULL,
  label_bn              TEXT NOT NULL,
  release_pct           NUMERIC(5,2) NOT NULL CHECK (release_pct > 0 AND release_pct <= 100),
  amount                NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  evidence_required     TEXT NOT NULL
                        CHECK (evidence_required IN ('NONE','DISPATCH_PROOF','DELIVERY_PROOF','INSPECTION')),
  evidence_media_json   JSONB,
  bank_ref              TEXT,                            -- 🔐 encrypted
  status                TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','EVIDENCE_SUBMITTED','RELEASED','FROZEN','REFUNDED')),
  agreed_terms_hash     TEXT NOT NULL,                   -- immutable snapshot of agreed schedule
  released_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  released_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sub_order_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_b2b_milestones_sub_order ON b2b_escrow_milestones (sub_order_id, sequence_no);
