/**
 * discovery.api.js — Typed wrapper for the interest-based discovery feed (/discover).
 *
 * One place that knows the /discovery/* request/response shape (per how-to-add-a-feature.md Step 8).
 * Reuses catalog.api.js's list-item normalization so feed products read identically to the rest of
 * the catalog regardless of VITE_API_MODE.
 */
import { api } from '../core/api.js';
import { normalizeProductListItem } from './catalog.api.js';
import { getDiscoverySessionId, isPersonalizationOff } from './signals.js';

export { getDiscoverySessionId };

/**
 * Fetches one personalized page of the feed.
 * @param {object} opts
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 * @param {'customer'|'saler'} [opts.audience]
 * @param {object} [opts.filters]  category/brand/price/tier/district/in_stock/q — snake_case query keys
 * @returns {Promise<{products: object[], meta: object}>}
 */
export async function getFeed({ limit, offset, audience = 'customer', filters = {} } = {}) {
  const sid = getDiscoverySessionId();
  const query = { audience, ...filters };
  if (limit != null) query.limit = limit;
  if (offset != null) query.offset = offset;
  if (sid) query.session_id = sid;
  // WHY: a shopper who opted out asked not to be profiled, so their feed must not be ranked by
  // history gathered before they did. The server then ranks by popularity alone.
  if (isPersonalizationOff()) query.personalize = '0';

  const { data, meta } = await api.get('/discovery/feed', {
    query,
    headers: sid ? { 'x-session-id': sid } : undefined,
  });
  const products = (data?.products ?? []).map(normalizeProductListItem);
  return { products, meta: meta || {} };
}

/**
 * Fetches the home page's themed rails (for you / trending / best sellers / ...). The server decides
 * which rails exist for this shopper, their order and their contents; a rail with no products is
 * dropped here so the caller never has to render an empty row.
 * @param {object} [opts]
 * @param {'customer'|'saler'} [opts.audience]
 * @returns {Promise<{key: string, personalized: boolean, products: object[]}[]>}
 */
export async function getRails({ audience = 'customer' } = {}) {
  const sid = getDiscoverySessionId();
  const query = { audience };
  if (sid) query.session_id = sid;
  // Same opt-out switch as getFeed: an opted-out shopper's rails are ranked without their history.
  if (isPersonalizationOff()) query.personalize = '0';

  const { data } = await api.get('/discovery/rails', {
    query,
    headers: sid ? { 'x-session-id': sid } : undefined,
  });
  return (data?.rails ?? [])
    .filter((r) => r && r.key && Array.isArray(r.products) && r.products.length > 0)
    .map((r) => ({
      key: String(r.key),
      personalized: Boolean(r.personalized),
      products: r.products.map(normalizeProductListItem),
    }));
}
