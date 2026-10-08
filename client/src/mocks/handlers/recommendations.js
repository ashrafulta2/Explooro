/**
 * recommendations.js — Mock API handlers for the personalized-feed admin page.
 *
 * Mirrors server/src/routes/recommendationAdmin.routes.js so the whole page is demonstrable with
 * VITE_API_MODE=mock and no database (Master Instruction: every integration ships a mock driver).
 *
 * The shipped defaults and bounds below are a copy of the server's, because a browser mock cannot
 * import server code. server/test/recommendationAdmin.test.js loads this file and fails if any field,
 * default or bound differs from the live service, so the copy cannot quietly go stale.
 */

import { sectionProblems } from '../../services/recoSettings.js';

const bool = (key, dflt = true) => ({ key, type: 'bool', default: dflt });
const num = (key, type, min, max, dflt, extra = {}) => ({ key, type, min, max, default: dflt, ...extra });

const WEIGHT = (key, dflt) => num(key, 'number', 0, 20, dflt, key.endsWith('_penalty') ? { penalty: true } : {});

export const MOCK_FIELDS = {
  weights: [
    WEIGHT('affinity_category', 3), WEIGHT('affinity_brand', 2), WEIGHT('affinity_supplier', 2),
    WEIGHT('recently_viewed', 1.5), WEIGHT('covisited', 2), WEIGHT('trending', 2.5),
    WEIGHT('bestseller', 1.5), WEIGHT('recent_sales', 1.5), WEIGHT('quality', 2),
    WEIGHT('freshness', 1), WEIGHT('trust_tier', 0.5), WEIGHT('locality', 1),
    WEIGHT('out_of_stock_penalty', 5), WEIGHT('return_rate_penalty', 2), WEIGHT('already_bought_penalty', 3),
  ],
  tuning: [
    num('trend_recent_hours', 'int', 1, 168, 48),
    num('trend_baseline_days', 'int', 2, 60, 7),
    num('recent_sales_days', 'int', 1, 365, 30),
    num('recent_sales_cap', 'int', 2, 100000, 100),
    num('bestseller_cap', 'int', 2, 1000000, 500),
    num('quality_prior_mean', 'number', 0, 5, 4),
    num('quality_prior_count', 'number', 1, 1000, 10),
    num('freshness_halflife_days', 'number', 1, 730, 30),
    num('viewed_window_days', 'int', 1, 90, 14),
    num('purchased_window_days', 'int', 1, 730, 60),
  ],
  diversity: [
    bool('enabled'),
    num('pool_size', 'int', 20, 500, 120),
    num('window', 'int', 2, 30, 6),
    num('max_per_supplier', 'int', 1, 30, 2),
    num('max_per_category', 'int', 1, 30, 3),
    num('max_per_brand', 'int', 1, 30, 2),
    num('explore_every', 'int', 2, 50, 5, { allow_zero: true }),
  ],
  covisit: [
    bool('enabled'),
    num('window_days', 'int', 1, 365, 60),
    num('min_actors', 'int', 2, 1000, 3),
    num('max_related', 'int', 1, 200, 30),
    num('max_products_per_actor', 'int', 2, 200, 25),
    num('full_score', 'number', 0.01, 1, 0.3),
    num('seed_limit', 'int', 1, 30, 8),
  ],
  cache: [
    bool('enabled'),
    num('pool_ttl_seconds', 'int', 5, 900, 60),
    num('settings_ttl_seconds', 'int', 0, 300, 30),
  ],
};

export const MOCK_RAIL_CATALOGUE = [
  { key: 'continue_browsing', needs: 'viewed', has_window: false },
  { key: 'also_viewed', needs: 'covisit', has_window: false },
  { key: 'for_you', needs: null, has_window: false },
  { key: 'trending', needs: null, has_window: false },
  { key: 'bestsellers', needs: null, has_window: false },
  { key: 'new_arrivals', needs: null, has_window: true },
  { key: 'near_you', needs: 'district', has_window: false },
];

export const MOCK_RAIL_LIMITS = {
  limit: { min: 1, max: 30 },
  min_items: { min: 1, max: 30 },
  window_days: { min: 1, max: 365 },
};

export const MOCK_RAIL_DEFAULTS = {
  min_items: 4,
  rails: [
    { key: 'continue_browsing', enabled: true, limit: 10 },
    { key: 'also_viewed', enabled: true, limit: 12 },
    { key: 'for_you', enabled: true, limit: 12 },
    { key: 'trending', enabled: true, limit: 12 },
    { key: 'bestsellers', enabled: true, limit: 12 },
    { key: 'new_arrivals', enabled: true, limit: 12, window_days: 30 },
    { key: 'near_you', enabled: true, limit: 12 },
  ],
};

const LABELS = {
  weights: ['Personalized feed — signal weights', 'পার্সোনালাইজড ফিড — সিগন্যালের ওজন'],
  tuning: ['Personalized feed — signal windows and caps', 'পার্সোনালাইজড ফিড — সিগন্যালের সময়সীমা ও সীমা'],
  rails: ['Home page rails', 'হোম পেজের রেল'],
  diversity: ['Personalized feed — diversity', 'পার্সোনালাইজড ফিড — বৈচিত্র্য'],
  covisit: ['Personalized feed — shoppers also viewed', 'পার্সোনালাইজড ফিড — যারা দেখেছেন তারা আরও দেখেছেন'],
  cache: ['Personalized feed — cache', 'পার্সোনালাইজড ফিড — ক্যাশ'],
};

const SECTION_ORDER = ['weights', 'tuning', 'rails', 'diversity', 'covisit', 'cache'];

const defaultsOf = (name) =>
  name === 'rails'
    ? JSON.parse(JSON.stringify(MOCK_RAIL_DEFAULTS))
    : Object.fromEntries(MOCK_FIELDS[name].map((f) => [f.key, f.default]));

// null = the section has never been saved (running on defaults).
const saved = Object.fromEntries(SECTION_ORDER.map((n) => [n, null]));
let history = [];

const describe = (name) => {
  const row = saved[name];
  return {
    key: name,
    label_en: LABELS[name][0],
    label_bn: LABELS[name][1],
    value: row ? JSON.parse(JSON.stringify(row.value)) : defaultsOf(name),
    defaults: defaultsOf(name),
    is_default: !row,
    has_fallbacks: false,
    fields: name === 'rails' ? undefined : MOCK_FIELDS[name],
    ...(name === 'rails' ? { catalogue: MOCK_RAIL_CATALOGUE, limits: MOCK_RAIL_LIMITS } : {}),
    updated_at: row?.updated_at ?? null,
    updated_by: row ? 1 : null,
  };
};

const bad = (message_en, message_bn, field) => ({ code: 'VALIDATION_FAILED', message_en, message_bn, details: field ? { field } : undefined });

/** Same shape rules as the server: complete, no unknown keys, every bound, then the cross-field rules. */
function validate(name, value, reason) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return bad('The settings must be an object.', 'সেটিংস অবশ্যই একটি অবজেক্ট হতে হবে।', 'value');
  }
  const section = describe(name);
  if (name !== 'rails') {
    const known = new Set(section.fields.map((f) => f.key));
    for (const k of Object.keys(value)) if (!known.has(k)) return bad(`Unknown setting "${k}".`, `অজানা সেটিং "${k}"।`, k);
    for (const f of section.fields) if (!(f.key in value)) return bad(`${f.key} is missing.`, `${f.key} দেওয়া হয়নি।`, f.key);
  } else {
    const keys = new Set(MOCK_RAIL_CATALOGUE.map((c) => c.key));
    const seen = new Set();
    for (const r of value.rails || []) {
      if (!keys.has(r.key)) return bad(`Unknown rail "${r.key}".`, `অজানা রেল "${r.key}"।`, 'rails');
      if (seen.has(r.key)) return bad(`Rail "${r.key}" appears twice.`, `রেল "${r.key}" দুইবার আছে।`, 'rails');
      seen.add(r.key);
    }
  }
  const problem = sectionProblems(section, value)[0];
  if (problem) {
    const text = problem.code === 'no_positive'
      ? ['At least one signal weight (other than a penalty) must be above 0, or the feed has no order.', 'অন্তত একটি সিগন্যালের ওজন (পেনাল্টি বাদে) ০-র বেশি হতে হবে, নইলে ফিডের কোনো ক্রম থাকে না।']
      : [`${problem.path} is not an acceptable value.`, `${problem.path}-এর মান গ্রহণযোগ্য নয়।`];
    return bad(text[0], text[1], problem.path);
  }
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    return bad('Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।', 'reason');
  }
  return null;
}

const SAMPLE_FUNNEL = [
  { source: 'rail:trending', impressions: 1840, clicks: 212, add_carts: 41, purchases: 12, actors: 96 },
  { source: 'rail:for_you', impressions: 2210, clicks: 301, add_carts: 66, purchases: 21, actors: 118 },
  { source: 'rail:also_viewed', impressions: 640, clicks: 88, add_carts: 19, purchases: 7, actors: 41 },
  { source: 'grid', impressions: 5120, clicks: 410, add_carts: 55, purchases: 14, actors: 205 },
  { source: 'feed', impressions: 0, clicks: 0, add_carts: 0, purchases: 0, actors: 0 },
];

const ratio = (n, d) => (d > 0 ? Number((n / d).toFixed(4)) : null);

export const recommendationHandlers = [
  {
    method: 'GET',
    path: '/admin/platform/recommendations',
    handler() {
      return {
        status: 200,
        body: {
          sections: SECTION_ORDER.map(describe),
          authority: {
            roles: [{ key: 'super_admin', label_en: 'Super Admin', label_bn: 'সুপার অ্যাডমিন' }],
            grants: [],
          },
          history,
          runtime: {
            node: {
              pool: { hits: 412, misses: 38, errors: 0, coalesced: 6, hit_rate: 0.9156 },
              settings: { hits: 905, misses: 21, errors: 0, hit_rate: 0.9773 },
              latency: {
                feed: { count: 188, mean_ms: 14.2, max_ms: 61.4 },
                rails: { count: 264, mean_ms: 22.8, max_ms: 97.1 },
              },
            },
            driver: null,
          },
          min_reason_length: 10,
          can_update: true,
        },
      };
    },
  },

  {
    method: 'GET',
    path: '/admin/platform/recommendations/funnel',
    handler({ query = {} } = {}) {
      const days = Number.isInteger(Number(query.days)) && Number(query.days) > 0 ? Number(query.days) : 7;
      const attribution = Number.isInteger(Number(query.attribution_days)) && Number(query.attribution_days) > 0 ? Number(query.attribution_days) : 7;
      return {
        status: 200,
        body: {
          window: { days, attribution_days: attribution },
          surfaces: SAMPLE_FUNNEL.map((r) => ({
            ...r,
            ctr: ratio(r.clicks, r.impressions),
            cart_rate: ratio(r.add_carts, r.clicks),
            purchase_rate: ratio(r.purchases, r.clicks),
          })),
          limits: { days: { min: 1, max: 90, fallback: 7 }, attribution_days: { min: 1, max: 30, fallback: 7 } },
        },
      };
    },
  },

  {
    method: 'PUT',
    path: '/admin/platform/recommendations/:section',
    handler({ params = {}, body = {}, path = '' } = {}) {
      const name = params.section || decodeURIComponent(path.split('/').pop() || '');
      if (!SECTION_ORDER.includes(name)) {
        return { status: 400, body: { error: bad(`Unknown section "${name}".`, `অজানা বিভাগ "${name}"।`, 'section') } };
      }
      const error = validate(name, body.value, body.reason);
      if (error) return { status: 400, body: { error } };

      const currentStamp = saved[name]?.updated_at ?? null;
      if (body.base_updated_at !== undefined && (body.base_updated_at ?? null) !== currentStamp) {
        return {
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message_en: 'Someone else changed this section after you opened it. Reload to see their change, then apply yours again.',
              message_bn: 'আপনি খোলার পর অন্য কেউ এই বিভাগটি বদলেছেন। তাঁর পরিবর্তন দেখতে পেজটি রিলোড করে আবার আপনার পরিবর্তন করুন।',
            },
          },
        };
      }

      const before = describe(name).value;
      saved[name] = { value: JSON.parse(JSON.stringify(body.value)), updated_at: new Date().toISOString() };
      history.unshift({
        id: history.length + 1,
        action: 'platform.recommendation.update',
        actor_ref: 'USR-SUPERADMIN',
        risk_tier: 'MEDIUM',
        created_at: saved[name].updated_at,
        before_json: { section: name, value: before },
        after_json: { section: name, value: describe(name).value, meta: { reason: body.reason.trim() } },
      });
      history = history.slice(0, 15);

      return {
        status: 200,
        body: {
          section: describe(name),
          message_en: 'Feed settings updated. Shoppers get them within a few seconds.',
          message_bn: 'ফিডের সেটিংস হালনাগাদ হয়েছে। ক্রেতারা কয়েক সেকেন্ডের মধ্যেই এটি পাবেন।',
        },
      };
    },
  },
];

export default recommendationHandlers;
