/**
 * SalerInsightsPage.js — Supplier Saler Network Analytics & Curators Leaderboard (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AL.1:
 * - Real-time analytics on which Salers curate and sell the supplier's products most effectively.
 * - Revenue, commission, and order volume breakdowns.
 * - Full-width Top Salers Leaderboard with instant search and curator detail modals.
 * - Full-width Regional Demand Breakdown card placed underneath with spacious 4-column district grid.
 */

import { supplierApi } from '../../services/supplier.api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function SalerInsightsPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  let insights = null;
  let loading = true;
  let searchQuery = '';

  async function loadInsights() {
    loading = true;
    render();
    try {
      const res = await supplierApi.getSalerInsights();
      insights = res.data || res || { top_salers: [], regional_distribution: [] };
    } catch (err) {
      console.error('Failed to load saler insights:', err);
      toast.error(t('supplier.salers_load_failed', 'Failed to load saler insights.'));
      insights = { top_salers: [], regional_distribution: [] };
    } finally {
      loading = false;
      render();
    }
  }

  function openBroadcastModal() {
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <p style="font-size: var(--text-sm); color: var(--text-secondary); margin: 0;">
        ${t('supplier.si_bc_intro')}
      </p>
      <div class="supplier-form-field">
        <label>${t('supplier.si_bc_type')}</label>
        <select class="form-select" id="broadcast-type">
          <option value="margin_boost">${t('supplier.si_bc_opt_margin')}</option>
          <option value="bulk_discount">${t('supplier.si_bc_opt_bulk')}</option>
          <option value="new_arrival">${t('supplier.si_bc_opt_new')}</option>
        </select>
      </div>
      <div class="supplier-form-field">
        <label>${t('supplier.si_bc_target')}</label>
        <select class="form-select" id="broadcast-target">
          <option value="all">${t('supplier.si_bc_t_all', { n: insights?.top_salers?.length || 0 })}</option>
          <option value="top_tier">${t('supplier.si_bc_t_top')}</option>
          <option value="dhaka">${t('supplier.si_bc_t_dhaka')}</option>
        </select>
      </div>
      <div class="supplier-form-field">
        <label>${t('supplier.si_bc_msg')}</label>
        <textarea class="form-textarea" id="broadcast-message" rows="3" placeholder="${t('supplier.si_bc_msg_ph')}"></textarea>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-broadcast-btn">${t('supplier.si_cancel')}</button>
      <button class="btn btn--primary btn--sm" id="send-broadcast-btn"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg> ${t('supplier.si_bc_send')}</button>
    `;

    const modal = Modal({
      title: `📢 ${t('supplier.si_bc_title')}`,
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-broadcast-btn').onclick = () => modal.close();
    footer.querySelector('#send-broadcast-btn').onclick = () => {
      toast.success(t('supplier.si_bc_sent'));
      modal.close();
    };
  }

  function openSalerDetailModal(saler) {
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '16px';
    content.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; background: var(--surface-1); padding: 12px 16px; border-radius: var(--radius-lg); border: 1px solid var(--border-subtle);">
        <div>
          <div style="font-weight: 800; font-size: var(--text-base); color: var(--text-primary);">${saler.saler_name}</div>
          <div class="text-xs text-muted">${t('supplier.si_d_storefront')} <span class="font-mono text-brand font-bold">explooro.com/store/${saler.store_slug || saler.slug || 'store'}</span></div>
        </div>
        <span class="badge badge--success font-bold text-xs">${t('supplier.si_d_verified')}</span>
      </div>

      <div class="supplier-kpi-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;">
        <div class="supplier-kpi-card" style="padding: 12px;">
          <span class="supplier-kpi-card__label">${t('supplier.si_d_skus')}</span>
          <div style="font-weight: 800; font-size: 1.15rem; color: var(--text-primary); margin-top: 2px;">${t('supplier.si_items_n', { n: saler.curated_products_count || saler.curated_sku_count || 0 })}</div>
        </div>
        <div class="supplier-kpi-card" style="padding: 12px;">
          <span class="supplier-kpi-card__label">${t('supplier.si_d_orders')}</span>
          <div style="font-weight: 800; font-size: 1.15rem; color: var(--text-primary); margin-top: 2px;">${t('supplier.si_orders_n', { n: saler.total_orders_sold || 0 })}</div>
        </div>
        <div class="supplier-kpi-card" style="padding: 12px;">
          <span class="supplier-kpi-card__label">${t('supplier.si_d_volume')}</span>
          <div style="font-weight: 800; font-size: 1.15rem; color: var(--success); margin-top: 2px;">${formatCurrency(saler.total_revenue_generated || 0)}</div>
        </div>
      </div>

      <div>
        <h4 style="font-size: var(--text-xs); font-weight: 800; text-transform: uppercase; color: var(--text-secondary); margin: 0 0 8px 0;">
          ${t('supplier.si_d_collab')}
        </h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="btn btn--sm btn--outline" id="grant-margin-btn" style="text-align: left; justify-content: flex-start;">
            ${t('supplier.si_d_grant')}
          </button>
          <button class="btn btn--sm btn--outline" id="send-direct-msg-btn" style="text-align: left; justify-content: flex-start;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> ${t('supplier.si_d_message')}
          </button>
        </div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="done-saler-btn">${t('supplier.si_close')}</button>
    `;

    const modal = Modal({
      title: saler.store_name || saler.saler_name,
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#done-saler-btn').onclick = () => modal.close();
    content.querySelector('#grant-margin-btn').onclick = () => {
      toast.success(t('supplier.si_d_granted', { name: saler.saler_name }));
      modal.close();
    };
    content.querySelector('#send-direct-msg-btn').onclick = () => {
      toast.info(t('supplier.si_d_opening', { name: saler.saler_name }));
      modal.close();
    };
  }

  function render() {
    container.innerHTML = '';

    // -------------------------------------------------------------------------
    // 1. Header
    // -------------------------------------------------------------------------
    const header = document.createElement('header');
    header.className = 'supplier-header';
    header.innerHTML = `
      <div class="supplier-header__titles">
        <div class="supplier-header__badge-row">
          <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">&lt; ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
          <span class="text-muted">/</span>
          <span class="text-xs text-muted font-mono">${t('supplier.si_breadcrumb')}</span>
        </div>
        <h1 class="supplier-header__title">
          <span>👥</span> ${t('supplier.saler_insights_title', 'Saler Network Insights & Curators')}
        </h1>
        <p class="supplier-header__subtitle">
          ${t('supplier.saler_insights_subtitle', 'Identify your top-performing virtual storefront salers, sales conversion, and geographic distribution.')}
        </p>
      </div>
      <div class="supplier-header__actions">
        <button class="btn btn--sm btn--outline" id="broadcast-offer-btn">
          📢 ${t('supplier.si_broadcast_btn')}
        </button>
        <button class="btn btn--sm btn--secondary" id="refresh-insights-btn">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;

    header.querySelector('#refresh-insights-btn').onclick = loadInsights;
    header.querySelector('#broadcast-offer-btn').onclick = openBroadcastModal;
    container.appendChild(header);

    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>${t('common.loading', 'Loading saler network analytics...')}</p>
      `;
      container.appendChild(loader);
      return;
    }

    const rawTopSalers = insights?.top_salers || [];
    const regionalDist = insights?.regional_distribution || [];

    // Filter Salers by search
    const topSalers = rawTopSalers.filter((s) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        (s.saler_name && s.saler_name.toLowerCase().includes(q)) ||
        (s.store_name && s.store_name.toLowerCase().includes(q)) ||
        (s.store_slug && s.store_slug.toLowerCase().includes(q))
      );
    });

    // -------------------------------------------------------------------------
    // 2. Summary KPI Cards
    // -------------------------------------------------------------------------
    const totalRevenue = rawTopSalers.reduce((acc, s) => acc + Number(s.total_revenue_generated || s.revenue || 0), 0);
    const totalOrders = rawTopSalers.reduce((acc, s) => acc + Number(s.total_orders_sold || s.order_count || 0), 0);

    let topDistrict = 'N/A';
    let topDistrictOrders = 0;
    if (regionalDist.length > 0) {
      const topR = [...regionalDist].sort((a, b) => Number(b.total_sales || b.revenue || 0) - Number(a.total_sales || a.revenue || 0))[0];
      topDistrict = topR?.district || 'Dhaka';
      topDistrictOrders = topR?.order_count || 0;
    }

    const kpiSummary = document.createElement('div');
    kpiSummary.className = 'supplier-kpi-grid';
    kpiSummary.innerHTML = `
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.total_active_curators', 'Active Salers Sourcing Your SKUs')}</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">${t('supplier.si_curators_count', { n: rawTopSalers.length })}</div>
        <span class="text-xs text-muted">${t('supplier.si_curators_sub')}</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.saler_order_volume', 'Total Orders via Salers')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 4px 0;">${t('supplier.si_orders_count', { n: totalOrders })}</div>
        <span class="text-xs text-muted">${t('supplier.si_orders_sub')}</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.saler_gross_sales', 'Saler Generated Sales')}</span>
        <div class="supplier-kpi-card__value supplier-kpi-card__value--success" style="font-size: 1.5rem; margin: 4px 0;">
          ${formatCurrency(totalRevenue)}
        </div>
        <span class="text-xs text-muted">${t('supplier.si_gmv_sub')}</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.si_top_hub')}</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">
          📍 ${topDistrict}
        </div>
        <span class="text-xs text-muted">${t('supplier.si_orders_delivered', { n: topDistrictOrders })}</span>
      </div>
    `;
    container.appendChild(kpiSummary);

    // -------------------------------------------------------------------------
    // 3. Vertical Stack: Full-Width Leaderboard (Top) + Regional Breakdown (Bottom)
    // -------------------------------------------------------------------------
    const mainStack = document.createElement('div');
    mainStack.className = 'supplier-saler-stack';

    // 3.1 Full-Width Top Salers Leaderboard
    const tableCard = document.createElement('div');
    tableCard.className = 'supplier-leaderboard-card';

    const tableHeader = document.createElement('div');
    tableHeader.style.display = 'flex';
    tableHeader.style.alignItems = 'center';
    tableHeader.style.justifyContent = 'space-between';
    tableHeader.style.flexWrap = 'wrap';
    tableHeader.style.gap = '12px';
    tableHeader.style.borderBottom = '1px solid var(--border-subtle)';
    tableHeader.style.paddingBottom = '14px';
    tableHeader.innerHTML = `
      <div>
        <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 0;">
          🏆 ${t('supplier.top_curators_leaderboard', 'Top Salers Leaderboard')}
        </h3>
        <p data-page-info style="font-size: var(--text-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
          ${t('supplier.si_ranked_by')}
        </p>
      </div>
      <div style="display: flex; align-items: center; gap: 10px; min-width: 0; max-width: 100%;">
        <input type="search" id="saler-search-input" aria-label="${t('supplier.si_search_label')}" placeholder="${t('supplier.si_search_ph')}" value="${searchQuery}" class="form-input" style="padding: 6px 12px; font-size: 12px; width: 220px; max-width: 100%; border-radius: 8px;" />
        <span class="badge badge--neutral text-xs font-mono font-bold">${t('supplier.si_curators_active', { n: topSalers.length })}</span>
      </div>
    `;
    tableCard.appendChild(tableHeader);

    tableHeader.querySelector('#saler-search-input').oninput = (e) => {
      searchQuery = e.target.value.trim();
      render();
    };

    if (topSalers.length === 0) {
      tableCard.appendChild(
        EmptyState({
          icon: '👥',
          title: t('supplier.no_salers_yet', 'No salers found'),
          description: t('supplier.no_salers_desc', 'Offer attractive wholesale margins to entice Salers to feature your SKUs on their storefronts.'),
        })
      );
    } else {
      const tableWrapper = document.createElement('div');
      tableWrapper.style.overflowX = 'auto';

      const table = document.createElement('table');
      table.className = 'supplier-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th style="width: 70px;">${t('supplier.si_rank')}</th>
            <th>${t('supplier.saler', 'Saler Storefront')}</th>
            <th>${t('supplier.curated_skus', 'Curated SKUs')}</th>
            <th>${t('supplier.orders_sold', 'Orders Fulfilled')}</th>
            <th style="text-align: right;">${t('supplier.revenue_generated', 'Revenue Generated')}</th>
            <th style="text-align: right; width: 110px;">${t('supplier.si_action')}</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector('tbody');

      topSalers.forEach((saler, idx) => {
        const medal = idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : idx === 2 ? '🥉 #3' : `#${idx + 1}`;
        const curatedCount = saler.curated_products_count ?? saler.curated_sku_count ?? 0;
        const slug = saler.store_slug || saler.slug || 'store';
        const revenue = saler.total_revenue_generated ?? saler.revenue ?? 0;
        const orders = saler.total_orders_sold ?? saler.orders ?? 0;

        const tr = document.createElement('tr');
        tr.className = 'supplier-curator-row';
        tr.innerHTML = `
          <td>
            <span class="badge ${idx === 0 ? 'badge--primary' : 'badge--neutral'} font-mono font-bold" style="font-size: 12px; padding: 4px 8px;">
              ${medal}
            </span>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-weight: 800; font-size: 13px; color: var(--text-primary);">${saler.store_name || saler.saler_name}</span>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="text-xs text-muted">${t('supplier.si_by', { name: saler.saler_name })}</span>
                <span class="text-muted">•</span>
                <a href="/store/${slug}" target="_blank" class="text-xs text-primary hover:underline font-mono" style="text-decoration: none;" title="${t('supplier.si_open_store')}">
                  explooro.com/store/${slug} ↗
                </a>
              </div>
            </div>
          </td>
          <td>
            <span class="badge badge--neutral text-xs font-bold" style="padding: 4px 8px;">📦 ${t('supplier.si_items_n', { n: curatedCount })}</span>
          </td>
          <td>
            <strong style="font-family: var(--font-mono); font-size: 13px;">${t('supplier.si_orders_n', { n: orders })}</strong>
          </td>
          <td style="text-align: right;">
            <span style="font-weight: 800; font-family: var(--font-mono); font-size: 14px; color: var(--success);">
              ${formatCurrency(revenue)}
            </span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn--xs btn--outline text-primary view-saler-btn" style="font-size: 11px; padding: 4px 10px; font-weight: 700;">
              👁️ ${t('supplier.si_view_profile')}
            </button>
          </td>
        `;

        tr.querySelector('.view-saler-btn').onclick = () => openSalerDetailModal(saler);
        tbody.appendChild(tr);
      });

      tableWrapper.appendChild(table);
      tableCard.appendChild(tableWrapper);
    }
    mainStack.appendChild(tableCard);

    // -------------------------------------------------------------------------
    // 3.2 Full-Width Regional Demand Breakdown (Placed Underneath)
    // -------------------------------------------------------------------------
    const regionCard = document.createElement('div');
    regionCard.className = 'supplier-leaderboard-card';

    const totalRegionalSales = regionalDist.reduce((acc, r) => acc + Number(r.total_sales ?? r.revenue ?? 0), 0) || 1;
    const totalRegionalOrders = regionalDist.reduce((acc, r) => acc + Number(r.order_count || 0), 0) || 1;
    const maxRev = Math.max(...regionalDist.map((r) => Number(r.total_sales ?? r.revenue ?? 0)), 1);

    regionCard.innerHTML = `
      <div style="border-bottom: 1px solid var(--border-subtle); padding-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 0;">
            📍 ${t('supplier.regional_demand', 'Regional Demand & Logistics Breakdown')}
          </h3>
          <p data-page-info style="font-size: var(--text-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
            ${t('supplier.si_regional_sub')}
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge badge--neutral text-xs font-mono font-bold">${t('supplier.si_districts_n', { n: regionalDist.length })}</span>
          <span class="badge badge--success text-xs font-mono font-bold">${t('supplier.si_total_amt', { amount: formatCurrency(totalRegionalSales) })}</span>
        </div>
      </div>
    `;

    if (regionalDist.length === 0) {
      regionCard.appendChild(
        EmptyState({
          icon: '🗺️',
          title: t('supplier.no_regional_data', 'No regional data yet'),
          description: t('supplier.no_regional_desc', 'Geographic demand metrics will appear as orders are fulfilled across districts.'),
        })
      );
    } else {
      const regionGrid = document.createElement('div');
      regionGrid.className = 'supplier-region-grid';

      regionalDist.forEach((region, idx) => {
        const salesVal = Number(region.total_sales ?? region.revenue ?? 0);
        const orderCount = region.order_count || 0;
        const barPct = Math.min(Math.round((salesVal / maxRev) * 100), 100);
        const sharePct = Math.round((salesVal / totalRegionalSales) * 100);
        const isTop = idx === 0;

        const card = document.createElement('div');
        card.className = `supplier-region-card ${isTop ? 'supplier-region-card--top' : ''}`;
        card.innerHTML = `
          <div>
            <div class="supplier-region-card__header">
              <span class="supplier-region-card__title">
                📍 ${region.district}
              </span>
              <span class="badge ${isTop ? 'badge--primary' : 'badge--neutral'} font-mono font-bold" style="font-size: 10px;">
                ${isTop ? `👑 ${t('supplier.si_hub_top')}` : '#' + (idx + 1)} (${sharePct}%)
              </span>
            </div>
            <div class="supplier-region-card__amount">
              ${formatCurrency(salesVal)}
            </div>
          </div>

          <div>
            <div class="supplier-region-card__meta" style="margin-bottom: 6px;">
              <span><strong>📦 ${orderCount}</strong> ${t('supplier.si_orders_word')}</span>
              <span><strong>${sharePct}%</strong> ${t('supplier.si_of_total')}</span>
            </div>
            <div class="supplier-region-bar-track">
              <div class="supplier-region-bar-fill" style="width: ${barPct}%;"></div>
            </div>
          </div>
        `;

        regionGrid.appendChild(card);
      });

      regionCard.appendChild(regionGrid);

      // Logistics advice footer box
      const adviceBox = document.createElement('div');
      adviceBox.style.marginTop = '12px';
      adviceBox.style.padding = '12px 16px';
      adviceBox.style.background = 'var(--surface-1)';
      adviceBox.style.borderRadius = 'var(--radius-lg)';
      adviceBox.style.border = '1px solid var(--border-subtle)';
      adviceBox.style.fontSize = '12px';
      adviceBox.style.color = 'var(--text-secondary)';
      adviceBox.style.lineHeight = '1.5';
      adviceBox.innerHTML = `
        💡 ${t('supplier.si_advice')}
      `;
      regionCard.appendChild(adviceBox);
    }

    mainStack.appendChild(regionCard);
    container.appendChild(mainStack);
  }

  loadInsights();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
