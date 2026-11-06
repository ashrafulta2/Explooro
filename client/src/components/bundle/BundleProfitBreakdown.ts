/**
 * BundleProfitBreakdown.ts — Live Multi-Party Profit & Margin Breakdown Component (Prompt 10.5).
 *
 * Displays a live price breakdown for cross-seller combos:
 * - Original Sum of Parts vs Bundle Price vs Discount
 * - Itemized discount apportionment & effective retail prices
 * - Platform Share, only when a caller passes showPlatformShare (none does on a partner page)
 *
 * WHY no partner profit, wholesale cost or supplier payouts (owner, 2026-11-02): the Explooro partner
 * building the bundle is shown no per-product profit and never the supplier's cost.
 */

import { t } from '../../services/i18n.ts';
import { formatCurrency } from '../../services/format.ts';

type Figure = number | string;

/** One line of the bundle, with its discount apportioned. */
export interface BundleItem {
  productTitleEn: string;
  variantTitle?: string;
  qty: number;
  originalRetailPrice: Figure;
  discountShare: Figure;
  effectiveUnitPrice: Figure;
  salerCommission: Figure;
}

export interface BundleSupplierPayout {
  supplier_name: string;
  item_count: number;
  total_wholesale_payout: Figure;
}

/** The server's live breakdown for a bundle. Every figure is the server's; none is derived here. */
export interface BundleBreakdown {
  sum_of_parts: Figure;
  bundle_price: Figure;
  discount_amount: Figure;
  discount_pct: Figure;
  total_wholesale_cost: Figure;
  total_net_margin?: Figure;
  total_saler_commission: Figure;
  total_platform_margin?: Figure;
  saler_margin_pct: Figure;
  is_multi_supplier?: boolean;
  supplier_count?: number;
  items?: BundleItem[];
  suppliers?: BundleSupplierPayout[];
}

export function createBundleProfitBreakdown({
  breakdown = null,
  showPlatformShare = false,
}: { breakdown?: BundleBreakdown | null; showPlatformShare?: boolean } = {}): {
  element: HTMLDivElement;
  update(data: BundleBreakdown | null): void;
} {
  const container = document.createElement('div');
  container.className = 'bundle-profit-breakdown';

  function render(data: BundleBreakdown | null): void {
    if (!data) {
      container.innerHTML = `
        <div class="bundle-breakdown-empty">
          <p class="text-muted">${t('bundle.empty_breakdown_prompt')}</p>
        </div>
      `;
      return;
    }

    const {
      sum_of_parts,
      bundle_price,
      discount_amount,
      discount_pct,
      total_platform_margin,
      is_multi_supplier,
      supplier_count,
      items = [],
    } = data;

    container.innerHTML = `
      <div class="card p-4 bundle-breakdown-card">
        <div class="bundle-breakdown-header mb-4 flex-between">
          <div>
            <h4 class="m-0 font-bold">${t('bundle.breakdown_title')}</h4>
            <p class="text-sm text-muted m-0 mt-1">
              ${is_multi_supplier
                ? t('bundle.multi_supplier_badge', { count: supplier_count })
                : t('bundle.single_supplier_badge')}
            </p>
          </div>
          <div class="discount-badge badge badge-primary font-mono text-sm px-3 py-1">
            ${t('bundle.discount_tag', { pct: discount_pct })} (-${formatCurrency(discount_amount)})
          </div>
        </div>

        <!-- Top Level Metric Cards -->
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="stat-pill p-3 border rounded">
            <span class="text-xs text-muted block uppercase">${t('bundle.sum_of_parts')}</span>
            <span class="text-base font-bold font-mono line-through text-muted">${formatCurrency(sum_of_parts)}</span>
          </div>
          <div class="stat-pill p-3 border rounded bg-surface-hover">
            <span class="text-xs text-muted block uppercase">${t('bundle.bundle_price')}</span>
            <span class="text-lg font-bold font-mono text-primary">${formatCurrency(bundle_price)}</span>
          </div>
        </div>

        <!-- Itemized Discount Apportionment Table -->
        <div class="itemized-breakdown-section">
          <h5 class="text-sm font-semibold mb-2 text-muted uppercase tracking-wider">${t('bundle.itemized_apportionment')}</h5>
          <div class="table-responsive">
            <table class="table w-full text-xs">
              <thead>
                <tr class="border-b text-muted text-left">
                  <th class="py-2">${t('bundle.product')}</th>
                  <th class="py-2 text-right">${t('bundle.qty')}</th>
                  <th class="py-2 text-right">${t('bundle.original_retail')}</th>
                  <th class="py-2 text-right">${t('bundle.discount_share')}</th>
                  <th class="py-2 text-right">${t('bundle.effective_price')}</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((it) => `
                  <tr class="border-b">
                    <td class="py-2 font-medium">
                      ${it.productTitleEn}
                      ${it.variantTitle ? `<span class="text-muted block text-xs">(${it.variantTitle})</span>` : ''}
                    </td>
                    <td class="py-2 text-right font-mono">${it.qty}</td>
                    <td class="py-2 text-right font-mono text-muted line-through">${formatCurrency(it.originalRetailPrice)}</td>
                    <td class="py-2 text-right font-mono text-danger">-${formatCurrency(it.discountShare)}</td>
                    <td class="py-2 text-right font-mono font-semibold">${formatCurrency(it.effectiveUnitPrice)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        ${showPlatformShare && total_platform_margin !== undefined ? `<div class="mt-4 pt-3 border-t flex-between text-xs text-muted"><span>${t('bundle.platform_share_tag', { amount: formatCurrency(total_platform_margin) })}</span></div>` : ''}
      </div>
    `;
  }

  render(breakdown);

  return {
    element: container,
    update: render,
  };
}
