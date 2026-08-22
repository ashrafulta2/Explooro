/**
 * me.routes.js — Current authenticated user introspection routes (Prompt 2.4).
 *
 * Exposes GET /api/v1/me/permissions returning resolved permissions + sources + active grants
 * + active JIT windows + restrictions, enabling client-side locked-state UI (ia-sitemap.md §5).
 */

import * as rbacService from '../services/rbac.service.js';

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
}
