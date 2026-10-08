/**
 * covisit.service.js — "Shoppers who opened this also opened that" (Phase E).
 *
 * Owns the co-visitation policy (the recommendation.covisit setting, sanitised per field) and the
 * rebuild that turns the behavioural event log into the product_covisits aggregate. The SQL of the
 * rebuild lives in repositories/covisit.repository.js; the SQL that READS the aggregate while ranking
 * lives with the rest of the blended score in repositories/recommendation.repository.js.
 *
 * Organic only, and aggregate only: the table keeps product pairs and an actor COUNT, never who the
 * actors were, and a pair needs `min_actors` distinct actors (never fewer than 2) to exist.
 */

import { withTransaction } from '../config/db.js';
import * as settingRepo from '../repositories/setting.repository.js';
import * as covisitRepo from '../repositories/covisit.repository.js';

export const SETTINGS_GROUP = 'recommendation';
export const COVISIT_KEY = 'recommendation.covisit';

/** Shipped defaults — the same numbers migration 059 seeds (test/covisit.test.js pins the parity). */
export const DEFAULT_COVISIT = Object.freeze({
  enabled: true,
  window_days: 60,
  min_actors: 3,
  max_related: 30,
  max_products_per_actor: 25,
  full_score: 0.3,
  seed_limit: 8,
});

export const COVISIT_LIMITS = Object.freeze({
  window_days: { min: 1, max: 365, integer: true },
  // WHY the floor is 2: a pair seen from one actor is that person's private browsing history, not a
  // pattern across shoppers.
  min_actors: { min: 2, max: 1000, integer: true },
  max_related: { min: 1, max: 200, integer: true },
  max_products_per_actor: { min: 2, max: 200, integer: true },
  full_score: { min: 0.01, max: 1 },
  seed_limit: { min: 1, max: 30, integer: true },
});

/** `pg` hands back JSONB parsed; a text column or a mock db may return a string. */
function readJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Keeps each value that is inside its range and replaces every other with its default — one bad key
 * must not discard the rest of an admin's tuning. `null` and '' are rejected explicitly because
 * Number(null) is 0, which would read an absent key as a real value.
 */
export function sanitizeCovisit(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_COVISIT.enabled };
  for (const [key, { min, max, integer }] of Object.entries(COVISIT_LIMITS)) {
    const n = src[key] === null || src[key] === '' || src[key] === undefined ? NaN : Number(src[key]);
    const valid = Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
    out[key] = valid ? n : DEFAULT_COVISIT[key];
  }
  return out;
}

/** The co-visitation policy out of a list of `recommendation` settings rows (already read by the caller). */
export function covisitFromSettingRows(rows) {
  const row = (rows || []).find((r) => r.key === COVISIT_KEY);
  return sanitizeCovisit(readJson(row?.value_json));
}

/** The live policy. An unreadable table or row yields the shipped defaults, never an error. */
export async function resolveCovisitConfig(db) {
  let rows = [];
  try {
    rows = await settingRepo.listSettingsByGroup(db, SETTINGS_GROUP);
  } catch {
    // Fresh clone that has not run migration 059 — the defaults are the right answer.
  }
  return covisitFromSettingRows(rows);
}

/**
 * The shopper's own products that co-visitation starts from: what they opened most recently, then
 * what they bought, without repeats, at most `seed_limit`. Empty when there is no history, which is
 * also what an opted-out shopper has (their spec carries no viewed or purchased ids).
 */
export function pickSeedIds({ viewedIds = [], purchasedIds = [] } = {}, config = DEFAULT_COVISIT) {
  const seen = new Set();
  const out = [];
  for (const id of [...viewedIds, ...purchasedIds]) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
    if (out.length >= config.seed_limit) break;
  }
  return out;
}

/**
 * Recomputes product_covisits from the event log.
 *
 * Pass a Pool and the rebuild runs in its own transaction (the job). Pass a checked-out client and it
 * joins the caller's transaction (tests, scripts) — WHY the Pool check is `totalCount`: a bare
 * pg.Client also has connect(), so that cannot tell the two apart.
 *
 * @returns {Promise<{skipped?: boolean, pairs: number, products: number}>}
 */
export async function rebuildCovisits(db, { config } = {}) {
  const cfg = config || (await resolveCovisitConfig(db));
  if (!cfg.enabled) return { skipped: true, pairs: 0, products: 0 };
  const run = (client) => covisitRepo.replaceCovisits(client, cfg);
  return typeof db.totalCount === 'number' ? withTransaction(db, run) : run(db);
}
