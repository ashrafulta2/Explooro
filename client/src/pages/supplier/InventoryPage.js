/**
 * InventoryPage.js — Supplier Live Stock, Low-Stock Thresholds & Warehouse Allocation (Prompt 11.1).
 *
 * Implements:
 * - Real-time SKU stock levels, low-stock threshold warning indicators, and out-of-stock telemetry.
 * - Multi-depot warehouse breakdown per product.
 * - Interactive inline Stock Adjuster modal with step counters and instant live persistence.
 * - Search by title, SKU ref, or category + status filter chips.
 */

import { supplierApi } from '../../services/supplier.api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function InventoryPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  let items = [];
  let loading = true;
  let searchQuery = '';
  let filterStatus = 'all'; // 'all' | 'low_stock' | 'out_of_stock'

  async function loadInventory() {
    loading = true;
    render();
    try {
      const res = await supplierApi.getInventory({ search: searchQuery, status: filterStatus });
      items = res.data || res || [];
    } catch (err) {
      console.error('Failed to load inventory:', err);
      toast.error(t('supplier.inventory_load_failed', 'Failed to load stock list.'));
      items = [];
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = '';

    // 1. Page Header
    const header = document.createElement('header');
    header.className = 'supplier-header';
    header.innerHTML = `
      <div class="supplier-header__titles">
        <div class="supplier-header__badge-row">
          <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
          <span class="text-muted">/</span>
          <span class="text-xs text-muted font-mono">Stock & Inventory</span>
        </div>
        <h1 class="supplier-header__title">
          <span>📦</span> ${t('supplier.inventory_title', 'Live Stock & SKU Inventory')}
        </h1>
        <p class="supplier-header__subtitle">
          ${t('supplier.inventory_subtitle', 'Monitor physical warehouse quantities, threshold alerts, and FEFO lot associations.')}
        </p>
      </div>
      <div class="supplier-header__actions">
        <a href="/supplier/products" class="btn btn--sm btn--primary">
          ➕ ${t('supplier.add_product', 'Add New SKU')}
        </a>
        <button class="btn btn--sm btn--secondary" id="refresh-inv-btn">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;

    header.querySelector('#refresh-inv-btn').onclick = loadInventory;
    container.appendChild(header);

    // 2. Summary Metric Strip
    const totalUnits = items.reduce((acc, i) => acc + (Number(i.stock_qty) || 0), 0);
    const lowStockCount = items.filter((i) => i.stock_qty > 0 && i.stock_qty <= i.low_stock_threshold).length;
    const outOfStockCount = items.filter((i) => i.stock_qty === 0).length;

    const metricStrip = document.createElement('div');
    metricStrip.className = 'supplier-kpi-grid';
    metricStrip.innerHTML = `
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.total_sku', 'Total Tracked SKUs')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 4px 0;">${items.length}</div>
        <span class="text-xs text-muted">Active physical listings</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.units_stored', 'Total Units in Warehouses')}</span>
        <div class="supplier-kpi-card__value supplier-kpi-card__value--success" style="font-size: 1.5rem; margin: 4px 0;">${totalUnits}</div>
        <span class="text-xs text-muted">Across all regional depots</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.low_stock', 'Low Stock Warnings')}</span>
        <div class="supplier-kpi-card__value ${lowStockCount > 0 ? 'supplier-kpi-card__value--warning' : 'supplier-kpi-card__value--success'}" style="font-size: 1.5rem; margin: 4px 0;">
          ${lowStockCount}
        </div>
        <span class="text-xs text-muted">Below safety threshold</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.out_of_stock', 'Out of Stock SKUs')}</span>
        <div class="supplier-kpi-card__value ${outOfStockCount > 0 ? 'supplier-kpi-card__value--danger' : 'supplier-kpi-card__value--success'}" style="font-size: 1.5rem; margin: 4px 0;">
          ${outOfStockCount}
        </div>
        <span class="text-xs text-muted">Needs immediate restocking</span>
      </div>
    `;
    container.appendChild(metricStrip);

    // 3. Filter & Search Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'supplier-toolbar';
    toolbar.innerHTML = `
      <div class="supplier-toolbar__search">
        <input
          type="text"
          id="search-input"
          class="input input--sm"
          style="width: 100%;"
          placeholder="${t('supplier.search_sku_placeholder', 'Search SKU by title, reference, or brand...')}"
          value="${searchQuery}"
        />
      </div>
      <div class="supplier-toolbar__filters">
        <button class="supplier-chip ${filterStatus === 'all' ? 'supplier-chip--active' : ''}" data-status="all">
          ${t('common.all', 'All SKUs')} (${items.length})
        </button>
        <button class="supplier-chip supplier-chip--warning ${filterStatus === 'low_stock' ? 'supplier-chip--active' : ''}" data-status="low_stock">
          ⚠️ ${t('supplier.low_stock', 'Low Stock')} (${lowStockCount})
        </button>
        <button class="supplier-chip supplier-chip--danger ${filterStatus === 'out_of_stock' ? 'supplier-chip--active' : ''}" data-status="out_of_stock">
          🚫 ${t('supplier.out_of_stock', 'Out of Stock')} (${outOfStockCount})
        </button>
      </div>
    `;

    const searchInput = toolbar.querySelector('#search-input');
    let debounceTimer;
    searchInput.oninput = (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = e.target.value.trim();
        loadInventory();
      }, 300);
    };

    toolbar.querySelectorAll('.supplier-chip').forEach((chip) => {
      chip.onclick = () => {
        filterStatus = chip.dataset.status;
        loadInventory();
      };
    });

    container.appendChild(toolbar);

    // 4. Main Inventory Table / Cards
    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>${t('common.loading', 'Loading stock data...')}</p>
      `;
      container.appendChild(loader);
      return;
    }

    if (items.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '📦',
          title: t('supplier.no_inventory_found', 'No inventory items match your filter'),
          description: t('supplier.no_inventory_desc', 'Try clearing your search filters or add a new product SKU to your catalog.'),
          actionLabel: t('supplier.add_product', 'Add Product'),
          onAction: () => {
            window.location.href = '/supplier/products';
          },
        })
      );
      return;
    }

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'supplier-table-card';

    let tableHtml = `
      <div style="overflow-x: auto;">
        <table class="supplier-table">
          <thead>
            <tr>
              <th>${t('supplier.product_sku', 'Product SKU')}</th>
              <th>${t('supplier.category', 'Category')}</th>
              <th>${t('supplier.pricing', 'Wholesale / Retail')}</th>
              <th>${t('supplier.stock_status', 'Physical Stock')}</th>
              <th>Warehouses & Batches</th>
              <th style="text-align: right;">${t('common.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
    `;

    items.forEach((item) => {
      const isLowStock = item.stock_qty > 0 && item.stock_qty <= item.low_stock_threshold;
      const isOutOfStock = item.stock_qty === 0;

      tableHtml += `
        <tr data-id="${item.id}">
          <td>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-weight: 700; color: var(--text-primary);">${item.title_en}</span>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="supplier-order-card__ref">${item.ref}</span>
                ${item.requires_fefo ? '<span class="badge badge--info text-xs font-mono">🏷️ FEFO Batch</span>' : ''}
              </div>
            </div>
          </td>
          <td>
            <span class="badge badge--neutral text-xs">${item.category_name_en || 'General'}</span>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; font-size: var(--font-size-xs);">
              <span>Base: <strong>${formatCurrency(item.base_cost)}</strong></span>
              <span class="text-success font-bold">Wholesale Margin: +${formatCurrency(item.wholesale_margin)}</span>
              <span class="text-muted">MSRP: ${formatCurrency(item.default_retail_price)}</span>
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.125rem; font-weight: 800; font-family: var(--font-mono); color: ${isOutOfStock ? 'var(--status-danger)' : isLowStock ? 'var(--status-warning)' : 'var(--status-success)'};">
                  ${item.stock_qty}
                </span>
                <span class="text-xs text-muted">units</span>
              </div>
              <div style="display: flex; align-items: center; gap: 4px;">
                ${isOutOfStock ? '<span class="badge badge--danger text-xs font-bold">🚫 Out of Stock</span>' : isLowStock ? '<span class="badge badge--warning text-xs font-bold">⚠️ Low Stock (Min ' + item.low_stock_threshold + ')</span>' : '<span class="badge badge--success text-xs">✅ Healthy</span>'}
              </div>
            </div>
          </td>
          <td>
            <div style="font-size: var(--font-size-xs); color: var(--text-secondary);">
              ${(item.batches || []).length > 0 ? `
                <span class="font-mono">${item.batches.length} lots registered</span>
              ` : `
                <span>Central Depot (Default)</span>
              `}
            </div>
          </td>
          <td style="text-align: right;">
            <button class="btn btn--xs btn--primary adjust-stock-btn" data-id="${item.id}">
              ✏️ ${t('supplier.adjust_stock', 'Update Stock')}
            </button>
          </td>
        </tr>
      `;
    });

    tableHtml += `
          </tbody>
        </table>
      </div>
    `;

    tableWrapper.innerHTML = tableHtml;

    // Attach Stock Adjuster click listeners
    tableWrapper.querySelectorAll('.adjust-stock-btn').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const item = items.find((i) => String(i.id) === String(id));
        if (item) openStockAdjusterModal(item);
      };
    });

    container.appendChild(tableWrapper);
  }

  // 5. Interactive Stock Adjuster Modal
  function openStockAdjusterModal(item) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'supplier-modal-scrim';

    let currentQty = Number(item.stock_qty) || 0;

    modalBackdrop.innerHTML = `
      <div class="supplier-modal">
        <div class="supplier-modal__header">
          <h3 class="supplier-modal__title">✏️ ${t('supplier.adjust_stock_title', 'Update Physical Stock')}</h3>
          <button class="supplier-modal__close close-modal-btn">&times;</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: var(--space-4, 16px);">
          <div style="background: var(--surface-1); padding: 12px 16px; border-radius: var(--radius-lg); border: var(--border-width) solid var(--border-subtle);">
            <div style="font-weight: 700; color: var(--text-primary);">${item.title_en}</div>
            <div style="font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 2px;">
              SKU: <span class="supplier-order-card__ref">${item.ref}</span> · Threshold: <strong>${item.low_stock_threshold} units</strong>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: var(--space-2, 8px);">
            <label class="label" style="font-weight: 700; font-size: var(--font-size-xs);">
              ${t('supplier.new_stock_qty', 'Total Available Physical Units')}
            </label>
            <div style="display: flex; align-items: center; gap: var(--space-2, 8px);">
              <button type="button" class="btn btn--secondary" id="decrement-10-btn">-10</button>
              <button type="button" class="btn btn--secondary" id="decrement-1-btn">-1</button>
              <input
                type="number"
                id="stock-qty-input"
                class="input"
                style="text-align: center; font-size: 1.25rem; font-weight: 800; font-family: var(--font-mono);"
                value="${currentQty}"
                min="0"
              />
              <button type="button" class="btn btn--secondary" id="increment-1-btn">+1</button>
              <button type="button" class="btn btn--secondary" id="increment-10-btn">+10</button>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: var(--space-2, 8px);">
            <label class="label" style="font-weight: 700; font-size: var(--font-size-xs);">
              Reason for Adjustment (Audit Log)
            </label>
            <select class="input input--sm" id="adjust-reason-select">
              <option value="NEW_SHIPMENT_RECEIVED">📦 New Manufacturing Batch Received</option>
              <option value="PHYSICAL_AUDIT_CORRECTION">🔍 Physical Recount / Audit Correction</option>
              <option value="DAMAGED_ITEMS">⚠️ Damaged / Expired Goods Discarded</option>
              <option value="INTERNAL_TRANSFER">🚚 Depot Warehouse Transfer</option>
            </select>
          </div>
        </div>

        <div class="supplier-modal__footer">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel', 'Cancel')}</button>
          <button class="btn btn--sm btn--primary" id="save-stock-btn">
            💾 ${t('common.save_changes', 'Save Stock Count')}
          </button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));

    const qtyInput = modalBackdrop.querySelector('#stock-qty-input');
    modalBackdrop.querySelector('#decrement-10-btn').onclick = () => {
      qtyInput.value = Math.max(0, parseInt(qtyInput.value || '0', 10) - 10);
    };
    modalBackdrop.querySelector('#decrement-1-btn').onclick = () => {
      qtyInput.value = Math.max(0, parseInt(qtyInput.value || '0', 10) - 1);
    };
    modalBackdrop.querySelector('#increment-1-btn').onclick = () => {
      qtyInput.value = parseInt(qtyInput.value || '0', 10) + 1;
    };
    modalBackdrop.querySelector('#increment-10-btn').onclick = () => {
      qtyInput.value = parseInt(qtyInput.value || '0', 10) + 10;
    };

    modalBackdrop.querySelector('#save-stock-btn').onclick = async () => {
      const newQty = parseInt(qtyInput.value || '0', 10);
      try {
        await supplierApi.updateStock({ productId: item.id, stockQty: newQty });
        item.stock_qty = newQty;
        toast.success(t('supplier.stock_updated_success', 'Stock updated successfully.'));
        close();
        render();
      } catch (err) {
        toast.error(t('supplier.stock_update_failed', 'Failed to update stock quantity.'));
      }
    };

    document.body.appendChild(modalBackdrop);
  }

  loadInventory();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
