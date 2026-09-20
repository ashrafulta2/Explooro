/**
 * genie.service.js — popup "genie" effect policy engine.
 *
 * Owns the platform's answer to three questions about the open/close animation every popup plays
 * (client/src/lib/genie.js): does it play at all, how long does it take, and how finely is it
 * drawn. The policy lives in platform_settings (group `genie`, seeded by 049_genie_effect_settings.sql)
 * and follows the pattern localization.service.js set: validated here, written in one transaction,
 * audited with before/after JSON, cached briefly because an unauthenticated endpoint serves it on
 * every cold page load.
 */

import * as settingRepo from '../repositories/setting.repository.js';
import { AppError } from '../plugins/errorHandler.js';

export const SETTINGS_GROUP = 'genie';

/**
 * Kept in lockstep with GENIE_LIMITS / GENIE_QUALITIES in client/src/lib/genie.js.
 * server/test/genieEffect.test.js parses the client file and fails on drift: a value the API
 * accepts but the engine clamps is a setting that silently does not do what its page says.
 */
export const DURATION_LIMITS = Object.freeze({ min: 250, max: 1500 });
export const QUALITIES = Object.freeze(['light', 'balanced', 'smooth']);

export const SETTING_KEYS = {
  enabled: 'genie.enabled',
  durationMs: 'genie.duration_ms',
  quality: 'genie.quality',
};

/** Row metadata the upsert needs when a key is written before its migration has ever run. */
const SETTING_META = {
  [SETTING_KEYS.enabled]: { valueType: 'BOOLEAN', labelEn: 'Popup genie effect', labelBn: 'পপআপ জিনি ইফেক্ট' },
  [SETTING_KEYS.durationMs]: { valueType: 'NUMBER', labelEn: 'Genie duration (ms)', labelBn: 'জিনি ইফেক্টের সময় (ms)' },
  [SETTING_KEYS.quality]: { valueType: 'STRING', labelEn: 'Genie smoothness', labelBn: 'জিনি ইফেক্টের মসৃণতা' },
};

export const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  duration_ms: 650,
  quality: 'balanced',
});

const CACHE_KEY = 'genie:policy';
const CACHE_TTL_SECONDS = 300;

/** `pg` hands back JSONB already parsed; a text column or a mock db may return a string. */
function readJsonValue(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isDuration(n) {
  return Number.isInteger(n) && n >= DURATION_LIMITS.min && n <= DURATION_LIMITS.max;
}

function rowsToPolicy(rows = []) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const enabled = readJsonValue(byKey.get(SETTING_KEYS.enabled)?.value_json);
  const duration = Number(readJsonValue(byKey.get(SETTING_KEYS.durationMs)?.value_json));
  const quality = readJsonValue(byKey.get(SETTING_KEYS.quality)?.value_json);
  const anchor = byKey.get(SETTING_KEYS.enabled);

  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_POLICY.enabled,
    duration_ms: isDuration(duration) ? duration : DEFAULT_POLICY.duration_ms,
    quality: QUALITIES.includes(quality) ? quality : DEFAULT_POLICY.quality,
    updated_at: anchor?.updated_at ?? null,
    updated_by: anchor?.updated_by ?? null,
  };
}

/**
 * Validates a complete proposed policy. Pure and exported so the API and the tests assert the same
 * rules with no second implementation to drift. Throws AppError('VALIDATION_FAILED') on the first
 * rule broken, with both language messages the API contract requires.
 *
 * WHY VALIDATION_FAILED: it is the code in the closed enum of docs/api-contract.md §3 (and in
 * plugins/errorHandler.js), so the API answers 400. An invented code falls through to 500.
 */
export function validatePolicy(input = {}) {
  const { enabled, duration_ms: durationMs, quality } = input;

  if (typeof enabled !== 'boolean') {
    throw new AppError(
      'VALIDATION_FAILED',
      'The popup effect switch must be true or false.',
      'পপআপ ইফেক্টের সুইচ true অথবা false হতে হবে।',
      { field: 'enabled' }
    );
  }

  if (!isDuration(durationMs)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Duration must be a whole number of milliseconds between ${DURATION_LIMITS.min} and ${DURATION_LIMITS.max}.`,
      `সময় ${DURATION_LIMITS.min} থেকে ${DURATION_LIMITS.max} মিলিসেকেন্ডের মধ্যে একটি পূর্ণসংখ্যা হতে হবে।`,
      { field: 'duration_ms', min: DURATION_LIMITS.min, max: DURATION_LIMITS.max }
    );
  }

  if (typeof quality !== 'string' || !QUALITIES.includes(quality)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Smoothness must be one of: ${QUALITIES.join(', ')}.`,
      `মসৃণতা এগুলোর একটি হতে হবে: ${QUALITIES.join(', ')}।`,
      { field: 'quality', supported: QUALITIES }
    );
  }

  return { enabled, duration_ms: durationMs, quality };
}

/**
 * The live policy. Cached briefly; the cache is dropped the moment the policy changes, so an admin
 * sees their change immediately rather than up to the TTL later.
 */
export async function getPolicy(db, cache) {
  if (cache) {
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (typeof parsed?.enabled === 'boolean') return parsed;
      }
    } catch {
      // A miss or a malformed entry is not an error — fall through to the database.
    }
  }

  let policy = { ...DEFAULT_POLICY, updated_at: null, updated_by: null };
  try {
    policy = rowsToPolicy(await settingRepo.listSettingsByGroup(db, SETTINGS_GROUP));
  } catch {
    // The table may not exist yet on a fresh clone that has not run migrations. The shipped
    // default is a better answer than a 500 on every page load.
  }

  if (cache) {
    try {
      await cache.set(CACHE_KEY, JSON.stringify(policy), CACHE_TTL_SECONDS);
    } catch {
      // Caching is an optimisation; failing to store must not fail the read.
    }
  }

  return policy;
}

async function invalidate(cache) {
  if (!cache) return;
  try {
    await cache.del(CACHE_KEY);
  } catch {
    // Worst case the previous value serves for up to CACHE_TTL_SECONDS.
  }
}

const pick = (p) => ({ enabled: p.enabled, duration_ms: p.duration_ms, quality: p.quality });

/**
 * Applies a new policy. One transaction over the whole `genie` group so a half-applied policy can
 * never be observed, and a single audit row carrying the previous and the new policy — the
 * before/after pair CLAUDE.md requires of every state-changing staff action.
 */
export async function updatePolicy(
  db,
  cache,
  auditService,
  { policy, reason, userId, actorRole = null, reqContext = {} }
) {
  const next = validatePolicy(policy);

  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Give a reason of at least 10 characters for this change.',
      'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।',
      { field: 'reason' }
    );
  }

  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  let before;
  let after;
  try {
    if (isDedicatedClient) await client.query('BEGIN');

    await settingRepo.lockSettingsGroup(client, SETTINGS_GROUP);
    before = rowsToPolicy(await settingRepo.listSettingsByGroup(client, SETTINGS_GROUP));

    const writes = [
      [SETTING_KEYS.enabled, next.enabled],
      [SETTING_KEYS.durationMs, next.duration_ms],
      [SETTING_KEYS.quality, next.quality],
    ];
    for (const [key, value] of writes) {
      await settingRepo.upsertSetting(client, {
        key,
        valueJson: value,
        groupKey: SETTINGS_GROUP,
        updatedBy: userId ?? null,
        ...SETTING_META[key],
      });
    }

    after = rowsToPolicy(await settingRepo.listSettingsByGroup(client, SETTINGS_GROUP));

    if (isDedicatedClient) await client.query('COMMIT');
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }

  await invalidate(cache);

  if (auditService?.record) {
    await auditService.record(db, {
      action: 'platform.genie.update',
      targetType: 'platform_settings',
      targetRef: SETTINGS_GROUP,
      beforeJson: pick(before),
      afterJson: pick(after),
      meta: { reason: reason.trim() },
      riskTier: 'MEDIUM',
      actorId: userId ?? null,
      actorRole,
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
  }

  return after;
}

/** The roster behind "who can change this" on the admin page. */
export async function getUpdateAuthority(db) {
  try {
    return await settingRepo.listPermissionHolders(db, 'platform.genie.update');
  } catch {
    return { roles: [], grants: [] };
  }
}
