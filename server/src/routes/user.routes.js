/**
 * user.routes.js — Admin routes for users, user details, permissions introspection, and matrix (Prompt 3.3).
 */

import * as userController from '../controllers/user.controller.js';

export default async function userRoutes(app) {
  // GET /api/v1/admin/users — List & search users
  app.get(
    '/admin/users',
    {
      preHandler: [app.requirePermission('users.account.view')],
    },
    userController.listUsers
  );

  // GET /api/v1/admin/users/:id — User details with profile & restrictions
  app.get(
    '/admin/users/:id',
    {
      preHandler: [app.requirePermission('users.account.view')],
    },
    userController.getUserDetail
  );

  // GET /api/v1/admin/users/:id/permissions — Resolved permission introspection & sources map
  app.get(
    '/admin/users/:id/permissions',
    {
      preHandler: [app.requirePermission('users.account.view')],
    },
    userController.getUserPermissions
  );

  // GET /api/v1/admin/roles-permissions — Roles × Permissions baseline matrix
  app.get(
    '/admin/roles-permissions',
    {
      preHandler: [app.requirePermission('staff.role.assign')],
    },
    userController.getRolesPermissions
  );
}
