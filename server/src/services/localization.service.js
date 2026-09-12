/**
 * localization.service.js — Language & Localization policy engine.
 *
 * Owns the platform's answer to "what language does a visitor see first?" and the two rules that
 * surround it: which languages the switcher may offer, and whether a visitor is allowed to pick
 * something other than the default at all.
 *
 * The policy lives in platform_settings (group `localization`, seeded by
 * 045_localization_policy.sql) — NOT in the `i18n` module's sub_settings_schema. That schema used
 * to declare a `default_locale` key, but nothing ever read it, and it was reachable only through
 * `platform.module.settings`, which is CRITICAL and therefore non-delegable: a Super Admin could
 * never hand the language over to anyone else. 046 drops that dead key so this table is the only
 * writer for the value.
 *
 * Every mutation is validated here (not in the controller, not in the page), written in one
 * transaction, and audited with before/after JSON.
 */

import * as settingRepo from '../repositories/setting.repository.js';
import { AppError } from '../plugins/errorHandler.js';

/**
 * The locales the product actually ships dictionaries for. Kept in lockstep with `SUPPORTED` in
 * client/src/services/i18n.js and the users.locale CHECK constraint in 001_identity.sql — adding a
 * third language means touching all three deliberately, which is the point: a locale nobody has
 * translated is worse than one that is simply absent.
 */
export const SUPPORTED_LOCALES = ['en', 'bn'];

/** Where the policy falls back when the table has not been seeded or the DB is unreachable. */
export const FALLBACK_LOCALE = 'en';

export const SETTINGS_GROUP = 'localization';

export const SETTING_KEYS = {
  defaultLocale: 'localization.default_locale',
  enabledLocales: 'localization.enabled_locales',
  allowUserOverride: 'localization.allow_user_override',
};

/** Row metadata the upsert needs when a key is written before its migration has ever run. */
const SETTING_META = {
  [SETTING_KEYS.defaultLocale]: {
    valueType: 'STRING',
    labelEn: 'Default language',
    labelBn: 'ডিফল্ট ভাষা',
  },
  [SETTING_KEYS.enabledLocales]: {
    valueType: 'OBJECT',
    labelEn: 'Enabled languages',
    labelBn: 'সক্রিয় ভাষাসমূহ',
  },
  [SETTING_KEYS.allowUserOverride]: {
    valueType: 'BOOLEAN',
    labelEn: 'Let visitors choose their own language',
    labelBn: 'দর্শনার্থীদের নিজের ভাষা বেছে নিতে দিন',
  },
};

export const DEFAULT_POLICY = Object.freeze({
  default_locale: FALLBACK_LOCALE,
  enabled_locales: [...SUPPORTED_LOCALES],
  allow_user_override: true,
});

const CACHE_KEY = 'localization:policy';
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

function rowsToPolicy(rows = []) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const defaultRow = byKey.get(SETTING_KEYS.defaultLocale);
  const enabledRow = byKey.get(SETTING_KEYS.enabledLocales);
  const overrideRow = byKey.get(SETTING_KEYS.allowUserOverride);

  const defaultLocale = readJsonValue(defaultRow?.value_json);
  const enabledLocales = readJsonValue(enabledRow?.value_json);
  const allowUserOverride = readJsonValue(overrideRow?.value_json);

  const cleanedEnabled = Array.isArray(enabledLocales)
    ? enabledLocales.filter((l) => SUPPORTED_LOCALES.includes(l))
    : [];

  return {
    default_locale: SUPPORTED_LOCALES.includes(defaultLocale)
      ? defaultLocale
      : DEFAULT_POLICY.default_locale,
    enabled_locales: cleanedEnabled.length ? cleanedEnabled : [...DEFAULT_POLICY.enabled_locales],
    allow_user_override:
      typeof allowUserOverride === 'boolean' ? allowUserOverride : DEFAULT_POLICY.allow_user_override,
    updated_at: defaultRow?.updated_at ?? null,
    updated_by: defaultRow?.updated_by ?? null,
  };
}

/**
 * Validates a complete proposed policy. Pure and exported so the same rules are asserted by the
 * test suite and enforced by the API, with no second implementation to drift.
 *
 * Returns the normalised policy; throws AppError('VALIDATION_ERROR') on the first rule broken,
 * with both language messages the API contract requires.
 */
export function validatePolicy(input = {}) {
  const defaultLocale = input.default_locale;
  const rawEnabled = input.enabled_locales;
  const allowUserOverride = input.allow_user_override;

  if (typeof defaultLocale !== 'string' || !SUPPORTED_LOCALES.includes(defaultLocale)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Default language must be one of: ${SUPPORTED_LOCALES.join(', ')}.`,
      `ডিফল্ট ভাষা এগুলোর একটি হতে হবে: ${SUPPORTED_LOCALES.join(', ')}।`,
      { field: 'default_locale', supported: SUPPORTED_LOCALES }
    );
  }

  if (!Array.isArray(rawEnabled) || rawEnabled.length === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      'At least one language must stay enabled.',
      'অন্তত একটি ভাষা সক্রিয় রাখতে হবে।',
      { field: 'enabled_locales' }
    );
  }

  const enabledLocales = [...new Set(rawEnabled)];
  const unknown = enabledLocales.filter((l) => !SUPPORTED_LOCALES.includes(l));
  if (unknown.length) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Unsupported language(s): ${unknown.join(', ')}.`,
      `অসমর্থিত ভাষা: ${unknown.join(', ')}।`,
      { field: 'enabled_locales', unsupported: unknown }
    );
  }

  // WHY this rule exists: a default that is not itself enabled would send every new visitor to a
  // language the switcher refuses to offer, with no way back from inside the UI.
  if (!enabledLocales.includes(defaultLocale)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The default language must also be enabled.',
      'ডিফল্ট ভাষাটিও সক্রিয় থাকতে হবে।',
      { field: 'default_locale' }
    );
  }

  if (typeof allowUserOverride !== 'boolean') {
    throw new AppError(
      'VALIDATION_ERROR',
      'Visitor language choice must be true or false.',
      'দর্শনার্থীর ভাষা নির্বাচন true অথবা false হতে হবে।',
      { field: 'allow_user_override' }
    );
  }

  return {
    default_locale: defaultLocale,
    enabled_locales: enabledLocales.sort(),
    allow_user_override: allowUserOverride,
  };
}

/**
 * The live policy. Cached briefly because an unauthenticated endpoint serves it on every cold page
 * load; the cache is dropped the moment the policy changes, so an admin sees their change
 * immediately rather than up to the TTL later.
 */
export async function getPolicy(db, cache) {
  if (cache) {
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (parsed?.default_locale) return parsed;
      }
    } catch {
      // A miss or a malformed entry is not an error — fall through to the database.
    }
  }

  let policy = { ...DEFAULT_POLICY, updated_at: null, updated_by: null };
  try {
    const rows = await settingRepo.listSettingsByGroup(db, SETTINGS_GROUP);
    policy = rowsToPolicy(rows);
  } catch {
    // The table may not exist yet on a fresh clone that has not run migrations. The shipped
    // default is a better answer than a 500 on the marketplace home page.
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

/**
 * Applies a new policy.
 *
 * Runs as one transaction over the whole `localization` group so a half-applied policy (a new
 * default whose locale was not enabled) can never be observed, and writes a single audit row
 * carrying both the previous and the new policy — the before/after pair CLAUDE.md requires of
 * every state-changing staff action.
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
      'VALIDATION_ERROR',
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
      [SETTING_KEYS.defaultLocale, next.default_locale],
      [SETTING_KEYS.enabledLocales, next.enabled_locales],
      [SETTING_KEYS.allowUserOverride, next.allow_user_override],
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
      action: 'platform.localization.update',
      targetType: 'platform_settings',
      targetRef: SETTINGS_GROUP,
      beforeJson: {
        default_locale: before.default_locale,
        enabled_locales: before.enabled_locales,
        allow_user_override: before.allow_user_override,
      },
      afterJson: {
        default_locale: after.default_locale,
        enabled_locales: after.enabled_locales,
        allow_user_override: after.allow_user_override,
      },
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
    return await settingRepo.listPermissionHolders(db, 'platform.localization.update');
  } catch {
    return { roles: [], grants: [] };
  }
}
