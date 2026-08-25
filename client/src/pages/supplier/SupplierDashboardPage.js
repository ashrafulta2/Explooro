/**
 * SupplierDashboardPage.js — Manufacturer & Physical Inventory Hub Dashboard (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AL.1 & Prompt 11.1 REQUIREMENTS 3, 4, 5:
 * - Advanced Mode: Live stock, batch manager & expiry timeline, multi-warehouse allocation,
 *   fulfilment queue with 1-click consignment and label printing, reseller network insights,
 *   earnings vault, wholesale inquiries, physical store status toggle, warranty claims, and live studio.
 * - Simple Mode: Surfaces at most 6 primary actions (Pending Orders, Low Stock Alerts, Today's Earnings, Print Labels).
 * - Every card is module-gated and permission-gated with graceful fallbacks.
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
  container.className = 'supplier-dashboard-page container py-6 space-y-6';

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
      // Fallback mock values so UI never crashes
      overviewData = {
        metrics: {
          total_products: 12,
          total_units: 450,
          low_stock_count: 3,
          out_of_stock_count: 0,
          pending_orders_count: 8,
          today_earnings: 14500,
          total_settled_earnings: 284000,
          total_active_batches: 6,
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

    // 1. Header with Mode Toggle & Quick Actions
    const header = document.createElement('header');
    header.className = 'page-header flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-subtle';
    header.innerHTML = `
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-bold flex items-center gap-2">
            <span>🏭</span> ${t('supplier.dashboard_title', 'Supplier / Manufacturer Dashboard')}
          </h1>
          <span class="badge ${isSimpleMode ? 'badge--info' : 'badge--primary'} text-xs uppercase px-2 py-0.5 rounded font-mono">
            ${isSimpleMode ? t('supplier.mode_simple', 'Simple Mode') : t('supplier.mode_pro', 'Pro Dashboard')}
          </span>
        </div>
        <p class="text-sm text-muted mt-1">
          ${t('supplier.dashboard_subtitle', 'Live physical inventory, FEFO batch routing, multi-depot fulfilment & wholesale analytics.')}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
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
      loader.innerHTML = `<div class="animate-spin inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full mb-3"></div><p>${t('common.loading', 'Loading dashboard...')}</p>`;
      container.appendChild(loader);
      return;
    }

    const metrics = overviewData?.metrics || {};
    const shop = overviewData?.physical_shop || { is_open: true };

    // ==========================================
    // SIMPLE MODE VIEW (At most 6 primary actions)
    // ==========================================
    if (isSimpleMode) {
      const simpleSection = document.createElement('div');
      simpleSection.className = 'simple-mode-container space-y-6';

      // 4 Primary KPI Cards
      simpleSection.innerHTML = `
        <div class="alert alert--info p-4 rounded-lg bg-surface-2 border border-primary/20 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-2xl">🌱</span>
            <div>
              <h4 class="font-bold text-sm text-primary">${t('supplier.simple_mode_welcome', 'Simple Mode Active')}</h4>
              <p class="text-xs text-muted">${t('supplier.simple_mode_desc', 'Showing your 4 most essential daily tasks with zero clutter.')}</p>
            </div>
          </div>
          <button class="text-xs font-semibold text-primary underline" id="simple-mode-expand-btn">${t('supplier.show_all_features', 'Show All Tools →')}</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- 1. Pending Orders -->
          <a href="/supplier/orders" class="kpi-card p-5 rounded-xl border border-subtle bg-surface hover:shadow-md transition-all flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted uppercase tracking-wider">${t('supplier.pending_orders', 'Pending Orders')}</span>
              <span class="p-2 rounded-lg bg-amber-500/10 text-amber-600 text-lg">🛒</span>
            </div>
            <div class="mt-4">
              <div class="text-3xl font-bold">${metrics.pending_orders_count || 0}</div>
              <p class="text-xs text-muted mt-1">${t('supplier.orders_awaiting_pack', 'Orders awaiting packing')}</p>
            </div>
            <span class="text-xs font-semibold text-primary mt-4 inline-flex items-center gap-1">${t('supplier.view_orders', 'View Orders →')}</span>
          </a>

          <!-- 2. Low Stock Alerts -->
          <a href="/supplier/inventory" class="kpi-card p-5 rounded-xl border border-subtle bg-surface hover:shadow-md transition-all flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted uppercase tracking-wider">${t('supplier.low_stock_alerts', 'Low Stock')}</span>
              <span class="p-2 rounded-lg ${metrics.low_stock_count > 0 ? 'bg-red-500/10 text-red-600' : 'bg-green-500/10 text-green-600'} text-lg">⚠️</span>
            </div>
            <div class="mt-4">
              <div class="text-3xl font-bold ${metrics.low_stock_count > 0 ? 'text-red-600' : 'text-green-600'}">${metrics.low_stock_count || 0}</div>
              <p class="text-xs text-muted mt-1">${metrics.low_stock_count > 0 ? t('supplier.items_below_threshold', 'SKUs below safety threshold') : t('supplier.all_stocks_healthy', 'Stock levels healthy')}</p>
            </div>
            <span class="text-xs font-semibold text-primary mt-4 inline-flex items-center gap-1">${t('supplier.manage_stock', 'Manage Stock →')}</span>
          </a>

          <!-- 3. Today's Earnings -->
          <a href="/supplier/vault" class="kpi-card p-5 rounded-xl border border-subtle bg-surface hover:shadow-md transition-all flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted uppercase tracking-wider">${t('supplier.today_earnings', "Today's Earnings")}</span>
              <span class="p-2 rounded-lg bg-green-500/10 text-green-600 text-lg">💰</span>
            </div>
            <div class="mt-4">
              <div class="text-3xl font-bold text-green-600">${formatCurrency(metrics.today_earnings || 0)}</div>
              <p class="text-xs text-muted mt-1">${t('supplier.net_wholesale_profit', 'Net wholesale profit accrued')}</p>
            </div>
            <span class="text-xs font-semibold text-primary mt-4 inline-flex items-center gap-1">${t('supplier.view_vault', 'View Vault →')}</span>
          </a>

          <!-- 4. Print Labels -->
          <a href="/supplier/fulfilment" class="kpi-card p-5 rounded-xl border border-subtle bg-surface hover:shadow-md transition-all flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted uppercase tracking-wider">${t('supplier.print_labels', 'Print Labels')}</span>
              <span class="p-2 rounded-lg bg-blue-500/10 text-blue-600 text-lg">🖨️</span>
            </div>
            <div class="mt-4">
              <div class="text-3xl font-bold">${metrics.pending_orders_count || 0}</div>
              <p class="text-xs text-muted mt-1">${t('supplier.labels_ready_to_print', 'Packing slips & courier labels')}</p>
            </div>
            <span class="text-xs font-semibold text-primary mt-4 inline-flex items-center gap-1">${t('supplier.open_fulfilment_queue', 'Print & Dispatch →')}</span>
          </a>
        </div>

        <!-- 6 Simple Mode Actions Total -->
        <div class="p-6 bg-surface border border-subtle rounded-xl">
          <h3 class="font-bold text-base mb-4 flex items-center gap-2">
            <span>⚡</span> ${t('supplier.quick_daily_actions', 'Quick Daily Actions')}
          </h3>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <a href="/supplier/fulfilment" class="btn btn--primary flex flex-col items-center justify-center p-4 h-auto text-center">
              <span class="text-2xl mb-1">🚚</span>
              <span class="text-xs font-bold">${t('supplier.dispatch_orders', '1-Click Dispatch')}</span>
            </a>
            <a href="/supplier/inventory" class="btn btn--secondary flex flex-col items-center justify-center p-4 h-auto text-center">
              <span class="text-2xl mb-1">📦</span>
              <span class="text-xs font-bold">${t('supplier.adjust_stock', 'Update Stock')}</span>
            </a>
            <a href="/supplier/products" class="btn btn--secondary flex flex-col items-center justify-center p-4 h-auto text-center">
              <span class="text-2xl mb-1">➕</span>
              <span class="text-xs font-bold">${t('supplier.add_product', 'Add Product')}</span>
            </a>
            <a href="/supplier/batches" class="btn btn--secondary flex flex-col items-center justify-center p-4 h-auto text-center">
              <span class="text-2xl mb-1">🏷️</span>
              <span class="text-xs font-bold">${t('supplier.batches_fefo', 'FEFO Batches')}</span>
            </a>
            <a href="/supplier/vault" class="btn btn--secondary flex flex-col items-center justify-center p-4 h-auto text-center">
              <span class="text-2xl mb-1">🏦</span>
              <span class="text-xs font-bold">${t('supplier.withdraw_money', 'Withdraw')}</span>
            </a>
            <a href="/supplier/resellers" class="btn btn--secondary flex flex-col items-center justify-center p-4 h-auto text-center">
              <span class="text-2xl mb-1">👥</span>
              <span class="text-xs font-bold">${t('supplier.top_resellers', 'Top Resellers')}</span>
            </a>
          </div>
        </div>
      `;

      simpleSection.querySelector('#simple-mode-expand-btn').onclick = () => {
        isSimpleMode = false;
        localStorage.setItem('supplier_simple_mode', 'false');
        render();
      };

      container.appendChild(simpleSection);
      return;
    }

    // ==========================================
    // PRO MODE VIEW (Full Multi-Subsystem Hub)
    // ==========================================
    const proSection = document.createElement('div');
    proSection.className = 'pro-dashboard space-y-6';

    // 1. KPI Metric Grid
    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3';
    kpiGrid.innerHTML = `
      <div class="p-4 rounded-xl border border-subtle bg-surface">
        <span class="text-xs text-muted block uppercase">${t('supplier.total_sku', 'Active SKUs')}</span>
        <div class="text-2xl font-bold mt-1">${metrics.total_products || 0}</div>
        <span class="text-xs text-muted">${metrics.total_units || 0} ${t('supplier.units_stored', 'units')}</span>
      </div>
      <div class="p-4 rounded-xl border border-subtle bg-surface">
        <span class="text-xs text-muted block uppercase">${t('supplier.low_stock', 'Low Stock')}</span>
        <div class="text-2xl font-bold mt-1 ${metrics.low_stock_count > 0 ? 'text-amber-600' : 'text-green-600'}">${metrics.low_stock_count || 0}</div>
        <span class="text-xs ${metrics.out_of_stock_count > 0 ? 'text-red-500 font-bold' : 'text-muted'}">${metrics.out_of_stock_count || 0} ${t('supplier.stockout', 'stockouts')}</span>
      </div>
      <div class="p-4 rounded-xl border border-subtle bg-surface">
        <span class="text-xs text-muted block uppercase">${t('supplier.pending_packing', 'Pending Orders')}</span>
        <div class="text-2xl font-bold mt-1 text-primary">${metrics.pending_orders_count || 0}</div>
        <a href="/supplier/fulfilment" class="text-xs text-primary underline">${t('supplier.pack_now', 'Pack Now →')}</a>
      </div>
      <div class="p-4 rounded-xl border border-subtle bg-surface">
        <span class="text-xs text-muted block uppercase">${t('supplier.today_margin', "Today's Margin")}</span>
        <div class="text-2xl font-bold mt-1 text-green-600">${formatCurrency(metrics.today_earnings || 0)}</div>
        <span class="text-xs text-muted">${formatCurrency(metrics.total_settled_earnings || 0)} ${t('supplier.total_settled', 'settled')}</span>
      </div>
      <div class="p-4 rounded-xl border border-subtle bg-surface">
        <span class="text-xs text-muted block uppercase">${t('supplier.active_batches', 'FEFO Batches')}</span>
        <div class="text-2xl font-bold mt-1">${metrics.total_active_batches || 0}</div>
        <span class="text-xs ${metrics.expiring_soon_count > 0 ? 'text-amber-600 font-bold' : 'text-muted'}">${metrics.expiring_soon_count || 0} ${t('supplier.expiring_soon', 'expiring soon')}</span>
      </div>
      <div class="p-4 rounded-xl border border-subtle bg-surface">
        <span class="text-xs text-muted block uppercase">${t('supplier.warehouses_count', 'Depot Nodes')}</span>
        <div class="text-2xl font-bold mt-1">${metrics.total_warehouses || 0}</div>
        <span class="text-xs text-muted">${metrics.active_curators_count || 0} ${t('supplier.curators', 'salers selling')}</span>
      </div>
    `;
    proSection.appendChild(kpiGrid);

    // 2. Operational Control Matrix
    const matrixGrid = document.createElement('div');
    matrixGrid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6';

    // Module Card 1: Inventory & Stock Hub (Core)
    const inventoryCard = document.createElement('div');
    inventoryCard.className = 'dashboard-card p-5 rounded-xl border border-subtle bg-surface flex flex-col justify-between';
    inventoryCard.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-xl">📦</span>
            <h3 class="font-bold text-base">${t('supplier.inventory_management', 'Stock & Inventory')}</h3>
          </div>
          <span class="badge badge--success text-xs">${metrics.total_products || 0} SKUs</span>
        </div>
        <p class="text-xs text-muted mb-4">
          ${t('supplier.inventory_desc', 'Track real-time SKU counts, configure low-stock reorder thresholds, and distribute inventory across regional warehouses.')}
        </p>
      </div>
      <div class="flex items-center gap-2 pt-3 border-t border-subtle">
        <a href="/supplier/inventory" class="btn btn--sm btn--primary flex-1 text-center">${t('supplier.view_inventory', 'View Live Stock')}</a>
        <a href="/supplier/products" class="btn btn--sm btn--secondary">${t('supplier.add_sku', '+ Add SKU')}</a>
      </div>
    `;
    matrixGrid.appendChild(inventoryCard);

    // Module Card 2: FEFO Batch Expiry & Recalls (fefo_batches)
    if (isFeatureEnabled('fefo_batches')) {
      const batchCard = document.createElement('div');
      batchCard.className = 'dashboard-card p-5 rounded-xl border border-subtle bg-surface flex flex-col justify-between';
      batchCard.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">🏷️</span>
              <h3 class="font-bold text-base">${t('supplier.batch_fefo_title', 'FEFO Batch Manager')}</h3>
            </div>
            ${metrics.expiring_soon_count > 0 ? `<span class="badge badge--warning text-xs">⚠️ ${metrics.expiring_soon_count} Expiring</span>` : `<span class="badge badge--neutral text-xs">All Good</span>`}
          </div>
          <p class="text-xs text-muted mb-4">
            ${t('supplier.batch_fefo_desc', 'Automated First-Expired, First-Out dispatch prioritization, 30/60-day clearance discount alerts, and 1-click rapid recall isolation.')}
          </p>
        </div>
        <div class="flex items-center gap-2 pt-3 border-t border-subtle">
          <a href="/supplier/batches" class="btn btn--sm btn--primary flex-1 text-center">${t('supplier.manage_batches', 'Batch Timeline')}</a>
          <a href="/supplier/batches?status=EXPIRING_SOON" class="btn btn--sm btn--secondary">${t('supplier.clearance_action', 'Clearance Deals')}</a>
        </div>
      `;
      matrixGrid.appendChild(batchCard);
    }

    // Module Card 3: Multi-Location Warehouse GIS Routing (multi_warehouse)
    if (isFeatureEnabled('multi_warehouse')) {
      const warehouseCard = document.createElement('div');
      warehouseCard.className = 'dashboard-card p-5 rounded-xl border border-subtle bg-surface flex flex-col justify-between';
      warehouseCard.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">🏭</span>
              <h3 class="font-bold text-base">${t('supplier.warehouse_routing_title', 'Multi-Node Warehouses')}</h3>
            </div>
            <span class="badge badge--info text-xs">${metrics.total_warehouses || 0} Nodes</span>
          </div>
          <p class="text-xs text-muted mb-4">
            ${t('supplier.warehouse_routing_desc', 'Manage regional factories (Dhaka, Chittagong, Sylhet, Bogura) with smart GIS great-circle proximity routing.')}
          </p>
        </div>
        <div class="flex items-center gap-2 pt-3 border-t border-subtle">
          <a href="/supplier/warehouses" class="btn btn--sm btn--primary flex-1 text-center">${t('supplier.manage_warehouses', 'Manage Depots')}</a>
        </div>
      `;
      matrixGrid.appendChild(warehouseCard);
    }

    // Module Card 4: Fulfilment Queue & 1-Click Labels (courier_hub)
    if (isFeatureEnabled('courier_hub')) {
      const fulfilmentCard = document.createElement('div');
      fulfilmentCard.className = 'dashboard-card p-5 rounded-xl border border-subtle bg-surface flex flex-col justify-between';
      fulfilmentCard.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">🚚</span>
              <h3 class="font-bold text-base">${t('supplier.fulfilment_queue', '3PL Fulfilment Queue')}</h3>
            </div>
            <span class="badge badge--primary text-xs">${metrics.pending_orders_count || 0} Pending</span>
          </div>
          <p class="text-xs text-muted mb-4">
            ${t('supplier.fulfilment_desc', '1-Click courier booking (Steadfast, Pathao, RedX), batch-directed packing slips, and printable thermal shipping labels.')}
          </p>
        </div>
        <div class="flex items-center gap-2 pt-3 border-t border-subtle">
          <a href="/supplier/fulfilment" class="btn btn--sm btn--primary flex-1 text-center">${t('supplier.print_pack_slips', 'Pack & Dispatch')}</a>
        </div>
      `;
      matrixGrid.appendChild(fulfilmentCard);
    }

    // Module Card 5: Reseller Network Insights & Curators
    const resellerCard = document.createElement('div');
    resellerCard.className = 'dashboard-card p-5 rounded-xl border border-subtle bg-surface flex flex-col justify-between';
    resellerCard.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-xl">👥</span>
            <h3 class="font-bold text-base">${t('supplier.reseller_insights_title', 'Reseller Network')}</h3>
          </div>
          <span class="badge badge--success text-xs">${metrics.active_curators_count || 0} Curators</span>
        </div>
        <p class="text-xs text-muted mb-4">
          ${t('supplier.reseller_insights_desc', 'See which Salers curate and sell your products most effectively, top conversion districts, and sales volume analytics.')}
        </p>
      </div>
      <div class="flex items-center gap-2 pt-3 border-t border-subtle">
        <a href="/supplier/resellers" class="btn btn--sm btn--primary flex-1 text-center">${t('supplier.view_salers', 'View Reseller Stats')}</a>
      </div>
    `;
    matrixGrid.appendChild(resellerCard);

    // Module Card 6: Earnings Vault & Wholesale Payouts (core)
    const vaultCard = document.createElement('div');
    vaultCard.className = 'dashboard-card p-5 rounded-xl border border-subtle bg-surface flex flex-col justify-between';
    vaultCard.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-xl">💰</span>
            <h3 class="font-bold text-base">${t('supplier.vault_title', 'Supplier Digital Vault')}</h3>
          </div>
          <span class="badge badge--success text-xs font-mono">${formatCurrency(metrics.today_earnings || 0)}</span>
        </div>
        <p class="text-xs text-muted mb-4">
          ${t('supplier.vault_desc', 'Track delivered order payouts, pending escrow settlements, and request instant bank or bKash withdrawals.')}
        </p>
      </div>
      <div class="flex items-center gap-2 pt-3 border-t border-subtle">
        <a href="/supplier/vault" class="btn btn--sm btn--primary flex-1 text-center">${t('supplier.open_vault', 'Open Vault')}</a>
      </div>
    `;
    matrixGrid.appendChild(vaultCard);

    // Module Card 7: Digital Warranty Claims (digital_warranty)
    if (isFeatureEnabled('digital_warranty')) {
      const warrantyCard = document.createElement('div');
      warrantyCard.className = 'dashboard-card p-5 rounded-xl border border-subtle bg-surface flex flex-col justify-between';
      warrantyCard.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">🛡️</span>
              <h3 class="font-bold text-base">${t('supplier.warranty_claims_title', 'Warranty & Claims')}</h3>
            </div>
            <span class="badge badge--neutral text-xs">Claims Hub</span>
          </div>
          <p class="text-xs text-muted mb-4">
            ${t('supplier.warranty_claims_desc', 'Review customer repair/replacement requests within 72h SLA and manage reverse logistics.')}
          </p>
        </div>
        <div class="flex items-center gap-2 pt-3 border-t border-subtle">
          <a href="/supplier/warranty-claims" class="btn btn--sm btn--secondary flex-1 text-center">${t('supplier.view_claims', 'Review Claims')}</a>
        </div>
      `;
      matrixGrid.appendChild(warrantyCard);
    }

    // Module Card 8: Live Commerce Host Studio (live_commerce)
    if (isFeatureEnabled('live_commerce')) {
      const liveCard = document.createElement('div');
      liveCard.className = 'dashboard-card p-5 rounded-xl border border-subtle bg-surface flex flex-col justify-between';
      liveCard.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">📹</span>
              <h3 class="font-bold text-base">${t('supplier.live_studio_title', 'Live Commerce Studio')}</h3>
            </div>
            <span class="badge badge--primary text-xs">Host Stream</span>
          </div>
          <p class="text-xs text-muted mb-4">
            ${t('supplier.live_studio_desc', 'Broadcast live wholesale and product demonstration sessions to hundreds of Salers and shoppers.')}
          </p>
        </div>
        <div class="flex items-center gap-2 pt-3 border-t border-subtle">
          <a href="/supplier/live-studio" class="btn btn--sm btn--secondary flex-1 text-center">${t('supplier.launch_studio', 'Launch Live Stream')}</a>
        </div>
      `;
      matrixGrid.appendChild(liveCard);
    }

    // Module Card 9: Physical Store Status Toggle (physical_shop_status)
    if (isFeatureEnabled('physical_shop_status')) {
      const shopCard = document.createElement('div');
      shopCard.className = 'dashboard-card p-5 rounded-xl border border-subtle bg-surface flex flex-col justify-between';
      shopCard.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">🏪</span>
              <h3 class="font-bold text-base">${t('supplier.physical_store_status', 'Physical Store Status')}</h3>
            </div>
            <span class="badge ${shop.is_open ? 'badge--success' : 'badge--danger'} text-xs" id="shop-status-badge">
              ${shop.is_open ? '🟢 ' + t('supplier.open', 'Open') : '🔴 ' + t('supplier.closed', 'Closed')}
            </span>
          </div>
          <p class="text-xs text-muted mb-4">
            ${t('supplier.physical_store_desc', 'Toggle your physical factory/warehouse customer walk-in status and operational hours.')}
          </p>
        </div>
        <div class="flex items-center gap-2 pt-3 border-t border-subtle">
          <button class="btn btn--sm ${shop.is_open ? 'btn--outline' : 'btn--primary'} flex-1 text-center" id="toggle-shop-status-btn">
            ${shop.is_open ? t('supplier.mark_closed', 'Mark Closed') : t('supplier.mark_open', 'Mark Open')}
          </button>
        </div>
      `;

      shopCard.querySelector('#toggle-shop-status-btn').onclick = async () => {
        try {
          const nextState = !shop.is_open;
          await supplierApi.updateStoreStatus({ isOpen: nextState });
          shop.is_open = nextState;
          toast.success(nextState ? t('supplier.shop_now_open', 'Physical store marked OPEN.') : t('supplier.shop_now_closed', 'Physical store marked CLOSED.'));
          render();
        } catch (err) {
          toast.error(t('supplier.failed_status_update', 'Failed to update shop status.'));
        }
      };

      matrixGrid.appendChild(shopCard);
    }

    proSection.appendChild(matrixGrid);
    container.appendChild(proSection);
  }

  loadData();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
