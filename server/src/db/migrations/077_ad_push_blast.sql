-- 077_ad_push_blast.sql — delivery of the Push Notification Blast ad format.
--
-- The `push_blast` product (CPS, prepaid, PUSH_INBOX) was sellable but nothing ever sent it: the
-- shop partner paid for N recipients and N pushes never left. This adds the bookkeeping the delivery
-- job needs.
--
--   1. ad_push_deliveries — one row per (campaign, shopper). The UNIQUE key is the claim: the job
--      inserts the row BEFORE it sends, so a crash or a second worker can never message the same
--      shopper twice for one campaign. It also powers the per-shopper frequency cap.
--   2. ad_campaigns.push_delivered_count / push_settled_at — progress, and the "money has been
--      reconciled" mark. Settlement refunds the recipients that were paid for but not reached,
--      because the format is priced per recipient DELIVERED.

CREATE TABLE IF NOT EXISTS ad_push_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id BIGINT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id)
);

-- The frequency cap asks "has this shopper had ANY ad push in the last N days?".
CREATE INDEX IF NOT EXISTS idx_ad_push_deliveries_user_sent ON ad_push_deliveries (user_id, sent_at DESC);

ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS push_delivered_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS push_settled_at TIMESTAMPTZ;

-- The sweep looks only at unsettled push campaigns.
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_push_pending
  ON ad_campaigns (start_date)
  WHERE placement = 'PUSH_INBOX' AND push_settled_at IS NULL;
