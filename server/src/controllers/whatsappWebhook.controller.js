/**
 * whatsappWebhook.controller.js — Meta Cloud API Webhook Controller (Prompt 8.3 / DFD Subsystem 20.0).
 */

import crypto from 'node:crypto';
import * as service from '../services/whatsappCommerce.service.js';

export async function verifyWebhook(req, reply) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || 'explooro_webhook_token';

  if (mode === 'subscribe' && token === expectedToken) {
    return reply.status(200).send(challenge);
  }

  return reply.status(403).send({ error: 'FORBIDDEN: Verify token mismatch.' });
}

export async function handleWebhook(req, reply) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const signature = req.headers['x-hub-signature-256'];

  // Signature validation if secret is provided
  if (appSecret && signature) {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    if (signature !== expected) {
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

        // Ingest to target saler (default to saler ID in metadata or system saler 1)
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
