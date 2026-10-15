/**
 * services/ai/index.ts — Barrel for the AI service layer (Prompt 10.2).
 *
 * Controllers import only from here (or provider.js for usage/cap admin endpoints) — never
 * reach past this into conciergeAgent/sourcingAgent's internals directly, and never touch the
 * SDK. See docs/ai-strategy.md.
 */

export * as conciergeAgent from './conciergeAgent.ts';
export * as sourcingAgent from './sourcingAgent.ts';
export * as provider from './provider.ts';
export * as creativeStudio from './creativeStudio.ts';
export * as demandForecast from './demandForecast.ts';
export * as reviewIntegrity from './reviewIntegrity.ts';
export * as prescriptiveInsights from './prescriptiveInsights.ts';

import * as aiRepo from '../../repositories/ai.repository.ts';

export async function listConversations(db, { userId, agentType, limit = 20 }) {
  return aiRepo.listConversations(db, { userId, agentType, limit });
}

export async function getConversationMessages(db, { userId, conversationId, limit = 50 }) {
  const conversation = await aiRepo.getConversationById(db, conversationId, userId);
  if (!conversation) return null;
  const messages = await aiRepo.listMessages(db, conversationId, { limit });
  return { conversation, messages };
}
