/**
 * ai.routes.js — Routes for the AI Service Layer (Prompt 10.2).
 *
 * Module checks: requireModule('ai_concierge' | 'ai_sourcing_chat')
 * Permissions: ai.concierge.use, ai.sourcing.use, ai.config.manage
 */

import * as aiCtrl from '../controllers/ai.controller.js';
import { requirePermission } from '../middlewares/requirePermission.js';

export default async function aiRoutes(fastify) {
  const reqMod = (key) => (fastify.requireModule ? fastify.requireModule(key) : async () => {});
  const reqPerm = fastify.requirePermission || requirePermission;

  fastify.post(
    '/ai/concierge/messages',
    { preHandler: [fastify.authenticate, reqMod('ai_concierge'), reqPerm('ai.concierge.use')] },
    aiCtrl.streamConcierge
  );
  fastify.get(
    '/ai/concierge/conversations',
    { preHandler: [fastify.authenticate, reqMod('ai_concierge'), reqPerm('ai.concierge.use')] },
    aiCtrl.listConversations
  );

  fastify.post(
    '/ai/sourcing/messages',
    { preHandler: [fastify.authenticate, reqMod('ai_sourcing_chat'), reqPerm('ai.sourcing.use')] },
    aiCtrl.streamSourcing
  );
  fastify.get(
    '/ai/sourcing/conversations',
    { preHandler: [fastify.authenticate, reqMod('ai_sourcing_chat'), reqPerm('ai.sourcing.use')] },
    aiCtrl.listConversations
  );

  fastify.get(
    '/ai/conversations/:id/messages',
    { preHandler: [fastify.authenticate] },
    aiCtrl.getConversationMessages
  );

  fastify.get(
    '/ai/usage',
    { preHandler: [fastify.authenticate, reqPerm('ai.config.manage')] },
    aiCtrl.getUsageSummary
  );
  fastify.patch(
    '/ai/usage/cap',
    { preHandler: [fastify.authenticate, reqPerm('ai.config.manage')] },
    aiCtrl.updateSpendCap
  );

  // Prompt 10.3: Creative Studio, Demand Forecasting & Prescriptive Insights
  const creativeGate = [fastify.authenticate, reqMod('ai_creative_studio'), reqPerm('ai.creative.use')];
  fastify.post('/ai/creative/ad-copy', { preHandler: creativeGate }, aiCtrl.generateAdCopy);
  fastify.post('/ai/creative/description', { preHandler: creativeGate }, aiCtrl.improveDescription);
  fastify.post('/ai/creative/background/suggest', { preHandler: creativeGate }, aiCtrl.suggestBackground);
  fastify.post('/ai/creative/background/apply', { preHandler: creativeGate }, aiCtrl.applyBackground);

  fastify.get(
    '/ai/forecast/:productId',
    { preHandler: [fastify.authenticate, reqMod('ai_forecasting'), reqPerm('supplier.analytics.view')] },
    aiCtrl.getForecast
  );

  fastify.get(
    '/ai/insights',
    { preHandler: [fastify.authenticate, reqMod('prescriptive_insights')] },
    aiCtrl.getInsights
  );
}
