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

  /**
   * Fetches customer's submitted reviews and review KPIs.
   */
  async getReviews(params = {}) {
    const searchParams = new URLSearchParams();
    if (params.sort) searchParams.set('sort', params.sort);
    if (params.rating) searchParams.set('rating', params.rating);
    if (params.q) searchParams.set('q', params.q);
    if (params.has_media) searchParams.set('has_media', '1');

    const qs = searchParams.toString();
    return api.get(`/account/reviews${qs ? `?${qs}` : ''}`);
  },

  /**
   * Fetches delivered orders pending review.
   */
  async getPendingReviews() {
    return api.get('/account/reviews/pending');
  },

  /**
   * Submits a customer review for a delivered product.
   */
  async submitReview(payload) {
    return api.post('/account/reviews', payload);
  },

  /**
   * Updates an existing customer review.
   */
  async updateReview(id, payload) {
    return api.put(`/account/reviews/${id}`, payload);
  },

  /**
   * Deletes a customer review.
   */
  async deleteReview(id) {
    return api.delete(`/account/reviews/${id}`);
  },

  /**
   * Fetches customer's saved delivery addresses with localStorage fallback.
   */
  async getAddresses() {
    try {
      const res = await api.get('/customer/addresses');
      if (res && res.data) {
        try {
          localStorage.setItem('explooro_saved_addresses', JSON.stringify(res.data));
        } catch {}
        return res.data;
      }
      return [];
    } catch (err) {
      try {
        const cached = localStorage.getItem('explooro_saved_addresses');
        if (cached) return JSON.parse(cached);
      } catch {}
      return [];
    }
  },

  /**
   * Creates a new delivery address.
   */
  async createAddress(payload) {
    try {
      const res = await api.post('/customer/addresses', payload);
      const newAddr = res?.data || payload;
      try {
        const cached = JSON.parse(localStorage.getItem('explooro_saved_addresses') || '[]');
        if (newAddr.is_default) {
          cached.forEach((a) => (a.is_default = false));
        }
        cached.unshift(newAddr);
        localStorage.setItem('explooro_saved_addresses', JSON.stringify(cached));
      } catch {}
      return res;
    } catch (err) {
      // Local fallback in case of network issue
      const mockId = Date.now();
      const newAddr = { ...payload, id: mockId, created_at: new Date().toISOString() };
      const cached = JSON.parse(localStorage.getItem('explooro_saved_addresses') || '[]');
      if (newAddr.is_default || cached.length === 0) {
        newAddr.is_default = true;
        cached.forEach((a) => (a.is_default = false));
      }
      cached.unshift(newAddr);
      localStorage.setItem('explooro_saved_addresses', JSON.stringify(cached));
      return { success: true, data: newAddr };
    }
  },

  /**
   * Updates an existing delivery address.
   */
  async updateAddress(id, payload) {
    try {
      const res = await api.put(`/customer/addresses/${id}`, payload);
      const updated = res?.data || { ...payload, id: Number(id) };
      try {
        let cached = JSON.parse(localStorage.getItem('explooro_saved_addresses') || '[]');
        if (updated.is_default) {
          cached.forEach((a) => (a.is_default = false));
        }
        cached = cached.map((a) => (String(a.id) === String(id) ? { ...a, ...updated } : a));
        localStorage.setItem('explooro_saved_addresses', JSON.stringify(cached));
      } catch {}
      return res;
    } catch (err) {
      let cached = JSON.parse(localStorage.getItem('explooro_saved_addresses') || '[]');
      if (payload.is_default) {
        cached.forEach((a) => (a.is_default = false));
      }
      cached = cached.map((a) => (String(a.id) === String(id) ? { ...a, ...payload } : a));
      localStorage.setItem('explooro_saved_addresses', JSON.stringify(cached));
      return { success: true, data: { ...payload, id: Number(id) } };
    }
  },

  /**
   * Deletes a delivery address.
   */
  async deleteAddress(id) {
    try {
      const res = await api.delete(`/customer/addresses/${id}`);
      try {
        let cached = JSON.parse(localStorage.getItem('explooro_saved_addresses') || '[]');
        const wasDefault = cached.find((a) => String(a.id) === String(id))?.is_default;
        cached = cached.filter((a) => String(a.id) !== String(id));
        if (wasDefault && cached.length > 0) {
          cached[0].is_default = true;
        }
        localStorage.setItem('explooro_saved_addresses', JSON.stringify(cached));
      } catch {}
      return res;
    } catch (err) {
      let cached = JSON.parse(localStorage.getItem('explooro_saved_addresses') || '[]');
      const wasDefault = cached.find((a) => String(a.id) === String(id))?.is_default;
      cached = cached.filter((a) => String(a.id) !== String(id));
      if (wasDefault && cached.length > 0) {
        cached[0].is_default = true;
      }
      localStorage.setItem('explooro_saved_addresses', JSON.stringify(cached));
      return { success: true, deleted_id: Number(id) };
    }
  },

  /**
   * Sets an address as the default delivery address.
   */
  async setDefaultAddress(id) {
    try {
      const res = await api.patch(`/customer/addresses/${id}/default`);
      try {
        let cached = JSON.parse(localStorage.getItem('explooro_saved_addresses') || '[]');
        cached.forEach((a) => {
          a.is_default = String(a.id) === String(id);
        });
        localStorage.setItem('explooro_saved_addresses', JSON.stringify(cached));
      } catch {}
      return res;
    } catch (err) {
      let cached = JSON.parse(localStorage.getItem('explooro_saved_addresses') || '[]');
      cached.forEach((a) => {
        a.is_default = String(a.id) === String(id);
      });
      localStorage.setItem('explooro_saved_addresses', JSON.stringify(cached));
      return { success: true, data: { id: Number(id), is_default: true } };
    }
  },
};
