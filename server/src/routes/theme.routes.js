/**
 * theme.routes.js — Theme Studio API routing (Prompt 3.5).
 */

import * as themeController from '../controllers/theme.controller.js';

export default async function themeRoutes(app) {
  const auth = app.authenticate || (async () => {});
  const reqPerm = (perm) => (app.requirePermission ? app.requirePermission(perm) : async () => {});

  // Public endpoint: get active theme tokens for client styling
  app.get('/theme/active', themeController.getActive);

  // Admin routes
  app.get(
    '/admin/theme/palettes',
    {
      preHandler: [auth, reqPerm('platform.theme.view')],
    },
    themeController.listPalettes
  );

  app.post(
    '/admin/theme/draft',
    {
      preHandler: [auth, reqPerm('platform.theme.draft')],
    },
    themeController.saveDraft
  );

  app.patch(
    '/admin/theme/:id',
    {
      preHandler: [auth, reqPerm('platform.theme.draft')],
    },
    themeController.renameTheme
  );

  app.delete(
    '/admin/theme/:id',
    {
      preHandler: [auth, reqPerm('platform.theme.draft')],
    },
    themeController.deleteTheme
  );

  // Publishing a theme palette is a CRITICAL action (Super Admin only)
  app.post(
    '/admin/theme/:id/publish',
    {
      preHandler: [auth, reqPerm('platform.theme.publish')],
    },
    themeController.publishTheme
  );

  app.post(
    '/admin/theme/validate-contrast',
    themeController.validateContrast
  );
}
