/**
 * recommendation.service.js — The blended ranking behind the personalized feed (Phase B).
 *
 * Owns three things: the ranking policy (weights + tuning, read from platform_settings and
 * sanitised), the per-actor inputs that turn the policy into a concrete ranking spec, and the
 * human-readable reason attached to each ranked product. The SQL itself lives in
 * repositories/recommendation.repository.js so the score is computed across the whole filtered
 * catalog before the page is cut.
 *
 * Organic only: nothing here reads ad spend or any paid placement. Sponsored slots are injected
 * separately and labelled (Phase D), so a paid boost can never silently become an organic one.
 */

import * as recoRepo from '../repositories/recommendation.repository.js';
import * as covisit from './covisit.service.js';
import * as recoCache from './recoCache.service.js';

export const SETTINGS_GROUP = 'recommendation';
export const WEIGHTS_KEY = 'recommendation.weights';
export const TUNING_KEY = 'recommendation.tuning';

/**
 * Shipped defaults — the same numbers migration 056 seeds. Used only when the settings rows are
 * missing or a single value is unusable, so a partial dev DB still ranks sensibly.
 * server/test/recommendation.test.js fails if these drift from the migration.
 */
export const DEFAULT_WEIGHTS = Object.freeze({
  affinity_category: 3,
  affinity_brand: 2,
  affinity_supplier: 2,
  recently_viewed: 1.5,
  covisited: 2,
  trending: 2.5,
  bestseller: 1.5,
  recent_sales: 1.5,
  quality: 2,
  freshness: 1,
  trust_tier: 0.5,
  locality: 1,
  out_of_stock_penalty: 5,
  return_rate_penalty: 2,
  already_bought_penalty: 3,
});

export const DEFAULT_TUNING = Object.freeze({
  trend_recent_hours: 48,
  trend_baseline_days: 7,
  recent_sales_days: 30,
  recent_sales_cap: 100,
  bestseller_cap: 500,
  quality_prior_mean: 4,
  quality_prior_count: 10,
  freshness_halflife_days: 30,
  viewed_window_days: 14,
  purchased_window_days: 60,
});

/** A weight is a coefficient on a 0..1 signal; past this a single signal would swamp all the rest. */
export const WEIGHT_LIMITS = Object.freeze({ min: 0, max: 20 });

export const TUNING_LIMITS = Object.freeze({
  trend_recent_hours: { min: 1, max: 168, integer: true },
  trend_baseline_days: { min: 2, max: 60, integer: true },
  recent_sales_days: { min: 1, max: 365, integer: true },
  recent_sales_cap: { min: 2, max: 100000, integer: true },
  bestseller_cap: { min: 2, max: 1000000, integer: true },
  quality_prior_mean: { min: 0, max: 5 },
  quality_prior_count: { min: 1, max: 1000 },
  freshness_halflife_days: { min: 1, max: 730 },
  viewed_window_days: { min: 1, max: 90, integer: true },
  purchased_window_days: { min: 1, max: 730, integer: true },
});

// How many recently-viewed products feed the re-surface signal. Not a business number: it bounds the
// size of the ANY() array bound into the ranking query.
const MAX_VIEWED_IDS = 12;

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
 * Keeps each value that is a finite number inside its range, and replaces every other with its
 * default — one bad key must not discard the rest of an admin's tuning. Pure and exported so the
 * (future) admin API and the tests share one validator.
 */
function sanitize(raw, defaults, limitFor) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(defaults)) {
    const { min, max, integer } = limitFor(key);
    // WHY null is rejected explicitly: Number(null) is 0, which would read an absent key as "off".
    const n = src[key] === null || src[key] === '' ? NaN : Number(src[key]);
    const valid = Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
    out[key] = valid ? n : defaults[key];
  }
  return out;
}

export const sanitizeWeights = (raw) => sanitize(raw, DEFAULT_WEIGHTS, () => WEIGHT_LIMITS);
export const sanitizeTuning = (raw) => sanitize(raw, DEFAULT_TUNING, (k) => TUNING_LIMITS[k]);

/**
 * The live ranking policy: weights and tuning, plus the co-visitation policy (Phase E) read from the
 * same `recommendation` rows. An unreadable table or row yields the shipped defaults, never an error.
 */
export async function resolveRankingConfig(db, { cache } = {}) {
  let rows = [];
  try {
    // One snapshot of the `recommendation` rows, shared with the rails/diversity/cache resolvers when
    // a cache is given (Phase F); otherwise a plain read, as before.
    rows = await recoCache.loadRecommendationRows(db, cache);
  } catch {
    // Fresh clone that has not run migration 056 — the defaults are the right answer.
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    weights: sanitizeWeights(readJson(byKey.get(WEIGHTS_KEY)?.value_json)),
    tuning: sanitizeTuning(readJson(byKey.get(TUNING_KEY)?.value_json)),
    covisit: covisit.covisitFromSettingRows(rows),
  };
}

/**
 * Turns the policy plus one actor's history into the spec the SQL builder consumes.
 *
 * `personalize: false` (the shopper opted out, or capture is switched off) keeps only the signals
 * that need no knowledge of the person — trending, best seller, quality, freshness, stock — so an
 * opted-out shopper still gets a good ranking, just the same one everybody gets. Affinity, recently
 * viewed, already bought and locality are all dropped.
 *
 * Each per-actor read is best-effort: a failure there costs one signal, never the feed.
 */
export async function buildRankingSpec(
  db,
  { userId, sessionId, audience = 'customer', personalize = true, affinity = {}, config, cache } = {}
) {
  const { weights, tuning, covisit: covisitConfig = covisit.DEFAULT_COVISIT } = config || (await resolveRankingConfig(db, { cache }));
  const spec = {
    weights,
    tuning,
    audience,
    categoryIds: [],
    brands: [],
    supplierIds: [],
    viewedIds: [],
    purchasedIds: [],
    covisitIds: [],
    covisitFullScore: covisitConfig.full_score,
    district: null,
  };
  if (!personalize || (!userId && !sessionId)) return spec;

  spec.categoryIds = affinity.categoryIds || [];
  spec.brands = affinity.brands || [];
  spec.supplierIds = affinity.supplierIds || [];

  const actor = { userId, sessionId, audience };
  const safe = async (fn, fallback) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  const [viewed, purchased, district] = await Promise.all([
    weights.recently_viewed > 0
      ? safe(
          () =>
            recoRepo.getRecentlyViewedIds(db, {
              ...actor,
              windowDays: tuning.viewed_window_days,
              limit: MAX_VIEWED_IDS,
            }),
          []
        )
      : [],
    weights.already_bought_penalty > 0
      ? safe(() => recoRepo.getPurchasedIds(db, { ...actor, windowDays: tuning.purchased_window_days }), [])
      : [],
    weights.locality > 0 ? safe(() => recoRepo.getActorDistrict(db, actor), null) : null,
  ]);

  spec.purchasedIds = purchased;
  // A product the shopper already bought is not "something they were looking at".
  const bought = new Set(purchased);
  spec.viewedIds = viewed.filter((id) => !bought.has(id));
  spec.district = district;
  // The starting points for "shoppers also viewed". Derived from the history read above, so a shopper who
  // opted out (no history) has none and the signal reads nothing about them.
  if (covisitConfig.enabled && weights.covisited > 0) {
    spec.covisitIds = covisit.pickSeedIds({ viewedIds: spec.viewedIds, purchasedIds: purchased }, covisitConfig);
  }
  return spec;
}

// Component → the badge the feed slide already knows how to draw (client ProductFeed reasonMap), so
// the label comes from what actually moved the product up, with no client change.
const REASON_BY_COMPONENT = {
  trending: 'trending',
  bestseller: 'bestseller',
  recent_sales: 'bestseller',
  recently_viewed: 'browsed',
  // The existing "What others are looking for" badge: that is exactly what co-visitation says.
  covisited: 'crowd',
  affinity_category: 'interest',
  affinity_brand: 'interest',
  affinity_supplier: 'interest',
  locality: 'interest',
};

// WHY quality / freshness / trust are not in the table above: every product has some of each, so they
// would win the "biggest contributor" race for nearly every row and every badge would read "explore".
// They only explain a placement when no specific signal does.
const BASELINE_COMPONENTS = ['quality', 'freshness', 'trust_tier'];

// Below this a product was placed by a combination of weak signals, not by any one of them, so
// naming a single cause would be a made-up explanation.
const MIN_REASON_CONTRIBUTION = 0.5;

/**
 * The reason a product earned its place: the specific positive component that contributed most,
 * else 'explore' if only baseline quality carried it, else null so the caller can use a neutral
 * label.
 */
export function reasonFromComponents(components) {
  if (!components || typeof components !== 'object') return null;
  let best = null;
  let baseline = 0;
  for (const [name, raw] of Object.entries(components)) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < MIN_REASON_CONTRIBUTION) continue;
    if (REASON_BY_COMPONENT[name]) {
      if (!best || v > best.value) best = { name, value: v };
    } else if (BASELINE_COMPONENTS.includes(name)) {
      baseline += v;
    }
  }
  if (best) return REASON_BY_COMPONENT[best.name];
  return baseline >= MIN_REASON_CONTRIBUTION ? 'explore' : null;
}

/**
 * Sets recommendation_reason from each row's score components. `rank_components` is the ranking's
 * internal arithmetic, so it is stripped from the response unless the caller asked to explain.
 */
export function applyRankReasons(products, { explain = false } = {}) {
  for (const p of products) {
    const reason = reasonFromComponents(p.rank_components);
    if (reason && !p.recommendation_reason) p.recommendation_reason = reason;
    if (!explain) {
      delete p.rank_components;
      delete p.rank_score;
    }
  }
  return products;
}
