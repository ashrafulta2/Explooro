/**
 * saler.api.js — Client API helper for Saler Dashboard & Analytics (Prompt 11.2).
 */

import { api } from '../core/api.js';

export const salerApi = {
  /**
   * Fetches the unified saler dashboard overview metrics and store state.
   */
  async getDashboard() {
    return api.get('/saler/dashboard');
  },

  /**
   * Fetches detailed time-series analytics, traffic breakdown, and product performance.
   * @param {{ range?: '7d' | '30d' | '90d' }} [params]
   */
  async getAnalytics({ range = '30d' } = {}) {
    return api.get('/saler/analytics', { query: { range } });
  },

  /**
   * Fetches first-run onboarding checklist status and video walkthrough metadata.
   */
  async getOnboarding() {
    return api.get('/saler/onboarding');
  },

  /**
   * Fetches grounded AI prescriptive growth recommendations with 1-click action triggers.
   */
  async getGrowthRecommendations() {
    return api.get('/saler/growth-assistant');
  },

  /**
   * Fetches curated products in the saler's store.
   * @param {{ category?: string, in_stock?: boolean, sort?: string, search?: string }} [params]
   */
  async getProducts(params = {}) {
    return api.get('/saler/products', { query: params });
  },

  /**
   * Updates a curated product's custom retail price, markup, or visibility.
   * @param {number|string} id
   * @param {object} payload
   */
  async updateProduct(id, payload) {
    return api.patch(`/saler/products/${id}`, payload);
  },

  /**
   * Removes a product from the saler's curated store.
   * @param {number|string} id
   */
  async removeProduct(id) {
    return api.delete(`/saler/products/${id}`);
  },

  /**
   * Fetches the saler's physical shop and showroom operational status.
   */
  async getStoreStatus() {
    return api.get('/saler/store-status');
  },

  /**
   * Updates physical shop status, schedule, address, or pickup settings.
   * @param {object} payload
   */
  async updateStoreStatus(payload) {
    return api.patch('/saler/store-status', payload);
  },

  /**
   * Fetches saler reseller orders with commission breakdowns.
   * @param {{ status?: string, search?: string, limit?: number }} [params]
   */
  async getOrders(params = {}) {
    return api.get('/saler/orders', { query: params });
  },

  /**
   * Fetches full order detail for a saler order.
   * @param {number|string} id
   */
  async getOrderDetail(id) {
    return api.get(`/saler/orders/${id}`);
  },

  /**
   * Fetches saler vault payouts history and balance summary.
   */
  async getPayouts() {
    return api.get('/saler/vault/payouts');
  },

  /**
   * Requests an instant payout withdrawal.
   * @param {{ amount: number, method: string, account_number: string, account_name?: string }} payload
   */
  async requestPayout(payload) {
    return api.post('/saler/vault/payouts', payload);
  },

  /**
   * Cancels a pending payout request.
   * @param {number|string} id
   */
  async cancelPayout(id) {
    return api.post(`/saler/vault/payouts/${id}/cancel`);
  },

  /**
   * Fetches saler daily and weekly missions and quest progress.
   */
  async getQuests() {
    return api.get('/saler/quests');
  },

  /**
   * Claims reward for a completed quest.
   * @param {number|string} id
   */
  async claimQuest(id) {
    return api.post(`/saler/quests/${id}/claim`);
  },

  /**
   * Fetches monthly merchant leaderboard.
   * @param {{ period?: 'this_month' | 'this_week' | 'all_time' }} [params]
   */
  async getLeaderboard(params = {}) {
    return api.get('/saler/leaderboard', { query: params });
  },

  /**
   * Generates or fetches social seller kit marketing templates.
   */
  async getSocialKitTemplates() {
    return api.get('/saler/social-kit/templates');
  },

  /**
   * Generates a tracked affiliate short link for social marketing.
   * @param {{ product_id?: number|string, source_channel?: string }} payload
   */
  async createSocialKitLink(payload) {
    return api.post('/saler/social-kit/links', payload);
  },
};
