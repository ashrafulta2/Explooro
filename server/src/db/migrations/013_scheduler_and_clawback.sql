-- 013_scheduler_and_clawback.sql (Prompt 6.2)
-- Implements scheduler execution audit (job_runs), failed escrow release dead-letter queue (escrow_dead_letters),
-- and negative-balance recovery records for post-release clawbacks (negative_balance_recoveries).

-- 1. Job Runs (Scheduler execution audit)
CREATE TABLE IF NOT EXISTS job_runs (
  id                    BIGSERIAL PRIMARY KEY,
  job_name              TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED','SKIPPED')),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ,
  duration_ms           INTEGER,
  processed_count       INTEGER NOT NULL DEFAULT 0,
  success_count         INTEGER NOT NULL DEFAULT 0,
  error_count           INTEGER NOT NULL DEFAULT 0,
  error_details_json    JSONB,
  metadata_json         JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_runs_name ON job_runs (job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs (status, started_at DESC);

-- 2. Escrow Dead Letters (Failed escrow releases requiring admin review)
CREATE TABLE IF NOT EXISTS escrow_dead_letters (
  id                    BIGSERIAL PRIMARY KEY,
  escrow_entry_id       BIGINT REFERENCES escrow_entries(id) ON DELETE SET NULL,
  sub_order_id          BIGINT REFERENCES sub_orders(id) ON DELETE SET NULL,
  failure_reason        TEXT NOT NULL,
  failure_stack         TEXT,
  attempts              INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','RESOLVED','IGNORED')),
  resolved_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  resolution_note       TEXT,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_escrow_dead_letters_status ON escrow_dead_letters (status, created_at);
CREATE INDEX IF NOT EXISTS idx_escrow_dead_letters_sub ON escrow_dead_letters (sub_order_id);

-- 3. Negative Balance Recoveries (Deficit tracking for post-release return clawbacks)
CREATE TABLE IF NOT EXISTS negative_balance_recoveries (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,            -- NBR-7X9K2M1A
  wallet_id             BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sub_order_id          BIGINT REFERENCES sub_orders(id) ON DELETE SET NULL,
  total_clawback_amount NUMERIC(14,2) NOT NULL CHECK (total_clawback_amount >= 0),
  recovered_from_available NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (recovered_from_available >= 0),
  unrecovered_deficit   NUMERIC(14,2) NOT NULL CHECK (unrecovered_deficit >= 0),
  recovery_status       TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (recovery_status IN ('PENDING','PARTIALLY_RECOVERED','RECOVERED','WRITTEN_OFF')),
  recovered_at          TIMESTAMPTZ,
  written_off_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reason                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_neg_recoveries_wallet ON negative_balance_recoveries (wallet_id, recovery_status);
CREATE INDEX IF NOT EXISTS idx_neg_recoveries_user ON negative_balance_recoveries (user_id, recovery_status);
