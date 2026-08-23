-- 014_logistics.sql (Prompt 7.1)
-- Multi-carrier logistics hub: Carrier Routing Rules, Shipments, and Shipment Status Event Timeline.

-- 1. Carrier Routing Rules
CREATE TABLE IF NOT EXISTS carrier_routing_rules (
  id                    BIGSERIAL PRIMARY KEY,
  district_name         TEXT,
  supplier_id           BIGINT REFERENCES users(id) ON DELETE CASCADE,
  carrier               TEXT NOT NULL CHECK (carrier IN ('STEADFAST','PATHAO','REDX','MOCK','OTHER')),
  priority              INTEGER NOT NULL DEFAULT 1 CHECK (priority >= 1),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_carrier_rules_lookup ON carrier_routing_rules (district_name, supplier_id, is_active);

-- 2. Shipments
CREATE TABLE IF NOT EXISTS shipments (
  id                    BIGSERIAL PRIMARY KEY,
  ref                   TEXT UNIQUE NOT NULL,
  sub_order_id          BIGINT NOT NULL REFERENCES sub_orders(id) ON DELETE RESTRICT,
  carrier               TEXT NOT NULL CHECK (carrier IN ('STEADFAST','PATHAO','REDX','MOCK','OTHER')),
  tracking_number       TEXT UNIQUE NOT NULL,
  courier_consignment_id TEXT,
  status                TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY',
                                          'DELIVERED','PARTIAL_DELIVERY','RETURNED','CANCELLED','FAILED')),
  recipient_name        TEXT NOT NULL,
  recipient_phone       TEXT NOT NULL,
  delivery_address_json JSONB NOT NULL,
  cod_amount            NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (cod_amount >= 0),
  shipping_charge       NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (shipping_charge >= 0),
  label_url             TEXT,
  current_latitude      NUMERIC(9,6),
  current_longitude     NUMERIC(9,6),
  delivered_at          TIMESTAMPTZ,
  returned_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shipments_sub_order ON shipments (sub_order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments (tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments (status);

-- 3. Shipment Event History Log (Timeline)
CREATE TABLE IF NOT EXISTS shipment_events (
  id                    BIGSERIAL PRIMARY KEY,
  shipment_id           BIGINT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_id              TEXT, -- for idempotency/replay protection
  carrier_status        TEXT NOT NULL,
  normalized_status     TEXT NOT NULL
                        CHECK (normalized_status IN ('PENDING','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY',
                                                     'DELIVERED','PARTIAL_DELIVERY','RETURNED','CANCELLED','FAILED')),
  location              TEXT,
  note                  TEXT,
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),
  raw_payload_json      JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment ON shipment_events (shipment_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_shipment_events_replay ON shipment_events (event_id) WHERE event_id IS NOT NULL;
