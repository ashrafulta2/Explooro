/**
 * me.routes.js — Current authenticated user introspection routes (Prompt 2.4).
 *
 * Exposes GET /api/v1/me/permissions returning resolved permissions + sources + active grants
 * + active JIT windows + restrictions, enabling client-side locked-state UI (ia-sitemap.md §5),
 * plus the self-service GET/PUT /api/v1/me/profile pair behind the account menu's "My Profile".
 *
 * Every route here is scoped to `req.user.id`, so `authenticate` is the whole authorization story
 * — there is no permission key for "read your own name".
 */

import * as rbacService from '../services/rbac.service.js';
import * as profileController from '../controllers/profile.controller.js';

export default async function meRoutes(app) {
  app.get(
    '/permissions',
    {
      preHandler: app.authenticate,
    },
    async (req, reply) => {
      const { db, cache } = req.server;
      const data = await rbacService.getPermissionsPayload(db, cache, req.user.id);
      reply.send({ data });
    }
  );

  app.get('/profile', { preHandler: app.authenticate }, profileController.getMyProfile);

  app.put('/profile', { preHandler: app.authenticate }, profileController.updateMyProfile);
}
