/**
 * payment.repository.js — Data Access Repository for Payment Transactions & Webhooks (Prompt 5.3).
 */

export async function createPaymentTransaction(db, {
  ref,
  orderId,
  userId,
  gateway,
  intent = 'SALE',
  amount,
  status = 'INITIATED',
  rawRequest = null,
  idempotencyKey = null,
}) {
  const sql = `
    INSERT INTO payment_transactions (
      ref, order_id, user_id, gateway, intent, amount, status, raw_request, idempotency_key, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now()
    )
    RETURNING *;
  `;
  const res = await db.query(sql, [
    ref,
    orderId,
    userId,
    gateway.toUpperCase(),
    intent.toUpperCase(),
    amount,
    status.toUpperCase(),
    rawRequest ? JSON.stringify(rawRequest) : null,
    idempotencyKey,
  ]);
  return res.rows[0];
}

export async function updatePaymentTransaction(db, idOrRef, {
  status,
  gatewayRef = null,
  rawResponse = null,
  reconciledAt = null,
}) {
  const isId = typeof idOrRef === 'number' || (!isNaN(Number(idOrRef)) && !String(idOrRef).startsWith('TXN-') && !String(idOrRef).startsWith('PAY-'));
  const whereClause = isId ? 'id = $1' : 'ref = $1';

  const updates = [];
  const values = [idOrRef];
  let idx = 2;

  if (status) {
    updates.push(`status = $${idx++}`);
    values.push(status.toUpperCase());
  }
  if (gatewayRef !== undefined) {
    updates.push(`gateway_ref = $${idx++}`);
    values.push(gatewayRef);
  }
  if (rawResponse !== undefined) {
    updates.push(`raw_response = $${idx++}`);
    values.push(rawResponse ? JSON.stringify(rawResponse) : null);
  }
  if (reconciledAt !== undefined) {
    updates.push(`reconciled_at = $${idx++}`);
    values.push(reconciledAt);
  }

  updates.push(`updated_at = now()`);

  const sql = `
    UPDATE payment_transactions
    SET ${updates.join(', ')}
    WHERE ${whereClause}
    RETURNING *;
  `;

  const res = await db.query(sql, values);
  return res.rows[0] || null;
}

export async function findPaymentTransactionByRef(db, ref) {
  const sql = `SELECT * FROM payment_transactions WHERE ref = $1 LIMIT 1;`;
  const res = await db.query(sql, [ref]);
  return res.rows[0] || null;
}

export async function findPaymentTransactionById(db, id) {
  const sql = `SELECT * FROM payment_transactions WHERE id = $1 LIMIT 1;`;
  const res = await db.query(sql, [id]);
  return res.rows[0] || null;
}

export async function findPaymentTransactionByIdempotencyKey(db, idempotencyKey) {
  if (!idempotencyKey) return null;
  const sql = `SELECT * FROM payment_transactions WHERE idempotency_key = $1 LIMIT 1;`;
  const res = await db.query(sql, [idempotencyKey]);
  return res.rows[0] || null;
}

export async function findPaymentTransactionsByOrderId(db, orderId) {
  const sql = `SELECT * FROM payment_transactions WHERE order_id = $1 ORDER BY created_at DESC;`;
  const res = await db.query(sql, [orderId]);
  return res.rows;
}

export async function findStuckPendingTransactions(db, olderThanMinutes = 15) {
  const sql = `
    SELECT * FROM payment_transactions
    WHERE status IN ('INITIATED', 'PENDING')
      AND created_at < (now() - ($1 || ' minutes')::interval)
    ORDER BY created_at ASC
    LIMIT 100;
  `;
  const res = await db.query(sql, [olderThanMinutes]);
  return res.rows;
}

export async function recordWebhookEvent(db, {
  gateway,
  providerEventId,
  signatureValid,
  payloadJson,
  processedAt = null,
  processResult = null,
}) {
  const sql = `
    INSERT INTO payment_webhook_events (
      gateway, provider_event_id, signature_valid, payload_json, processed_at, process_result, received_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, now()
    )
    ON CONFLICT (gateway, provider_event_id) DO UPDATE SET
      processed_at = EXCLUDED.processed_at,
      process_result = EXCLUDED.process_result
    RETURNING *;
  `;
  const res = await db.query(sql, [
    gateway.toUpperCase(),
    providerEventId,
    signatureValid,
    JSON.stringify(payloadJson || {}),
    processedAt,
    processResult,
  ]);
  return res.rows[0];
}

export async function findWebhookEvent(db, gateway, providerEventId) {
  const sql = `
    SELECT * FROM payment_webhook_events
    WHERE gateway = $1 AND provider_event_id = $2
    LIMIT 1;
  `;
  const res = await db.query(sql, [gateway.toUpperCase(), providerEventId]);
  return res.rows[0] || null;
}
