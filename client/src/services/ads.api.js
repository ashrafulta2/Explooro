import { api } from '../core/api.js';

// WHY: callers (and ad_products.placement) use the server's keys. The Stories page historically asked
// for 'HOMEPAGE_HERO', which no campaign carries, so the booked Homepage Spotlight never matched.
const PLACEMENT_ALIASES = { HOMEPAGE_HERO: 'HOME_HERO', FLASH_SLOT: 'FLASH_STRIP' };

/**
 * One reserved row from GET /ads/reserved, in the shape SponsoredSlot renders, with the legacy
 * `campaign_id` / `campaign_name` / `creative.*` fields kept so the four older callers still work.
 */
function normalizeReserved(row) {
  const productId = row.product_id ?? null;
  const target = row.destination_url || (productId ? `/product/${productId}` : '');
  return {
    campaignId: row.campaign_id,
    creativeId: row.creative_id ?? null,
    headline: row.headline || row.title || '',
    description: row.description || '',
    bannerImageUrl: row.banner_image_url || '',
    callToAction: row.call_to_action || 'SHOP_NOW',
    destinationUrl: target,
    productId,
    placement: row.placement,
    campaign_id: row.campaign_id,
    campaign_name: row.headline || row.title || '',
    creative: { image_url: row.banner_image_url || '', target_url: target },
  };
}

export const adsApi = {
  /**
   * Fetch reserved (prepaid) placements for a specific surface on the current date.
   * Resolves to `{ data: [normalized rows] }` — always an array, so `res.data.length` is safe.
   * @param {string} placement - e.g., 'HOME_HERO', 'STORE_DIRECTORY', 'LIVE_LOBBY', 'FLASH_STRIP', 'CATEGORY_BANNER'
   * @param {number} [categoryId] - Optional category ID for CATEGORY_BANNER
   */
  async listReservedPlacements(placement, categoryId = null) {
    const params = new URLSearchParams({ placement: PLACEMENT_ALIASES[placement] || placement });
    // WHY snake_case: the controller reads req.query.category_id; `categoryId` was silently ignored.
    if (categoryId) params.append('category_id', categoryId);

    // We get the local timezone date string in YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0];
    params.append('date', today);

    const res = await api.get(`/ads/reserved?${params.toString()}`);
    const rows = res?.placements ?? res?.data?.placements ?? (Array.isArray(res?.data) ? res.data : []);
    return { data: rows.map(normalizeReserved) };
  },

  /**
   * Run the real-time auction for a metered surface (search, feed, product page).
   * Resolves to an array of winners in SponsoredSlot's shape; never rejects (an ad must not break a page).
   * @param {string} placement - 'SEARCH_RESULTS' | 'FEED' | 'PRODUCT_PAGE'
   * @param {{ keyword?: string, categoryId?: number|string, limit?: number }} [opts]
   */
  async runAuction(placement, { keyword = '', categoryId = null, limit = 3 } = {}) {
    const params = new URLSearchParams({ placement, limit: String(limit) });
    if (keyword) params.append('keyword', keyword);
    if (categoryId) params.append('category_id', categoryId);
    try {
      const res = await api.get(`/ads/auction?${params.toString()}`);
      return res?.ads ?? res?.data?.ads ?? [];
    } catch {
      return [];
    }
  },

  /**
   * Track an ad click for CPA attribution.
   * @param {string} campaignId 
   */
  trackClick(campaignId) {
    if (!campaignId) return;
    try {
      // Store campaign ID with a 24h expiration
      const expiration = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem('x_ad_attribution', JSON.stringify({ campaignId, expiration }));
    } catch (e) {
      // ignore
    }
  },

  /**
   * Get the active CPA attribution campaign ID.
   * @returns {string|null}
   */
  getAttribution() {
    try {
      const data = localStorage.getItem('x_ad_attribution');
      if (!data) return null;
      const { campaignId, expiration } = JSON.parse(data);
      if (Date.now() > expiration) {
        localStorage.removeItem('x_ad_attribution');
        return null;
      }
      return campaignId;
    } catch (e) {
      return null;
    }
  },

  /**
   * Clear the active attribution (e.g. after successful checkout).
   */
  clearAttribution() {
    try {
      localStorage.removeItem('x_ad_attribution');
    } catch (e) {
      // ignore
    }
  },

  // ---- The simple Boost wizard (/advertise, migration 087) -------------------------------------

  /** What this account may boost, its vault balance, the format's limits and the audience choices. */
  async getEasyOptions() {
    return api.get('/ads/easy/options');
  },

  /** `{ people, narrowed, min_audience_size, too_small }` for an audience. */
  async estimateAudience(audience) {
    return api.post('/ads/audience-estimate', { audience });
  },

  /** The server's price and reach estimate for a budget; the client never prices anything itself. */
  async quote(body) {
    const res = await api.post('/ads/quote', body);
    return res?.quote ?? res?.data?.quote ?? null;
  },

  async createCampaign(body) {
    const res = await api.post('/ads/campaigns', body);
    return res?.campaign ?? res?.data?.campaign ?? null;
  },

  async listCampaigns() {
    const res = await api.get('/ads/campaigns');
    return res?.campaigns ?? res?.data?.campaigns ?? [];
  },

  async setCampaignPaused(id, paused) {
    return api.post(`/ads/campaigns/${encodeURIComponent(id)}/${paused ? 'pause' : 'resume'}`, {});
  },
};
