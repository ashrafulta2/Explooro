/**
 * adminAnalytics.routes.js — Fastify routes for Super Admin Analytics & System Health (Prompt 11.4).
 */

import * as controller from '../controllers/adminAnalytics.controller.js';

export default async function adminAnalyticsRoutes(fastify) {
  const reqPerm = (perm) => (fastify.requirePermission ? fastify.requirePermission(perm) : async () => {});

  // 1. Executive Analytics Overview
  fastify.get(
    '/admin/analytics/overview',
    {
      preHandler: [fastify.authenticate, reqPerm('admin.dashboard.view')],
    },
    controller.getOverviewHandler
  );

  // 2. Operational Action Alert Cards
  fastify.get(
    '/admin/analytics/alerts',
    {
      preHandler: [fastify.authenticate, reqPerm('admin.dashboard.view')],
    },
    controller.getAlertsHandler
  );

  // 3. System Health & Diagnostics Hub
  fastify.get(
    '/admin/system/health',
    {
      preHandler: [fastify.authenticate, reqPerm('system.health.view')],
    },
    controller.getSystemHealthHandler
  );

  // 4. Backup Snapshots History
  fastify.get(
    '/admin/system/backups',
    {
      preHandler: [fastify.authenticate, reqPerm('system.backup.manage')],
    },
    controller.getBackupsHandler
  );

  // 5. Trigger Manual Backup Snapshot
  fastify.post(
    '/admin/system/backups/trigger',
    {
      preHandler: [fastify.authenticate, reqPerm('system.backup.manage')],
    },
    controller.triggerBackupHandler
  );

  // 6. Restore Backup Snapshot (CRITICAL Tier)
  fastify.post(
    '/admin/system/backups/:id/restore',
    {
      preHandler: [fastify.authenticate, reqPerm('system.backup.manage')],
    },
    controller.restoreBackupHandler
  );

  // 7. Manual Rollup Trigger
  fastify.post(
    '/admin/analytics/rollup-now',
    {
      preHandler: [fastify.authenticate, reqPerm('admin.dashboard.view')],
    },
    controller.triggerRollupHandler
  );
}
