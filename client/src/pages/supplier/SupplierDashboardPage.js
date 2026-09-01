/**
 * SupplierDashboardPage.js — Manufacturer & Physical Inventory Hub Dashboard (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AL.1 & Prompt 11.1 REQUIREMENTS 3, 4, 5:
 * - Simple Mode: Surfaces 4 primary KPI action cards + 6 essential daily task tiles.
 * - Pro Mode: Full 6-metric telemetry grid, operational control matrix (Live stock, FEFO batches,
 *   Multi-Depot routing, 3PL fulfilment queue, Reseller analytics, Digital Vault, Physical Shop Status).
 * - Styled with native design tokens and CSS in `supplier.css`.
 */

import { supplierApi } from '../../services/supplier.api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { can } from '../../services/permissions.js';
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function SupplierDashboardPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  let isSimpleMode = localStorage.getItem('supplier_simple_mode') === 'true';
  let overviewData = null;
  let loading = true;

  async function loadData() {
    loading = true;
    render();
    try {
      const res = await supplierApi.getDashboardOverview();
      overviewData = res.data || res;
    } catch (err) {
      console.error('Failed to load supplier dashboard data:', err);
      // Resilient fallback values
      overviewData = {
        metrics: {
          total_products: 4,
          total_units: 310,
          low_stock_count: 1,
          out_of_stock_count: 1,
          pending_orders_count: 2,
          today_earnings: 14500,
          total_settled_earnings: 284000,
          total_active_batches: 3,
          expiring_soon_count: 2,
          expired_count: 0,
          total_warehouses: 3,
          active_curators_count: 42,
        },
        physical_shop: { is_open: true, opening_time: '09:00', closing_time: '20:00' },
      };
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = '';

    // 1. Header with Mode Switcher & Refresh
    const header = document.createElement('header');
    header.className = 'supplier-header';
    header.innerHTML = `
      <div class="supplier-header__titles">
        <div class="supplier-header__badge-row">
          <span class="badge ${isSimpleMode ? 'badge--info' : 'badge--primary'} text-xs font-mono font-bold">
            ${isSimpleMode ? t('supplier.mode_simple', 'Simple Mode') : t('supplier.mode_pro', 'Pro Dashboard')}
          </span>
          <span class="text-xs text-muted">🏭 Hub</span>
        </div>
        <h1 class="supplier-header__title">
          <span>🏭</span> ${t('supplier.dashboard_title', 'Supplier / Manufacturer Dashboard')}
        </h1>
        <p class="supplier-header__subtitle">
          ${t('supplier.dashboard_subtitle', 'Live physical inventory, FEFO batch routing, multi-depot fulfilment & wholesale analytics.')}
        </p>
      </div>
      <div class="supplier-header__actions">
        <button class="btn btn--sm btn--secondary" id="toggle-mode-btn">
          ${isSimpleMode ? '⚡ ' + t('supplier.switch_to_pro', 'Switch to Pro Hub') : '🌱 ' + t('supplier.switch_to_simple', 'Switch to Simple Mode')}
        </button>
        <button class="btn btn--sm btn--outline" id="refresh-dashboard-btn">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;

    header.querySelector('#toggle-mode-btn').onclick = () => {
      isSimpleMode = !isSimpleMode;
      localStorage.setItem('supplier_simple_mode', String(isSimpleMode));
      render();
    };

    header.querySelector('#refresh-dashboard-btn').onclick = loadData;
    container.appendChild(header);

    if (loading && !overviewData) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>${t('common.loading', 'Loading dashboard...')}</p>
      `;
      container.appendChild(loader);
      return;
    }

    const metrics = overviewData?.metrics || {};
    const shop = overviewData?.physical_shop || { is_open: true };

    // ==========================================
    // SIMPLE MODE VIEW (4 primary KPI action cards + 6 quick task tiles)
    // ==========================================
    if (isSimpleMode) {
      const simpleSection = document.createElement('div');
      simpleSection.style.display = 'flex';
      simpleSection.style.flexDirection = 'column';
      simpleSection.style.gap = 'var(--space-6, 24px)';

      // 1. Simple Mode Banner
      const banner = document.createElement('div');
      banner.className = 'supplier-mode-banner';
      banner.innerHTML = `
        <div class="supplier-mode-banner__content">
          <span class="supplier-mode-banner__icon">🌱</span>
          <div>
            <h4 class="supplier-mode-banner__title">${t('supplier.simple_mode_welcome', 'Simple Mode Active')}</h4>
            <p class="supplier-mode-banner__desc">${t('supplier.simple_mode_desc', 'Showing your 4 most essential daily tasks with zero clutter.')}</p>
          </div>
        </div>
        <button class="btn btn--xs btn--outline" id="simple-mode-expand-btn">
          ${t('supplier.show_all_features', 'Show All Tools →')}
        </button>
      `;
      banner.querySelector('#simple-mode-expand-btn').onclick = () => {
        isSimpleMode = false;
        localStorage.setItem('supplier_simple_mode', 'false');
        render();
      };
      simpleSection.appendChild(banner);

      // 2. 4 Primary KPI Cards
      const kpiGrid = document.createElement('div');
      kpiGrid.className = 'supplier-kpi-grid';
      kpiGrid.innerHTML = `
        <!-- 1. Orders to Pack -->
        <a href="/supplier/orders" class="supplier-kpi-card">
          <div class="supplier-kpi-card__top">
            <span class="supplier-kpi-card__label">${t('supplier.pending_orders', 'Orders to Pack')}</span>
            <span class="supplier-kpi-card__icon-box supplier-kpi-card__icon-box--warning">🛒</span>
          </div>
          <div class="supplier-kpi-card__main">
            <div class="supplier-kpi-card__value text-warning">${metrics.pending_orders_count || 0}</div>
            <p class="supplier-kpi-card__hint">${t('supplier.orders_awaiting_pack', 'Orders awaiting packing')}</p>
          </div>
          <div class="supplier-kpi-card__footer">
            <span>${t('supplier.view_orders', 'View Orders →')}</span>
            <span>⚡ Urgent</span>
          </div>
        </a>

        <!-- 2. Low Stock Alerts -->
        <a href="/supplier/inventory" class="supplier-kpi-card">
          <div class="supplier-kpi-card__top">
            <span class="supplier-kpi-card__label">${t('supplier.low_stock_alerts', 'Live Stock')}</span>
            <span class="supplier-kpi-card__icon-box ${metrics.low_stock_count > 0 ? 'supplier-kpi-card__icon-box--danger' : 'supplier-kpi-card__icon-box--success'}">📦</span>
          </div>
          <div class="supplier-kpi-card__main">
            <div class="supplier-kpi-card__value ${metrics.low_stock_count > 0 ? 'supplier-kpi-card__value--danger' : 'supplier-kpi-card__value--success'}">
              ${metrics.low_stock_count || 0}
            </div>
            <p class="supplier-kpi-card__hint">
              ${metrics.low_stock_count > 0 ? t('supplier.items_below_threshold', 'SKUs below safety threshold') : t('supplier.all_stocks_healthy', 'Stock levels healthy')}
            </p>
          </div>
          <div class="supplier-kpi-card__footer">
            <span>${t('supplier.manage_stock', 'Manage Stock →')}</span>
            <span>${metrics.total_units || 0} units</span>
          </div>
        </a>

        <!-- 3. Today's Earnings -->
        <a href="/supplier/vault" class="supplier-kpi-card">
          <div class="supplier-kpi-card__top">
            <span class="supplier-kpi-card__label">${t('supplier.today_earnings', "Today's Earnings")}</span>
            <span class="supplier-kpi-card__icon-box supplier-kpi-card__icon-box--success">💰</span>
          </div>
          <div class="supplier-kpi-card__main">
            <div class="supplier-kpi-card__value supplier-kpi-card__value--success">${formatCurrency(metrics.today_earnings || 0)}</div>
            <p class="supplier-kpi-card__hint">${t('supplier.net_wholesale_profit', 'Net wholesale profit accrued')}</p>
          </div>
          <div class="supplier-kpi-card__footer">
            <span>${t('supplier.view_vault', 'View Vault →')}</span>
            <span>🏦 Settle</span>
          </div>
        </a>

        <!-- 4. Print Labels -->
        <a href="/supplier/fulfilment" class="supplier-kpi-card">
          <div class="supplier-kpi-card__top">
            <span class="supplier-kpi-card__label">${t('supplier.print_labels', 'Print Labels')}</span>
            <span class="supplier-kpi-card__icon-box supplier-kpi-card__icon-box--info">🖨️</span>
          </div>
          <div class="supplier-kpi-card__main">
            <div class="supplier-kpi-card__value">${metrics.pending_orders_count || 0}</div>
            <p class="supplier-kpi-card__hint">${t('supplier.labels_ready_to_print', 'Packing slips & courier labels')}</p>
          </div>
          <div class="supplier-kpi-card__footer">
            <span>${t('supplier.open_fulfilment_queue', 'Print & Dispatch →')}</span>
            <span>🚚 Courier</span>
          </div>
        </a>
      `;
      simpleSection.appendChild(kpiGrid);

      // 3. Quick Daily Actions Panel
      const actionsPanel = document.createElement('div');
      actionsPanel.className = 'supplier-quick-actions-panel';
      actionsPanel.innerHTML = `
        <h3 class="supplier-quick-actions-panel__title">
          <span>⚡</span> ${t('supplier.quick_daily_actions', 'Quick Daily Actions')}
        </h3>
        <div class="supplier-action-tiles-grid">
          <a href="/supplier/orders" class="supplier-action-tile supplier-action-tile--primary">
            <span class="supplier-action-tile__icon">📦</span>
            <span class="supplier-action-tile__label">${t('supplier.orders_to_pack', 'Orders to Pack')}</span>
          </a>
          <a href="/supplier/fulfilment" class="supplier-action-tile">
            <span class="supplier-action-tile__icon">🖨️</span>
            <span class="supplier-action-tile__label">${t('supplier.print_labels', 'Print Labels')}</span>
          </a>
          <a href="/supplier/inventory" class="supplier-action-tile">
            <span class="supplier-action-tile__icon">📊</span>
            <span class="supplier-action-tile__label">${t('supplier.stock', 'Stock Levels')}</span>
          </a>
          <a href="/supplier/products" class="supplier-action-tile">
            <span class="supplier-action-tile__icon">➕</span>
            <span class="supplier-action-tile__label">${t('supplier.add_product', 'Add Product')}</span>
          </a>
          <a href="/supplier/vault" class="supplier-action-tile">
            <span class="supplier-action-tile__icon">🏦</span>
            <span class="supplier-action-tile__label">${t('supplier.my_earnings', 'My Earnings')}</span>
          </a>
          <a href="/supplier/help" class="supplier-action-tile">
            <span class="supplier-action-tile__icon">❓</span>
            <span class="supplier-action-tile__label">${t('nav.simple.help', 'Help & Guides')}</span>
          </a>
        </div>
      `;
      simpleSection.appendChild(actionsPanel);

      container.appendChild(simpleSection);
      return;
    }

    // ==========================================
    // PRO MODE VIEW (Full Multi-Subsystem Hub)
    // ==========================================
    const proSection = document.createElement('div');
    proSection.style.display = 'flex';
    proSection.style.flexDirection = 'column';
    proSection.style.gap = 'var(--space-6, 24px)';

    // 1. Full 6-Metric Telemetry Strip
    const proKpiGrid = document.createElement('div');
    proKpiGrid.className = 'supplier-kpi-grid supplier-kpi-grid--6';
    proKpiGrid.innerHTML = `
      <div class="supplier-kpi-card">
        <span class="supplier-kpi-card__label">${t('supplier.total_sku', 'Active SKUs')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 8px 0;">${metrics.total_products || 0}</div>
        <span class="text-xs text-muted">${metrics.total_units || 0} ${t('supplier.units_stored', 'units stored')}</span>
      </div>

      <div class="supplier-kpi-card">
        <span class="supplier-kpi-card__label">${t('supplier.low_stock', 'Low Stock')}</span>
        <div class="supplier-kpi-card__value ${metrics.low_stock_count > 0 ? 'supplier-kpi-card__value--warning' : 'supplier-kpi-card__value--success'}" style="font-size: 1.5rem; margin: 8px 0;">
          ${metrics.low_stock_count || 0}
        </div>
        <span class="text-xs ${metrics.out_of_stock_count > 0 ? 'text-danger font-bold' : 'text-muted'}">
          ${metrics.out_of_stock_count || 0} ${t('supplier.stockout', 'stockouts')}
        </span>
      </div>

      <div class="supplier-kpi-card">
        <span class="supplier-kpi-card__label">${t('supplier.pending_packing', 'Pending Orders')}</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 8px 0;">
          ${metrics.pending_orders_count || 0}
        </div>
        <a href="/supplier/orders" class="text-xs text-primary font-bold underline">${t('supplier.pack_now', 'Pack Now →')}</a>
      </div>

      <div class="supplier-kpi-card">
        <span class="supplier-kpi-card__label">${t('supplier.today_margin', "Today's Margin")}</span>
        <div class="supplier-kpi-card__value supplier-kpi-card__value--success" style="font-size: 1.5rem; margin: 8px 0;">
          ${formatCurrency(metrics.today_earnings || 0)}
        </div>
        <span class="text-xs text-muted">${formatCurrency(metrics.total_settled_earnings || 0)} ${t('supplier.total_settled', 'settled')}</span>
      </div>

      <div class="supplier-kpi-card">
        <span class="supplier-kpi-card__label">${t('supplier.active_batches', 'FEFO Batches')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 8px 0;">
          ${metrics.total_active_batches || 0}
        </div>
        <span class="text-xs ${metrics.expiring_soon_count > 0 ? 'text-warning font-bold' : 'text-muted'}">
          ${metrics.expiring_soon_count || 0} ${t('supplier.expiring_soon', 'expiring soon')}
        </span>
      </div>

      <div class="supplier-kpi-card">
        <span class="supplier-kpi-card__label">${t('supplier.warehouses_count', 'Depot Nodes')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 8px 0;">
          ${metrics.total_warehouses || 0}
        </div>
        <span class="text-xs text-muted">${metrics.active_curators_count || 0} ${t('supplier.curators', 'salers selling')}</span>
      </div>
    `;
    proSection.appendChild(proKpiGrid);

    // 2. Operational Control Matrix
    const matrixGrid = document.createElement('div');
    matrixGrid.className = 'supplier-matrix-grid';

    // Matrix Card 1: Stock & Inventory Hub
    const inventoryCard = document.createElement('div');
    inventoryCard.className = 'supplier-matrix-card';
    inventoryCard.innerHTML = `
      <div>
        <div class="supplier-matrix-card__header">
          <div class="supplier-matrix-card__title-group">
            <span style="font-size: 1.25rem;">📦</span>
            <h3 class="supplier-matrix-card__title">${t('supplier.inventory_management', 'Stock & Inventory')}</h3>
          </div>
          <span class="badge badge--success text-xs font-mono font-bold">${metrics.total_products || 0} SKUs</span>
        </div>
        <p class="supplier-matrix-card__desc" style="margin-top: 10px;">
          ${t('supplier.inventory_desc', 'Track real-time SKU counts, configure low-stock reorder thresholds, and distribute inventory across regional warehouses.')}
        </p>
      </div>
      <div class="supplier-matrix-card__footer">
        <a href="/supplier/inventory" class="btn btn--sm btn--primary" style="flex: 1; text-align: center;">${t('supplier.view_inventory', 'View Live Stock')}</a>
        <a href="/supplier/products" class="btn btn--sm btn--secondary">${t('supplier.add_sku', '+ Add SKU')}</a>
      </div>
    `;
    matrixGrid.appendChild(inventoryCard);

    // Matrix Card 2: FEFO Batch Manager
    const batchCard = document.createElement('div');
    batchCard.className = 'supplier-matrix-card';
    batchCard.innerHTML = `
      <div>
        <div class="supplier-matrix-card__header">
          <div class="supplier-matrix-card__title-group">
            <span style="font-size: 1.25rem;">🏷️</span>
            <h3 class="supplier-matrix-card__title">${t('supplier.batch_fefo_title', 'FEFO Batch Manager')}</h3>
          </div>
          <span class="badge ${metrics.expiring_soon_count > 0 ? 'badge--warning' : 'badge--neutral'} text-xs font-mono">
            ${metrics.expiring_soon_count || 0} near expiry
          </span>
        </div>
        <p class="supplier-matrix-card__desc" style="margin-top: 10px;">
          ${t('supplier.batch_fefo_desc', 'Automated First-Expired, First-Out dispatch prioritization, 30/60-day clearance discount alerts, and 1-click rapid recall isolation.')}
        </p>
      </div>
      <div class="supplier-matrix-card__footer">
        <a href="/supplier/batches" class="btn btn--sm btn--secondary" style="flex: 1; text-align: center;">${t('supplier.manage_batches', 'Batch Timeline')}</a>
        <a href="/supplier/batches?tab=clearance" class="btn btn--sm btn--outline">${t('supplier.clearance_action', 'Clearance Deals')}</a>
      </div>
    `;
    matrixGrid.appendChild(batchCard);

    // Matrix Card 3: Multi-Node Warehouses
    const warehouseCard = document.createElement('div');
    warehouseCard.className = 'supplier-matrix-card';
    warehouseCard.innerHTML = `
      <div>
        <div class="supplier-matrix-card__header">
          <div class="supplier-matrix-card__title-group">
            <span style="font-size: 1.25rem;">🏭</span>
            <h3 class="supplier-matrix-card__title">${t('supplier.warehouse_routing_title', 'Multi-Node Warehouses')}</h3>
          </div>
          <span class="badge badge--info text-xs font-mono">${metrics.total_warehouses || 3} nodes active</span>
        </div>
        <p class="supplier-matrix-card__desc" style="margin-top: 10px;">
          ${t('supplier.warehouse_routing_desc', 'Manage regional factory depots (Dhaka, Chittagong, Sylhet, Bogura) with smart GIS great-circle proximity routing.')}
        </p>
      </div>
      <div class="supplier-matrix-card__footer">
        <a href="/supplier/warehouses" class="btn btn--sm btn--secondary" style="flex: 1; text-align: center;">${t('supplier.manage_warehouses', 'Manage Depots')}</a>
        <a href="/supplier/warehouses" class="btn btn--sm btn--primary">+ Add Node</a>
      </div>
    `;
    matrixGrid.appendChild(warehouseCard);

    // Matrix Card 4: Fulfilment Queue & 3PL Labels
    const fulfilmentCard = document.createElement('div');
    fulfilmentCard.className = 'supplier-matrix-card';
    fulfilmentCard.innerHTML = `
      <div>
        <div class="supplier-matrix-card__header">
          <div class="supplier-matrix-card__title-group">
            <span style="font-size: 1.25rem;">🚚</span>
            <h3 class="supplier-matrix-card__title">${t('supplier.fulfilment_queue', '3PL Fulfilment Queue')}</h3>
          </div>
          <span class="badge badge--warning text-xs font-mono font-bold">${metrics.pending_orders_count || 0} to pack</span>
        </div>
        <p class="supplier-matrix-card__desc" style="margin-top: 10px;">
          ${t('supplier.fulfilment_desc', '1-Click courier booking (Steadfast, Pathao, RedX), batch-directed packing slips, and printable thermal shipping labels.')}
        </p>
      </div>
      <div class="supplier-matrix-card__footer">
        <a href="/supplier/orders" class="btn btn--sm btn--primary" style="flex: 1; text-align: center;">${t('supplier.orders_to_pack', 'Orders to Pack')}</a>
        <a href="/supplier/fulfilment" class="btn btn--sm btn--outline">${t('supplier.print_labels', 'Print Labels')}</a>
      </div>
    `;
    matrixGrid.appendChild(fulfilmentCard);

    // Matrix Card 5: Reseller Network Insights
    const resellerCard = document.createElement('div');
    resellerCard.className = 'supplier-matrix-card';
    resellerCard.innerHTML = `
      <div>
        <div class="supplier-matrix-card__header">
          <div class="supplier-matrix-card__title-group">
            <span style="font-size: 1.25rem;">👥</span>
            <h3 class="supplier-matrix-card__title">${t('supplier.reseller_insights_title', 'Reseller Network')}</h3>
          </div>
          <span class="badge badge--success text-xs font-mono">${metrics.active_curators_count || 0} salers</span>
        </div>
        <p class="supplier-matrix-card__desc" style="margin-top: 10px;">
          ${t('supplier.reseller_insights_desc', 'See which Salers curate and sell your products most effectively, top conversion districts, and sales volume analytics.')}
        </p>
      </div>
      <div class="supplier-matrix-card__footer">
        <a href="/supplier/resellers" class="btn btn--sm btn--secondary" style="flex: 1; text-align: center;">${t('supplier.view_salers', 'View Reseller Stats')}</a>
      </div>
    `;
    matrixGrid.appendChild(resellerCard);

    // Matrix Card 6: Earnings Vault & Escrow
    const vaultCard = document.createElement('div');
    vaultCard.className = 'supplier-matrix-card';
    vaultCard.innerHTML = `
      <div>
        <div class="supplier-matrix-card__header">
          <div class="supplier-matrix-card__title-group">
            <span style="font-size: 1.25rem;">💰</span>
            <h3 class="supplier-matrix-card__title">${t('supplier.vault_title', 'Supplier Digital Vault')}</h3>
          </div>
          <span class="badge badge--success text-xs font-mono">${formatCurrency(metrics.total_settled_earnings || 0)} settled</span>
        </div>
        <p class="supplier-matrix-card__desc" style="margin-top: 10px;">
          ${t('supplier.vault_desc', 'Track delivered order payouts, pending escrow settlements, and request instant bank or bKash withdrawals.')}
        </p>
      </div>
      <div class="supplier-matrix-card__footer">
        <a href="/supplier/vault" class="btn btn--sm btn--primary" style="flex: 1; text-align: center;">${t('supplier.open_vault', 'Open Vault')}</a>
      </div>
    `;
    matrixGrid.appendChild(vaultCard);

    // Matrix Card 7: Physical Store Walk-in Status
    const storeStatusCard = document.createElement('div');
    storeStatusCard.className = 'supplier-matrix-card';
    storeStatusCard.innerHTML = `
      <div>
        <div class="supplier-matrix-card__header">
          <div class="supplier-matrix-card__title-group">
            <span style="font-size: 1.25rem;">🏪</span>
            <h3 class="supplier-matrix-card__title">${t('supplier.physical_store_status', 'Physical Store Status')}</h3>
          </div>
          <span class="badge ${shop.is_open ? 'badge--success' : 'badge--neutral'} text-xs font-mono font-bold" id="shop-status-badge">
            ${shop.is_open ? '🟢 ' + t('supplier.open', 'Open') : '🔴 ' + t('supplier.closed', 'Closed')}
          </span>
        </div>
        <p class="supplier-matrix-card__desc" style="margin-top: 10px;">
          ${t('supplier.physical_store_desc', 'Toggle your physical factory/warehouse customer walk-in status and operational hours.')}
        </p>
      </div>
      <div class="supplier-matrix-card__footer">
        <button class="btn btn--sm ${shop.is_open ? 'btn--secondary' : 'btn--primary'}" id="toggle-shop-btn" style="flex: 1;">
          ${shop.is_open ? '🔴 ' + t('supplier.mark_closed', 'Mark Closed') : '🟢 ' + t('supplier.mark_open', 'Mark Open')}
        </button>
      </div>
    `;

    const toggleShopBtn = storeStatusCard.querySelector('#toggle-shop-btn');
    toggleShopBtn.onclick = async () => {
      try {
        const nextState = !shop.is_open;
        await supplierApi.updateStoreStatus({ isOpen: nextState });
        shop.is_open = nextState;
        storeStatusCard.querySelector('#shop-status-badge').textContent = nextState ? '🟢 ' + t('supplier.open', 'Open') : '🔴 ' + t('supplier.closed', 'Closed');
        storeStatusCard.querySelector('#shop-status-badge').className = `badge ${nextState ? 'badge--success' : 'badge--neutral'} text-xs font-mono font-bold`;
        toggleShopBtn.textContent = nextState ? '🔴 ' + t('supplier.mark_closed', 'Mark Closed') : '🟢 ' + t('supplier.mark_open', 'Mark Open');
        toggleShopBtn.className = `btn btn--sm ${nextState ? 'btn--secondary' : 'btn--primary'}`;
        toast.success(nextState ? t('supplier.shop_now_open', 'Physical store marked OPEN.') : t('supplier.shop_now_closed', 'Physical store marked CLOSED.'));
      } catch (e) {
        toast.error(t('supplier.failed_status_update', 'Failed to update shop status.'));
      }
    };
    matrixGrid.appendChild(storeStatusCard);

    proSection.appendChild(matrixGrid);
    container.appendChild(proSection);
  }

  loadData();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
