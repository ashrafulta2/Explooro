/**
 * return.routes.js — Fastify Route definitions for Return & Refund Engine (Prompt 7.2).
 */

import * as controller from '../controllers/return.controller.js';

export default async function returnRoutes(app) {
  // 1. Customer: Create Return Request
  app.post('/returns/request', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['sub_order_id', 'reason_code'],
        properties: {
          sub_order_id: { type: 'integer' },
          reason_code: { type: 'string' },
          customer_note: { type: 'string' },
          evidence_urls: { type: 'array', items: { type: 'string' } },
          preferred_resolution: { type: 'string' },
          items: { type: 'array' },
        },
      },
    },
    handler: controller.requestReturn,
  });

  // 2. Customer: Get My Returns
  app.get('/returns/my-returns', {
    preHandler: [app.authenticate],
    handler: controller.getMyReturns,
  });

  // 3. Customer / Staff: Get Return Details
  app.get('/returns/:id', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getReturnById,
  });

  // 4. Admin / Moderator: Returns Moderation Queue
  app.get('/admin/returns/queue', {
    preHandler: [
      app.authenticate,
      app.requirePermission('orders.return.manage', {
        tier: 'MEDIUM',
        module: 'returns_engine',
      }),
    ],
    handler: controller.getAdminQueue,
  });

  // 5. Admin / Moderator: Review Return (Approve / Reject)
  app.post('/admin/returns/:id/review', {
    preHandler: [
      app.authenticate,
      app.requirePermission('orders.return.manage', {
        tier: 'MEDIUM',
        module: 'returns_engine',
      }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['APPROVE', 'REJECT'] },
          rejection_reason: { type: 'string' },
        },
      },
    },
    handler: controller.reviewReturn,
  });

  // 6. Admin / Staff: Receive & Inspect Returned Parcel
  app.post('/admin/returns/:id/inspect', {
    preHandler: [
      app.authenticate,
      app.requirePermission('orders.return.manage', {
        tier: 'MEDIUM',
        module: 'returns_engine',
      }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          inspection_notes: { type: 'string' },
          condition_pass: { type: 'boolean' },
        },
      },
    },
    handler: controller.inspectReturn,
  });

  // 7. Admin / Staff: Execute Refund & Clawback
  app.post('/admin/returns/:id/refund', {
    preHandler: [
      app.authenticate,
      app.requirePermission('orders.return.manage', {
        tier: 'MEDIUM',
        module: 'returns_engine',
      }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.refundReturn,
  });
}
