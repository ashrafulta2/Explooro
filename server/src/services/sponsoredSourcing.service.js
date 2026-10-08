/**
 * sponsoredSourcing.service.js — The rules of the Sponsored Sourcing Slot.
 *
 * The slot is an ordinary CPC ad (`ad_products.sourcing_boost`) shown above the Sourcing Catalog.
 * Everything generic - pricing, billing, the second-price auction - stays in the ad engine. This file
 * owns only what is specific to selling to salers, and ties the slot to the Supplier Scorecard:
 *
 *   1. A supplier can only promote their OWN products here. Salers pick a supplier to build a store
 *      on; letting anyone push anyone's product into that list would be paid impersonation.
 *   2. A supplier graded in `blocked_grades` (default D) can neither buy the slot nor keep serving
 *      it. Charging a supplier the platform already measures as unreliable for access to salers would
 *      turn the platform's own scorecard into something money can override.
 *   3. The scorecard grade moves ad rank, not price: `grade_rank_bonus` is added to the campaign's
 *      quality multiplier, so an A supplier outranks a D one at the same bid and the auction still
 *      charges the second price. A supplier with no grade yet ("NEW") gets its own, neutral entry -
 *      being new is not the same as being bad.
 *
 * Every number comes from the `supplier.sponsored_sourcing` platform_settings row. The defaults
 * below only apply while that row is absent or unreadable.
 */

import { AppError } from '../plugins/errorHandler.js';
import * as repo from '../repositories/supplierScorecard.repository.js';

export const PLACEMENT = 'SOURCING_CATALOG';

const GRADES = ['A', 'B', 'C', 'D'];

export const DEFAULT_RULES = Object.freeze({
  max_slots: 2,
  grade_rank_bonus: Object.freeze({ A: 0.3, B: 0.15, C: 0, D: -0.25, NEW: 0 }),
  blocked_grades: Object.freeze(['D']),
});

/**
 * Merges a stored rules object over the defaults, field by field. A malformed field falls back to
 * its default rather than failing: one bad edit must not take the whole slot off sale.
 */
export function resolveRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;

  const max = Number(r.max_slots);
  const maxSlots = Number.isInteger(max) && max >= 0 && max <= 6 ? max : d.max_slots;

  const bonus = { ...d.grade_rank_bonus };
  for (const key of Object.keys(bonus)) {
    const v = r.grade_rank_bonus?.[key];
    // WHY a floor of -0.9: the bonus is added to a multiplier of 1, so -1 would zero a campaign's
    // rank and anything lower would flip its sign.
    if (typeof v === 'number' && Number.isFinite(v) && v >= -0.9 && v <= 2) bonus[key] = v;
  }

  const blocked = Array.isArray(r.blocked_grades)
    ? [...new Set(r.blocked_grades.filter((g) => GRADES.includes(g)))]
    : [...d.blocked_grades];

  return { max_slots: maxSlots, grade_rank_bonus: bonus, blocked_grades: blocked };
}

export async function loadRules(db) {
  try {
    return resolveRules(await repo.getSponsoredRulesRow(db));
  } catch {
    return resolveRules(null);
  }
}

/** Pure. The rank adjustment for a supplier's grade; `null` (no grade yet) maps to "NEW". */
export function qualityBonus(grade, rules) {
  return rules.grade_rank_bonus[grade ?? 'NEW'] ?? 0;
}

/** Pure. A supplier with no grade is never blocked: absence of data is not a bad score. */
export function isBlocked(grade, rules) {
  return grade != null && rules.blocked_grades.includes(grade);
}

async function gradesFor(db, supplierIds) {
  if (!supplierIds.length) return new Map();
  try {
    const rows = await repo.findByIds(db, supplierIds);
    return new Map(rows.map((r) => [String(r.supplier_id), r.grade ?? null]));
  } catch {
    // WHY swallow: before migration 062 is applied there is no table. Serving ungraded is the
    // correct behaviour then, and an ad lookup must never break the catalog.
    return new Map();
  }
}

/**
 * Narrows auction candidates to the ones this placement may serve and stamps each with the rank
 * bonus its supplier's grade earns. Drops a candidate when its supplier is in a blocked grade, or
 * its product can no longer be sold (inactive or out of stock - a saler who clicks a sponsored
 * card must be able to act on it, and the supplier must not pay for a click that cannot convert).
 */
export async function applyCandidatePolicy(db, candidates, rules) {
  const grades = await gradesFor(db, [...new Set(candidates.map((c) => c.user_id))]);
  const kept = [];
  for (const c of candidates) {
    const grade = grades.get(String(c.user_id)) ?? null;
    if (isBlocked(grade, rules)) continue;
    const product = c.product;
    if (!product || product.status !== 'ACTIVE' || !(Number(product.stock_qty) > 0)) continue;
    kept.push({ ...c, scorecard_grade: grade, quality_bonus: qualityBonus(grade, rules) });
  }
  return kept;
}

/**
 * Throws unless `userId` may buy the slot for `productId`. Called when a campaign is created.
 * Staff buying on a supplier's behalf (`isPrivileged`) skip the ownership check only.
 */
export async function assertMayAdvertise(db, userId, productId, { isPrivileged = false } = {}) {
  if (!productId) {
    throw new AppError(
      'PRODUCT_REQUIRED',
      'Pick the product this sourcing slot should promote.',
      'এই স্লটে কোন পণ্য প্রচার করবেন তা বেছে নিন।'
    );
  }

  const { rows } = await db.query(
    `SELECT supplier_id, status FROM products WHERE id = $1 AND deleted_at IS NULL`,
    [Number(productId)]
  );
  const product = rows[0];
  if (!product) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'পণ্যটি পাওয়া যায়নি।');
  }
  if (!isPrivileged && String(product.supplier_id) !== String(userId)) {
    throw new AppError(
      'SOURCING_PRODUCT_NOT_OWNED',
      'You can only promote your own products in the Sourcing Catalog.',
      'সোর্সিং ক্যাটালগে আপনি শুধু নিজের পণ্য প্রচার করতে পারবেন।'
    );
  }

  const rules = await loadRules(db);
  const grade = (await gradesFor(db, [product.supplier_id])).get(String(product.supplier_id)) ?? null;
  if (isBlocked(grade, rules)) {
    throw new AppError(
      'SUPPLIER_GRADE_BLOCKED',
      `Suppliers graded ${grade} on the Supplier Scorecard cannot buy this slot. Improve your scorecard and try again.`,
      `সাপ্লায়ার স্কোরকার্ডে ${grade} গ্রেডের সাপ্লায়াররা এই স্লট কিনতে পারেন না। স্কোরকার্ড উন্নত করে আবার চেষ্টা করুন।`
    );
  }
}
