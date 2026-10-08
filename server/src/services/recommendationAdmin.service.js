/**
 * recommendationAdmin.service.js — the operator's hands on the personalized home feed (Phase G).
 *
 * Phases B–F made every number of the feed a `platform_settings` row in group `recommendation`:
 * the blend weights and tuning (056), the rail layout (057), diversity (058), co-visitation (059)
 * and the cache (060). Each service reads its row through its own sanitiser, which is deliberately
 * forgiving — a bad field falls back to its default so a hand-edited row can never break the page.
 *
 * Writing needs the opposite. A person who types 900 into a field that tops out at 20 should be told
 * "no", not have the field quietly keep its old value and see "saved". So this file adds a STRICT
 * validator per section on top of the same limits the readers use (it imports them; there is no
 * second copy of any bound to drift), and a write is accepted only if it is already exactly what the
 * reader would have made of it.
 *
 * One section per call, one transaction, one audit row carrying that section's before/after.
 */

import * as settingRepo from '../repositories/setting.repository.js';
import { AppError } from '../plugins/errorHandler.js';
import * as recommendation from './recommendation.service.js';
import * as homeRails from './homeRails.service.js';
import * as diversity from './diversity.service.js';
import * as covisit from './covisit.service.js';
import * as recoCache from './recoCache.service.js';

export const SETTINGS_GROUP = 'recommendation';
export const AUDIT_ACTION = 'platform.recommendation.update';
export const VIEW_PERMISSION = 'platform.recommendation.view';
export const UPDATE_PERMISSION = 'platform.recommendation.update';
export const MIN_REASON_LENGTH = 10;

// ── Field specs ────────────────────────────────────────────────────────────────────────────────
// A field is { key, type: 'bool' | 'int' | 'number', min, max, allowZero?, default }. Built from the
// limits the readers already export, so the form the page draws and the check the API runs are the
// same object.

const bool = (key, dflt) => ({ key, type: 'bool', default: dflt });
const num = (key, dflt, { min, max, integer = false, allowZero = false }) => ({
  key,
  type: integer ? 'int' : 'number',
  min,
  max,
  ...(allowZero ? { allowZero: true } : {}),
  default: dflt,
});

const weightFields = Object.keys(recommendation.DEFAULT_WEIGHTS).map((key) =>
  num(key, recommendation.DEFAULT_WEIGHTS[key], recommendation.WEIGHT_LIMITS)
);
const tuningFields = Object.keys(recommendation.DEFAULT_TUNING).map((key) =>
  num(key, recommendation.DEFAULT_TUNING[key], recommendation.TUNING_LIMITS[key])
);
const diversityFields = [
  bool('enabled', diversity.DEFAULT_DIVERSITY.enabled),
  ...Object.keys(diversity.DIVERSITY_LIMITS).map((key) =>
    num(key, diversity.DEFAULT_DIVERSITY[key], { ...diversity.DIVERSITY_LIMITS[key], integer: true })
  ),
];
const covisitFields = [
  bool('enabled', covisit.DEFAULT_COVISIT.enabled),
  ...Object.keys(covisit.COVISIT_LIMITS).map((key) =>
    num(key, covisit.DEFAULT_COVISIT[key], covisit.COVISIT_LIMITS[key])
  ),
];
const cacheFields = [
  bool('enabled', recoCache.DEFAULT_CACHE.enabled),
  ...Object.keys(recoCache.CACHE_LIMITS).map((key) =>
    num(key, recoCache.DEFAULT_CACHE[key], { ...recoCache.CACHE_LIMITS[key], integer: true })
  ),
];

/** A weight on a penalty subtracts; every other weight is a positive signal that lifts a product. */
const isPenalty = (key) => key.endsWith('_penalty');

/**
 * The sections, in the order the page shows them.
 *   rowKey   the platform_settings key
 *   sanitize the reader's forgiving sanitiser (what the system actually runs)
 *   defaults the shipped values (what "Reset" restores)
 *   fields   the form (omitted for `rails`, which is a list)
 */
export const SECTIONS = Object.freeze({
  weights: {
    rowKey: recommendation.WEIGHTS_KEY,
    sanitize: recommendation.sanitizeWeights,
    defaults: recommendation.DEFAULT_WEIGHTS,
    fields: weightFields,
    labelEn: 'Personalized feed — signal weights',
    labelBn: 'পার্সোনালাইজড ফিড — সিগন্যালের ওজন',
  },
  tuning: {
    rowKey: recommendation.TUNING_KEY,
    sanitize: recommendation.sanitizeTuning,
    defaults: recommendation.DEFAULT_TUNING,
    fields: tuningFields,
    labelEn: 'Personalized feed — signal windows and caps',
    labelBn: 'পার্সোনালাইজড ফিড — সিগন্যালের সময়সীমা ও সীমা',
  },
  rails: {
    rowKey: homeRails.RAILS_KEY,
    sanitize: homeRails.sanitizeRailsConfig,
    defaults: homeRails.DEFAULT_RAILS_CONFIG,
    labelEn: 'Home page rails',
    labelBn: 'হোম পেজের রেল',
  },
  diversity: {
    rowKey: diversity.DIVERSITY_KEY,
    sanitize: diversity.sanitizeDiversity,
    defaults: diversity.DEFAULT_DIVERSITY,
    fields: diversityFields,
    labelEn: 'Personalized feed — diversity',
    labelBn: 'পার্সোনালাইজড ফিড — বৈচিত্র্য',
  },
  covisit: {
    rowKey: covisit.COVISIT_KEY,
    sanitize: covisit.sanitizeCovisit,
    defaults: covisit.DEFAULT_COVISIT,
    fields: covisitFields,
    labelEn: 'Personalized feed — shoppers also viewed',
    labelBn: 'পার্সোনালাইজড ফিড — যারা দেখেছেন তারা আরও দেখেছেন',
  },
  cache: {
    rowKey: recoCache.CACHE_KEY,
    sanitize: recoCache.sanitizeCache,
    defaults: recoCache.DEFAULT_CACHE,
    fields: cacheFields,
    labelEn: 'Personalized feed — cache',
    labelBn: 'পার্সোনালাইজড ফিড — ক্যাশ',
  },
});

export const SECTION_KEYS = Object.freeze(Object.keys(SECTIONS));

/** What the page needs to draw a rail's row: whether it has a freshness window and what it depends on. */
export const RAIL_CATALOGUE = Object.freeze(
  homeRails.RAIL_KEYS.map((key) => ({
    key,
    needs: homeRails.RAIL_PROFILES[key].needs ?? null,
    has_window: Boolean(homeRails.RAIL_PROFILES[key].fresh),
  }))
);

// ── Strict validation ──────────────────────────────────────────────────────────────────────────

const invalid = (field, en, bn, extra = {}) =>
  new AppError('VALIDATION_FAILED', en, bn, { field, ...extra });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkField(spec, raw, path) {
  const where = path ? `${path}.${spec.key}` : spec.key;
  if (spec.type === 'bool') {
    if (typeof raw !== 'boolean') {
      throw invalid(where, `${where} must be true or false.`, `${where} অবশ্যই true অথবা false হতে হবে।`);
    }
    return raw;
  }
  // WHY typeof: Number('12') is 12 and Number(null) is 0, either of which would turn a missing or
  // mistyped field into a value the admin never entered.
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw invalid(where, `${where} must be a number.`, `${where} অবশ্যই একটি সংখ্যা হতে হবে।`);
  }
  if (spec.type === 'int' && !Number.isInteger(raw)) {
    throw invalid(where, `${where} must be a whole number.`, `${where} অবশ্যই পূর্ণসংখ্যা হতে হবে।`);
  }
  const zeroOk = spec.allowZero && raw === 0;
  if (!zeroOk && (raw < spec.min || raw > spec.max)) {
    const lo = spec.allowZero ? `0 or ${spec.min}` : String(spec.min);
    throw invalid(
      where,
      `${where} must be between ${lo} and ${spec.max}.`,
      `${where} অবশ্যই ${lo} থেকে ${spec.max}-এর মধ্যে হতে হবে।`,
      { min: spec.min, max: spec.max }
    );
  }
  return raw;
}

/** A flat object: exactly the section's fields, no more and no fewer. */
function validateFlat(section, value) {
  if (!isPlainObject(value)) {
    throw invalid('value', 'The settings must be an object.', 'সেটিংস অবশ্যই একটি অবজেক্ট হতে হবে।');
  }
  const known = new Set(section.fields.map((f) => f.key));
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      throw invalid(key, `Unknown setting "${key}".`, `অজানা সেটিং "${key}"।`);
    }
  }
  const out = {};
  for (const spec of section.fields) {
    if (!(spec.key in value)) {
      throw invalid(spec.key, `${spec.key} is missing.`, `${spec.key} দেওয়া হয়নি।`);
    }
    out[spec.key] = checkField(spec, value[spec.key]);
  }
  return out;
}

function validateWeights(section, value) {
  const out = validateFlat(section, value);
  // WHY: with every positive signal at 0 every product scores the same minus penalties, so the feed
  // would be an arbitrary order that still wears the name "personalized".
  const anyPositive = section.fields.some((f) => !isPenalty(f.key) && out[f.key] > 0);
  if (!anyPositive) {
    throw invalid(
      'value',
      'At least one signal weight (other than a penalty) must be above 0, or the feed has no order.',
      'অন্তত একটি সিগন্যালের ওজন (পেনাল্টি বাদে) ০-র বেশি হতে হবে, নইলে ফিডের কোনো ক্রম থাকে না।'
    );
  }
  return out;
}

function validateRails(_section, value) {
  if (!isPlainObject(value)) {
    throw invalid('value', 'The settings must be an object.', 'সেটিংস অবশ্যই একটি অবজেক্ট হতে হবে।');
  }
  for (const key of Object.keys(value)) {
    if (key !== 'min_items' && key !== 'rails') {
      throw invalid(key, `Unknown setting "${key}".`, `অজানা সেটিং "${key}"।`);
    }
  }
  const min_items = checkField(
    { key: 'min_items', type: 'int', ...homeRails.RAIL_LIMITS.min_items },
    value.min_items
  );
  if (!Array.isArray(value.rails)) {
    throw invalid('rails', 'rails must be a list.', 'rails অবশ্যই একটি তালিকা হতে হবে।');
  }
  const seen = new Set();
  const rails = value.rails.map((item, i) => {
    const path = `rails[${i}]`;
    if (!isPlainObject(item)) {
      throw invalid(path, `${path} must be an object.`, `${path} অবশ্যই একটি অবজেক্ট হতে হবে।`);
    }
    const profile = homeRails.RAIL_PROFILES[item.key];
    if (!profile) {
      throw invalid(`${path}.key`, `Unknown rail "${item.key}".`, `অজানা রেল "${item.key}"।`);
    }
    if (seen.has(item.key)) {
      throw invalid(`${path}.key`, `Rail "${item.key}" appears twice.`, `রেল "${item.key}" দুইবার আছে।`);
    }
    seen.add(item.key);
    const allowed = new Set(['key', 'enabled', 'limit', ...(profile.fresh ? ['window_days'] : [])]);
    for (const k of Object.keys(item)) {
      if (!allowed.has(k)) {
        throw invalid(`${path}.${k}`, `"${k}" does not apply to the ${item.key} rail.`, `"${k}" ${item.key} রেলের জন্য প্রযোজ্য নয়।`);
      }
    }
    const rail = {
      key: item.key,
      enabled: checkField({ key: 'enabled', type: 'bool' }, item.enabled, path),
      limit: checkField({ key: 'limit', type: 'int', ...homeRails.RAIL_LIMITS.limit }, item.limit, path),
    };
    if (profile.fresh) {
      rail.window_days = checkField(
        { key: 'window_days', type: 'int', ...homeRails.RAIL_LIMITS.window_days },
        item.window_days,
        path
      );
    }
    return rail;
  });
  return { min_items, rails };
}

const VALIDATORS = { weights: validateWeights, rails: validateRails };

/**
 * Validates one section's proposed value and returns the normalized object to store. Pure and
 * exported so the API and the tests assert one set of rules.
 */
export function validateSection(name, value) {
  const section = SECTIONS[name];
  if (!section) {
    throw invalid('section', `Unknown section "${name}".`, `অজানা বিভাগ "${name}"।`, { supported: SECTION_KEYS });
  }
  const checked = (VALIDATORS[name] || validateFlat)(section, value);
  // Belt and braces: what we are about to store must survive the reader unchanged. If it did not, the
  // validator and the reader disagree, and the admin would see a value other than the one they saved.
  if (JSON.stringify(section.sanitize(checked)) !== JSON.stringify(checked)) {
    throw invalid('value', 'That value is not accepted by the feed.', 'ফিড এই মানটি গ্রহণ করে না।');
  }
  return checked;
}

// ── Reading ────────────────────────────────────────────────────────────────────────────────────

function readJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Key-order-insensitive structural equality. WHY not JSON.stringify: Postgres JSONB does not keep the
 * order keys were written in (it stores them shortest-first, then alphabetically), so a perfectly
 * healthy stored row never stringifies the way the sanitiser's output does — and every section would be
 * reported as "has out-of-range values". Caught against the real database; a mock that keeps insertion
 * order cannot show it. Arrays keep their order: the order of the rails is the layout.
 */
const canonical = (v) =>
  JSON.stringify(v, (_key, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val
  );
const sameJson = (a, b) => canonical(a) === canonical(b);

/** Public description of a field, without the server-only parts. */
const describeField = ({ key, type, min, max, allowZero, default: dflt }) => ({
  key,
  type,
  ...(min !== undefined ? { min, max } : {}),
  ...(allowZero ? { allow_zero: true } : {}),
  default: dflt,
  ...(type !== 'bool' && isPenalty(key) ? { penalty: true } : {}),
});

function describeSection(name, rowsByKey) {
  const section = SECTIONS[name];
  const row = rowsByKey.get(section.rowKey);
  const stored = readJson(row?.value_json);
  const value = section.sanitize(stored);
  return {
    key: name,
    label_en: section.labelEn,
    label_bn: section.labelBn,
    value,
    defaults: section.defaults,
    // A row that is missing runs on the shipped defaults; a row that exists but is out of range runs on
    // the sanitised mix. Both are worth saying out loud on the page.
    is_default: !row,
    has_fallbacks: Boolean(row) && !sameJson(stored, value),
    fields: section.fields ? section.fields.map(describeField) : undefined,
    ...(name === 'rails' ? { catalogue: RAIL_CATALOGUE, limits: homeRails.RAIL_LIMITS } : {}),
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

/** Every section as the system is running it right now, read straight from the table (never cached). */
export async function getSettings(db) {
  let rows = [];
  try {
    rows = await settingRepo.listSettingsByGroup(db, SETTINGS_GROUP);
  } catch {
    // A fresh clone that has not migrated: show the shipped defaults, which is also what runs.
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SECTION_KEYS.map((name) => describeSection(name, byKey));
}

/** The roster behind "who can change this". */
export async function getUpdateAuthority(db) {
  try {
    return await settingRepo.listPermissionHolders(db, UPDATE_PERMISSION);
  } catch {
    return { roles: [], grants: [] };
  }
}

// ── Writing ────────────────────────────────────────────────────────────────────────────────────

const toMs = (v) => (v ? new Date(v).getTime() : null);

/**
 * Saves one section.
 *
 * `baseUpdatedAt` is the `updated_at` the form was loaded with (null for a section still on defaults).
 * When it is given and the row has moved since, the save is refused with CONFLICT instead of silently
 * overwriting the other admin's change — the audit trail would show it, but the edit would be lost.
 * `undefined` skips the check for callers that do not track it.
 */
export async function updateSection(
  db,
  cache,
  auditService,
  { section: name, value, reason, baseUpdatedAt, userId, actorRole = null, reqContext = {} }
) {
  const section = SECTIONS[name];
  const next = validateSection(name, value);

  if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
    throw invalid(
      'reason',
      `Give a reason of at least ${MIN_REASON_LENGTH} characters for this change.`,
      `এই পরিবর্তনের জন্য অন্তত ${MIN_REASON_LENGTH} অক্ষরের একটি কারণ লিখুন।`
    );
  }

  const client = db.connect ? await db.connect() : db;
  const dedicated = Boolean(db.connect);

  let before;
  let after;
  let saved;
  try {
    if (dedicated) await client.query('BEGIN');

    // Serialises two admins saving at once, so `before` is always a state that really existed.
    await settingRepo.lockSettingsGroup(client, SETTINGS_GROUP);
    const current = (await settingRepo.listSettingsByGroup(client, SETTINGS_GROUP)).find((r) => r.key === section.rowKey);

    if (baseUpdatedAt !== undefined && toMs(baseUpdatedAt) !== toMs(current?.updated_at)) {
      throw new AppError(
        'CONFLICT',
        'Someone else changed this section after you opened it. Reload to see their change, then apply yours again.',
        'আপনি খোলার পর অন্য কেউ এই বিভাগটি বদলেছেন। তাঁর পরিবর্তন দেখতে পেজটি রিলোড করে আবার আপনার পরিবর্তন করুন।',
        { field: 'base_updated_at' }
      );
    }

    before = section.sanitize(readJson(current?.value_json));

    saved = await settingRepo.upsertSetting(client, {
      key: section.rowKey,
      valueJson: next,
      valueType: 'OBJECT',
      labelEn: section.labelEn,
      labelBn: section.labelBn,
      groupKey: SETTINGS_GROUP,
      updatedBy: userId ?? null,
    });
    after = section.sanitize(readJson(saved?.value_json) ?? next);

    if (dedicated) await client.query('COMMIT');
  } catch (err) {
    if (dedicated) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (dedicated && client.release) client.release();
  }

  // WHY after the commit: dropping the snapshot first would let a concurrent request re-read the
  // OLD row and re-cache it for settings_ttl_seconds. The pool cache needs nothing — its key hashes
  // the whole ranking query, so a changed weight or size is already a different key.
  await recoCache.invalidateSettings(cache);

  if (auditService?.record) {
    await auditService.record(db, {
      action: AUDIT_ACTION,
      targetType: 'platform_settings',
      targetRef: section.rowKey,
      beforeJson: { section: name, value: before },
      afterJson: { section: name, value: after },
      meta: { reason: reason.trim() },
      riskTier: 'MEDIUM',
      actorId: userId ?? null,
      actorRole,
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
  }

  return describeSection(name, new Map([[section.rowKey, saved]]));
}
