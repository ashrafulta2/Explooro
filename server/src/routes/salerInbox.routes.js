/**
 * salerInbox.routes.js — Saler Unified Multi-Channel Inbox Routes (Prompt 8.3).
 */

import * as controller from '../controllers/salerInbox.controller.js';

export default async function salerInboxRoutes(app) {
  // 1. Get unified threads (WhatsApp + Messenger + In-Platform)
  app.get('/saler/inbox/threads', {
    preHandler: [app.authenticate],
    handler: controller.getUnifiedThreads,
  });

  // 2. Send reply in thread
  app.post('/saler/inbox/threads/:id/send', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: { content: { type: 'string' } },
      },
    },
    handler: controller.sendOutboundReply,
  });

  // 3. Send interactive product card with 1-tap checkout link
  app.post('/saler/inbox/threads/:id/send-product', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['product_id'],
        properties: {
          product_id: { type: 'integer' },
          variant_id: { type: 'integer' },
          note: { type: 'string' },
        },
      },
    },
    handler: controller.sendProductCard,
  });
}
