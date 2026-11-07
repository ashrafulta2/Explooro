-- 109_courier_webhook_events.sql
--
-- One row per courier webhook received at POST /webhooks/courier/:carrier, whatever became of it:
-- processed, a duplicate, unmatched, a return pickup's update, or refused for a bad signature.
-- Before this, only the ones that moved a forward parcel left a trace (shipment_events), so a
-- courier sending updates with the wrong token was invisible. Shown beside payment_webhook_events
-- in the webhook log at /admin/platform/integrations.
--
-- WHY no payload column: a courier payload carries the recipient's name, phone and address. The
-- log needs only what happened and when; the parcel's own history keeps the details it needs.
CREATE TABLE IF NOT EXISTS courier_webhook_events (
  id                 BIGSERIAL PRIMARY KEY,
  carrier            TEXT NOT NULL,
  provider_event_id  TEXT,
  signature_valid    BOOLEAN NOT NULL,
  result             TEXT NOT NULL
                     CHECK (result IN ('PROCESSED', 'DUPLICATE', 'UNMATCHED', 'REVERSE_PICKUP', 'REJECTED', 'ERROR')),
  message            TEXT,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courier_webhook_received ON courier_webhook_events (received_at DESC);
