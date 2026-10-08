/**
 * recoFunnel.service.js — "Is this surface working?" (Phase F).
 *
 * For each tagged surface — a home rail (`rail:trending`, `rail:also_viewed`, ...), the swipe feed,
 * the catalog grid, search — over a window: how many products it showed, how many were opened, and
 * how many of those openings led to the same shopper adding that product to the cart / buying it.
 *
 * Read this the way it is built:
 *   - click-through is clicks / impressions, where an impression is a card that was really on screen
 *     (the client counts a VIEW only after it was half visible for half a second);
 *   - add-to-cart and purchase are ATTRIBUTED to the click that preceded them by the same shopper on the
 *     same product within `attribution_days`. A shopper who clicked from two surfaces is counted for
 *     both: this is "which surfaces led to a conversion", not a split of credit;
 *   - it is observational. It cannot say a rail CAUSED a purchase the shopper would not have made — only
 *     an A/B test can, and none exists.
 */

import * as funnelRepo from '../repositories/recoFunnel.repository.js';

export const FUNNEL_LIMITS = Object.freeze({
  days: { min: 1, max: 90, fallback: 7 },
  attribution_days: { min: 1, max: 30, fallback: 7 },
});

const bounded = (raw, { min, max, fallback }) => {
  const n = raw === null || raw === '' || raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const ratio = (num, den) => (den > 0 ? Number((num / den).toFixed(4)) : null);

/**
 * @returns {Promise<{window: {days: number, attribution_days: number}, surfaces: object[]}>}
 *   `ctr`, `cart_rate` and `purchase_rate` are fractions (0.05 = 5%), null when the denominator is 0
 *   so a surface with no impressions is not reported as a 0% performer. cart_rate / purchase_rate are
 *   per click.
 */
export async function getFunnel(db, { audience = 'customer', days, attributionDays } = {}) {
  const window = {
    days: bounded(days, FUNNEL_LIMITS.days),
    attribution_days: bounded(attributionDays, FUNNEL_LIMITS.attribution_days),
  };
  const rows = await funnelRepo.getFunnelBySource(db, {
    audience: audience === 'saler' ? 'saler' : 'customer',
    days: window.days,
    attributionDays: window.attribution_days,
  });
  const surfaces = rows.map((r) => {
    const impressions = Number(r.impressions) || 0;
    const clicks = Number(r.clicks) || 0;
    const add_carts = Number(r.add_carts) || 0;
    const purchases = Number(r.purchases) || 0;
    return {
      source: r.source,
      impressions,
      clicks,
      add_carts,
      purchases,
      actors: Number(r.actors) || 0,
      ctr: ratio(clicks, impressions),
      cart_rate: ratio(add_carts, clicks),
      purchase_rate: ratio(purchases, clicks),
    };
  });
  return { window, surfaces };
}
