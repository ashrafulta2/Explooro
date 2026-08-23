/**
 * provider.js — Thin abstraction over the Anthropic Claude SDK (Prompt 10.2).
 *
 * The ONLY file in this codebase allowed to import `@anthropic-ai/sdk` or know its request/
 * response shapes (docs/ai-strategy.md §1). No controller or route may call the model directly.
 *
 * Responsibilities:
 * 1. Streaming single-turn completions, normalized to a small event shape agents can consume
 *    without touching the SDK's types.
 * 2. Retry with exponential backoff on transient failures (docs/ai-strategy.md §8).
 * 3. Token accounting per user/feature (ai_usage_events) and cost computation (docs/ai-strategy.md §3).
 * 4. A hard, server-enforced monthly spend cap (docs/ai-strategy.md §6) — checked before every
 *    call; never bypassable from a controller or client.
 * 5. A zero-cost `mock` driver (AI_DRIVER=mock, the default) so the whole AI layer works with no
 *    API key, per the platform's "every integration ships a mock driver" rule.
 * 6. PII redaction on outbound user text (docs/ai-strategy.md §9.2).
 */

import * as aiRepo from '../../repositories/ai.repository.js';

const DEFAULT_SPEND_CAP_USD = parseFloat(process.env.AI_MONTHLY_SPEND_CAP_USD || '100');
const PLATFORM_SETTING_CAP_KEY = 'ai.monthly_spend_cap_usd';

// docs/ai-strategy.md §3 — re-verify against the claude-api skill's pricing reference on model change.
export const PRICING_PER_1K = {
  'claude-sonnet-5': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5': { input: 0.001, output: 0.005 },
  'claude-opus-5': { input: 0.005, output: 0.025 },
};

const MODEL_ENV_BY_FEATURE = {
  concierge: 'AI_MODEL_CONCIERGE',
  sourcing: 'AI_MODEL_SOURCING',
  creative: 'AI_MODEL_CREATIVE',
};

export function getModelForFeature(featureKey) {
  const envKey = MODEL_ENV_BY_FEATURE[featureKey];
  return (envKey && process.env[envKey]) || process.env.AI_MODEL || 'claude-sonnet-5';
}

export function getDriver() {
  return (process.env.AI_DRIVER || 'mock').toLowerCase().trim();
}

export function computeCostUsd(model, inputTokens, outputTokens) {
  const rate = PRICING_PER_1K[model] || PRICING_PER_1K['claude-sonnet-5'];
  return (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
}

export async function getSpendCapUsd(db) {
  try {
    const stored = await aiRepo.getPlatformSetting(db, PLATFORM_SETTING_CAP_KEY);
    if (stored !== null && stored !== undefined) {
      const n = parseFloat(stored);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    // platform_settings unreachable — fall through to env bootstrap default
  }
  return DEFAULT_SPEND_CAP_USD;
}

export async function setSpendCapUsd(db, capUsd) {
  await aiRepo.upsertPlatformSetting(db, PLATFORM_SETTING_CAP_KEY, capUsd);
  return capUsd;
}

export async function getUsageSummary(db) {
  const [cap, monthTotal, byFeature] = await Promise.all([
    getSpendCapUsd(db),
    aiRepo.getMonthSpend(db),
    aiRepo.getMonthSpendByFeature(db),
  ]);
  return {
    driver: getDriver(),
    cap_usd: cap,
    spent_usd: monthTotal.totalUsd,
    remaining_usd: Math.max(0, cap - monthTotal.totalUsd),
    event_count: monthTotal.eventCount,
    by_feature: byFeature,
  };
}

export async function isOverBudget(db) {
  const [cap, monthTotal] = await Promise.all([getSpendCapUsd(db), aiRepo.getMonthSpend(db)]);
  return monthTotal.totalUsd >= cap;
}

/** Records a completed call's token usage/cost — the only place ai_usage_events is written. */
export async function recordUsage(db, { userId, conversationId, featureKey, model, driver, inputTokens, outputTokens, degraded = false }) {
  const costUsd = degraded ? 0 : computeCostUsd(model, inputTokens, outputTokens);
  return aiRepo.insertUsageEvent(db, {
    userId,
    conversationId,
    featureKey,
    model,
    driver,
    inputTokens,
    outputTokens,
    costUsd,
    degraded,
  });
}

/**
 * One-shot, non-streaming completion for capabilities that don't need SSE (Prompt 10.3: creative
 * copy, forecast/insight explanations). Wraps streamTurn so retry/backoff stays in one place, but
 * collects the full text before returning rather than yielding deltas.
 *
 * Same spend-cap/mock/degradation contract as an agent's runTurn: never throws to the caller —
 * always resolves to { text, degraded, reason, model, driver }, with usage recorded exactly once.
 */
export async function generateCompletion(db, { userId, featureKey, system, prompt, maxTokens = 400 }) {
  const model = getModelForFeature(featureKey);
  const overBudget = await isOverBudget(db);
  const driver = overBudget ? getDriver() : getDriver();

  if (overBudget || driver === 'mock') {
    await recordUsage(db, {
      userId,
      featureKey,
      model,
      driver: overBudget ? driver : 'mock',
      inputTokens: 0,
      outputTokens: 0,
      degraded: true,
    });
    return { text: null, degraded: true, reason: overBudget ? 'SPEND_CAP_EXCEEDED' : 'MOCK_DRIVER', model, driver };
  }

  try {
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const event of streamTurn({
      model,
      system,
      messages: [{ role: 'user', content: prompt }],
      tools: [],
      maxTokens,
      effort: 'low',
    })) {
      if (event.type === 'text_delta') text += event.text;
      if (event.type === 'usage') {
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
      }
    }
    await recordUsage(db, { userId, featureKey, model, driver: 'anthropic', inputTokens, outputTokens });
    return { text, degraded: false, reason: null, model, driver: 'anthropic' };
  } catch {
    await recordUsage(db, {
      userId,
      featureKey,
      model,
      driver: 'anthropic',
      inputTokens: 0,
      outputTokens: 0,
      degraded: true,
    });
    return { text: null, degraded: true, reason: 'PROVIDER_UNAVAILABLE', model, driver: 'anthropic' };
  }
}

// docs/ai-strategy.md §9.2 — same pattern family as audit.service.js's sensitive-key detection,
// applied to free text rather than object keys.
const PII_PATTERNS = [
  { re: /\b(?:\+?880|0)1[3-9]\d{8}\b/g, placeholder: '[PHONE]' },
  { re: /\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/g, placeholder: '[EMAIL]' },
  { re: /\b\d{10}(?:\d{3})?\b/g, placeholder: '[NID]' },
];

export function redactPii(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const { re, placeholder } of PII_PATTERNS) {
    out = out.replace(re, placeholder);
  }
  return out;
}

let anthropicClientPromise = null;
async function getAnthropicClient() {
  if (!anthropicClientPromise) {
    anthropicClientPromise = import('@anthropic-ai/sdk').then(({ default: Anthropic }) => new Anthropic());
  }
  return anthropicClientPromise;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [300, 900];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Streams one model turn. Yields normalized events:
 *   { type: 'text_delta', text }
 *   { type: 'tool_use', id, name, input }
 *   { type: 'usage', inputTokens, outputTokens }
 *   { type: 'stop', reason }
 * Throws only after the retry budget (docs/ai-strategy.md §8) is exhausted — the caller (an
 * agent's runTurn) is responsible for catching and falling into the degraded path.
 */
export async function* streamTurn({ model, system, messages, tools, maxTokens = 1024, effort = 'low' }) {
  const client = await getAnthropicClient();

  let attempt = 0;
  while (true) {
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools,
        output_config: { effort },
        messages,
      });

      const toolInputBuffers = new Map();

      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          toolInputBuffers.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: '' });
        }
        if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text };
          }
          if (event.delta?.type === 'input_json_delta') {
            const buf = toolInputBuffers.get(event.index);
            if (buf) buf.json += event.delta.partial_json;
          }
        }
        if (event.type === 'content_block_stop') {
          const buf = toolInputBuffers.get(event.index);
          if (buf) {
            let input = {};
            try {
              input = buf.json ? JSON.parse(buf.json) : {};
            } catch {
              input = {};
            }
            yield { type: 'tool_use', id: buf.id, name: buf.name, input };
            toolInputBuffers.delete(event.index);
          }
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: 'usage',
        inputTokens: finalMessage.usage?.input_tokens || 0,
        outputTokens: finalMessage.usage?.output_tokens || 0,
      };
      yield { type: 'stop', reason: finalMessage.stop_reason };
      return;
    } catch (err) {
      const status = err?.status;
      const retryable = RETRYABLE_STATUS.has(status) || err?.name === 'APIConnectionError';
      if (!retryable || attempt >= BACKOFF_MS.length) throw err;
      await sleep(BACKOFF_MS[attempt]);
      attempt += 1;
    }
  }
}
