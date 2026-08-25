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
};
