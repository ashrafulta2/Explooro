/**
 * homeRails.service.js — The themed rails on the home page (Phase C of the personalized feed).
 *
 * A rail is a slice of the same blended ranking the swipe feed uses (recommendation.service.js),
 * looking at one idea at a time: what is trending, what sells, what is new, what is near you, what
 * you were just looking at. A rail picks WHICH signals it listens to; HOW MUCH each signal counts is
 * still the admin's recommendation.weights, so retuning the ranking retunes every rail.
 *
 * Which rails appear, their order and sizes are settings too (migration 057, recommendation.rails).
 *
 * Organic only: nothing here reads ad spend. A paid placement, when one exists, is injected and
 * labelled separately (Phase D) so it can never pass for an organic pick.
 */

import * as settingRepo from '../repositories/setting.repository.js';
import * as productService from './product.service.js';
import * as discoveryFeed from './discoveryFeed.service.js';
import * as recommendation from './recommendation.service.js';

export const RAILS_KEY = 'recommendation.rails';

// ── Rail catalogue (structure, not business numbers) ───────────────────────────────────────────
//
// `signals`  the positive signals this rail ranks by; every other positive signal is switched off for
//            it. Penalties (out of stock, returns, already bought) always stay on.
// `require`  a rail named after a cause must be earned by it: a "Trending" rail that fills up with
//            products nothing is trending about would be a false label, so a row needs a positive
//            contribution from one of these components to qualify.
// `needs`    what the rail cannot work without; a rail missing it is skipped, not faked.
export const RAIL_PROFILES = Object.freeze({
  continue_browsing: { needs: 'viewed' },
  for_you: { signals: null },
  trending: { signals: ['trending', 'recent_sales', 'quality'], require: ['trending'] },
  bestsellers: { signals: ['bestseller', 'recent_sales', 'quality'], require: ['bestseller', 'recent_sales'] },
  new_arrivals: { signals: ['freshness', 'quality'], fresh: true },
  near_you: { signals: ['locality', 'quality', 'bestseller'], require: ['locality'], needs: 'district' },
});

export const RAIL_KEYS = Object.freeze(Object.keys(RAIL_PROFILES));

// The signals a profile may switch off. Anything else in the weights object is a penalty.
const POSITIVE_SIGNALS = [
  'affinity_category',
  'affinity_brand',
  'affinity_supplier',
  'recently_viewed',
  'trending',
  'bestseller',
  'recent_sales',
  'quality',
  'freshness',
  'trust_tier',
  'locality',
];

/** Shipped defaults — the same values migration 057 seeds (test/homeRails.test.js pins the parity). */
export const DEFAULT_RAILS_CONFIG = Object.freeze({
  min_items: 4,
  rails: Object.freeze([
    Object.freeze({ key: 'continue_browsing', enabled: true, limit: 10 }),
    Object.freeze({ key: 'for_you', enabled: true, limit: 12 }),
    Object.freeze({ key: 'trending', enabled: true, limit: 12 }),
    Object.freeze({ key: 'bestsellers', enabled: true, limit: 12 }),
    Object.freeze({ key: 'new_arrivals', enabled: true, limit: 12, window_days: 30 }),
    Object.freeze({ key: 'near_you', enabled: true, limit: 12 }),
  ]),
});

export const RAIL_LIMITS = Object.freeze({
  limit: { min: 1, max: 30 },
  min_items: { min: 1, max: 30 },
  window_days: { min: 1, max: 365 },
});

// Bounds one catalog query's size no matter what the settings say: every rail is a full ranking.
const MAX_FETCH = 60;

const defaultRail = (key) => DEFAULT_RAILS_CONFIG.rails.find((r) => r.key === key);

function boundedInt(raw, { min, max }, fallback) {
  const n = raw === null || raw === '' || raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/**
 * Keeps each known rail in the order stored, drops unknown keys and repeats, and replaces any unusable
 * value with that rail's own default — one bad field must not discard the rest of an admin's layout.
 * A missing or malformed list falls back to the shipped layout; an empty list is respected (an admin
 * who removed every rail meant it).
 */
export function sanitizeRailsConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const min_items = boundedInt(src.min_items, RAIL_LIMITS.min_items, DEFAULT_RAILS_CONFIG.min_items);
  if (!Array.isArray(src.rails)) {
    return { min_items, rails: DEFAULT_RAILS_CONFIG.rails.map((r) => ({ ...r })) };
  }
  const seen = new Set();
  const rails = [];
  for (const item of src.rails) {
    const key = item && typeof item === 'object' ? item.key : null;
    if (!RAIL_PROFILES[key] || seen.has(key)) continue;
    seen.add(key);
    const base = defaultRail(key);
    const rail = {
      key,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : base.enabled,
      limit: boundedInt(item.limit, RAIL_LIMITS.limit, base.limit),
    };
    if (RAIL_PROFILES[key].fresh) {
      rail.window_days = boundedInt(item.window_days, RAIL_LIMITS.window_days, base.window_days);
    }
    rails.push(rail);
  }
  return { min_items, rails };
}

function readJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The live rail layout. An unreadable table or row yields the shipped layout, never an error. */
export async function resolveRailsConfig(db) {
  let rows = [];
  try {
    rows = await settingRepo.listSettingsByGroup(db, recommendation.SETTINGS_GROUP);
  } catch {
    // Fresh clone that has not run migration 057 — the defaults are the right answer.
  }
  const row = rows.find((r) => r.key === RAILS_KEY);
  return sanitizeRailsConfig(readJson(row?.value_json));
}

/** The weights a rail ranks with: its own signals at the admin's strengths, everything else off. */
export function profileWeights(weights, signals) {
  if (!signals) return { ...weights };
  const out = { ...weights };
  for (const name of POSITIVE_SIGNALS) {
    if (!signals.includes(name)) out[name] = 0;
  }
  return out;
}

const componentOf = (row, name) => Number(row?.rank_components?.[name]) || 0;

/** Does this ranked row actually earn the rail's name? */
function qualifies(row, profile, { windowDays, now }) {
  if (profile.require && !profile.require.some((name) => componentOf(row, name) > 0)) return false;
  if (profile.fresh) {
    const created = new Date(row.created_at).getTime();
    if (!Number.isFinite(created) || now - created > windowDays * 86400000) return false;
  }
  return true;
}

/** A rail needs something from the shopper that they may not have given (history, a district). */
function canRun(profile, spec) {
  if (profile.needs === 'viewed') return spec.viewedIds.length > 0;
  if (profile.needs === 'district') return Boolean(spec.district);
  return true;
}

/** Is the "for you" rail really about this person, or is it just the popular list? */
function isPersonal(spec) {
  return (
    spec.categoryIds.length + spec.brands.length + spec.supplierIds.length + spec.viewedIds.length > 0 ||
    Boolean(spec.district)
  );
}

async function fetchRail(db, rail, profile, spec, size) {
  if (profile.needs === 'viewed') {
    const rows = await productService.listCatalog(db, {
      status: 'ACTIVE',
      productIds: spec.viewedIds,
      inStock: true,
      sortBy: 'newest',
      limit: spec.viewedIds.length,
      offset: 0,
    });
    // Most recently opened first — that is the order the ids arrive in.
    const order = new Map(spec.viewedIds.map((id, i) => [id, i]));
    return rows.sort((a, b) => (order.get(Number(a.id)) ?? 0) - (order.get(Number(b.id)) ?? 0));
  }
  return productService.listCatalog(db, {
    status: 'ACTIVE',
    sortBy: 'recommended',
    ranking: { ...spec, weights: profileWeights(spec.weights, profile.signals) },
    inStock: true,
    limit: size,
    offset: 0,
  });
}

/**
 * The home page's rails for one actor.
 *
 * Every rail's query runs in parallel, then the rails are filled in layout order so a product
 * appears in only the first rail that earns it. One rail failing costs that rail, not the page.
 *
 * @returns {Promise<{rails: {key: string, personalized: boolean, products: object[]}[], meta: object}>}
 */
export async function getRails(
  db,
  { userId, sessionId, audience = 'customer', personalize = true, now = Date.now() } = {}
) {
  const [config, feedSettings] = await Promise.all([resolveRailsConfig(db), discoveryFeed.resolveFeedSettings(db)]);
  const active = config.rails.filter((r) => r.enabled);
  if (!active.length) return { rails: [], meta: { count: 0 } };

  const { ranking: spec } = await discoveryFeed.resolveActorRanking(db, {
    userId,
    sessionId,
    audience,
    personalize,
    affinityWindowDays: feedSettings.affinityWindowDays,
  });

  const runnable = active.filter((r) => canRun(RAIL_PROFILES[r.key], spec));
  // Enough rows that products already claimed by an earlier rail cannot leave this one short.
  const budget = runnable.reduce((sum, r) => sum + r.limit, 0);

  const fetched = await Promise.all(
    runnable.map(async (rail) => {
      try {
        return await fetchRail(db, rail, RAIL_PROFILES[rail.key], spec, Math.min(MAX_FETCH, Math.max(rail.limit, budget)));
      } catch {
        return null;
      }
    })
  );

  const claimed = new Set();
  const rails = [];
  runnable.forEach((rail, i) => {
    const profile = RAIL_PROFILES[rail.key];
    const rows = (fetched[i] || [])
      .filter((p) => !claimed.has(String(p.id)) && qualifies(p, profile, { windowDays: rail.window_days, now }))
      .slice(0, rail.limit);
    if (rows.length < config.min_items) return;
    rows.forEach((p) => claimed.add(String(p.id)));
    // The score's arithmetic is internal; the shopper-facing label is the rail's own title.
    recommendation.applyRankReasons(rows);
    rails.push({
      key: rail.key,
      // continue_browsing and near_you are personal by definition; for_you only if it had something to go on.
      personalized: rail.key === 'for_you' ? isPersonal(spec) : rail.key === 'continue_browsing' || rail.key === 'near_you',
      products: rows,
    });
  });

  return { rails, meta: { count: rails.length } };
}
