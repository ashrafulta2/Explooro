-- 039_payments.sql (Prompt 5.3)
-- Enhances payment_transactions and webhook indexing for high-throughput idempotency and reconciliation sweeps.

CREATE INDEX IF NOT EXISTS idx_payment_txns_gateway_status ON payment_transactions (gateway, status, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_txns_idempotency ON payment_transactions (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_webhook_received ON payment_webhook_events (received_at);

-- View for monitoring transactions stuck in PENDING beyond SLA (15 minutes)
CREATE OR REPLACE VIEW v_stuck_payment_transactions AS
SELECT
  id,
  ref,
  order_id,
  user_id,
  gateway,
  gateway_ref,
  amount,
  status,
  created_at,
  EXTRACT(EPOCH FROM (now() - created_at)) / 60.0 AS stuck_minutes
FROM payment_transactions
WHERE status IN ('INITIATED', 'PENDING')
  AND created_at < (now() - INTERVAL '15 minutes');
