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
};
