/**
 * partnerReward.ts — Mock API handlers for the monthly shop partner reward pool.
 *
 * Mirrors server/src/routes/partnerReward.routes.ts and the shapes of partnerReward.service.ts
 * (getAdminView, getOwnView, getRunPayouts). The rules persist to localStorage, as attribution.js does,
 * so "does the save survive a reload?" can be checked in mock mode.
 */


import type { MockRoute } from '../types.ts';

const STORAGE_KEY = 'explooro:mock:partner-reward:rules';
// Mirrors partnerReward.service.ts RULE_LIMITS and the migration 086 seed.
const LIMITS = {
  weight: { min: 0, max: 100, total: 100 },
  ad_revenue_share_pct: { min: 0, max: 100 },
  community_point: { min: 0, max: 20 },
  max_posts_per_day: { min: 1, max: 50 },
  settle_lag_days: { min: 0, max: 28 },
};
const DEFAULT_RULES = {
  weights: { sales: 40, social: 25, community: 20, activity: 15 },
  ad_revenue_share_pct: 55,
  community_points: { post: 3, like: 1, comment: 2, save: 2 },
  max_posts_per_day: 3,
  settle_lag_days: 7,
  timezone: 'Asia/Dhaka',
  first_month: '2026-10-01',
  updated_at: null,
  updated_by: null,
};
const FACTORS = ['sales', 'social', 'community', 'activity'];
const MIN_REASON_LENGTH = 10;

function loadRules() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (parsed?.weights) return { ...DEFAULT_RULES, ...parsed };
  } catch {
    // Private browsing — the shipped default.
  }
  return { ...DEFAULT_RULES };
}

let rules = loadRules();
const history = [];

// Four partners' month-so-far values; the same share arithmetic as computeShares on the server.
const PARTNERS = [
  { saler_id: 6, name: 'Dhaka Fashion House', values: { sales: 18, social: 240, community: 46, activity: 21 } },
  { saler_id: 202, name: 'Bangla Smart Store', values: { sales: 11, social: 410, community: 12, activity: 17 } },
  { saler_id: 305, name: 'Rangpur Crafts', values: { sales: 4, social: 95, community: 88, activity: 22 } },
  { saler_id: 411, name: 'Sylhet Tea Corner', values: { sales: 2, social: 30, community: 6, activity: 9 } },
];
const POOL = { available: '18450.00', pending: '6120.00', ad_revenue: '32000.00' };

function estimate() {
  const adShare = Math.floor(Number(POOL.ad_revenue) * rules.ad_revenue_share_pct) / 100;
  const pool = Number(POOL.available) + adShare;
  const totals = Object.fromEntries(FACTORS.map((f) => [f, PARTNERS.reduce((s, p) => s + p.values[f], 0)]));
  const rows = PARTNERS.map((p) => {
    const points = Object.fromEntries(FACTORS.map((f) => [f, totals[f] ? (rules.weights[f] * p.values[f]) / totals[f] : 0]));
    return { ...p, points, score: FACTORS.reduce((s, f) => s + points[f], 0) };
  });
  const sum = rows.reduce((s, r) => s + r.score, 0);
  const round = (n) => Number(n.toFixed(2));
  return {
    pool: { ...POOL, ad_share: adShare.toFixed(2), estimated: pool.toFixed(2) },
    totals,
    rows: rows
      .map((r) => ({
        saler_id: r.saler_id,
        name: r.name,
        values: r.values,
        points: Object.fromEntries(FACTORS.map((f) => [f, round(r.points[f])])),
        score: round(r.score),
        share_pct: round(sum ? (r.score / sum) * 100 : 0),
        estimated_amount: (Math.floor((pool * 100 * r.score) / sum) / 100).toFixed(2),
      }))
      .sort((a, b) => b.score - a.score),
  };
}

const PERIOD = { start: '2026-10-01', end: '2026-10-31', today: '2026-10-23' };
const CLOSES_ON = '2026-11-08';

const RUNS = [
  { id: 2, period_start: '2026-09-01', period_end: '2026-09-30', ad_revenue: '28500.00', ad_share: '5700.00', pool_amount: '21900.00', paid_amount: '21899.98', carried_amount: '0.02', partners_scored: 4, triggered_by: null, created_at: '2026-10-08T00:10:00Z' },
  { id: 1, period_start: '2026-08-01', period_end: '2026-08-31', ad_revenue: '19000.00', ad_share: '3800.00', pool_amount: '14200.00', paid_amount: '14200.00', carried_amount: '0.00', partners_scored: 3, triggered_by: 1, created_at: '2026-09-08T00:10:00Z' },
];

const bad = (field, message_en, message_bn) => ({ status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en, message_bn, details: { field } } } });
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export const partnerRewardHandlers = [
  {
    method: 'GET',
    path: '/admin/growth/partner-rewards',
    handler() {
      const est = estimate();
      return {
        status: 200,
        body: {
          policy: { ...rules },
          limits: LIMITS,
          preview: {
            period: PERIOD,
            closes_on: CLOSES_ON,
            pool: est.pool,
            partners_scored: est.rows.length,
            totals: est.totals,
            top: est.rows,
          },
          closable_periods: [],
          runs: { items: RUNS, total: RUNS.length, page: 1, limit: 12 },
          history,
          can_update: true,
          can_run: true,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/admin/growth/partner-rewards/runs/:id/payouts',
    handler({ params }) {
      const run = RUNS.find((r) => String(r.id) === String(params?.id));
      const pool = Number(run?.paid_amount || 0);
      const items = estimate().rows.slice(0, run?.partners_scored || 0).map((r) => ({
        saler_id: r.saler_id,
        partner_name: r.name,
        metrics_json: r.values,
        points_json: r.points,
        score: String(r.score),
        share_pct: String(r.share_pct),
        amount: ((pool * r.share_pct) / 100).toFixed(2),
      }));
      return { status: 200, body: { items, total: items.length, page: 1, limit: 50 } };
    },
  },
  {
    method: 'PUT',
    path: '/admin/growth/partner-rewards',
    handler({ body = {} } = {}) {
      const w = body.weights || {};
      if (!FACTORS.every((f) => isInt(w[f], 0, 100))) return bad('weights', 'Each weight must be a whole number from 0 to 100.', 'প্রতিটি weight 0 থেকে 100 এর মধ্যে পূর্ণ সংখ্যা হতে হবে।');
      if (FACTORS.reduce((s, f) => s + w[f], 0) !== 100) return bad('weights', 'The four weights must add up to 100.', 'চারটি weight এর যোগফল 100 হতে হবে।');
      if (!(w.sales >= w.social && w.social >= w.community && w.community >= w.activity)) {
        return bad('weights', 'Keep the order: store sales ≥ social shares ≥ community posts ≥ activity.', 'ক্রম ঠিক রাখুন: store sale ≥ social share ≥ community post ≥ activity।');
      }
      const pct = body.ad_revenue_share_pct;
      if (typeof pct !== 'number' || pct < 0 || pct > 100) return bad('ad_revenue_share_pct', 'The ad revenue share must be from 0 to 100, with at most two decimals.', 'বিজ্ঞাপন আয়ের অংশ 0 থেকে 100 এর মধ্যে হতে হবে, সর্বোচ্চ দুই দশমিক ঘর।');
      const cp = body.community_points || {};
      if (!['post', 'like', 'comment', 'save'].every((k) => isInt(cp[k], 0, 20))) return bad('community_points', 'Community points must be whole numbers from 0 to 20.', 'Community point 0 থেকে 20 এর মধ্যে পূর্ণ সংখ্যা হতে হবে।');
      if (!isInt(body.max_posts_per_day, 1, 50)) return bad('max_posts_per_day', 'Posts counted per day must be from 1 to 50.', 'দিনে গোনা post 1 থেকে 50 এর মধ্যে হতে হবে।');
      if (!isInt(body.settle_lag_days, 0, 28)) return bad('settle_lag_days', 'The closing delay must be from 0 to 28 days.', 'মাস বন্ধের অপেক্ষা 0 থেকে 28 দিনের মধ্যে হতে হবে।');
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason.length < MIN_REASON_LENGTH) return bad('reason', `Give a reason of at least ${MIN_REASON_LENGTH} characters for this change.`, `এই পরিবর্তনের জন্য অন্তত ${MIN_REASON_LENGTH} অক্ষরের একটি কারণ লিখুন।`);
      const before = { ...rules };
      rules = {
        ...rules,
        weights: { ...w },
        ad_revenue_share_pct: pct,
        community_points: { ...cp },
        max_posts_per_day: body.max_posts_per_day,
        settle_lag_days: body.settle_lag_days,
        updated_at: new Date().toISOString(),
        updated_by: 1,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
      } catch {
        // Not persisted; still applies for this session.
      }
      history.unshift({ created_at: rules.updated_at, actor_ref: 'USR-SUPERADMIN', before_json: before, after_json: { ...rules, meta: { reason } } });
      return {
        status: 200,
        body: {
          policy: { ...rules },
          message_en: 'Reward rules saved. They apply to every month not yet closed.',
          message_bn: 'রিওয়ার্ডের নিয়ম সংরক্ষিত হয়েছে। যে মাসগুলো এখনো বন্ধ হয়নি সেগুলোতে প্রযোজ্য।',
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/growth/partner-rewards/close',
    handler() {
      return { status: 200, body: { closed: [], message_en: 'There is no finished month left to close.', message_bn: 'বন্ধ করার মতো কোনো শেষ হওয়া মাস নেই।' } };
    },
  },
  {
    method: 'GET',
    path: '/saler/partner-reward',
    handler() {
      const est = estimate();
      const mine = est.rows.find((r) => r.saler_id === 6);
      return {
        status: 200,
        body: {
          data: {
            period: PERIOD,
            closes_on: CLOSES_ON,
            weights: rules.weights,
            pool_estimate: est.pool.estimated,
            partners_scored: est.rows.length,
            values: mine.values,
            community_counts: { posts: 9, likes: 11, comments: 4, saves: 2 },
            points: mine.points,
            score: mine.score,
            share_pct: mine.share_pct,
            estimated_amount: mine.estimated_amount,
            history: [
              { period_start: '2026-09-01', amount: '7420.50', share_pct: 33.88 },
              { period_start: '2026-08-01', amount: '5130.00', share_pct: 36.13 },
            ],
          },
        },
      };
    },
  },
] satisfies MockRoute[];
