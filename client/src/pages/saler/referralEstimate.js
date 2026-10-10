/**
 * referralEstimate.js — the Referral Hub calculator's arithmetic, driven by the live programme rules.
 *
 * WHY its own file: the rates used to be literals (5% and 2%) typed into the page, so changing the
 * programme at /admin/growth/referrals left the calculator quoting the old numbers. The rules now
 * arrive as `overview.program` (server: publicProgramRules) and this is the only place they are used.
 *
 * It is an illustration, not a promise: tier 2 is assumed to be half again as many people as tier 1
 * (SUB_NETWORK_FACTOR), the same assumption the page always made.
 */

export const SUB_NETWORK_FACTOR = 1.5;

// Used only when the server sent no programme block (older API, failed overview request).
export const DEFAULT_PROGRAM = Object.freeze({
  qualifying_event: 'FIRST_ORDER',
  tier_1_rate_pct: 5,
  tier_2_rate_pct: 2,
  max_tier_depth: 2,
  holding_period_days: 7,
  signup_bonus_bdt: 0,
  first_sale_bonus_bdt: 0,
  kyc_bonus_bdt: 0,
});

const BONUS_KEY = Object.freeze({
  SIGNUP: 'signup_bonus_bdt',
  FIRST_SALE: 'first_sale_bonus_bdt',
  KYC_VERIFIED: 'kyc_bonus_bdt',
});

export function programOf(overview) {
  return { ...DEFAULT_PROGRAM, ...(overview?.program || {}) };
}

/**
 * What `friends` direct referrals (and the network under them) would pay, as one figure per tier.
 * A percentage event scales with `spend`; a fixed-bonus event pays the configured taka per person.
 */
export function estimateEarnings(program, friends, spend) {
  const p = { ...DEFAULT_PROGRAM, ...(program || {}) };
  const subFriends = Math.round(friends * SUB_NETWORK_FACTOR);
  const bonusKey = BONUS_KEY[p.qualifying_event];

  let direct;
  let sub;
  if (bonusKey) {
    const bonus = Number(p[bonusKey]) || 0;
    const ratio = p.tier_1_rate_pct > 0 ? p.tier_2_rate_pct / p.tier_1_rate_pct : 0;
    direct = friends * bonus;
    sub = subFriends * bonus * ratio;
  } else {
    direct = friends * spend * (p.tier_1_rate_pct / 100);
    sub = subFriends * spend * (p.tier_2_rate_pct / 100);
  }
  if (p.max_tier_depth < 2) sub = 0;
  return { direct, sub, total: Math.round(direct + sub) };
}
