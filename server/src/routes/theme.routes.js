/**
 * theme.routes.js — Theme Studio API routing (Prompt 3.5).
 */

import * as themeController from '../controllers/theme.controller.js';

export default async function themeRoutes(app) {
  // Public endpoint: get active theme tokens for client styling
  app.get('/theme/active', themeController.getActive);

  // Admin routes
  app.get(
    '/admin/theme/palettes',
    {
      preHandler: [app.requirePermission('platform.module.view')],
    },
    themeController.listPalettes
  );

  app.post(
    '/admin/theme/draft',
    {
      preHandler: [app.requirePermission('platform.module.view')],
    },
    themeController.saveDraft
  );

  // Publishing a theme palette is a CRITICAL action (Super Admin only)
  app.post(
    '/admin/theme/:id/publish',
    {
      preHandler: [app.requirePermission('platform.module.toggle')],
    },
    themeController.publishTheme
  );

  app.post(
    '/admin/theme/validate-contrast',
    themeController.validateContrast
  );
}
