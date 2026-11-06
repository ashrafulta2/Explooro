/**
 * saler.api.ts — Client API helper for Explooro Partner Dashboard & Analytics (Prompt 11.2).
 */

import { api } from '../core/api.ts';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, any>;

export const salerApi = {
  /**
   * Fetches the unified Explooro partner dashboard overview metrics and store state.
   */
  async getDashboard() {
    return api.get('/saler/dashboard');
  },

  /**
   * The Explooro partner's earned commission tier: tier, bonus, delivered volume in the window and the way to the
   * next tier. `enabled: false` means the platform has tiers switched off.
   */
  async getCommissionTier() {
    return api.get('/saler/commission-tier');
  },

  /**
   * The Explooro partner's own Partner Score: score, band, boost, points per metric and the metric with
   * the most points left to win. `is_new` until enough orders have come through their store or links.
   */
  async getPartnerScore() {
    return api.get('/saler/partner-score');
  },

  /**
   * This month's reward pool estimate for the caller (points per factor, share, estimated taka) and
   * their last payouts. Only their own numbers; the server never sends another partner's.
   */
  async getPartnerReward() {
    return api.get('/saler/partner-reward');
  },

  /**
   * Fetches detailed time-series analytics, traffic breakdown, and product performance.
   * @param {{ range?: '7d' | '30d' | '90d' }} [params]
   */
  async getAnalytics({ range = '30d' }: { range?: '7d' | '30d' | '90d' } = {}) {
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
   * Fetches one page of the curated products in the Explooro partner's store, hidden ones included.
   * @param {{ limit?: number, offset?: number }} [params]
   */
  async getProducts(params: Params = {}) {
    return api.get('/saler/products', { query: params });
  },

  /**
   * Shows or hides a curated item on the storefront. Only `is_active` may change: a price is refused
   * with 422 PRICE_LOCKED (the supplier sets every price).
   * @param {number|string} id the store item's id (`products[].id`), not the product id
   * @param {object} payload
   */
  async updateProduct(id: number | string, payload: Params) {
    return api.patch(`/saler/products/${id}`, payload);
  },

  /**
   * Removes a product from the Explooro partner's curated store.
   * @param {number|string} id the store item's id (`products[].id`), not the product id
   */
  async removeProduct(id: number | string) {
    return api.delete(`/saler/products/${id}`);
  },

  /**
   * Fetches the Explooro partner's physical shop and showroom operational status.
   */
  async getStoreStatus() {
    return api.get('/saler/store-status');
  },

  /**
   * Updates physical shop status, schedule, address, or pickup settings.
   * @param {object} payload
   */
  async updateStoreStatus(payload: Params) {
    return api.patch('/saler/store-status', payload);
  },

  /**
   * Fetches Explooro Partner orders with commission breakdowns.
   * @param {{ status?: string, search?: string, limit?: number }} [params]
   */
  async getOrders(params: Params = {}) {
    return api.get('/saler/orders', { query: params });
  },

  /**
   * Fetches full order detail for a Explooro partner order.
   * @param {number|string} id
   */
  async getOrderDetail(id: number | string) {
    return api.get(`/saler/orders/${id}`);
  },

  /**
   * Fetches Explooro partner vault payouts history and balance summary.
   */
  async getPayouts() {
    return api.get('/saler/vault/payouts');
  },

  /**
   * Requests an instant payout withdrawal.
   * @param {{ amount: number, method: string, account_number: string, account_name?: string }} payload
   */
  async requestPayout(payload: Params) {
    return api.post('/saler/vault/payouts', payload);
  },

  /**
   * Cancels a pending payout request.
   * @param {number|string} id
   */
  async cancelPayout(id: number | string) {
    return api.post(`/saler/vault/payouts/${id}/cancel`);
  },

  /**
   * Fetches Explooro partner daily and weekly missions and quest progress.
   */
  async getQuests() {
    return api.get('/saler/quests');
  },

  /**
   * Claims reward for a completed quest.
   * @param {number|string} id
   */
  async claimQuest(id: number | string) {
    return api.post(`/saler/quests/${id}/claim`);
  },

  /**
   * Fetches monthly merchant leaderboard.
   * @param {{ period?: 'this_month' | 'this_week' | 'all_time' }} [params]
   */
  async getLeaderboard(params: Params = {}) {
    return api.get('/saler/leaderboard', { query: params });
  },

  /**
   * Generates or fetches social Explooro partner kit marketing templates.
   */
  async getSocialKitTemplates() {
    return api.get('/saler/social-kit/templates');
  },

  /**
   * Generates a tracked affiliate short link for social marketing.
   * @param {{ product_id?: number|string, source_channel?: string }} payload
   */
  async createSocialKitLink(payload: Params) {
    return api.post('/saler/social-kit/links', payload);
  },

  /**
   * Explooro Partner Pro: the plans on offer, the caller's live subscription and recent invoices.
   * Only reachable while the `subscription_fees` module is ON.
   */
  async getSubscription() {
    return api.get('/subscriptions/me');
  },

  /**
   * Subscribes to a plan; a paid plan is charged from the Vault up front.
   * @param {{ plan_id: number|string, auto_renew?: boolean }} payload
   */
  async subscribeToPlan(payload: Params) {
    return api.post('/subscriptions/subscribe', payload);
  },

  /** Stops renewal; benefits run until the paid period ends. */
  async cancelSubscription() {
    return api.post('/subscriptions/cancel');
  },

  /** Undoes a pending cancellation. */
  async resumeSubscription() {
    return api.post('/subscriptions/resume');
  },
};
