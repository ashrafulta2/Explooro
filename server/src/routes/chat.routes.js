/**
 * chat.routes.js — Fastify routes for Real-Time Chat (Prompt 8.1 / DFD Subsystem 7.0).
 */

import * as controller from '../controllers/chat.controller.js';

export default async function chatRoutes(app) {
  // 1. Issue short-lived ticket for WebSocket upgrade
  app.post('/chat/ticket', {
    preHandler: [app.authenticate],
    handler: controller.getTicket,
  });

  // 2. List user's conversation threads
  app.get('/chat/threads', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
    },
    handler: controller.getThreads,
  });

  // 3. Create or open conversation thread
  app.post('/chat/threads', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['target_user_id'],
        properties: {
          target_user_id: { type: 'integer' },
          thread_type: { type: 'string', enum: ['CUSTOMER_SALER', 'SALER_SUPPLIER', 'SUPPORT', 'DISPUTE_ORDER'] },
          metadata: { type: 'object' },
        },
      },
    },
    handler: controller.createOrGetThread,
  });

  // 4. Get cursor-paginated messages in thread
  app.get('/chat/threads/:id/messages', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          cursor: { type: 'integer' },
          limit: { type: 'integer' },
        },
      },
    },
    handler: controller.getMessages,
  });

  // 5. Send message via HTTP fallback
  app.post('/chat/threads/:id/messages', {
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
        properties: {
          content: { type: 'string' },
          client_msg_id: { type: 'string' },
          msg_type: { type: 'string', enum: ['TEXT', 'IMAGE', 'PRODUCT_CARD', 'ORDER_CARD', 'SYSTEM'] },
          payload_json: { type: 'object' },
        },
      },
    },
    handler: controller.sendMessageHttp,
  });

  // 6. Mark messages in thread as read
  app.post('/chat/threads/:id/read', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          last_read_message_id: { type: 'integer' },
        },
      },
    },
    handler: controller.markRead,
  });

  // 7. Report message to moderation
  app.post('/chat/messages/:id/report', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
      },
    },
    handler: controller.reportMessage,
  });
}
