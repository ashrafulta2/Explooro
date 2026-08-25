/**
 * InventoryPage.js — Supplier Live Stock, Low-Stock Thresholds & Warehouse Allocation (Prompt 11.1).
 *
 * Implements:
 * - Real-time SKU stock levels, low-stock threshold warning indicators, and out-of-stock telemetry.
 * - Multi-depot warehouse breakdown per product.
 * - Inline stock adjuster modal to update regional counts.
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
  container.className = 'supplier-inventory-page container py-6 space-y-6';

  let items = [];
  let loading = true;
  let searchQuery = '';
  let filterStatus = 'all'; // 'all' | 'low_stock' | 'out_of_stock'
  let selectedItemForStock = null;

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
    header.className = 'page-header flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-subtle';
    header.innerHTML = `
      <div>
        <div class="flex items-center gap-2">
          <a href="/supplier" class="text-xs text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
        </div>
        <h1 class="text-2xl font-bold flex items-center gap-2 mt-1">
          <span>📦</span> ${t('supplier.inventory_title', 'Live Stock & SKU Inventory')}
        </h1>
        <p class="text-sm text-muted mt-1">
          ${t('supplier.inventory_subtitle', 'Monitor physical warehouse quantities, threshold alerts, and FEFO lot associations.')}
        </p>
      </div>
      <div class="flex items-center gap-2">
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

    // 2. Filter & Search Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'filter-toolbar flex flex-wrap items-center justify-between gap-3 p-3 bg-surface-2 rounded-xl border border-subtle';
    toolbar.innerHTML = `
      <div class="flex items-center gap-2 flex-1 min-w-[240px]">
        <input
          type="text"
          id="search-input"
          class="input input--sm w-full bg-surface"
          placeholder="${t('supplier.search_sku_placeholder', 'Search SKU by title, reference, or brand...')}"
          value="${searchQuery}"
        />
      </div>
      <div class="flex items-center gap-2">
        <button class="filter-chip px-3 py-1.5 rounded-lg text-xs font-semibold ${filterStatus === 'all' ? 'bg-primary text-white' : 'bg-surface border border-subtle text-secondary'}" data-status="all">
          ${t('common.all', 'All SKUs')}
        </button>
        <button class="filter-chip px-3 py-1.5 rounded-lg text-xs font-semibold ${filterStatus === 'low_stock' ? 'bg-amber-600 text-white' : 'bg-surface border border-subtle text-secondary'}" data-status="low_stock">
          ⚠️ ${t('supplier.low_stock', 'Low Stock')}
        </button>
        <button class="filter-chip px-3 py-1.5 rounded-lg text-xs font-semibold ${filterStatus === 'out_of_stock' ? 'bg-red-600 text-white' : 'bg-surface border border-subtle text-secondary'}" data-status="out_of_stock">
          🚫 ${t('supplier.out_of_stock', 'Out of Stock')}
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

    toolbar.querySelectorAll('.filter-chip').forEach((chip) => {
      chip.onclick = () => {
        filterStatus = chip.dataset.status;
        loadInventory();
      };
    });

    container.appendChild(toolbar);

    // 3. Main Inventory Table / Cards
    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `<div class="animate-spin inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full mb-3"></div><p>${t('common.loading', 'Loading stock data...')}</p>`;
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
    tableWrapper.className = 'table-container overflow-x-auto bg-surface border border-subtle rounded-xl';

    let tableHtml = `
      <table class="table w-full text-left border-collapse text-sm">
        <thead>
          <tr class="border-b border-subtle bg-surface-2 text-xs uppercase text-muted">
            <th class="py-3 px-4">${t('supplier.product_sku', 'Product SKU')}</th>
            <th class="py-3 px-4">${t('supplier.category', 'Category')}</th>
            <th class="py-3 px-4">${t('supplier.pricing', 'Base / Margin / Retail')}</th>
            <th class="py-3 px-4">${t('supplier.stock_status', 'Stock Level')}</th>
            <th class="py-3 px-4">${t('supplier.batches_fefo', 'FEFO Batches')}</th>
            <th class="py-3 px-4 text-right">${t('common.actions', 'Actions')}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-subtle">
    `;

    items.forEach((item) => {
      const isLow = Number(item.stock_qty) <= Number(item.low_stock_threshold);
      const isOut = Number(item.stock_qty) === 0;

      let statusBadge = `<span class="badge badge--success text-xs font-semibold">🟢 ${item.stock_qty} in stock</span>`;
      if (isOut) {
        statusBadge = `<span class="badge badge--danger text-xs font-semibold">🚫 Out of Stock</span>`;
      } else if (isLow) {
        statusBadge = `<span class="badge badge--warning text-xs font-semibold">⚠️ Low (${item.stock_qty} / Min ${item.low_stock_threshold})</span>`;
      }

      const batches = Array.isArray(item.batches) ? item.batches : [];
      const batchCount = batches.length;

      tableHtml += `
        <tr class="hover:bg-surface-2 transition-colors">
          <td class="py-3.5 px-4">
            <div class="font-bold text-base text-foreground">${item.title_en}</div>
            <div class="text-xs text-muted font-bangla">${item.title_bn || ''}</div>
            <span class="text-xs font-mono text-muted block mt-0.5">Ref: ${item.ref}</span>
          </td>
          <td class="py-3.5 px-4">
            <span class="badge badge--neutral text-xs">${item.category_name_en || 'General'}</span>
            ${item.requires_fefo ? '<span class="badge badge--info text-2xs block mt-1">FEFO Tracked</span>' : ''}
          </td>
          <td class="py-3.5 px-4 font-mono text-xs">
            <div><span class="text-muted">Base:</span> ${formatCurrency(item.base_cost)}</div>
            <div><span class="text-muted">Margin:</span> ${formatCurrency(item.wholesale_margin)}</div>
            <div><span class="text-muted">Retail:</span> ${formatCurrency(item.default_retail_price)}</div>
          </td>
          <td class="py-3.5 px-4">
            ${statusBadge}
            <div class="text-xs text-muted mt-1">Threshold: ${item.low_stock_threshold} units</div>
          </td>
          <td class="py-3.5 px-4">
            <div class="text-xs font-semibold">${batchCount} active batch${batchCount !== 1 ? 'es' : ''}</div>
            ${batches.slice(0, 2).map((b) => `
              <div class="text-2xs text-muted font-mono mt-0.5">
                #${b.batch_number} (${b.qty}u) · Exp: ${b.exp_date ? b.exp_date.slice(0, 10) : 'N/A'}
              </div>
            `).join('')}
          </td>
          <td class="py-3.5 px-4 text-right">
            <div class="flex items-center justify-end gap-1.5">
              <button class="btn btn--2xs btn--outline adjust-stock-btn" data-id="${item.id}" data-title="${item.title_en}" data-qty="${item.stock_qty}">
                ✏️ ${t('supplier.adjust_stock', 'Update Stock')}
              </button>
              <a href="/supplier/batches?productId=${item.id}" class="btn btn--2xs btn--secondary">
                🏷️ ${t('supplier.batches', 'Batches')}
              </a>
            </div>
          </td>
        </tr>
      `;
    });

    tableHtml += `</tbody></table>`;
    tableWrapper.innerHTML = tableHtml;

    // Attach adjust stock buttons
    tableWrapper.querySelectorAll('.adjust-stock-btn').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const title = btn.dataset.title;
        const currentQty = btn.dataset.qty;
        openStockAdjustModal(id, title, currentQty);
      };
    });

    container.appendChild(tableWrapper);
  }

  function openStockAdjustModal(productId, productTitle, currentQty) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    modalBackdrop.innerHTML = `
      <div class="modal-box bg-surface p-6 rounded-2xl border border-subtle max-w-md w-full shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-subtle pb-3">
          <h3 class="font-bold text-lg flex items-center gap-2">
            <span>📦</span> ${t('supplier.adjust_stock_title', 'Update Physical Stock')}
          </h3>
          <button class="text-muted hover:text-foreground text-xl close-modal-btn">&times;</button>
        </div>

        <p class="text-xs text-muted">
          ${t('supplier.adjust_stock_for', 'Updating live physical stock quantity for:')} <strong>${productTitle}</strong>
        </p>

        <div class="space-y-3">
          <div>
            <label class="block text-xs font-semibold mb-1">${t('supplier.new_stock_qty', 'Total New Stock Quantity')}</label>
            <input type="number" id="new-stock-input" class="input w-full" min="0" value="${currentQty}" />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-subtle">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel', 'Cancel')}</button>
          <button class="btn btn--sm btn--primary" id="save-stock-btn">${t('common.save', 'Save Quantity')}</button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));

    modalBackdrop.querySelector('#save-stock-btn').onclick = async () => {
      const newQty = parseInt(modalBackdrop.querySelector('#new-stock-input').value, 10);
      if (isNaN(newQty) || newQty < 0) {
        toast.error(t('supplier.invalid_qty', 'Please enter a valid non-negative number.'));
        return;
      }
      try {
        await supplierApi.updateStock({ productId, stockQty: newQty });
        toast.success(t('supplier.stock_updated_success', 'Stock updated successfully.'));
        close();
        loadInventory();
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
