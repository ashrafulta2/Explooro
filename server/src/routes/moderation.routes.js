/**
 * moderation.routes.js — Fastify routes for Unified Product Approval & Content Moderation (Prompt 7.4).
 */

import * as controller from '../controllers/moderation.controller.js';
import * as dashboardController from '../controllers/moderatorDashboard.controller.js';

export default async function moderationRoutes(app) {
  // 0. Moderator Dashboard Summary (Prompt 7.6)
  app.get('/moderator/dashboard', {
    preHandler: [app.authenticate],
    handler: dashboardController.getDashboardSummary,
  });

  // 1. Get Moderation Queue
  app.get('/moderation/queue', {
    preHandler: [
      app.authenticate,
      app.requirePermission('moderation.product.view', {
        tier: 'LOW',
        module: 'product_moderation',
      }),
    ],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          item_type: { type: 'string' },
          status: { type: 'string' },
          claimed_by: { type: 'string' },
          flagged_only: { type: 'string' },
          search: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
    },
    handler: controller.getQueue,
  });

  // 2. Get Single Queue Item
  app.get('/moderation/queue/:id', {
    preHandler: [
      app.authenticate,
      app.requirePermission('moderation.product.view', {
        tier: 'LOW',
        module: 'product_moderation',
      }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getItemById,
  });

  // 3. Claim Item Lock
  app.post('/moderation/queue/:id/claim', {
    preHandler: [
      app.authenticate,
      app.requirePermission('moderation.queue.assign', {
        tier: 'LOW',
        module: 'product_moderation',
      }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.claimItem,
  });

  // 4. Release Claim Lock
  app.post('/moderation/queue/:id/release', {
    preHandler: [
      app.authenticate,
      app.requirePermission('moderation.queue.assign', {
        tier: 'LOW',
        module: 'product_moderation',
      }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.releaseClaim,
  });

  // 5. Decide Single Item (Approve / Reject / Request Changes / Escalate)
  app.post('/moderation/queue/:id/decide', {
    preHandler: [
      app.authenticate,
      app.requirePermission('moderation.product.approve', {
        tier: 'LOW',
        module: 'product_moderation',
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
        required: ['decision'],
        properties: {
          decision: {
            type: 'string',
            enum: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'ESCALATED'],
          },
          reason_en: { type: 'string' },
          reason_bn: { type: 'string' },
          changes_requested_en: { type: 'string' },
          changes_requested_bn: { type: 'string' },
          shadow_restrict_seller: { type: 'boolean' },
        },
      },
    },
    handler: controller.decideItem,
  });

  // 6. Bulk Decide Items
  app.post('/moderation/bulk-decide', {
    preHandler: [
      app.authenticate,
      app.requirePermission('moderation.product.approve', {
        tier: 'LOW',
        module: 'product_moderation',
      }),
    ],
    schema: {
      body: {
        type: 'object',
        required: ['queue_ids', 'decision'],
        properties: {
          queue_ids: { type: 'array', items: { type: 'integer' } },
          decision: {
            type: 'string',
            enum: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'ESCALATED'],
          },
          reason_en: { type: 'string' },
          reason_bn: { type: 'string' },
        },
      },
    },
    handler: controller.bulkDecide,
  });

  // 7. Throughput Stats
  app.get('/moderation/stats', {
    preHandler: [
      app.authenticate,
      app.requirePermission('moderation.dashboard.view', {
        tier: 'LOW',
        module: 'product_moderation',
      }),
    ],
    handler: controller.getStats,
  });

  // 8. Pre-screen Content
  app.post('/moderation/pre-screen', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          title_en: { type: 'string' },
          title_bn: { type: 'string' },
          description_en: { type: 'string' },
          description_bn: { type: 'string' },
          default_retail_price: { type: 'number' },
          base_cost: { type: 'number' },
          category_id: { type: 'integer' },
        },
      },
    },
    handler: controller.preScreen,
  });
}
