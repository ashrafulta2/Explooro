/**
 * variantOptions.service.ts — which variant options (size, colour, weight, ...) each category offers.
 *
 * Configuration, not code: the `catalog.variant_options` row in platform_settings, edited at
 * /admin/catalog/variant-options. Shape: { categories: { "<category id>": ["weight", "pack_size"] } }.
 *
 * Resolution for a product's category: its own entry, else the nearest parent's, else every option.
 * WHY "every option" when nothing is set: the platform worked that way before this setting existed,
 * so an empty setting changes nothing, and an admin narrows only the categories that need it.
 *
 * productVariant.service.ts enforces the result on every save; the product form reads it from
 * GET /catalog/variant-options so it only offers what the save would accept.
 */

import { AppError } from '../plugins/errorHandler.ts';
import * as settingRepo from '../repositories/setting.repository.ts';
import { VARIANT_ATTRIBUTE_KEYS } from '../config/variantDimensions.ts';

export const SETTING_KEY = 'catalog.variant_options';
export const SETTINGS_GROUP = 'catalog';
export const MIN_REASON_LENGTH = 10;

const KNOWN = new Set<string>(VARIANT_ATTRIBUTE_KEYS);

type Rules = { categories: Record<string, string[]> };

const readJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const toMs = (v) => (v == null ? null : new Date(v).getTime());

/**
 * Forgiving read of a stored row: unknown options and malformed entries are dropped, never thrown,
 * so one bad hand edit cannot stop every supplier from saving variants.
 */
export function sanitizeRules(raw: unknown): Rules {
  const categories: Record<string, string[]> = {};
  const src = (raw as any)?.categories;
  if (src && typeof src === 'object') {
    for (const [id, list] of Object.entries(src)) {
      if (!/^\d+$/.test(id) || !Array.isArray(list)) continue;
      const clean = VARIANT_ATTRIBUTE_KEYS.filter((k) => list.includes(k));
      if (clean.length) categories[id] = clean;
    }
  }
  return { categories };
}

/**
 * Strict check of what an admin sent: refused, never trimmed, so the admin is never told something
 * was saved that was not. `categoryIds` are the ids that exist.
 */
export function validateRules(input: unknown, categoryIds: Array<number | string>): Rules {
  const src = (input as any)?.categories;
  if (!src || typeof src !== 'object' || Array.isArray(src)) {
    throw new AppError('VALIDATION_FAILED', 'Send the options as one list per category.', 'প্রতিটি ক্যাটেগরির জন্য একটি তালিকা পাঠান।', { field: 'categories' });
  }
  const exists = new Set(categoryIds.map(String));
  const categories: Record<string, string[]> = {};
  for (const [id, list] of Object.entries(src)) {
    if (!exists.has(id)) {
      throw new AppError('VALIDATION_FAILED', `Category ${id} does not exist.`, `ক্যাটেগরি ${id} নেই।`, { field: 'categories', category_id: id });
    }
    if (!Array.isArray(list) || list.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A category needs at least one option. To allow every option, remove its entry instead.',
        'একটি ক্যাটেগরিতে অন্তত একটি অপশন লাগবে। সব অপশন চালু রাখতে এর এন্ট্রি সরিয়ে দিন।',
        { field: 'categories', category_id: id }
      );
    }
    const bad = list.find((k) => !KNOWN.has(k));
    if (bad !== undefined) {
      throw new AppError('VALIDATION_FAILED', `"${bad}" is not a variant option.`, `"${bad}" কোনো ভ্যারিয়েন্ট অপশন নয়।`, { field: 'categories', category_id: id });
    }
    categories[id] = VARIANT_ATTRIBUTE_KEYS.filter((k) => list.includes(k));
  }
  return { categories };
}

/** The options a category offers: its own entry, else the nearest parent's, else all. Pure. */
export function resolveFor(rules: Rules, categoryId: number | string | null, parentOf: Map<string, string | null>): string[] {
  const seen = new Set<string>();
  let id = categoryId == null ? null : String(categoryId);
  while (id && !seen.has(id)) {
    seen.add(id); // a parent cycle in bad data must not loop forever
    if (rules.categories[id]) return rules.categories[id];
    id = parentOf.get(id) ?? null;
  }
  return [...VARIANT_ATTRIBUTE_KEYS];
}

async function loadParents(db): Promise<Map<string, string | null>> {
  const { rows } = await db.query(`SELECT id, parent_id FROM categories`);
  return new Map(rows.map((r) => [String(r.id), r.parent_id == null ? null : String(r.parent_id)]));
}

async function loadRow(db, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT value_json, updated_at, updated_by FROM platform_settings WHERE key = $1${lock ? ' FOR UPDATE' : ''}`,
    [SETTING_KEY]
  );
  return rows[0] ?? null;
}

/** The options the product form should offer, and the save will accept, for one category. */
export async function loadAllowedForCategory(db, categoryId): Promise<string[]> {
  const row = await loadRow(db);
  const rules = sanitizeRules(readJson(row?.value_json));
  if (Object.keys(rules.categories).length === 0) return [...VARIANT_ATTRIBUTE_KEYS];
  return resolveFor(rules, categoryId, await loadParents(db));
}

/** Everything the admin page draws: the categories, the stored rules, and the version to save against. */
export async function getPolicy(db) {
  const [row, cats] = await Promise.all([
    loadRow(db),
    db.query(`SELECT id, parent_id, name_en, name_bn, is_active FROM categories ORDER BY parent_id NULLS FIRST, display_order, name_en`),
  ]);
  return {
    rules: sanitizeRules(readJson(row?.value_json)),
    options: [...VARIANT_ATTRIBUTE_KEYS],
    categories: cats.rows.map((c) => ({ id: Number(c.id), parent_id: c.parent_id == null ? null : Number(c.parent_id), name_en: c.name_en, name_bn: c.name_bn, is_active: c.is_active })),
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

/**
 * Saves the rules. `baseUpdatedAt` is the version the form was loaded with: if the row moved since,
 * the save is refused with CONFLICT instead of silently overwriting another admin's change.
 * One audit row with before/after and the reason.
 */
export async function updatePolicy(
  db,
  auditService,
  { rules, reason, baseUpdatedAt, userId = null, actorRole = null, reqContext = {} as Record<string, any> }
) {
  if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Give a reason of at least ${MIN_REASON_LENGTH} characters for this change.`,
      `এই পরিবর্তনের জন্য অন্তত ${MIN_REASON_LENGTH} অক্ষরের একটি কারণ লিখুন।`,
      { field: 'reason' }
    );
  }

  const client = db.connect ? await db.connect() : db;
  const dedicated = Boolean(db.connect);
  let before;
  let after;
  let saved;
  try {
    if (dedicated) await client.query('BEGIN');
    const parents = await loadParents(client);
    const next = validateRules(rules, [...parents.keys()]);
    const current = await loadRow(client, { lock: true });
    if (baseUpdatedAt !== undefined && toMs(baseUpdatedAt) !== toMs(current?.updated_at)) {
      throw new AppError(
        'CONFLICT',
        'Someone else changed these options after you opened the page. Reload to see their change, then apply yours again.',
        'আপনি পেজটি খোলার পর অন্য কেউ এই অপশনগুলো বদলেছেন। তাঁর পরিবর্তন দেখতে রিলোড করে আবার আপনার পরিবর্তন করুন।',
        { field: 'base_updated_at' }
      );
    }
    before = sanitizeRules(readJson(current?.value_json));
    saved = await settingRepo.upsertSetting(client, {
      key: SETTING_KEY,
      valueJson: next,
      valueType: 'OBJECT',
      labelEn: 'Variant options per category',
      labelBn: 'ক্যাটেগরি অনুযায়ী ভ্যারিয়েন্ট অপশন',
      groupKey: SETTINGS_GROUP,
      updatedBy: userId,
    });
    after = sanitizeRules(readJson(saved.value_json));
    if (auditService?.record) {
      await auditService.record(client, {
        action: 'catalog.variant_options.update',
        targetType: 'platform_settings',
        targetRef: SETTING_KEY,
        beforeJson: before,
        afterJson: after,
        meta: { reason: reason.trim() },
        riskTier: 'MEDIUM',
        actorId: userId,
        actorRole,
        ip: reqContext.ip ?? null,
        userAgent: reqContext.userAgent ?? null,
        traceId: reqContext.traceId ?? null,
      });
    }
    if (dedicated) await client.query('COMMIT');
  } catch (err) {
    if (dedicated) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (dedicated && client.release) client.release();
  }
  return { rules: after, updated_at: saved.updated_at, updated_by: saved.updated_by };
}
