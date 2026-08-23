-- 012_returns.sql (Prompt 7.2)
-- Return & Refund Engine (DFD Subsystem 9.0): return_requests and return_items.

-- 1. Return Requests
CREATE TABLE IF NOT EXISTS return_requests (
  id                      BIGSERIAL PRIMARY KEY,
  ref                     TEXT UNIQUE NOT NULL,
  sub_order_id            BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  customer_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason_code             TEXT NOT NULL
                          CHECK (reason_code IN ('DAMAGED','WRONG_ITEM','DEFECTIVE','SIZE_MISMATCH',
                                                 'NOT_AS_DESCRIBED','CHANGED_MIND','OTHER')),
  customer_note           TEXT,
  status                  TEXT NOT NULL DEFAULT 'REQUESTED'
                          CHECK (status IN ('REQUESTED','UNDER_REVIEW','APPROVED','REJECTED',
                                            'PICKUP_SCHEDULED','RECEIVED','INSPECTED','REFUNDED','DISPUTED')),
  evidence_urls_json      JSONB NOT NULL DEFAULT '[]',
  preferred_resolution    TEXT NOT NULL DEFAULT 'WALLET_REFUND'
                          CHECK (preferred_resolution IN ('WALLET_REFUND','ORIGINAL_GATEWAY','REPLACEMENT')),
  refund_amount           NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (refund_amount >= 0),
  reverse_tracking_number TEXT,
  reverse_carrier         TEXT,
  inspection_notes        TEXT,
  rejection_reason        TEXT,
  reviewed_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  received_at             TIMESTAMPTZ,
  inspected_at            TIMESTAMPTZ,
  refunded_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_return_requests_sub_order ON return_requests (sub_order_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_customer ON return_requests (customer_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_status ON return_requests (status);
CREATE INDEX IF NOT EXISTS idx_return_requests_ref ON return_requests (ref);

-- 2. Return Items
CREATE TABLE IF NOT EXISTS return_items (
  id                      BIGSERIAL PRIMARY KEY,
  return_request_id       BIGINT NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  order_item_id           BIGINT NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  product_id              BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity                INTEGER NOT NULL CHECK (quantity > 0),
  unit_price              NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  item_reason_notes       TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_items_request ON return_items (return_request_id);
CREATE INDEX IF NOT EXISTS idx_return_items_product ON return_items (product_id);
