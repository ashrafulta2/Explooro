/**
 * audit.routes.js — Route definitions for Audit Log Engine (Prompt 2.7).
 */

import * as controller from '../controllers/audit.controller.js';

export default async function auditRoutes(app) {
  // 1. Query audit log with filters and cursor pagination
  app.get('/admin/audit', {
    preHandler: [app.authenticate, app.requirePermission('security.audit.view')],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          actor_id: { type: 'string' },
          actor: { type: 'string' },
          action: { type: 'string' },
          target_type: { type: 'string' },
          target_ref: { type: 'string' },
          risk_tier: { type: 'string' },
          trace_id: { type: 'string' },
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          cursor: { type: 'integer' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    handler: controller.listAuditLogs,
  });

  // 2. Walk and verify the tamper-evident hash chain
  app.get('/admin/audit/verify', {
    preHandler: [app.authenticate, app.requirePermission('security.audit.verify')],
    handler: controller.verifyAuditChain,
  });

  // 3. User activity timeline
  app.get('/admin/users/:id/timeline', {
    preHandler: [app.authenticate, app.requirePermission('users.account.view')],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getUserTimeline,
  });
}
