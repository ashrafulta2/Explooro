import { api } from '../core/api.js';

export const adsApi = {
  /**
   * Fetch reserved placements for a specific surface on the current date.
   * @param {string} placement - e.g., 'HOMEPAGE_HERO', 'STORE_DIRECTORY', 'LIVE_LOBBY', 'FLASH_SLOT', 'CATEGORY_BANNER'
   * @param {number} [categoryId] - Optional category ID for CATEGORY_BANNER
   */
  async listReservedPlacements(placement, categoryId = null) {
    const params = new URLSearchParams({ placement });
    if (categoryId) params.append('categoryId', categoryId);
    
    // We get the local timezone date string in YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0];
    params.append('date', today);

    return api.get(`/ads/reserved?${params.toString()}`);
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
  }
};
