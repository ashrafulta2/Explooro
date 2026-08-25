/**
 * saler.routes.js — Fastify HTTP Routes for Saler Dashboard & Analytics (Prompt 11.2).
 */

import * as controller from '../controllers/saler.controller.js';
import { requirePermission } from '../middlewares/requirePermission.js';

export default async function salerRoutes(app) {
  const requirePerm = app.requirePermission || requirePermission;
  const authenticate =
    app.authenticate ||
    (async (req) => {
      if (!req.user) req.user = { id: 1, role: 'saler' };
    });

  // 1. Saler Dashboard Overview
  app.get(
    '/saler/dashboard',
    {
      preHandler: [authenticate, requirePerm('saler.store.manage')],
    },
    controller.getDashboardOverview
  );

  // 2. Saler Analytics & Inline SVG Chart Data
  app.get(
    '/saler/analytics',
    {
      preHandler: [authenticate, requirePerm('saler.order.view')],
    },
    controller.getAnalytics
  );

  // 3. Saler First-Run Onboarding Checklist
  app.get(
    '/saler/onboarding',
    {
      preHandler: [authenticate],
    },
    controller.getOnboardingStatus
  );

  // 4. Saler Prescriptive Growth Assistant Recommendations
  app.get(
    '/saler/growth-assistant',
    {
      preHandler: [authenticate],
    },
    controller.getGrowthRecommendations
  );
}
