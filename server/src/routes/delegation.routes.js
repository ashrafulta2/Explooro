/**
 * delegation.routes.js — Route definitions for delegation & maker-checker endpoints (Prompt 2.5).
 */

import * as controller from '../controllers/delegation.controller.js';

export default async function delegationRoutes(app) {
  /* ======================================================================= */
  /* MODE A — Standing Grants                                               */
  /* ======================================================================= */
  app.post('/admin/grants', {
    preHandler: [app.authenticate, app.requirePermission('users.permission.grant')],
    schema: {
      body: {
        type: 'object',
        required: ['user_id', 'permission_key', 'reason', 'expires_at'],
        additionalProperties: false,
        properties: {
          user_id: { type: 'integer' },
          permission_key: { type: 'string' },
          effect: { type: 'string', enum: ['GRANT', 'DENY'] },
          scope_json: { type: 'object', nullable: true },
          scope: { type: 'object', nullable: true },
          reason: { type: 'string', minLength: 10 },
          expires_at: { type: 'string' },
        },
      },
    },
    handler: controller.createGrant,
  });

  app.delete('/admin/grants/:id', {
    preHandler: [app.authenticate, app.requirePermission('users.permission.revoke')],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['reason'],
        additionalProperties: false,
        properties: { reason: { type: 'string', minLength: 10 } },
      },
    },
    handler: controller.revokeGrant,
  });

  app.get('/admin/grants', {
    preHandler: [app.authenticate, app.requirePermission('users.account.view')],
    handler: controller.listGrants,
  });

  /* ======================================================================= */
  /* MODE B — Just-In-Time Requests                                         */
  /* ======================================================================= */
  app.post('/access-requests', {
    preHandler: app.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['permission_key', 'reason'],
        additionalProperties: false,
        properties: {
          permission_key: { type: 'string' },
          reason: { type: 'string', minLength: 10 },
          target_scope_json: { type: 'object', nullable: true },
          target_scope: { type: 'object', nullable: true },
        },
      },
    },
    handler: controller.createAccessRequest,
  });

  app.get('/access-requests', {
    preHandler: app.authenticate,
    handler: controller.listAccessRequests,
  });

  app.patch('/access-requests/:id', {
    preHandler: [app.authenticate, app.requirePermission('admin.approval.decide', { skipMakerChecker: true })],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['decision'],
        additionalProperties: false,
        properties: {
          decision: { type: 'string', enum: ['APPROVE', 'REJECT'] },
          note: { type: 'string', nullable: true },
          window_minutes: { type: 'integer', minimum: 1, maximum: 480, nullable: true },
        },
      },
    },
    handler: controller.decideAccessRequest,
  });

  /* ======================================================================= */
  /* MODE C — Maker-Checker (pending_admin_actions)                         */
  /* ======================================================================= */
  app.get('/admin/pending-actions', {
    preHandler: [app.authenticate, app.requirePermission('admin.approval.view')],
    handler: controller.listPendingActions,
  });

  app.patch('/admin/pending-actions/:id', {
    preHandler: [app.authenticate, app.requirePermission('admin.approval.decide', { skipMakerChecker: true })],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['decision'],
        additionalProperties: false,
        properties: {
          decision: { type: 'string', enum: ['APPROVE', 'REJECT'] },
          note: { type: 'string', nullable: true },
        },
      },
    },
    handler: controller.decidePendingAction,
  });
}
