-- 105_reverse_pickups.sql
--
-- Parcels that travel back: a courier collects a returned product (return_requests) or a product
-- sent in for warranty repair or replacement (warranty_claims) from the customer.
--
-- WHY a table of their own and not rows in `shipments`: a `shipments` row is the forward parcel of
-- a sub-order, and its DELIVERED webhook marks the sub-order delivered, deposits escrow (the profit
-- split) and issues warranty cards; RETURNED restocks and claws escrow back
-- (shipment.service applyShipmentEvent). A reverse parcel stored there would run all of that a
-- second time when it reached the warehouse. Here a courier event only moves the pickup's own
-- status; the return is still received and inspected by staff, and the money moves only then.
--
-- The warranty pickup used to INSERT into `shipments` with no ref, recipient or address and the
-- status 'BOOKED', which the CHECK does not allow, so every such INSERT failed and no row exists to
-- move. warranty_claims.reverse_shipment_id stays for history; nothing writes it any more.
--
-- 1. Where returned products go. Filled in by a super admin at /admin/platform/operations
--    (platform.operations.update, CRITICAL). Empty on purpose: an invented warehouse address would
--    send real parcels to it. With couriers INTEGRATED a return cannot be booked until it is filled
--    (reversePickup.service.ts missingReturnAddressFields). A warranty pickup goes to the supplier's
--    own warehouse when they have one, else here.
INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
VALUES (
  'operations.return_address',
  '{"name": "", "phone": "", "division": "", "district": "", "upazila": "", "address_line": ""}'::jsonb,
  'OBJECT',
  'Where returned products are sent',
  'ফেরত পণ্য যেখানে পাঠানো হয়',
  'operations',
  false
)
ON CONFLICT (key) DO NOTHING;

-- 2. The reverse parcels.
CREATE TABLE IF NOT EXISTS reverse_pickups (
  id                        BIGSERIAL PRIMARY KEY,
  ref                       TEXT UNIQUE NOT NULL,
  kind                      TEXT NOT NULL CHECK (kind IN ('RETURN','WARRANTY')),
  return_request_id         BIGINT REFERENCES return_requests(id) ON DELETE RESTRICT,
  warranty_claim_id         BIGINT REFERENCES warranty_claims(id) ON DELETE RESTRICT,
  carrier                   TEXT NOT NULL CHECK (carrier IN ('STEADFAST','PATHAO','REDX','MOCK')),
  tracking_number           TEXT NOT NULL,
  courier_consignment_id    TEXT,
  status                    TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY',
                                              'DELIVERED','RETURNED','CANCELLED','FAILED')),
  pickup_name               TEXT NOT NULL,
  pickup_phone              TEXT NOT NULL,
  pickup_address_json       JSONB NOT NULL,
  destination_name          TEXT NOT NULL,
  destination_phone         TEXT NOT NULL,
  destination_address_json  JSONB NOT NULL,
  label_url                 TEXT,
  delivered_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ,
  -- Exactly one parent, matching the kind.
  CONSTRAINT reverse_pickups_parent_check CHECK (
    (kind = 'RETURN' AND return_request_id IS NOT NULL AND warranty_claim_id IS NULL)
    OR (kind = 'WARRANTY' AND warranty_claim_id IS NOT NULL AND return_request_id IS NULL)
  ),
  -- A carrier's numbers are unique within that carrier; the webhook matches on carrier + number.
  CONSTRAINT reverse_pickups_tracking_unique UNIQUE (carrier, tracking_number)
);

-- WHY partial: a cancelled or failed pickup may be booked again, but never two live ones at once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_reverse_pickups_live_return
  ON reverse_pickups (return_request_id) WHERE return_request_id IS NOT NULL AND status NOT IN ('CANCELLED','FAILED');
CREATE UNIQUE INDEX IF NOT EXISTS ux_reverse_pickups_live_claim
  ON reverse_pickups (warranty_claim_id) WHERE warranty_claim_id IS NOT NULL AND status NOT IN ('CANCELLED','FAILED');
CREATE INDEX IF NOT EXISTS idx_reverse_pickups_consignment ON reverse_pickups (carrier, courier_consignment_id);

CREATE TABLE IF NOT EXISTS reverse_pickup_events (
  id                  BIGSERIAL PRIMARY KEY,
  reverse_pickup_id   BIGINT NOT NULL REFERENCES reverse_pickups(id) ON DELETE CASCADE,
  event_id            TEXT,
  carrier_status      TEXT NOT NULL,
  normalized_status   TEXT NOT NULL
                      CHECK (normalized_status IN ('PENDING','PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY',
                                                   'DELIVERED','PARTIAL_DELIVERY','RETURNED','CANCELLED','FAILED')),
  location            TEXT,
  note                TEXT,
  raw_payload_json    JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reverse_pickup_events_pickup ON reverse_pickup_events (reverse_pickup_id, created_at);
-- Replay protection: a courier retrying the same event must not record it twice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_reverse_pickup_events_event ON reverse_pickup_events (event_id) WHERE event_id IS NOT NULL;

-- 3. Each parent points at its live pickup.
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS reverse_pickup_id BIGINT REFERENCES reverse_pickups(id) ON DELETE SET NULL;
ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS reverse_pickup_id BIGINT REFERENCES reverse_pickups(id) ON DELETE SET NULL;
