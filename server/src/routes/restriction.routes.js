/**
 * restriction.routes.js — Route definitions for Granular User Activity Restrictions (Prompt 2.6).
 */

import * as controller from '../controllers/restriction.controller.js';

export default async function restrictionRoutes(app) {
  // 1. List all restrictions (across all users & segments with filters)
  app.get('/admin/restrictions', {
    preHandler: [app.authenticate, app.requirePermission('users.restriction.view')],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          subject_type: { type: 'string', enum: ['USER', 'SEGMENT'] },
          capability_key: { type: 'string' },
          mode: { type: 'string', enum: ['BLOCK', 'THROTTLE', 'FORCE_REVIEW_QUEUE', 'SHADOW_BAN'] },
          status: { type: 'string', enum: ['ACTIVE', 'LIFTED', 'EXPIRED'] },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
    },
    handler: controller.listRestrictions,
  });

  // 2. List all restrictions for a specific user
  app.get('/admin/users/:id/restrictions', {
    preHandler: [app.authenticate, app.requirePermission('users.account.view')],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getUserRestrictions,
  });

  // 2. Apply a new restriction (single user or segment)
  app.post('/admin/restrictions', {
    preHandler: [
      app.authenticate,
      app.requirePermission('users.restriction.manage', { targetType: 'user_restriction_apply' }),
    ],
    schema: {
      body: {
        type: 'object',
        required: ['subject_type', 'subject_ref', 'capability_key', 'mode', 'reason'],
        additionalProperties: false,
        properties: {
          subject_type: { type: 'string', enum: ['USER', 'SEGMENT'] },
          subject_ref: { type: 'string' },
          segment_predicate: { type: 'object', nullable: true },
          capability_key: { type: 'string' },
          mode: { type: 'string', enum: ['BLOCK', 'THROTTLE', 'FORCE_REVIEW_QUEUE', 'SHADOW_BAN'] },
          limit_value: { type: 'number', nullable: true },
          reason: { type: 'string', minLength: 10 },
          reason_bn: { type: 'string', nullable: true },
          evidence_json: { type: 'object', nullable: true },
          expires_at: { type: 'string', nullable: true },
        },
      },
    },
    handler: controller.createRestriction,
  });

  // 3. Update an existing restriction
  app.patch('/admin/restrictions/:id', {
    preHandler: [
      app.authenticate,
      app.requirePermission('users.restriction.manage', { targetType: 'user_restriction_update' }),
    ],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', enum: ['BLOCK', 'THROTTLE', 'FORCE_REVIEW_QUEUE', 'SHADOW_BAN'] },
          limit_value: { type: 'number', nullable: true },
          reason: { type: 'string', minLength: 10, nullable: true },
          reason_bn: { type: 'string', nullable: true },
          evidence_json: { type: 'object', nullable: true },
          expires_at: { type: 'string', nullable: true },
        },
      },
    },
    handler: controller.updateRestriction,
  });

  // 4. Lift a restriction (reason required)
  app.delete('/admin/restrictions/:id', {
    preHandler: [
      app.authenticate,
      app.requirePermission('users.restriction.manage', { targetType: 'user_restriction_lift' }),
    ],
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
        properties: {
          reason: { type: 'string', minLength: 10 },
        },
      },
    },
    handler: controller.liftRestriction,
  });

  // 5. Dry-run segment preview — read-only, so gated by the LOW-tier view permission, not
  // users.restriction.manage: it was previously HIGH-tier, meaning any non-super-admin request to
  // preview a segment (which changes nothing) was silently deferred into an unapprovable pending
  // action instead of just returning the preview.
  app.post('/admin/restrictions/preview', {
    preHandler: [app.authenticate, app.requirePermission('users.restriction.view')],
    handler: controller.previewSegment,
  });
}
