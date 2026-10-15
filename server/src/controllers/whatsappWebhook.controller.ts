/**
 * whatsappWebhook.controller.ts — Meta Cloud API Webhook Controller (Prompt 8.3 / DFD Subsystem 20.0).
 */

import crypto from 'node:crypto';
import * as service from '../services/whatsappCommerce.service.ts';

// WHY: outside production the mock driver needs a predictable token for local runs; in production a
// guessable default would let anyone subscribe a hostile endpoint, so it must come from the env.
function expectedVerifyToken(req) {
  if (process.env.WHATSAPP_VERIFY_TOKEN) return process.env.WHATSAPP_VERIFY_TOKEN;
  return req.server.config?.isProduction ? null : 'explooro_webhook_token';
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function verifyWebhook(req, reply) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = expectedVerifyToken(req);

  if (mode === 'subscribe' && expectedToken && token && safeEqual(token, expectedToken)) {
    return reply.status(200).send(challenge);
  }

  return reply.status(403).send({ error: 'FORBIDDEN: Verify token mismatch.' });
}

export async function handleWebhook(req, reply) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const signature = req.headers['x-hub-signature-256'];

  // WHY: fail closed. The old check ran only when a signature header was present, so an attacker
  // could skip verification by omitting it. Production and any non-mock driver must always verify;
  // only the local mock driver may run without a secret.
  const driver = req.server.config?.whatsapp?.driver || process.env.WHATSAPP_DRIVER || 'mock';
  const mustVerify = Boolean(req.server.config?.isProduction) || driver !== 'mock' || Boolean(appSecret);
  if (mustVerify) {
    if (!appSecret || typeof signature !== 'string') {
      return reply.status(401).send({ error: 'UNAUTHORIZED: Missing webhook HMAC signature.' });
    }
    // WHY: Meta signs the exact bytes it sent; re-serialising the parsed body can differ by whitespace or key order.
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    if (!safeEqual(signature, expected)) {
      return reply.status(401).send({ error: 'UNAUTHORIZED: Invalid webhook HMAC signature.' });
    }
  }

  const body = req.body || {};
  const entries = body.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const val = change.value || {};
      const messages = val.messages || [];
      const contacts = val.contacts || [];

      for (const msg of messages) {
        const fromPhone = msg.from;
        const contact = contacts.find((c) => c.wa_id === fromPhone) || {};
        const customerName = contact.profile?.name || `Customer +${fromPhone}`;

        let content = '';
        if (msg.type === 'text') {
          content = msg.text?.body || '';
        } else if (msg.type === 'image') {
          content = '[Image Attachment]';
        } else if (msg.type === 'interactive') {
          content = `[Interactive Response: ${msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || 'Option selected'}]`;
        }

        // Ingest to target shop partner (default to shop partner ID in metadata or system shop partner 1)
        const targetSalerId = val.metadata?.saler_id ? parseInt(val.metadata.saler_id, 10) : 1;

        await service.ingestInboundMessage(req.server.db, {
          fromPhone,
          customerName,
          salerId: targetSalerId,
          content,
          metaMessageId: msg.id,
          channel: 'WHATSAPP',
        });
      }
    }
  }

  return reply.status(200).send({ status: 'EVENT_RECEIVED' });
}
