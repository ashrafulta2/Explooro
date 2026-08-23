/**
 * dispute.routes.js — Fastify Route definitions for Dispute Arbitration Engine (Prompt 7.3).
 */

import * as controller from '../controllers/dispute.controller.js';

export default async function disputeRoutes(app) {
  // 1. Create Dispute
  app.post('/disputes', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['sub_order_id'],
        properties: {
          sub_order_id: { type: 'integer' },
          return_id: { type: 'integer' },
          disputed_amount: { type: 'number' },
          reason: { type: 'string' },
          initial_message: { type: 'string' },
          attachments: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    handler: controller.createDispute,
  });

  // 2. List Disputes (scoper for Customer/Saler/Supplier/Staff)
  app.get('/disputes', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          search: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
    },
    handler: controller.listDisputes,
  });

  // 3. Precedent search for arbitrators
  app.get('/disputes/precedents', {
    preHandler: [
      app.authenticate,
      app.requirePermission('orders.dispute.view_all', {
        tier: 'LOW',
        module: 'dispute_panel',
      }),
    ],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
    },
    handler: controller.searchPrecedents,
  });

  // 4. Get Dispute Thread Details (Strict participant & staff internal note filter)
  app.get('/disputes/:id', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getDisputeById,
  });

  // 5. Post Message / Internal Staff Note
  app.post('/disputes/:id/messages', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['body'],
        properties: {
          body: { type: 'string' },
          attachments: { type: 'array', items: { type: 'string' } },
          is_internal_note: { type: 'boolean' },
        },
      },
    },
    handler: controller.postMessage,
  });

  // 6. Evidence Timeline (Immutable chronological timeline)
  app.get('/disputes/:id/timeline', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getEvidenceTimeline,
  });

  // 7. Arbitrate Dispute (HIGH Tier with Maker-Checker)
  app.post('/disputes/:id/arbitrate', {
    preHandler: [
      app.authenticate,
      app.requirePermission('orders.dispute.arbitrate', {
        tier: 'HIGH',
        module: 'dispute_panel',
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
        required: ['outcome'],
        properties: {
          outcome: {
            type: 'string',
            enum: ['FULL_REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'REJECTED', 'SPLIT_LIABILITY'],
          },
          outcome_split: { type: 'object' },
          resolution_notes: { type: 'string' },
        },
      },
    },
    handler: controller.arbitrateDispute,
  });

  // 8. Escalate Dispute
  app.post('/disputes/:id/escalate', {
    preHandler: [
      app.authenticate,
      app.requirePermission('orders.dispute.escalate', {
        tier: 'LOW',
        module: 'dispute_panel',
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
          reason: { type: 'string' },
        },
      },
    },
    handler: controller.escalateDispute,
  });
}
