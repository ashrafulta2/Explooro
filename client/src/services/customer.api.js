import { api } from '../core/api.js';

export const customerApi = {
  /**
   * Fetches customer dashboard summary telemetry.
   */
  async getDashboard() {
    return api.get('/customer/dashboard');
  },

  /**
   * Fetches customer orders with tracking and item details.
   */
  async getOrders(params = {}) {
    const searchParams = new URLSearchParams();
    if (params.status && params.status !== 'ALL') searchParams.set('status', params.status);
    if (params.limit) searchParams.set('limit', params.limit);
    if (params.offset) searchParams.set('offset', params.offset);

    const qs = searchParams.toString();
    return api.get(`/customer/orders${qs ? `?${qs}` : ''}`);
  },

  /**
   * Fetches following feed (product drops, live streams, stories from followed sellers).
   */
  async getFollowingFeed() {
    return api.get('/customer/following-feed');
  },

  /**
   * Toggles following a store.
   */
  async toggleFollow(storeId) {
    return api.post(`/customer/follow/${storeId}`);
  },

  /**
   * 1-Click genuine saler upgrade.
   */
  async becomeSaler() {
    return api.post('/customer/become-saler');
  },

  /**
   * Triggers wishlist price-drop evaluation.
   */
  async checkPriceDrops() {
    return api.post('/customer/wishlist/check-price-drops');
  },
};
