/**
 * diversity.service.js — Candidate pool + diversity re-rank for the personalized feed (Phase D).
 *
 * The blended score (recommendation.service.js) says how relevant each product is. It says nothing
 * about the LIST: ranked purely by score, a page can be eight products from one supplier, or six
 * shoes in a row, and the shopper's profile only ever reinforces itself. This pass runs after the
 * score and before the page is cut:
 *
 *   1. candidate pool — the top `pool_size` products by score (a light query: ids and ranking
 *      inputs, no images, variants or pricing). Everything below works on this pool.
 *   2. diversity     — walk the pool in score order; a product that would put more than
 *      `max_per_supplier` / `max_per_category` / `max_per_brand` of the same kind inside the last
 *      `window` picks is held back and the next product that fits is taken instead.
 *   3. exploration   — every `explore_every`-th slot goes to the best product that has nothing to do
 *      with the shopper's profile, so a person who looked at three phones is still shown the world.
 *
 * Nothing is ever dropped: a held-back product keeps its place in the queue and is taken the moment
 * it fits, and if nothing left fits (a catalog with one supplier) the best remaining product is
 * taken anyway. The pass reorders; it never shortens a list.
 *
 * Every number is a setting (migration 058, recommendation.diversity), range-checked on read.
 * Organic only: no paid placement goes through here (sponsored slots, if they ever exist, are a
 * separate, labelled injection — they must not be able to pass for an organic pick).
 */

import * as settingRepo from '../repositories/setting.repository.js';
import * as recommendation from './recommendation.service.js';

export const DIVERSITY_KEY = 'recommendation.diversity';

/** Shipped defaults — the same values migration 058 seeds (test/diversity.test.js pins the parity). */
export const DEFAULT_DIVERSITY = Object.freeze({
  enabled: true,
  pool_size: 120,
  window: 6,
  max_per_supplier: 2,
  max_per_category: 3,
  max_per_brand: 2,
  explore_every: 5,
});

// `explore_every` 0 switches exploration off; 1 would make every slot an exploration slot, so the
// smallest useful value is 2.
export const DIVERSITY_LIMITS = Object.freeze({
  pool_size: { min: 20, max: 500 },
  window: { min: 2, max: 30 },
  max_per_supplier: { min: 1, max: 30 },
  max_per_category: { min: 1, max: 30 },
  max_per_brand: { min: 1, max: 30 },
  explore_every: { min: 2, max: 50, allowZero: true },
});

/** Components that exist only because of who the shopper is — a product with none of them is "new to them". */
const PERSONAL_COMPONENTS = ['affinity_category', 'affinity_brand', 'affinity_supplier', 'recently_viewed'];

function boundedInt(raw, { min, max, allowZero = false }, fallback) {
  // WHY null/'' are rejected: Number(null) is 0, which would read an absent key as "off".
  const n = raw === null || raw === '' || raw === undefined ? NaN : Number(raw);
  if (!Number.isInteger(n)) return fallback;
  if (allowZero && n === 0) return 0;
  return n >= min && n <= max ? n : fallback;
}

/**
 * Keeps each value that is usable and replaces every other with its default — one bad field must
 * not discard the rest of an admin's tuning. Pure and exported so the (future) admin API and the
 * tests share one validator.
 */
export function sanitizeDiversity(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_DIVERSITY.enabled,
  };
  for (const key of Object.keys(DIVERSITY_LIMITS)) {
    out[key] = boundedInt(src[key], DIVERSITY_LIMITS[key], DEFAULT_DIVERSITY[key]);
  }
  return out;
}

function readJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The live diversity policy. An unreadable table or row yields the shipped defaults, never an error. */
export async function resolveDiversityConfig(db) {
  let rows = [];
  try {
    rows = await settingRepo.listSettingsByGroup(db, recommendation.SETTINGS_GROUP);
  } catch {
    // Fresh clone that has not run migration 058 — the defaults are the right answer.
  }
  const row = rows.find((r) => r.key === DIVERSITY_KEY);
  return sanitizeDiversity(readJson(row?.value_json));
}

const keyOf = (value) => (value === null || value === undefined || value === '' ? null : String(value).toLowerCase());

const isPersonalPick = (row) =>
  PERSONAL_COMPONENTS.some((name) => Number(row?.rank_components?.[name]) > 0);

/**
 * Re-orders a score-ranked candidate list. The input is NOT mutated and every input row appears
 * exactly once in the output.
 *
 * @param {object[]} candidates  best first; each carries supplier_id, category_id, brand and
 *                               (for exploration) rank_components
 * @param {object} config        a sanitised diversity config
 * @returns {object[]}
 */
export function diversify(candidates, config) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!config?.enabled || rows.length < 2) return rows.slice();

  const { window, max_per_supplier, max_per_category, max_per_brand, explore_every } = config;
  const queue = rows.slice();
  const out = [];

  /** How many of the last `window` picks share this value on this dimension. */
  const seen = (dimension, value) => {
    if (value === null) return 0;
    let count = 0;
    for (let i = Math.max(0, out.length - window); i < out.length; i++) {
      if (dimension(out[i]) === value) count++;
    }
    return count;
  };
  const supplierOf = (r) => keyOf(r.supplier_id);
  const categoryOf = (r) => keyOf(r.category_id);
  const brandOf = (r) => keyOf(r.brand);

  const fits = (row) =>
    seen(supplierOf, supplierOf(row)) < max_per_supplier &&
    seen(categoryOf, categoryOf(row)) < max_per_category &&
    seen(brandOf, brandOf(row)) < max_per_brand;

  // Does anything in the pool belong to this shopper? If nothing does there is nothing to explore
  // away from, and the exploration slots would only be a no-op dressed up as a decision.
  const hasProfile = explore_every > 0 && rows.some(isPersonalPick);

  while (queue.length) {
    let at = -1;
    // Exploration slot: the best product that fits AND is unrelated to the shopper's profile.
    if (hasProfile && (out.length + 1) % explore_every === 0) {
      at = queue.findIndex((row) => !isPersonalPick(row) && fits(row));
    }
    if (at < 0) at = queue.findIndex(fits);
    // Nothing fits (e.g. one supplier owns the whole pool): the best remaining product, unchanged.
    if (at < 0) at = 0;
    out.push(queue.splice(at, 1)[0]);
  }
  return out;
}
