-- 030_warranty.sql (Prompt 10.4)
-- Implements Digital Warranty & Claims Engine per docs/erd.md §6 & idea proposition.md §AA.

-- 1. Warranty Cards (Digital Guarantee Certificates)
CREATE TABLE IF NOT EXISTS warranty_cards (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,                  -- WAR-8K2P9Q1X
  order_item_id       BIGINT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  customer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supplier_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  serial_number       TEXT,
  coverage_terms_en   TEXT,
  coverage_terms_bn   TEXT,
  is_transferable     BOOLEAN NOT NULL DEFAULT false,
  starts_at           TIMESTAMPTZ NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_warranty_order_item UNIQUE (order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_warranty_cards_customer ON warranty_cards (customer_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_warranty_cards_supplier ON warranty_cards (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warranty_cards_serial ON warranty_cards (serial_number) WHERE serial_number IS NOT NULL;

-- 2. Warranty Claims (Repair, Replace, Refund Requests)
CREATE TABLE IF NOT EXISTS warranty_claims (
  id                  BIGSERIAL PRIMARY KEY,
  ref                 TEXT UNIQUE NOT NULL,                  -- CLM-4N7T2V9Y
  warranty_card_id    BIGINT NOT NULL REFERENCES warranty_cards(id) ON DELETE RESTRICT,
  customer_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issue_description   TEXT NOT NULL,
  evidence_media_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution          TEXT CHECK (resolution IN ('REPAIR','REPLACE','REFUND','REJECTED')),
  status              TEXT NOT NULL DEFAULT 'SUBMITTED'
                      CHECK (status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED',
                                        'IN_PROGRESS','COMPLETED','ESCALATED')),
  reverse_shipment_id BIGINT REFERENCES shipments(id) ON DELETE SET NULL,
  sla_due_at          TIMESTAMPTZ,
  decided_by          BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  rejection_reason    TEXT,
  supplier_notes      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_warranty_claims_card ON warranty_claims (warranty_card_id);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_customer ON warranty_claims (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warranty_claims_status ON warranty_claims (status, sla_due_at);

-- 3. Add transferability setting to categories if column doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'categories' AND column_name = 'is_warranty_transferable'
  ) THEN
    ALTER TABLE categories ADD COLUMN is_warranty_transferable BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
