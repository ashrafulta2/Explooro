/**
 * kyc.routes.js — Fastify routes for KYC Verification & Trust Tiers (Prompt 7.5).
 */

import * as controller from '../controllers/kyc.controller.js';

export default async function kycRoutes(app) {
  // 1. Submit KYC step
  app.post('/kyc/submit', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        properties: {
          kyc_type: { type: 'string', enum: ['SUPPLIER', 'SALER', 'CUSTOMER', 'AGE'] },
          step: { type: 'integer' },
          nid_number: { type: 'string' },
          trade_license_no: { type: 'string' },
          vat_tin: { type: 'string' },
          business_name: { type: 'string' },
          business_address: { type: 'string' },
          documents: {
            type: 'array',
            items: {
              type: 'object',
              required: ['doc_type', 'storage_key'],
              properties: {
                doc_type: { type: 'string' },
                storage_key: { type: 'string' },
                mime_type: { type: 'string' },
                size_bytes: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    handler: controller.submitStep,
  });

  // 2. Get my KYC status
  app.get('/kyc/status', {
    preHandler: [app.authenticate],
    handler: controller.getMyStatus,
  });

  // 3. Appeal rejected KYC
  app.post('/kyc/appeal', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['kyc_id'],
        properties: {
          kyc_id: { type: 'integer' },
          appeal_note: { type: 'string' },
        },
      },
    },
    handler: controller.appeal,
  });

  // 4. Admin KYC Verification Queue
  app.get('/admin/kyc/queue', {
    preHandler: [
      app.authenticate,
      app.requirePermission('users.kyc.view', {
        tier: 'MEDIUM',
        module: 'supplier_verification',
      }),
    ],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          kyc_type: { type: 'string' },
          status: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
    },
    handler: controller.getQueue,
  });

  // 5. Admin KYC Details
  app.get('/admin/kyc/:id', {
    preHandler: [
      app.authenticate,
      app.requirePermission('users.kyc.view', {
        tier: 'MEDIUM',
        module: 'supplier_verification',
      }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getKycById,
  });

  // 6. Audited Document View
  app.get('/admin/kyc/:id/documents/:docId', {
    preHandler: [
      app.authenticate,
      app.requirePermission('users.kyc.document_view', {
        tier: 'HIGH',
        module: 'supplier_verification',
      }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id', 'docId'],
        properties: {
          id: { type: 'string' },
          docId: { type: 'string' },
        },
      },
    },
    handler: controller.viewDocument,
  });

  // 7. Decide KYC (HIGH tier Maker-Checker)
  app.post('/admin/kyc/:id/decide', {
    preHandler: [
      app.authenticate,
      app.requirePermission('users.kyc.approve', {
        tier: 'HIGH',
        module: 'supplier_verification',
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
          decision: { type: 'string', enum: ['VERIFIED', 'REJECTED'] },
          reason_en: { type: 'string' },
          reason_bn: { type: 'string' },
        },
      },
    },
    handler: controller.decide,
  });

  // 8. Trust Tier Details
  app.get('/admin/kyc/tiers/:userId', {
    preHandler: [
      app.authenticate,
      app.requirePermission('users.account.view_pii', {
        tier: 'HIGH',
      }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
    handler: controller.getTrustTier,
  });

  // 9. Trigger Trust Tier Recompute
  app.post('/admin/kyc/tiers/recompute', {
    preHandler: [
      app.authenticate,
      app.requirePermission('users.tier.override', {
        tier: 'MEDIUM',
        module: 'trust_tiers',
      }),
    ],
    handler: controller.recomputeTiers,
  });
}
