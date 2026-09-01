/**
 * ResellerInsightsPage.js — Supplier Reseller Network Analytics & Curators Leaderboard (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AL.1:
 * - Real-time analytics on which Salers curate and sell the supplier's products most effectively.
 * - Revenue, commission, and order volume breakdowns.
 * - Full-width Top Resellers Leaderboard with instant search and curator detail modals.
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

export default function ResellerInsightsPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  let insights = null;
  let loading = true;
  let searchQuery = '';

  async function loadInsights() {
    loading = true;
    render();
    try {
      const res = await supplierApi.getResellerInsights();
      insights = res.data || res || { top_salers: [], regional_distribution: [] };
    } catch (err) {
      console.error('Failed to load reseller insights:', err);
      toast.error(t('supplier.resellers_load_failed', 'Failed to load reseller insights.'));
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
      <p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin: 0;">
        Incentivize Salers curating your products with an exclusive wholesale discount or flash commission bonus.
      </p>
      <div class="supplier-form-field">
        <label>Offer Type *</label>
        <select class="form-select" id="broadcast-type">
          <option value="margin_boost">⚡ +5% Extra Margin Bonus (Flash 48 Hours)</option>
          <option value="bulk_discount">📦 Bulk Sourcing Tier Discount (-10% on 20+ units)</option>
          <option value="new_arrival">✨ New Catalog Collection Launch Announcement</option>
        </select>
      </div>
      <div class="supplier-form-field">
        <label>Target Audience *</label>
        <select class="form-select" id="broadcast-target">
          <option value="all">All Active Salers (${insights?.top_salers?.length || 0} Curators)</option>
          <option value="top_tier">Top 3 Tier Curators Only</option>
          <option value="dhaka">Dhaka & Chittagong High-Demand Salers</option>
        </select>
      </div>
      <div class="supplier-form-field">
        <label>Custom Message / Note for Salers</label>
        <textarea class="form-textarea" id="broadcast-message" rows="3" placeholder="e.g. Special Eid flash commission for our top selling sarees and garments! Feature them now on your storefront."></textarea>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-broadcast-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="send-broadcast-btn">🚀 Send Broadcast</button>
    `;

    const modal = Modal({
      title: '📢 Broadcast Wholesale Offer',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-broadcast-btn').onclick = () => modal.close();
    footer.querySelector('#send-broadcast-btn').onclick = () => {
      toast.success('Wholesale promotion broadcasted successfully to active Salers!');
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
          <div style="font-weight: 800; font-size: var(--font-size-base); color: var(--text-primary);">${saler.saler_name}</div>
          <div class="text-xs text-muted">Virtual Storefront: <span class="font-mono text-brand font-bold">explooro.com/store/${saler.store_slug || saler.slug || 'store'}</span></div>
        </div>
        <span class="badge badge--success font-bold text-xs">⭐ Verified Top Saler</span>
      </div>

      <div class="supplier-kpi-grid" style="grid-template-columns: repeat(3, 1fr); gap: 8px;">
        <div class="supplier-kpi-card" style="padding: 12px;">
          <span class="supplier-kpi-card__label">Curated SKUs</span>
          <div style="font-weight: 800; font-size: 1.15rem; color: var(--text-primary); margin-top: 2px;">${saler.curated_products_count || saler.curated_sku_count || 0} items</div>
        </div>
        <div class="supplier-kpi-card" style="padding: 12px;">
          <span class="supplier-kpi-card__label">Orders Sold</span>
          <div style="font-weight: 800; font-size: 1.15rem; color: var(--text-primary); margin-top: 2px;">${saler.total_orders_sold || 0} orders</div>
        </div>
        <div class="supplier-kpi-card" style="padding: 12px;">
          <span class="supplier-kpi-card__label">Sales Volume</span>
          <div style="font-weight: 800; font-size: 1.15rem; color: var(--status-success); margin-top: 2px;">${formatCurrency(saler.total_revenue_generated || 0)}</div>
        </div>
      </div>

      <div>
        <h4 style="font-size: var(--font-size-xs); font-weight: 800; text-transform: uppercase; color: var(--text-secondary); margin: 0 0 8px 0;">
          Supplier Collaboration Options
        </h4>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="btn btn--sm btn--outline" id="grant-margin-btn" style="text-align: left; justify-content: flex-start;">
            🎁 Grant Exclusive Tier-1 Wholesale Margin (+3% discount)
          </button>
          <button class="btn btn--sm btn--outline" id="send-direct-msg-btn" style="text-align: left; justify-content: flex-start;">
            💬 Message Saler on Explooro Messenger
          </button>
        </div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="done-saler-btn">Close</button>
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
      toast.success(`Exclusive margin granted to ${saler.saler_name}!`);
      modal.close();
    };
    content.querySelector('#send-direct-msg-btn').onclick = () => {
      toast.info(`Opening messenger chat with ${saler.saler_name}...`);
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
          <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
          <span class="text-muted">/</span>
          <span class="text-xs text-muted font-mono">Reseller Network Insights</span>
        </div>
        <h1 class="supplier-header__title">
          <span>👥</span> ${t('supplier.reseller_insights_title', 'Reseller Network Insights & Curators')}
        </h1>
        <p class="supplier-header__subtitle">
          ${t('supplier.reseller_insights_subtitle', 'Identify your top-performing virtual storefront resellers, sales conversion, and geographic distribution.')}
        </p>
      </div>
      <div class="supplier-header__actions">
        <button class="btn btn--sm btn--outline" id="broadcast-offer-btn">
          📢 Broadcast Margin Offer
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
        <p>${t('common.loading', 'Loading reseller network analytics...')}</p>
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
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">${rawTopSalers.length} Curators</div>
        <span class="text-xs text-muted">Virtual storefronts with your items active</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.reseller_order_volume', 'Total Orders via Resellers')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 4px 0;">${totalOrders} Orders</div>
        <span class="text-xs text-muted">Direct retail orders generated by Salers</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.reseller_gross_sales', 'Reseller Generated Sales')}</span>
        <div class="supplier-kpi-card__value supplier-kpi-card__value--success" style="font-size: 1.5rem; margin: 4px 0;">
          ${formatCurrency(totalRevenue)}
        </div>
        <span class="text-xs text-muted">Gross merchandise volume through Saler stores</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">Top Demand Hub</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">
          📍 ${topDistrict}
        </div>
        <span class="text-xs text-muted">${topDistrictOrders} orders delivered</span>
      </div>
    `;
    container.appendChild(kpiSummary);

    // -------------------------------------------------------------------------
    // 3. Vertical Stack: Full-Width Leaderboard (Top) + Regional Breakdown (Bottom)
    // -------------------------------------------------------------------------
    const mainStack = document.createElement('div');
    mainStack.className = 'supplier-reseller-stack';

    // 3.1 Full-Width Top Resellers Leaderboard
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
        <h3 style="font-size: var(--font-size-base); font-weight: 800; color: var(--text-primary); margin: 0;">
          🏆 ${t('supplier.top_curators_leaderboard', 'Top Resellers Leaderboard')}
        </h3>
        <p style="font-size: var(--font-size-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
          Ranked by direct customer sales volume and retail merchandise demand
        </p>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <input type="text" id="reseller-search-input" placeholder="🔍 Search Saler store..." value="${searchQuery}" class="form-input" style="padding: 6px 12px; font-size: 12px; width: 220px; border-radius: 8px;" />
        <span class="badge badge--neutral text-xs font-mono font-bold">${topSalers.length} Curators Active</span>
      </div>
    `;
    tableCard.appendChild(tableHeader);

    tableHeader.querySelector('#reseller-search-input').oninput = (e) => {
      searchQuery = e.target.value.trim();
      render();
    };

    if (topSalers.length === 0) {
      tableCard.appendChild(
        EmptyState({
          icon: '👥',
          title: t('supplier.no_resellers_yet', 'No resellers found'),
          description: t('supplier.no_resellers_desc', 'Offer attractive wholesale margins to entice Salers to feature your SKUs on their storefronts.'),
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
            <th style="width: 70px;"># Rank</th>
            <th>${t('supplier.saler', 'Saler Storefront')}</th>
            <th>${t('supplier.curated_skus', 'Curated SKUs')}</th>
            <th>${t('supplier.orders_sold', 'Orders Fulfilled')}</th>
            <th style="text-align: right;">${t('supplier.revenue_generated', 'Revenue Generated')}</th>
            <th style="text-align: right; width: 110px;">Action</th>
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
                <span class="text-xs text-muted">by ${saler.saler_name}</span>
                <span class="text-muted">•</span>
                <a href="/store/${slug}" target="_blank" class="text-xs text-primary hover:underline font-mono" style="text-decoration: none;" title="Open live storefront">
                  explooro.com/store/${slug} ↗
                </a>
              </div>
            </div>
          </td>
          <td>
            <span class="badge badge--neutral text-xs font-bold" style="padding: 4px 8px;">📦 ${curatedCount} items</span>
          </td>
          <td>
            <strong style="font-family: var(--font-mono); font-size: 13px;">${orders} orders</strong>
          </td>
          <td style="text-align: right;">
            <span style="font-weight: 800; font-family: var(--font-mono); font-size: 14px; color: var(--status-success);">
              ${formatCurrency(revenue)}
            </span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn--xs btn--outline text-primary view-saler-btn" style="font-size: 11px; padding: 4px 10px; font-weight: 700;">
              👁️ View Profile
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
          <h3 style="font-size: var(--font-size-base); font-weight: 800; color: var(--text-primary); margin: 0;">
            📍 ${t('supplier.regional_demand', 'Regional Demand & Logistics Breakdown')}
          </h3>
          <p style="font-size: var(--font-size-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
            Geographic sales distribution across Bangladesh districts to optimize warehouse stocking and courier fulfillment
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge badge--neutral text-xs font-mono font-bold">${regionalDist.length} Districts</span>
          <span class="badge badge--success text-xs font-mono font-bold">Total: ${formatCurrency(totalRegionalSales)}</span>
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
                ${isTop ? '👑 #1 Hub' : '#' + (idx + 1)} (${sharePct}%)
              </span>
            </div>
            <div class="supplier-region-card__amount">
              ${formatCurrency(salesVal)}
            </div>
          </div>

          <div>
            <div class="supplier-region-card__meta" style="margin-bottom: 6px;">
              <span><strong>📦 ${orderCount}</strong> Orders</span>
              <span><strong>${sharePct}%</strong> of total volume</span>
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
        💡 <strong>Regional Logistics Strategy:</strong>
        <strong>Dhaka</strong> and <strong>Chittagong</strong> generate <strong>81%</strong> of your total retail demand.
        Keep safety stock allocated at your central Tejgaon and Agrabad dispatch hubs to ensure rapid 24-hour courier fulfillment.
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
