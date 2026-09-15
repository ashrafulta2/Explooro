/**
 * discovery.api.js — Typed wrapper for the interest-based discovery feed (/discover).
 *
 * One place that knows the /discovery/* request/response shape (per how-to-add-a-feature.md Step 8).
 * Reuses catalog.api.js's list-item normalization so feed products read identically to the rest of
 * the catalog regardless of VITE_API_MODE.
 */
import { api } from '../core/api.js';
import { normalizeProductListItem } from './catalog.api.js';

const SESSION_KEY = 'explooro_discovery_sid';

/**
 * The guest ranking id: an opaque token persisted in this browser so an anonymous shopper's
 * discovery history is stable across a session. Never an auth credential — it only scopes
 * personalization. Returns null if storage is unavailable (private mode); the feed then simply
 * ranks by popularity.
 */
export function getDiscoverySessionId() {
  try {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = `sid_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return null;
  }
}

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

  const { data, meta } = await api.get('/discovery/feed', {
    query,
    headers: sid ? { 'x-session-id': sid } : undefined,
  });
  const products = (data?.products ?? []).map(normalizeProductListItem);
  return { products, meta: meta || {} };
}

/**
 * Records interaction signal(s). Fire-and-forget: a ranking signal must never block or break the
 * browsing experience, so failures are swallowed. Accepts one event or an array.
 */
export function recordEvent(event, { audience = 'customer' } = {}) {
  const events = Array.isArray(event) ? event : [event];
  if (events.length === 0) return;
  const sid = getDiscoverySessionId();

  try {
    api
      .post(
        '/discovery/events',
        { events, audience, session_id: sid },
        { headers: sid ? { 'x-session-id': sid } : undefined, skipAuthRedirect: true }
      )
      .catch(() => {});
  } catch {
    // Ignore — personalization is best-effort.
  }
}
