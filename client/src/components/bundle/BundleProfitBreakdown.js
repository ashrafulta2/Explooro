/**
 * BundleProfitBreakdown.js — Live Multi-Party Profit & Margin Breakdown Component (Prompt 10.5).
 *
 * Displays a live, transparent financial breakdown for cross-seller combos:
 * - Original Sum of Parts vs Bundle Price vs Discount
 * - Per-Supplier Guaranteed Wholesale Payouts
 * - Saler Profit Split & Commission
 * - Platform Share
 * - Itemized discount apportionment & effective retail prices
 */

import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';

export function createBundleProfitBreakdown({ breakdown = null, showPlatformShare = false } = {}) {
  const container = document.createElement('div');
  container.className = 'bundle-profit-breakdown';

  function render(data) {
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
      total_wholesale_cost,
      total_net_margin,
      total_saler_commission,
      total_platform_margin,
      saler_margin_pct,
      is_multi_supplier,
      supplier_count,
      items = [],
      suppliers = [],
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
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div class="stat-pill p-3 border rounded">
            <span class="text-xs text-muted block uppercase">${t('bundle.sum_of_parts')}</span>
            <span class="text-base font-bold font-mono line-through text-muted">${formatCurrency(sum_of_parts)}</span>
          </div>
          <div class="stat-pill p-3 border rounded bg-surface-hover">
            <span class="text-xs text-muted block uppercase">${t('bundle.bundle_price')}</span>
            <span class="text-lg font-bold font-mono text-primary">${formatCurrency(bundle_price)}</span>
          </div>
          <div class="stat-pill p-3 border rounded bg-success-soft">
            <span class="text-xs text-muted block uppercase">${t('bundle.saler_earning')}</span>
            <span class="text-base font-bold font-mono text-success">${formatCurrency(total_saler_commission)} (${saler_margin_pct}%)</span>
          </div>
          <div class="stat-pill p-3 border rounded">
            <span class="text-xs text-muted block uppercase">${t('bundle.wholesale_cost')}</span>
            <span class="text-base font-bold font-mono">${formatCurrency(total_wholesale_cost)}</span>
          </div>
        </div>

        <!-- Per-Supplier Guaranteed Payouts -->
        <div class="supplier-payouts-section mb-4">
          <h5 class="text-sm font-semibold mb-2 text-muted uppercase tracking-wider">${t('bundle.supplier_payouts_heading')}</h5>
          <div class="space-y-2">
            ${suppliers.map((supp) => `
              <div class="flex-between p-2 rounded border bg-surface-subtle text-sm">
                <div class="flex items-center gap-2">
                  <span class="supplier-icon">🏭</span>
                  <div>
                    <span class="font-medium">${supp.supplier_name}</span>
                    <span class="text-xs text-muted block">${t('bundle.supplier_items_count', { count: supp.item_count })}</span>
                  </div>
                </div>
                <div class="text-right">
                  <span class="font-mono font-semibold">${formatCurrency(supp.total_wholesale_payout)}</span>
                  <span class="text-xs text-muted block">${t('bundle.guaranteed_wholesale')}</span>
                </div>
              </div>
            `).join('')}
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
                  <th class="py-2 text-right">${t('bundle.saler_share')}</th>
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
                    <td class="py-2 text-right font-mono text-success font-semibold">${formatCurrency(it.salerCommission)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t flex-between text-xs text-muted">
          <span>🔒 ${t('bundle.zero_drift_guarantee')}</span>
          ${showPlatformShare && total_platform_margin !== undefined ? `<span>${t('bundle.platform_share_tag', { amount: formatCurrency(total_platform_margin) })}</span>` : ''}
        </div>
      </div>
    `;
  }

  render(breakdown);

  return {
    element: container,
    update: render,
  };
}
