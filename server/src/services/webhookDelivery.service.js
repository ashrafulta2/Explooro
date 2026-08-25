/**
 * webhookDelivery.service.js — Outbound Webhooks & Dead-Letter Queue Engine (Prompt 10.7).
 *
 * Implements idea proposition.md §AI:
 * 1. Webhook subscriptions for order.created, order.delivered, product.updated, payout.completed.
 * 2. Cryptographic HMAC-SHA256 payload signing (X-Explooro-Signature).
 * 3. Exponential-backoff automated retries with max 3 attempts.
 * 4. Dead-Letter Queue (DLQ) state transition upon repeated delivery failure.
 * 5. Admin & Developer 1-click manual delivery replay.
 */

import { randomBytes, createHmac } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.js';
import { generateRef } from '../lib/ref.js';

export const SUPPORTED_WEBHOOK_EVENTS = [
  'order.created',
  'order.paid',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'product.created',
  'product.updated',
  'product.stock_low',
  'payout.requested',
  'payout.completed',
  'b2b_deal.created',
  'b2b_deal.milestone_released',
];

/**
 * Signs payload with HMAC-SHA256 secret.
 */
export function signWebhookPayload(payloadString, secret) {
  return createHmac('sha256', String(secret)).update(payloadString).digest('hex');
}

/**
 * Creates a new webhook subscription.
 */
export async function createSubscription(db, {
  userId,
  targetUrl,
  events = [],
  secret = null,
}) {
  if (!userId) {
    throw new AppError('VALIDATION_FAILED', 'User ID is required to create a webhook subscription.', 400);
  }
  if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
    throw new AppError('VALIDATION_FAILED', 'A valid HTTP or HTTPS target URL is required.', 400);
  }

  const safeEvents = Array.isArray(events) && events.length > 0 ? events : ['order.created'];
  const endpointSecret = secret || `whsec_${randomBytes(24).toString('hex')}`;
  const ref = generateRef('WHK');

  const sql = `
    INSERT INTO webhook_subscriptions (
      ref, user_id, target_url, secret, events, status, failure_count, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 0, now(), now())
    RETURNING id, ref, user_id, target_url, secret, events, status, failure_count, created_at;
  `;

  const { rows } = await db.query(sql, [
    ref,
    userId,
    targetUrl.trim(),
    endpointSecret,
    JSON.stringify(safeEvents),
  ]);

  return rows[0];
}

/**
 * Lists webhook subscriptions for a user or admin.
 */
export async function listSubscriptions(db, { userId, role }) {
  let sql = `
    SELECT id, ref, user_id, target_url, secret, events, status, failure_count, created_at, updated_at
    FROM webhook_subscriptions
  `;
  const params = [];

  if (role !== 'admin' && role !== 'super_admin') {
    params.push(userId);
    sql += ` WHERE user_id = $1`;
  }

  sql += ` ORDER BY created_at DESC;`;

  const { rows } = await db.query(sql, params);
  return rows.map((r) => ({
    ...r,
    events: Array.isArray(r.events) ? r.events : JSON.parse(r.events || '[]'),
  }));
}

/**
 * Deletes a webhook subscription.
 */
export async function deleteSubscription(db, { subscriptionId, userId, role }) {
  const { rows } = await db.query('SELECT * FROM webhook_subscriptions WHERE id = $1;', [subscriptionId]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `Webhook subscription #${subscriptionId} not found.`, 404);
  }

  const sub = rows[0];
  if (role !== 'admin' && role !== 'super_admin' && Number(sub.user_id) !== Number(userId)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to delete this webhook subscription.', 403);
  }

  await db.query('DELETE FROM webhook_subscriptions WHERE id = $1;', [subscriptionId]);
  return { id: subscriptionId, deleted: true };
}

/**
 * Dispatches an event to all matching active webhook subscriptions.
 */
export async function dispatchWebhookEvent(db, { eventName, payload, httpClient = null }) {
  if (!eventName) return [];

  // Find all active subscriptions interested in this event or wildcard '*'
  const sql = `
    SELECT * FROM webhook_subscriptions
    WHERE status = 'ACTIVE'
      AND (events @> $1::jsonb OR events @> '["*"]'::jsonb);
  `;

  const { rows: subscriptions } = await db.query(sql, [JSON.stringify([eventName])]);
  if (!subscriptions.length) return [];

  const createdDeliveries = [];

  for (const sub of subscriptions) {
    const insertSql = `
      INSERT INTO webhook_deliveries (
        subscription_id, event_name, payload_json, attempt_number,
        max_attempts, status, created_at
      ) VALUES ($1, $2, $3, 1, 3, 'PENDING', now())
      RETURNING *;
    `;

    const { rows: deliveryRows } = await db.query(insertSql, [
      sub.id,
      eventName,
      JSON.stringify(payload || {}),
    ]);

    const delivery = deliveryRows[0];
    createdDeliveries.push(delivery);

    // Execute initial delivery attempt asynchronously
    deliverWebhookAttempt(db, delivery.id, httpClient).catch((err) => {
      console.warn(`[Webhooks] Async delivery attempt failed for #${delivery.id}:`, err?.message);
    });
  }

  return createdDeliveries;
}

/**
 * Delivers a single webhook delivery attempt over HTTP.
 */
export async function deliverWebhookAttempt(db, deliveryId, customHttpClient = null) {
  const querySql = `
    SELECT d.*, s.target_url, s.secret, s.status as sub_status
    FROM webhook_deliveries d
    JOIN webhook_subscriptions s ON d.subscription_id = s.id
    WHERE d.id = $1;
  `;

  const { rows } = await db.query(querySql, [deliveryId]);
  if (!rows.length) return null;

  const item = rows[0];
  if (item.status === 'DELIVERED') return item;

  const payloadString = JSON.stringify(item.payload_json);
  const signature = signWebhookPayload(payloadString, item.secret);
  const timestamp = Date.now().toString();

  let responseStatus = null;
  let responseBody = null;
  let errorMessage = null;
  let isSuccess = false;

  try {
    if (customHttpClient) {
      // Mock / custom client for testing
      const res = await customHttpClient({
        url: item.target_url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Explooro-Event': item.event_name,
          'X-Explooro-Delivery': String(item.id),
          'X-Explooro-Signature': `sha256=${signature}`,
          'X-Explooro-Timestamp': timestamp,
        },
        body: payloadString,
      });
      responseStatus = res.status || 200;
      responseBody = typeof res.body === 'string' ? res.body : JSON.stringify(res.body || '');
      isSuccess = responseStatus >= 200 && responseStatus < 300;
    } else {
      // Real Node.js fetch with 10s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(item.target_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Explooro-Event': item.event_name,
          'X-Explooro-Delivery': String(item.id),
          'X-Explooro-Signature': `sha256=${signature}`,
          'X-Explooro-Timestamp': timestamp,
          'User-Agent': 'Explooro-Webhooks/1.0',
        },
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      responseStatus = response.status;
      responseBody = await response.text();
      isSuccess = response.ok;
    }
  } catch (err) {
    errorMessage = err?.message || 'Network request failed';
  }

  // Evaluate attempt outcome
  if (isSuccess) {
    const updateSql = `
      UPDATE webhook_deliveries
      SET status = 'DELIVERED',
          response_status = $1,
          response_body = $2,
          delivered_at = now(),
          error_message = null
      WHERE id = $3
      RETURNING *;
    `;
    const { rows: updated } = await db.query(updateSql, [responseStatus, (responseBody || '').slice(0, 2000), item.id]);

    // Reset subscription failure count
    await db.query('UPDATE webhook_subscriptions SET failure_count = 0, updated_at = now() WHERE id = $1;', [item.subscription_id]);
    return updated[0];
  } else {
    const currentAttempt = item.attempt_number || 1;
    const maxAttempts = item.max_attempts || 3;

    if (currentAttempt < maxAttempts) {
      // Exponential backoff: +1m, +5m, +15m
      const backoffMinutes = currentAttempt === 1 ? 1 : currentAttempt === 2 ? 5 : 15;
      const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

      const updateSql = `
        UPDATE webhook_deliveries
        SET status = 'FAILED',
            attempt_number = attempt_number + 1,
            response_status = $1,
            response_body = $2,
            error_message = $3,
            next_retry_at = $4
        WHERE id = $5
        RETURNING *;
      `;
      const { rows: updated } = await db.query(updateSql, [
        responseStatus,
        (responseBody || '').slice(0, 2000),
        errorMessage || `HTTP ${responseStatus}`,
        nextRetryAt,
        item.id,
      ]);
      return updated[0];
    } else {
      // Transition to Dead-Letter Queue (DLQ)
      const updateSql = `
        UPDATE webhook_deliveries
        SET status = 'DEAD_LETTER',
            response_status = $1,
            response_body = $2,
            error_message = $3,
            next_retry_at = null
        WHERE id = $4
        RETURNING *;
      `;
      const { rows: updated } = await db.query(updateSql, [
        responseStatus,
        (responseBody || '').slice(0, 2000),
        errorMessage || `Exhausted ${maxAttempts} attempts (HTTP ${responseStatus})`,
        item.id,
      ]);

      // Increment subscription failure count
      await db.query(
        'UPDATE webhook_subscriptions SET failure_count = failure_count + 1, updated_at = now() WHERE id = $1;',
        [item.subscription_id]
      );

      return updated[0];
    }
  }
}

/**
 * Replays a failed or dead-letter webhook delivery immediately.
 */
export async function replayWebhookDelivery(db, { deliveryId, httpClient = null }) {
  const { rows } = await db.query('SELECT * FROM webhook_deliveries WHERE id = $1;', [deliveryId]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `Webhook delivery #${deliveryId} not found.`, 404);
  }

  // Reset delivery to PENDING
  await db.query(
    `UPDATE webhook_deliveries
     SET status = 'PENDING',
         attempt_number = 1,
         error_message = null,
         response_status = null,
         response_body = null
     WHERE id = $1;`,
    [deliveryId]
  );

  return deliverWebhookAttempt(db, deliveryId, httpClient);
}

/**
 * Lists webhook delivery logs with filtering.
 */
export async function listDeliveries(db, { subscriptionId = null, status = null, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT d.*, s.ref as subscription_ref, s.target_url, s.user_id
    FROM webhook_deliveries d
    JOIN webhook_subscriptions s ON d.subscription_id = s.id
  `;
  const params = [];
  const conditions = [];

  if (subscriptionId) {
    params.push(subscriptionId);
    conditions.push(`d.subscription_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`d.status = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  sql += ` ORDER BY d.created_at DESC LIMIT $${limitParam} OFFSET $${offsetParam};`;

  const { rows } = await db.query(sql, params);
  return rows;
}
