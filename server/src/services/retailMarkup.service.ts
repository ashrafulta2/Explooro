/**
 * retailMarkup.service.ts — the one place a product's retail price is derived from the supplier's price.
 *
 * Owner decision 2026-10-31: a supplier enters only the price they want per unit. The platform sets
 * the retail price everyone sees: supplier price + markup %, rounded UP to `round_to_bdt` taka.
 *   - `pricing.markup` (platform_settings, migration 094): the default markup % and the rounding step.
 *   - `category_markups`: a per-category markup % that replaces the default for that category.
 * The margin (retail − supplier price) is then split by the partner share as before
 * (product.service `defaultPartnerProfit`).
 *
 * WHY round up, never to nearest: rounding down could leave a retail price that does not cover the
 * markup the admin set; rounding up only ever widens the margin.
 *
 * The client mirrors `retailFromSupplierPrice` in `client/src/services/retailMarkup.ts` so the supplier
 * form can quote the price live; `server/test/retailMarkup.test.js` fails if the two disagree.
 */

import { AppError } from '../plugins/errorHandler.ts';
import { writeAudit } from '../lib/audit.ts';
import { resolvePlatformPricingConfig, toPaisa } from './pricing.service.ts';

export const SETTING_KEY = 'pricing.markup';

export const DEFAULT_MARKUP = Object.freeze({ default_markup_pct: 15, round_to_bdt: 10 });

/** Write bounds. markup_pct also bounds category_markups (its CHECK in migration 094 must match). */
export const MARKUP_LIMITS = Object.freeze({
  markup_pct: { min: 0, max: 300 },
  round_to_bdt: { min: 0, max: 1000 },
});

export interface MarkupPolicy {
  default_markup_pct: number;
  round_to_bdt: number;
  /** category id → markup %, only categories with an override. */
  categories: Record<string, number>;
}

/**
 * Pure. Retail price (BDT) for a supplier price, a markup % and a rounding step. Paisa throughout so
 * the result matches what is stored in NUMERIC(14,2). A step of 0 means no rounding.
 */
export function retailFromSupplierPrice(supplierPrice: number | string, markupPct: number, roundToBdt: number): number {
  const pricePaisa = toPaisa(supplierPrice);
  const rawPaisa = Math.round((pricePaisa * (100 + Number(markupPct || 0))) / 100);
  const stepPaisa = Math.round(Number(roundToBdt || 0) * 100);
  const retailPaisa = stepPaisa > 0 ? Math.ceil(rawPaisa / stepPaisa) * stepPaisa : rawPaisa;
  return retailPaisa / 100;
}

/** Pure. The markup a category uses: its override, else the default. */
export function markupForCategory(policy: MarkupPolicy, categoryId: unknown): number {
  const key = categoryId == null ? '' : String(categoryId);
  return key && policy.categories[key] !== undefined ? policy.categories[key] : policy.default_markup_pct;
}

// WHY forgiving on read, strict on write: a hand-edited row must not take the catalog down, but the
// admin page can never store a value outside the bounds.
function readNumber(value: unknown, fallback: number, { min, max }: { min: number; max: number }): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export async function loadMarkupPolicy(db): Promise<MarkupPolicy> {
  const [{ rows: settingRows }, { rows: catRows }] = await Promise.all([
    db.query(`SELECT value_json FROM platform_settings WHERE key = $1`, [SETTING_KEY]),
    db.query(`SELECT category_id, markup_pct FROM category_markups`),
  ]);
  const value = settingRows[0]?.value_json || {};
  const categories: Record<string, number> = {};
  for (const r of catRows) categories[String(r.category_id)] = Number(r.markup_pct);
  return {
    default_markup_pct: readNumber(value.default_markup_pct, DEFAULT_MARKUP.default_markup_pct, MARKUP_LIMITS.markup_pct),
    round_to_bdt: readNumber(value.round_to_bdt, DEFAULT_MARKUP.round_to_bdt, MARKUP_LIMITS.round_to_bdt),
    categories,
  };
}

/**
 * The settings the price-conflict warnings need (client/src/services/pricingConflicts.ts): markups,
 * the partner share, the platform minimum and the category names. Sent by every admin page that sets a
 * price or a discount, so each can warn about a clash with settings that live on another page.
 */
export async function loadPricingContext(db) {
  const [markup, split, { rows: categories }] = await Promise.all([
    loadMarkupPolicy(db),
    resolvePlatformPricingConfig(db),
    db.query(`SELECT id, name_en, name_bn FROM categories ORDER BY id`),
  ]);
  return {
    markup: { default_markup_pct: markup.default_markup_pct, categories: markup.categories },
    split: { saler_split_pct: split.salerSplitPct, platform_default_profit_pct: split.platformDefaultProfitPct },
    categories,
  };
}

/** The retail price a supplier price gets in a category, with the markup that produced it. */
export async function quoteRetail(db, { supplierPrice, categoryId }): Promise<{ retail: number; markup_pct: number; round_to_bdt: number }> {
  const policy = await loadMarkupPolicy(db);
  const markup = markupForCategory(policy, categoryId);
  return { retail: retailFromSupplierPrice(supplierPrice, markup, policy.round_to_bdt), markup_pct: markup, round_to_bdt: policy.round_to_bdt };
}

function strictNumber(value: unknown, field: string, { min, max }: { min: number; max: number }, integer = false): number {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new AppError(
      'VALIDATION_FAILED',
      `${field} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`,
      `${field} অবশ্যই ${min} থেকে ${max} এর মধ্যে ${integer ? 'পূর্ণ সংখ্যা ' : ''}হতে হবে।`,
      { field }
    );
  }
  return n;
}

function requireReason(reason: unknown): string {
  const text = String(reason ?? '').trim();
  if (!text) throw new AppError('VALIDATION_FAILED', 'A reason is required.', 'একটি কারণ লিখতে হবে।', { field: 'reason' });
  return text;
}

export async function saveDefaultMarkup(db, { defaultMarkupPct, roundToBdt, reason, actorId }) {
  const next = {
    default_markup_pct: strictNumber(defaultMarkupPct, 'default_markup_pct', MARKUP_LIMITS.markup_pct),
    round_to_bdt: strictNumber(roundToBdt, 'round_to_bdt', MARKUP_LIMITS.round_to_bdt, true),
  };
  const why = requireReason(reason);
  const before = await loadMarkupPolicy(db);
  await db.query(
    `INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, updated_at)
     VALUES ($1, $2::jsonb, 'OBJECT', 'Retail price markup', 'খুচরা মূল্যের markup', 'finance', now())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = now()`,
    [SETTING_KEY, JSON.stringify(next)]
  );
  await writeAudit(db, {
    action: 'finance.markup.update',
    targetType: 'PROFIT_SPLIT',
    targetRef: 'MARKUP:GLOBAL',
    actorId,
    before: { default_markup_pct: before.default_markup_pct, round_to_bdt: before.round_to_bdt },
    after: { ...next, meta: { reason: why } },
  });
  return next;
}

export async function setCategoryMarkup(db, { categoryId, markupPct, reason, actorId }) {
  const id = strictNumber(categoryId, 'category_id', { min: 1, max: Number.MAX_SAFE_INTEGER }, true);
  const pct = strictNumber(markupPct, 'markup_pct', MARKUP_LIMITS.markup_pct);
  const why = requireReason(reason);
  const { rows: cat } = await db.query(`SELECT id FROM categories WHERE id = $1`, [id]);
  if (!cat.length) throw new AppError('NOT_FOUND', 'Category not found.', 'ক্যাটাগরি পাওয়া যায়নি।');
  const { rows: prev } = await db.query(`SELECT markup_pct FROM category_markups WHERE category_id = $1`, [id]);
  await db.query(
    `INSERT INTO category_markups (category_id, markup_pct, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (category_id) DO UPDATE SET markup_pct = EXCLUDED.markup_pct, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [id, pct, actorId ?? null]
  );
  await writeAudit(db, {
    action: 'finance.markup.category_update',
    targetType: 'PROFIT_SPLIT',
    targetRef: `MARKUP:CATEGORY:${id}`,
    actorId,
    before: { markup_pct: prev[0] ? Number(prev[0].markup_pct) : null },
    after: { markup_pct: pct, meta: { reason: why } },
  });
  return { category_id: id, markup_pct: pct };
}

export async function clearCategoryMarkup(db, { categoryId, reason, actorId }) {
  const id = strictNumber(categoryId, 'category_id', { min: 1, max: Number.MAX_SAFE_INTEGER }, true);
  const why = requireReason(reason);
  const { rows: prev } = await db.query(`DELETE FROM category_markups WHERE category_id = $1 RETURNING markup_pct`, [id]);
  await writeAudit(db, {
    action: 'finance.markup.category_reset',
    targetType: 'PROFIT_SPLIT',
    targetRef: `MARKUP:CATEGORY:${id}`,
    actorId,
    before: { markup_pct: prev[0] ? Number(prev[0].markup_pct) : null },
    after: { markup_pct: null, meta: { reason: why } },
  });
  return { category_id: id, reset: prev.length > 0 };
}
