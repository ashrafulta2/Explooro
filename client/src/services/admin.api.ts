/**
 * admin.api.ts — Client API helper for Super Admin Executive Analytics & System Health (Prompt 11.4).
 */

import { api } from '../core/api.ts';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, any>;

/** The three numbers of a profit split, and the mandatory audit reason. */
export interface SplitChange {
  saler_split_pct: number | string;
  platform_split_pct: number | string;
  min_margin_pct?: number | string;
  /** Global-only: the server reads these three and falls back to 10 / 20 / 20 when they are absent. */
  platform_default_profit_pct?: number | string;
  saler_default_profit_pct?: number | string;
  extra_markup_platform_pct?: number | string;
  reason: string;
}

/** A preset (`7d`, `30d`, `90d`, `1y`) or a custom ISO-date pair. */
export type AnalyticsRange = string | { from: string; to: string } | null;

export const adminApi = {
  /**
   * Retrieves Executive Overview with 11 KPIs and timeframe comparison.
   */
  async getOverview(range: AnalyticsRange = '30d') {
    // A preset ('7d' | '30d' | '90d' | '1y') or a custom `{ from, to }` ISO-date pair.
    const qs =
      typeof range === 'object' && range?.from && range?.to
        ? `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
        : `timeframe=${encodeURIComponent(typeof range === 'string' ? range : '30d')}`;
    return api.get(`/admin/analytics/overview?${qs}`);
  },

  /**
   * Fetches the data for a CSV export (same figures as getOverview). Kept separate from the read
   * because the server gates it on `admin.analytics.export` and writes an audit row.
   */
  async exportOverview(range: AnalyticsRange = '30d') {
    const body =
      typeof range === 'object' && range?.from && range?.to
        ? { from: range.from, to: range.to }
        : { timeframe: typeof range === 'string' ? range : '30d' };
    return api.post('/admin/analytics/export', body);
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
   * Triggers immediate daily rollup re-calculation.
   */
  async triggerRollup(date: string | null = null) {
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
  async update2faPolicy(policy: Params) {
    return api.post('/admin/security/2fa/policy', policy);
  },

  /**
   * Resets TOTP 2FA for a staff member.
   */
  async resetStaff2fa(staffId: number | string) {
    return api.post(`/admin/staff/${staffId}/reset-2fa`, {});
  },

  /**
   * Sends 2FA setup reminder to staff member.
   */
  async remindStaff2fa(staffId: number | string) {
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
  async addIpAllowlistEntry(entry: Params) {
    return api.post('/admin/security/ip-allowlist', entry);
  },

  /**
   * Updates an existing allowlist entry.
   */
  async updateIpAllowlistEntry(id: number | string, patch: Params) {
    return api.patch(`/admin/security/ip-allowlist/${id}`, patch);
  },

  /**
   * Deletes an IP allowlist entry.
   */
  async deleteIpAllowlistEntry(id: number | string) {
    return api.delete(`/admin/security/ip-allowlist/${id}`);
  },

  /**
   * Updates firewall enforcement mode.
   */
  async setIpAllowlistMode(mode: string) {
    return api.post('/admin/security/ip-allowlist/mode', { mode });
  },

  /**
   * Fetches database and storage backup snapshots.
   */
  async getBackups(limit: number = 20) {
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
  async restoreBackup(id: number | string) {
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
  // WHY the three profit fields are forwarded: finance.controller reads them from the body and answers
  // a missing one with its default (10 / 20 / 20), so a save that dropped them reset those values.
  async updateGlobalSplit({
    saler_split_pct,
    platform_split_pct,
    min_margin_pct,
    platform_default_profit_pct,
    saler_default_profit_pct,
    extra_markup_platform_pct,
    reason,
  }: SplitChange) {
    return api.put('/admin/finance/splits/default', {
      saler_split_pct,
      platform_split_pct,
      min_margin_pct,
      platform_default_profit_pct,
      saler_default_profit_pct,
      extra_markup_platform_pct,
      reason,
    });
  },

  /**
   * Updates or sets category-specific profit split override.
   */
  async updateCategorySplit(categoryId: number | string, { saler_split_pct, platform_split_pct, reason }: SplitChange) {
    return api.put(`/admin/finance/splits/categories/${categoryId}`, {
      saler_split_pct,
      platform_split_pct,
      reason,
    });
  },

  /**
   * Clears a category split override and restores it to global default.
   */
  async deleteCategorySplit(categoryId: number | string) {
    return api.delete(`/admin/finance/splits/categories/${categoryId}`);
  },

  /** Default retail markup % and the rounding step (retailMarkup.service.ts). */
  async updateMarkup({ default_markup_pct, round_to_bdt, reason }: { default_markup_pct: number; round_to_bdt: number; reason: string }) {
    return api.put('/admin/finance/markup', { default_markup_pct, round_to_bdt, reason });
  },

  async updateCategoryMarkup(categoryId: number | string, { markup_pct, reason }: { markup_pct: number; reason: string }) {
    return api.put(`/admin/finance/markup/categories/${categoryId}`, { markup_pct, reason });
  },

  // WHY the reason in the query: a DELETE body is dropped by some proxies; the server reads either.
  async resetCategoryMarkup(categoryId: number | string, reason: string) {
    return api.delete(`/admin/finance/markup/categories/${categoryId}?reason=${encodeURIComponent(reason)}`);
  },

  /** Re-prices existing products from today's markup; no category = every product. */
  async repriceFromMarkup({ category_id, reason }: { category_id?: number | string | null; reason: string }) {
    return api.post('/admin/finance/markup/reprice', { category_id: category_id ?? null, reason });
  },

  /**
   * Updates Shop Partner trust tier commission incentive bonuses and, optionally, the volume ladder
   * ({ enabled, window_days, thresholds }) that decides which tier a shop partner is in. One request, so a
   * rejected ladder never leaves the bonuses half-saved.
   */
  async updateTierBonuses(tiers: Params, reason: string, rules?: Params) {
    return api.put('/admin/finance/splits/tiers', { tiers, reason, ...(rules ? { rules } : {}) });
  },

  /**
   * Simulates margin & split breakdown for given retail price, cost, category, and tier.
   */
  async simulateProfitSplit(params: Params) {
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
  async updateSubscriptionSettings(settings: Params) {
    return api.put('/admin/finance/subscriptions/settings', settings);
  },

  /**
   * Creates a new merchant subscription tier plan.
   */
  async createSubscriptionPlan(plan: Params) {
    return api.post('/admin/finance/subscriptions/plans', plan);
  },

  /**
   * Updates an existing subscription tier plan.
   */
  async updateSubscriptionPlan(id: number | string, patch: Params) {
    return api.put(`/admin/finance/subscriptions/plans/${id}`, patch);
  },

  /**
   * Updates subscriber status or grants fee waiver/exemption.
   */
  async updateSubscriberStatus(id: number | string, patch: Params) {
    return api.patch(`/admin/finance/subscriptions/subscribers/${id}`, patch);
  },

  /**
   * Retrieves all platform service and gateway integrations.
   */
  async getIntegrations(category: string = 'ALL') {
    return api.get(`/admin/platform/integrations?category=${encodeURIComponent(category)}`);
  },

  /**
   * Updates credentials, configuration or active state for an integration.
   */
  async updateIntegration(id: number | string, patch: Params) {
    return api.put(`/admin/platform/integrations/${id}`, patch);
  },

  /**
   * Performs an instant live connection test / handshake ping against a gateway.
   */
  async testIntegration(id: number | string) {
    return api.post(`/admin/platform/integrations/${id}/test`, {});
  },

  /**
   * Retrieves recent gateway webhook callback logs.
   */
  async getIntegrationLogs(limit: number = 30) {
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
  async updatePlatformSettings(settings: Params, reason: string = '') {
    return api.put('/admin/platform/settings', { settings, reason });
  },

  /**
   * Resets platform settings to system default baseline.
   */
  async resetPlatformSettings(reason: string = '') {
    return api.post('/admin/platform/settings/reset', { reason });
  },

  /**
   * Reads the language policy plus who may change it and the recent change history.
   */
  async getLocalizationPolicy() {
    return api.get('/admin/platform/localization');
  },

  /**
   * Writes the language policy. `reason` is mandatory (min 10 chars) and lands in audit_logs
   * alongside the before/after values — the API rejects the call without it.
   */
  async updateLocalizationPolicy({ default_locale, enabled_locales, allow_user_override, reason }: { default_locale?: string; enabled_locales?: string[]; allow_user_override?: boolean; reason: string }) {
    return api.put('/admin/platform/localization', {
      default_locale,
      enabled_locales,
      allow_user_override,
      reason,
    });
  },

  /**
   * Reads the popup genie-effect policy plus who may change it and the recent change history.
   */
  async getGeniePolicy() {
    return api.get('/admin/platform/genie');
  },

  /**
   * Writes the popup genie-effect policy. `reason` is mandatory (min 10 chars) and lands in
   * audit_logs alongside the before/after values — the API rejects the call without it.
   */
  async updateGeniePolicy({ enabled, duration_ms, quality, reason }: { enabled?: boolean; duration_ms?: number; quality?: string; reason: string }) {
    return api.put('/admin/platform/genie', { enabled, duration_ms, quality, reason });
  },

  /**
   * Reads every personalized-feed section (weights, windows, rails, diversity, co-visitation, cache)
   * as the system is running it, plus who may change them, the change history and the cache counters.
   */
  async getRecommendationSettings() {
    return api.get('/admin/platform/recommendations');
  },

  /** Which surface works: impressions, clicks and click-attributed carts / purchases per surface. */
  async getRecommendationFunnel({ days, attribution_days }: { days?: number; attribution_days?: number } = {}) {
    const q = new URLSearchParams();
    if (days) q.set('days', String(days));
    if (attribution_days) q.set('attribution_days', String(attribution_days));
    const qs = q.toString();
    return api.get(`/admin/platform/recommendations/funnel${qs ? `?${qs}` : ''}`);
  },

  /**
   * Saves ONE section. `reason` is mandatory (min 10 chars) and lands in audit_logs with the before/after.
   * `base_updated_at` is the section's updated_at when the form was loaded: a mismatch is a 409, not a
   * silent overwrite of another admin's change.
   */
  async updateRecommendationSection(section: string, { value, reason, base_updated_at = null }: { value: unknown; reason: string; base_updated_at?: string | null }) {
    return api.put(`/admin/platform/recommendations/${encodeURIComponent(section)}`, { value, reason, base_updated_at });
  },
};


