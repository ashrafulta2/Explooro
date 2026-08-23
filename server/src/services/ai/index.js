/**
 * services/ai/index.js — Barrel for the AI service layer (Prompt 10.2).
 *
 * Controllers import only from here (or provider.js for usage/cap admin endpoints) — never
 * reach past this into conciergeAgent/sourcingAgent's internals directly, and never touch the
 * SDK. See docs/ai-strategy.md.
 */

export * as conciergeAgent from './conciergeAgent.js';
export * as sourcingAgent from './sourcingAgent.js';
export * as provider from './provider.js';
export * as creativeStudio from './creativeStudio.js';
export * as demandForecast from './demandForecast.js';
export * as reviewIntegrity from './reviewIntegrity.js';
export * as prescriptiveInsights from './prescriptiveInsights.js';

import * as aiRepo from '../../repositories/ai.repository.js';

export async function listConversations(db, { userId, agentType, limit = 20 }) {
  return aiRepo.listConversations(db, { userId, agentType, limit });
}

export async function getConversationMessages(db, { userId, conversationId, limit = 50 }) {
  const conversation = await aiRepo.getConversationById(db, conversationId, userId);
  if (!conversation) return null;
  const messages = await aiRepo.listMessages(db, conversationId, { limit });
  return { conversation, messages };
}
