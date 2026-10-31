/**
 * supplierFlashSale.api.ts — a supplier's own flash sales, and the admin's limits for them
 * (server/src/services/supplierFlashSale.service.ts, migration 096).
 *
 * The supplier pays the discount: the platform's and the partner pool's share of a unit stay what
 * they are at the regular price. Every figure the page shows comes from `quote`, which runs the same
 * pricing function as checkout, so the client never computes a payout itself.
 */

import { api } from '../core/api.ts';

export interface SupplierFlashRules {
  enabled: boolean;
  max_discount_pct: number;
  max_duration_hours: number;
  max_live_deals: number;
  min_listing_days: number;
  updated_at?: string | null;
}

export type RuleLimits = Record<'max_discount_pct' | 'max_duration_hours' | 'max_live_deals' | 'min_listing_days', { min: number; max: number }>;

export interface FlashQuote {
  pricing: {
    regular_price: number;
    deal_price: number;
    discount_pct: number;
    supplier_funded: number;
    supplier_payout: number;
    regular_supplier_payout: number;
    partner_share: number;
    platform_share: number;
  };
  /** Why the deal would be refused (too new, too deep), or null. */
  problem: { code: string; message_en?: string; message_bn?: string; details?: Record<string, any> } | null;
}

const unwrap = <T>(res: any): T => (res?.data ?? res) as T;

export const supplierFlashSaleApi = {
  async overview(query: { limit?: number; offset?: number } = {}) {
    return unwrap<any>(await api.get('/supplier/flash-sales', { query }));
  },
  async quote(productId: number | string, discountPrice: number | string) {
    return unwrap<FlashQuote>(await api.get('/supplier/flash-sales/quote', { query: { product_id: productId, discount_price: discountPrice } }));
  },
  async create(body: Record<string, any>) {
    // WHY idempotent: a double-clicked submit must not start two deals on one product.
    return unwrap<any>(await api.post('/supplier/flash-sales', body, { idempotent: true }));
  },
  async stop(id: number | string) {
    return unwrap<any>(await api.post(`/supplier/flash-sales/${encodeURIComponent(String(id))}/stop`, {}));
  },
  async getRules() {
    return unwrap<{ rules: SupplierFlashRules; limits: RuleLimits }>(await api.get('/admin/growth/campaigns/flash-sales/supplier-rules'));
  },
  /** Raw reply: a delegated admin's save comes back `{ deferred }` (sent for approval), see writeOutcome.ts. */
  saveRules(rules: Omit<SupplierFlashRules, 'updated_at'>, reason: string, expectedUpdatedAt: string | null): Promise<any> {
    return api.put('/admin/growth/campaigns/flash-sales/supplier-rules', { rules, reason, expected_updated_at: expectedUpdatedAt });
  },
};
