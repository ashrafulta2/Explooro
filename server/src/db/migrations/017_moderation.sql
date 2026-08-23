-- 017_moderation.sql (Prompt 7.4)
-- Unified Product Approval & Content Moderation Pipeline (DFD Subsystem 10.0 / ERD §3 & §8).

CREATE TABLE IF NOT EXISTS moderation_queue (
  id                      BIGSERIAL PRIMARY KEY,
  ref                     TEXT UNIQUE NOT NULL,                  -- MOD-8K4P9ZN1
  item_type               TEXT NOT NULL
                          CHECK (item_type IN ('PRODUCT_NEW','PRODUCT_EDIT','REVIEW','UGC_VIDEO',
                                               'STOREFRONT_ASSET','LIVE_STREAM','CHAT_REPORT')),
  entity_id               BIGINT NOT NULL,                       -- ID of the target product, review, etc.
  submitted_by            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','IN_REVIEW','APPROVED','REJECTED',
                                            'CHANGES_REQUESTED','ESCALATED')),
  auto_flags_json         JSONB NOT NULL DEFAULT '[]'::jsonb,    -- advisory automated pre-screening flags
  payload_snapshot_json   JSONB NOT NULL DEFAULT '{}'::jsonb,    -- complete content snapshot for review
  claimed_by              BIGINT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at              TIMESTAMPTZ,
  decided_by              BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at              TIMESTAMPTZ,
  rejection_reason_en     TEXT,
  rejection_reason_bn     TEXT,
  changes_requested_en    TEXT,
  changes_requested_bn    TEXT,
  sla_due_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_moderation_queue_status_created ON moderation_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_queue_item_type ON moderation_queue (item_type, status);
CREATE INDEX IF NOT EXISTS idx_moderation_queue_claimed_by ON moderation_queue (claimed_by) WHERE status = 'IN_REVIEW';
CREATE INDEX IF NOT EXISTS idx_moderation_queue_submitted_by ON moderation_queue (submitted_by);
CREATE INDEX IF NOT EXISTS idx_moderation_queue_entity ON moderation_queue (item_type, entity_id);
