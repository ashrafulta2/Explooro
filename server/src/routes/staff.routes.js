/**
 * staff.routes.js — Staff Management admin API (Prompt 3.3), backing /admin/staff.
 *
 * Permission gates and why they are what they are (risk tiers come from docs/permission-catalog.json):
 *   GET    /admin/staff, /admin/staff/:id        staff.account.view     MEDIUM
 *   POST   /admin/staff                          staff.account.create   CRITICAL — Super Admin only
 *   PATCH  /admin/staff/:id/role                 staff.role.assign      CRITICAL — Super Admin only
 *   PATCH  /admin/staff/:id/status               staff.account.disable  CRITICAL — Super Admin only
 *   POST   /admin/staff/:id/reset-2fa            security.2fa.reset     HIGH — a delegated admin's
 *          request is deferred into pending_admin_actions (202) for a Super Admin to approve
 *   POST   /admin/staff/:id/resend-invite        staff.account.create
 * requirePermission does the tier routing itself, so these routes never re-implement it.
 *
 * No requireModule: staff management belongs to the always-on `core` surface (client nav and route
 * definitions mark it `module: 'core'`), and `core` is not a row in `modules` — requireModule would
 * read the missing row as "disabled" and lock every admin out. The other /admin identity routes
 * (user.routes.js, restriction.routes.js) make the same choice. No requireRestriction either: those
 * gates are per-capability limits on a user's own activity, and there is no capability to attach here.
 */

import * as controller from '../controllers/staff.controller.js';

const ID_PARAMS = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

// `reason` is validated by the service (3–300 chars, field-level error), not required here, so the
// admin gets the same {details.field: 'reason'} shape whether it is missing or too short.
const REASON = { type: 'string', maxLength: 1000 };

export default async function staffRoutes(app) {
  const auth = app.authenticate;

  app.get('/admin/staff', {
    preHandler: [auth, app.requirePermission('staff.account.view')],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 120 },
          role: { type: 'string', maxLength: 64 },
          status: { type: 'string', enum: ['ALL', 'ACTIVE', 'INVITED', 'SUSPENDED'] },
          two_factor: { type: 'string', enum: ['ALL', 'ENABLED', 'PENDING'] },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
    handler: controller.listStaff,
  });

  app.get('/admin/staff/:id', {
    preHandler: [auth, app.requirePermission('staff.account.view')],
    schema: { params: ID_PARAMS },
    handler: controller.getStaff,
  });

  app.post('/admin/staff', {
    preHandler: [auth, app.requirePermission('staff.account.create', { targetType: 'staff_create' })],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          full_name: { type: 'string', maxLength: 200 },
          email: { type: 'string', maxLength: 254 },
          phone: { type: 'string', maxLength: 32 },
          role_key: { type: 'string', maxLength: 64 },
          department: { type: 'string', maxLength: 200 },
        },
      },
    },
    handler: controller.provisionStaff,
  });

  app.patch('/admin/staff/:id/role', {
    preHandler: [auth, app.requirePermission('staff.role.assign', { targetType: 'staff_role' })],
    schema: {
      params: ID_PARAMS,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { role_key: { type: 'string', maxLength: 64 }, reason: REASON },
      },
    },
    handler: controller.changeRole,
  });

  app.patch('/admin/staff/:id/status', {
    preHandler: [auth, app.requirePermission('staff.account.disable', { targetType: 'staff_status' })],
    schema: {
      params: ID_PARAMS,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] }, reason: REASON },
      },
    },
    handler: controller.changeStatus,
  });

  app.post('/admin/staff/:id/reset-2fa', {
    preHandler: [auth, app.requirePermission('security.2fa.reset', { targetType: 'staff_2fa_reset' })],
    schema: {
      params: ID_PARAMS,
      body: { type: 'object', additionalProperties: false, properties: { reason: REASON } },
    },
    handler: controller.resetTwoFactor,
  });

  app.post('/admin/staff/:id/resend-invite', {
    preHandler: [auth, app.requirePermission('staff.account.create', { targetType: 'staff_invite' })],
    schema: { params: ID_PARAMS },
    handler: controller.resendInvite,
  });
}
