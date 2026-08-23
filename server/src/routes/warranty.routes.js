/**
 * warranty.routes.js — Fastify Route definitions for Digital Warranty & Claims Engine (Prompt 10.4).
 */

import * as controller from '../controllers/warranty.controller.js';

export default async function warrantyRoutes(app) {
  // 1. Customer: Get my digital warranty cards
  app.get('/warranties/my-cards', {
    preHandler: [
      app.authenticate,
      app.requireModule('digital_warranty'),
      app.requirePermission('support.warranty.view_own', {
        tier: 'LOW',
        module: 'digital_warranty',
      }),
    ],
    handler: controller.getMyWarrantyCards,
  });

  // 2. Customer / Supplier / Staff: Get single warranty card details
  app.get('/warranties/:id', {
    preHandler: [
      app.authenticate,
      app.requireModule('digital_warranty'),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getWarrantyCardById,
  });

  // 3. Customer: File 1-click warranty claim
  app.post('/warranties/:id/claim', {
    preHandler: [
      app.authenticate,
      app.requireModule('digital_warranty'),
      app.requirePermission('support.warranty.claim', {
        tier: 'LOW',
        module: 'digital_warranty',
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
        required: ['issue_description'],
        properties: {
          issue_description: { type: 'string', minLength: 10 },
          evidence_media: { type: 'array', items: { type: 'string' } },
          preferred_resolution: { type: 'string', enum: ['REPAIR', 'REPLACE', 'REFUND'] },
        },
      },
    },
    handler: controller.submitClaim,
  });

  // 4. Customer: Transfer warranty certificate to another user
  app.post('/warranties/:id/transfer', {
    preHandler: [
      app.authenticate,
      app.requireModule('digital_warranty'),
      app.requirePermission('support.warranty.view_own', {
        tier: 'LOW',
        module: 'digital_warranty',
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
        required: ['target_phone_or_email'],
        properties: {
          target_phone_or_email: { type: 'string' },
        },
      },
    },
    handler: controller.transferWarrantyCard,
  });

  // 5. Supplier: View incoming claims queue
  app.get('/supplier/claims', {
    preHandler: [
      app.authenticate,
      app.requireModule('digital_warranty'),
      app.requirePermission('support.warranty.manage', {
        tier: 'LOW',
        module: 'digital_warranty',
      }),
    ],
    handler: controller.getSupplierClaims,
  });

  // 6. Supplier: Review claim (Approve or Reject)
  app.post('/supplier/claims/:id/review', {
    preHandler: [
      app.authenticate,
      app.requireModule('digital_warranty'),
      app.requirePermission('support.warranty.manage', {
        tier: 'LOW',
        module: 'digital_warranty',
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
          resolution: { type: 'string', enum: ['REPAIR', 'REPLACE', 'REFUND'] },
          rejection_reason: { type: 'string' },
          supplier_notes: { type: 'string' },
        },
      },
    },
    handler: controller.reviewSupplierClaim,
  });

  // 7. Supplier: Update claim progress
  app.post('/supplier/claims/:id/progress', {
    preHandler: [
      app.authenticate,
      app.requireModule('digital_warranty'),
      app.requirePermission('support.warranty.manage', {
        tier: 'LOW',
        module: 'digital_warranty',
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
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['IN_PROGRESS', 'COMPLETED'] },
          supplier_notes: { type: 'string' },
        },
      },
    },
    handler: controller.updateClaimProgress,
  });

  // 8. Supplier & Admin: Claim rate analytics per product
  app.get('/supplier/claims/analytics', {
    preHandler: [
      app.authenticate,
      app.requireModule('digital_warranty'),
      app.requirePermission('support.warranty.manage', {
        tier: 'LOW',
        module: 'digital_warranty',
      }),
    ],
    handler: controller.getProductClaimAnalytics,
  });

  // 9. Admin / Moderator: Claims oversight & escalated claims queue
  app.get('/admin/warranties/queue', {
    preHandler: [
      app.authenticate,
      app.requirePermission('support.warranty.override', {
        tier: 'HIGH',
        module: 'digital_warranty',
      }),
    ],
    handler: controller.getAdminClaimsQueue,
  });

  // 10. Admin: Override supplier claim decision
  app.post('/admin/warranties/:id/override', {
    preHandler: [
      app.authenticate,
      app.requirePermission('support.warranty.override', {
        tier: 'HIGH',
        module: 'digital_warranty',
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
          resolution: { type: 'string', enum: ['REPAIR', 'REPLACE', 'REFUND'] },
          rejection_reason: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
    handler: controller.overrideClaimDecision,
  });
}
