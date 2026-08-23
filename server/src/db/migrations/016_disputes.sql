-- 016_disputes.sql (Prompt 7.3)
-- Dispute Arbitration & Mediation Engine (DFD Subsystem 9.0 / ERD §6).

-- 1. Dispute Threads
CREATE TABLE IF NOT EXISTS dispute_threads (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,              -- DSP-2R6Y1LM5
  return_id           BIGINT REFERENCES return_requests(id) ON DELETE RESTRICT,
  sub_order_id        BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  customer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  saler_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  moderator_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  disputed_amount     NUMERIC(14,2) NOT NULL CHECK (disputed_amount >= 0),
  reason              TEXT NOT NULL DEFAULT 'ITEM_DISPUTE',
  outcome             TEXT CHECK (outcome IN ('FULL_REFUND','PARTIAL_REFUND','REPLACEMENT',
                                              'REJECTED','SPLIT_LIABILITY')),
  outcome_split_json  JSONB,                             -- who bears what share { buyer_refund, supplier_clawback, saler_clawback, platform_share }
  status              TEXT NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','AWAITING_CUSTOMER','AWAITING_SELLER',
                                        'UNDER_ARBITRATION','ESCALATED','AWAITING_SUPER_ADMIN',
                                        'RESOLVED','CLOSED')),
  sla_due_at          TIMESTAMPTZ,
  escalated_at        TIMESTAMPTZ,
  escalation_reason   TEXT,
  pending_action_id   BIGINT REFERENCES pending_admin_actions(id) ON DELETE SET NULL,
  resolution_notes    TEXT,
  resolved_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dispute_threads_sub_order ON dispute_threads (sub_order_id);
CREATE INDEX IF NOT EXISTS idx_dispute_threads_return ON dispute_threads (return_id);
CREATE INDEX IF NOT EXISTS idx_dispute_threads_customer ON dispute_threads (customer_id);
CREATE INDEX IF NOT EXISTS idx_dispute_threads_supplier ON dispute_threads (supplier_id);
CREATE INDEX IF NOT EXISTS idx_dispute_threads_saler ON dispute_threads (saler_id);
CREATE INDEX IF NOT EXISTS idx_dispute_threads_status ON dispute_threads (status);
CREATE INDEX IF NOT EXISTS idx_dispute_threads_sla ON dispute_threads (sla_due_at) WHERE status IN ('OPEN', 'UNDER_ARBITRATION', 'AWAITING_CUSTOMER', 'AWAITING_SELLER');

-- 2. Dispute Messages
CREATE TABLE IF NOT EXISTS dispute_messages (
  id                  BIGSERIAL PRIMARY KEY,
  dispute_id          BIGINT NOT NULL REFERENCES dispute_threads(id) ON DELETE CASCADE,
  sender_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sender_role         TEXT NOT NULL CHECK (sender_role IN ('CUSTOMER','SALER','SUPPLIER','MODERATOR','ADMIN','SUPER_ADMIN')),
  body                TEXT NOT NULL,
  attachments_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_internal_note    BOOLEAN NOT NULL DEFAULT false,    -- moderator-only; must never leak
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute ON dispute_messages (dispute_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_sender ON dispute_messages (sender_id);
