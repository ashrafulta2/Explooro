/**
 * admin.api.js — Client API helper for Super Admin Executive Analytics & System Health (Prompt 11.4).
 */

import { api } from '../core/api.js';

export const adminApi = {
  /**
   * Retrieves Executive Overview with 11 KPIs and timeframe comparison.
   */
  async getOverview(timeframe = '30d') {
    return api.get(`/admin/analytics/overview?timeframe=${timeframe}`);
  },

  /**
   * Retrieves live operational alert cards with deep links.
   */
  async getAlerts() {
    return api.get('/admin/analytics/alerts');
  },

  /**
   * Retrieves system health vitals, DB/cache metrics, and scheduler job runs.
   */
  async getSystemHealth() {
    return api.get('/admin/system/health');
  },

  /**
   * Retrieves backup snapshot history.
   */
  async getBackups(limit = 20) {
    return api.get(`/admin/system/backups?limit=${limit}`);
  },

  /**
   * Triggers a manual backup snapshot creation.
   */
  async triggerBackup() {
    return api.post('/admin/system/backups/trigger', {});
  },

  /**
   * Triggers snapshot verification and restoration (CRITICAL tier).
   */
  async restoreBackup(backupId) {
    return api.post(`/admin/system/backups/${backupId}/restore`, {});
  },

  /**
   * Triggers immediate daily rollup re-calculation.
   */
  async triggerRollup(date = null) {
    return api.post('/admin/analytics/rollup-now', { date });
  },

  /**
   * Retrieves Staff 2FA posture, enforcement policy, and staff enrollment list.
   */
  async get2faStatus() {
    return api.get('/admin/security/2fa');
  },

  /**
   * Updates global 2FA policy.
   */
  async update2faPolicy(policy) {
    return api.post('/admin/security/2fa/policy', policy);
  },

  /**
   * Resets TOTP 2FA for a staff member.
   */
  async resetStaff2fa(staffId) {
    return api.post(`/admin/staff/${staffId}/reset-2fa`, {});
  },

  /**
   * Sends 2FA setup reminder to staff member.
   */
  async remindStaff2fa(staffId) {
    return api.post(`/admin/staff/${staffId}/remind-2fa`, {});
  },

  /**
   * Retrieves Admin IP allowlist entries, current IP, and firewall mode.
   */
  async getIpAllowlist() {
    return api.get('/admin/security/ip-allowlist');
  },

  /**
   * Adds an IP or CIDR subnet to the allowlist.
   */
  async addIpAllowlistEntry(entry) {
    return api.post('/admin/security/ip-allowlist', entry);
  },

  /**
   * Updates an existing allowlist entry.
   */
  async updateIpAllowlistEntry(id, patch) {
    return api.patch(`/admin/security/ip-allowlist/${id}`, patch);
  },

  /**
   * Deletes an IP allowlist entry.
   */
  async deleteIpAllowlistEntry(id) {
    return api.delete(`/admin/security/ip-allowlist/${id}`);
  },

  /**
   * Updates firewall enforcement mode.
   */
  async setIpAllowlistMode(mode) {
    return api.post('/admin/security/ip-allowlist/mode', { mode });
  },

  /**
   * Fetches database and storage backup snapshots.
   */
  async getBackups(limit = 20) {
    return api.get(`/admin/system/backups?limit=${limit}`);
  },

  /**
   * Triggers an on-demand cryptographic backup snapshot.
   */
  async triggerBackup() {
    return api.post('/admin/system/backups/trigger');
  },

  /**
   * Initiates restoration of a specific backup snapshot (CRITICAL audited action).
   */
  async restoreBackup(id) {
    return api.post(`/admin/system/backups/${id}/restore`);
  },

  /**
   * Retrieves profit split configuration, category overrides, trust tier rules, and history.
   */
  async getProfitSplits() {
    return api.get('/admin/finance/splits');
  },

  /**
   * Updates global platform profit split percentages (CRITICAL audited action).
   */
  async updateGlobalSplit({ saler_split_pct, platform_split_pct, min_margin_pct, reason }) {
    return api.put('/admin/finance/splits/default', {
      saler_split_pct,
      platform_split_pct,
      min_margin_pct,
      reason,
    });
  },

  /**
   * Updates or sets category-specific profit split override.
   */
  async updateCategorySplit(categoryId, { saler_split_pct, platform_split_pct, reason }) {
    return api.put(`/admin/finance/splits/categories/${categoryId}`, {
      saler_split_pct,
      platform_split_pct,
      reason,
    });
  },

  /**
   * Clears a category split override and restores it to global default.
   */
  async deleteCategorySplit(categoryId) {
    return api.delete(`/admin/finance/splits/categories/${categoryId}`);
  },

  /**
   * Updates Saler trust tier commission incentive bonuses.
   */
  async updateTierBonuses(tiers, reason) {
    return api.put('/admin/finance/splits/tiers', { tiers, reason });
  },

  /**
   * Simulates margin & split breakdown for given retail price, cost, category, and tier.
   */
  async simulateProfitSplit(params) {
    return api.post('/admin/finance/splits/simulate', params);
  },

  /**
   * Retrieves merchant subscription module status, plans, metrics, and subscriber roster.
   */
  async getSubscriptions() {
    return api.get('/admin/finance/subscriptions');
  },

  /**
   * Updates subscription engine sub-settings (free listing quota, extra fee, grace period).
   */
  async updateSubscriptionSettings(settings) {
    return api.put('/admin/finance/subscriptions/settings', settings);
  },

  /**
   * Creates a new merchant subscription tier plan.
   */
  async createSubscriptionPlan(plan) {
    return api.post('/admin/finance/subscriptions/plans', plan);
  },

  /**
   * Updates an existing subscription tier plan.
   */
  async updateSubscriptionPlan(id, patch) {
    return api.put(`/admin/finance/subscriptions/plans/${id}`, patch);
  },

  /**
   * Updates subscriber status or grants fee waiver/exemption.
   */
  async updateSubscriberStatus(id, patch) {
    return api.patch(`/admin/finance/subscriptions/subscribers/${id}`, patch);
  },

  /**
   * Retrieves all platform service and gateway integrations.
   */
  async getIntegrations(category = 'ALL') {
    return api.get(`/admin/platform/integrations?category=${encodeURIComponent(category)}`);
  },

  /**
   * Updates credentials, configuration or active state for an integration.
   */
  async updateIntegration(id, patch) {
    return api.put(`/admin/platform/integrations/${id}`, patch);
  },

  /**
   * Performs an instant live connection test / handshake ping against a gateway.
   */
  async testIntegration(id) {
    return api.post(`/admin/platform/integrations/${id}/test`, {});
  },

  /**
   * Retrieves recent gateway webhook callback logs.
   */
  async getIntegrationLogs(limit = 30) {
    return api.get(`/admin/platform/integrations/logs?limit=${limit}`);
  },

  /**
   * Retrieves master global platform settings.
   */
  async getPlatformSettings() {
    return api.get('/admin/platform/settings');
  },

  /**
   * Updates master platform governance settings with audit rationale.
   */
  async updatePlatformSettings(settings, reason = '') {
    return api.put('/admin/platform/settings', { settings, reason });
  },

  /**
   * Resets platform settings to system default baseline.
   */
  async resetPlatformSettings(reason = '') {
    return api.post('/admin/platform/settings/reset', { reason });
  },
};


