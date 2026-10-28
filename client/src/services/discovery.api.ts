/**
 * discovery.api.ts — Typed wrapper for the interest-based discovery feed (/discover).
 *
 * One place that knows the /discovery/* request/response shape (per how-to-add-a-feature.md Step 8).
 * Reuses catalog.api.ts's list-item normalization so feed products read identically to the rest of
 * the catalog regardless of VITE_API_MODE.
 */
import { api } from '../core/api.ts';
import { normalizeProductListItem } from './catalog.api.ts';
import { getDiscoverySessionId, isPersonalizationOff } from './signals.ts';
import type { SignalAudience } from './signals.ts';
import type { CatalogProduct } from './catalog.api.ts';

export interface FeedOptions {
  limit?: number;
  offset?: number;
  audience?: SignalAudience;
  /** category / brand / price / tier / district / in_stock / q: snake_case query keys. */
  filters?: Record<string, unknown>;
}

/** One home rail; a rail with no products never reaches the caller. */
export interface DiscoveryRail {
  key: string;
  personalized: boolean;
  products: ReturnType<typeof normalizeProductListItem>[];
}

export { getDiscoverySessionId };

/**
 * Fetches one personalized page of the feed.
 */
export async function getFeed({ limit, offset, audience = 'customer', filters = {} }: FeedOptions = {}) {
  const sid = getDiscoverySessionId();
  const query: Record<string, unknown> = { audience, ...filters };
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
 */
export async function getRails({ audience = 'customer' }: { audience?: SignalAudience } = {}): Promise<DiscoveryRail[]> {
  const sid = getDiscoverySessionId();
  const query: Record<string, unknown> = { audience };
  if (sid) query.session_id = sid;
  // Same opt-out switch as getFeed: an opted-out shopper's rails are ranked without their history.
  if (isPersonalizationOff()) query.personalize = '0';

  const { data } = await api.get('/discovery/rails', {
    query,
    headers: sid ? { 'x-session-id': sid } : undefined,
  });
  return (data?.rails ?? [])
    .filter((r: { key?: unknown; personalized?: unknown; products?: CatalogProduct[] }) => r && r.key && Array.isArray(r.products) && r.products.length > 0)
    .map((r) => ({
      key: String(r.key),
      personalized: Boolean(r.personalized),
      products: r.products.map(normalizeProductListItem),
    }));
}
