/**
 * module.routes.js — Route definitions for platform module management and public flags (Prompt 3.1).
 */

import * as controller from '../controllers/module.controller.js';

export default async function moduleRoutes(app) {
  // Optional auth pre-handler for public endpoint (to attach user context if logged in)
  const optionalAuth = async (req, reply) => {
    try {
      if (app.authenticate) {
        await app.authenticate(req, reply);
      }
    } catch {
      // Ignored for optional auth
    }
  };

  // Public: flags relevant to the caller, for UI gating
  app.get('/modules', { preHandler: [optionalAuth] }, controller.getPublicModules);

  // Admin Module Management Routes (Super Admin / Staff)
  app.register(async (adminScope) => {
    adminScope.addHook('preHandler', app.authenticate);

    // Full registry + state + targeting rules
    adminScope.get(
      '/admin/modules',
      { preHandler: [app.requirePermission('platform.module.view')] },
      controller.listAdminModules
    );

    // Toggle a module (CRITICAL tier -> super_admin only)
    adminScope.patch(
      '/admin/modules/:key',
      { preHandler: [app.requirePermission('platform.module.toggle')] },
      controller.toggleModule
    );

    // Update sub-settings (CRITICAL tier -> super_admin only)
    adminScope.patch(
      '/admin/modules/:key/settings',
      { preHandler: [app.requirePermission('platform.module.settings')] },
      controller.updateModuleSettings
    );

    // Add targeting rule (CRITICAL tier -> super_admin only)
    adminScope.post(
      '/admin/modules/:key/targeting',
      { preHandler: [app.requirePermission('platform.module.targeting')] },
      controller.createTargetingRule
    );

    // Delete targeting rule
    adminScope.delete(
      '/admin/targeting-rules/:id',
      { preHandler: [app.requirePermission('platform.module.targeting')] },
      controller.deleteTargetingRule
    );

    // Module change history (audit trail)
    adminScope.get(
      '/admin/modules/:key/history',
      { preHandler: [app.requirePermission('platform.module.view')] },
      controller.getModuleHistory
    );
  });
}
