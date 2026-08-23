/**
 * ai.controller.js — HTTP handlers for the AI Service Layer (Prompt 10.2).
 *
 * Concierge/sourcing turns stream over SSE (`text/event-stream`) — the response is hijacked so
 * Fastify never tries to send its own JSON envelope on top of the manually-written stream.
 */

import * as aiService from '../services/ai/index.js';
import * as provider from '../services/ai/provider.js';
import * as auditService from '../services/audit.service.js';
import * as productRepo from '../repositories/product.repository.js';
import { AppError } from '../plugins/errorHandler.js';

const { creativeStudio, demandForecast, prescriptiveInsights } = aiService;

function resolveLang(req) {
  return req.headers?.['accept-language'] === 'bn' ? 'bn' : 'en';
}

function isStaffUser(req) {
  return Boolean(req.user?.roles?.includes('admin') || req.user?.roles?.includes('super_admin'));
}

/** Description/background edits touch supplier-owned content — same ownership rule as
 * product.service.js's updateProduct: the owning supplier or staff, nobody else. `supplier_id`
 * comes back from pg as a string (BIGINT), req.user.id is a real Number — must coerce both. */
async function assertOwnsProduct(req, productId) {
  if (isStaffUser(req)) return;
  const product = await productRepo.getProductById(req.server.db, productId);
  if (!product || Number(product.supplier_id) !== Number(req.user.id)) {
    throw new AppError('FORBIDDEN', 'You do not own this product.', 'আপনি এই প্রোডাক্টটির মালিক নন।');
  }
}

function writeSseEvent(reply, event) {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function streamAgentTurn(req, reply, { agentType, runTurn }) {
  const db = req.server.db;
  const cache = req.server.cache;
  const userId = req.user.id;
  const message = (req.body?.message || '').toString().trim();
  const conversationId = req.body?.conversation_id ? parseInt(req.body.conversation_id, 10) : null;
  const lang = req.headers?.['accept-language'] === 'bn' ? 'bn' : 'en';

  if (!message) {
    return reply.status(400).send({
      error: { code: 'VALIDATION_FAILED', message_en: 'Message is required.', message_bn: 'বার্তা আবশ্যক।' },
    });
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const turnArgs = agentType === 'CONCIERGE'
      ? { db, cache, userId, conversationId, message, lang }
      : { db, userId, conversationId, message, lang };

    for await (const event of runTurn(turnArgs)) {
      writeSseEvent(reply, event);
    }
  } catch (err) {
    req.log.error({ err, agentType }, 'ai_turn_failed');
    writeSseEvent(reply, {
      type: 'error',
      code: 'INTERNAL_ERROR',
      message_en: 'The assistant is temporarily unavailable.',
      message_bn: 'সহকারী এই মুহূর্তে উপলব্ধ নয়।',
    });
  } finally {
    reply.raw.end();
  }
}

export async function streamConcierge(req, reply) {
  return streamAgentTurn(req, reply, { agentType: 'CONCIERGE', runTurn: (args) => aiService.conciergeAgent.runTurn(args) });
}

export async function streamSourcing(req, reply) {
  return streamAgentTurn(req, reply, { agentType: 'SOURCING', runTurn: (args) => aiService.sourcingAgent.runTurn(args) });
}

export async function listConversations(req, reply) {
  const agentType = req.query?.agent_type === 'SOURCING' ? 'SOURCING' : 'CONCIERGE';
  const items = await aiService.listConversations(req.server.db, { userId: req.user.id, agentType });
  return reply.send({ data: { items } });
}

export async function getConversationMessages(req, reply) {
  const conversationId = parseInt(req.params.id, 10);
  const result = await aiService.getConversationMessages(req.server.db, { userId: req.user.id, conversationId });
  if (!result) {
    throw new AppError('NOT_FOUND', 'Conversation not found.', 'কথোপকথন পাওয়া যায়নি।');
  }
  return reply.send({ data: result });
}

export async function getUsageSummary(req, reply) {
  const summary = await provider.getUsageSummary(req.server.db);
  return reply.send({ data: summary });
}

export async function updateSpendCap(req, reply) {
  const capUsd = parseFloat(req.body?.cap_usd);
  if (!Number.isFinite(capUsd) || capUsd < 0) {
    throw new AppError('VALIDATION_FAILED', 'cap_usd must be a non-negative number.', 'cap_usd অবশ্যই একটি অ-ঋণাত্মক সংখ্যা হতে হবে।');
  }
  const before = await provider.getSpendCapUsd(req.server.db);
  await provider.setSpendCapUsd(req.server.db, capUsd);

  await auditService.record(req.server.db, {
    action: 'ai.spend_cap.update',
    targetType: 'PLATFORM_SETTING',
    targetRef: 'ai.monthly_spend_cap_usd',
    before: { cap_usd: before },
    after: { cap_usd: capUsd },
    riskTier: 'HIGH',
    actorId: req.user.id,
  });

  const summary = await provider.getUsageSummary(req.server.db);
  return reply.send({ data: summary });
}

// ---- Prompt 10.3: Creative Studio, Forecasting, Insights ----------------------------------

export async function generateAdCopy(req, reply) {
  const productId = parseInt(req.body?.product_id, 10);
  const result = await creativeStudio.generateAdCopy(req.server.db, {
    userId: req.user.id,
    productId,
    lang: resolveLang(req),
    tone: req.body?.tone,
  });
  return reply.send({ data: result });
}

export async function improveDescription(req, reply) {
  const productId = parseInt(req.body?.product_id, 10);
  await assertOwnsProduct(req, productId);
  const result = await creativeStudio.improveDescription(req.server.db, {
    userId: req.user.id,
    productId,
    lang: resolveLang(req),
  });
  return reply.send({ data: result });
}

export async function suggestBackground(req, reply) {
  const productId = parseInt(req.body?.product_id, 10);
  await assertOwnsProduct(req, productId);
  const result = await creativeStudio.suggestBackgroundTreatment(req.server.db, {
    userId: req.user.id,
    productId,
    lang: resolveLang(req),
  });
  return reply.send({ data: result });
}

export async function applyBackground(req, reply) {
  const productId = parseInt(req.body?.product_id, 10);
  await assertOwnsProduct(req, productId);
  const result = await creativeStudio.applyBackgroundTreatment(req.server.db, {
    userId: req.user.id,
    productId,
    style: req.body?.style,
    userRestrictions: req.userRestrictions || [],
  });
  return reply.send({ data: result });
}

export async function getForecast(req, reply) {
  const productId = parseInt(req.params.productId, 10);
  if (!isStaffUser(req)) {
    const product = await productRepo.getProductById(req.server.db, productId);
    if (!product || Number(product.supplier_id) !== Number(req.user.id)) {
      throw new AppError('FORBIDDEN', 'You do not own this product.', 'আপনি এই প্রোডাক্টটির মালিক নন।');
    }
  }
  const horizonDays = req.query?.horizon_days ? parseInt(req.query.horizon_days, 10) : 14;
  const result = await demandForecast.runForecast(req.server.db, {
    userId: req.user.id,
    productId,
    horizonDays,
    lang: resolveLang(req),
  });
  return reply.send({ data: result });
}

export async function getInsights(req, reply) {
  const result = await prescriptiveInsights.getInsightsForUser(req.server.db, {
    userId: req.user.id,
    role: req.user.role,
    lang: resolveLang(req),
  });
  return reply.send({ data: result });
}
