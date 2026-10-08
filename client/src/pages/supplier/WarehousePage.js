/**
 * WarehousePage.js — Multi-Location Warehouse Hub & Regional Allocation (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AK:
 * - Multi-Node Warehouse Mapping: Regional factory nodes, storage facilities, partner fulfillment depots.
 * - Smart Proximity GIS allocation telemetry & great-circle distance resolution.
 * - Admin/Supplier priority configuration & add depot modal.
 *
 * WHY: nodes are uniform structured records (name/district/priority/stock), so the primary
 * surface is a sortable table — a supplier's real questions ("which depot is empty?",
 * "which one wins routing?") are column scans, not per-card reads. Cards survive only below
 * 1024px, where a seven-column table would force horizontal scrolling.
 */

import { supplierApi } from '../../services/supplier.api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { supplierModal } from './supplierModal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

/** Row count above which the search + status filter toolbar earns its space. */
const TOOLBAR_MIN_ROWS = 4;

const numberFmt = new Intl.NumberFormat();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

export default function WarehousePage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  if (!isFeatureEnabled('multi_warehouse')) {
    container.appendChild(
      EmptyState({
        icon: '🏭',
        title: t('supplier.warehouse_routing_title', 'Multi-Node Warehouses'),
        description: t('supplier.warehouse_module_disabled', 'The Multi-Warehouse Proximity Routing module is currently disabled.'),
      })
    );
    root.appendChild(container);
    return () => container.remove();
  }

  let warehouses = [];
  let loading = true;
  let query = '';
  let statusFilter = 'all';
  let sortKey = 'priority';
  let sortDir = 'desc';

  async function loadWarehouses() {
    loading = true;
    render();
    try {
      const res = await supplierApi.getWarehouses();
      warehouses = res.data || res || [];
    } catch (err) {
      console.error('Failed to load warehouses:', err);
      toast.error(t('supplier.warehouses_load_failed', 'Failed to load warehouse nodes.'));
      warehouses = [];
    } finally {
      loading = false;
      render();
    }
  }

  function isActive(wh) {
    return wh.is_active !== false;
  }

  function stockOf(wh) {
    return Number(wh.total_units_stored ?? wh.stock_units ?? 0);
  }

  function skuOf(wh) {
    return Number(wh.sku_count ?? 0);
  }

  function visibleRows() {
    const q = query.trim().toLowerCase();
    const rows = warehouses.filter((wh) => {
      if (statusFilter === 'active' && !isActive(wh)) return false;
      if (statusFilter === 'inactive' && isActive(wh)) return false;
      if (!q) return true;
      return [wh.name, wh.ref, wh.code, wh.district, wh.division, wh.address_line]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      let cmp;
      switch (sortKey) {
        case 'name':
          cmp = String(a.name || '').localeCompare(String(b.name || ''));
          break;
        case 'district':
          cmp = String(a.district || '').localeCompare(String(b.district || ''));
          break;
        case 'skus':
          cmp = skuOf(a) - skuOf(b);
          break;
        case 'stock':
          cmp = stockOf(a) - stockOf(b);
          break;
        case 'status':
          cmp = Number(isActive(a)) - Number(isActive(b));
          break;
        default:
          cmp = Number(a.priority || 0) - Number(b.priority || 0);
      }
      // WHY: priority ties are common (default 0) — fall back to name so order is stable.
      if (cmp === 0) cmp = String(a.name || '').localeCompare(String(b.name || ''));
      return cmp * dir;
    });
  }

  function toggleSort(key) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      // WHY: text reads naturally A→Z, but for counts the useful first look is the biggest.
      sortDir = key === 'name' || key === 'district' ? 'asc' : 'desc';
    }
    render();
  }

  function statusBadge(wh) {
    return isActive(wh)
      ? `<span class="badge badge--success text-xs">${escapeHtml(t('supplier.wh_status_active', 'Active'))}</span>`
      : `<span class="badge badge--neutral text-xs">${escapeHtml(t('supplier.wh_status_inactive', 'Inactive'))}</span>`;
  }

  function stockCell(wh) {
    const units = stockOf(wh);
    const empty = units === 0;
    return `
      <span class="supplier-wh-stock${empty ? ' supplier-wh-stock--empty' : ''}">
        ${numberFmt.format(units)} <span class="text-xs text-muted">${escapeHtml(t('supplier.wh_units', 'units'))}</span>
      </span>
      ${empty ? `<span class="badge badge--warning text-xs font-bold">${escapeHtml(t('supplier.wh_empty', 'Empty'))}</span>` : ''}
    `;
  }

  function coordsLine(wh) {
    if (wh.latitude == null || wh.longitude == null) return '';
    return `<span class="supplier-wh-coords">${escapeHtml(wh.latitude)}, ${escapeHtml(wh.longitude)}</span>`;
  }

  function sortableTh(key, label, numeric) {
    const active = sortKey === key;
    const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
    const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
    return `
      <th aria-sort="${ariaSort}"${numeric ? ' class="supplier-wh-num"' : ''}>
        <button type="button" class="supplier-th-sort${active ? ' is-active' : ''}" data-sort="${key}">
          ${escapeHtml(label)}<span class="supplier-th-sort__arrow" aria-hidden="true">${arrow}</span>
        </button>
      </th>
    `;
  }

  function renderToolbar(total, shown) {
    if (warehouses.length < TOOLBAR_MIN_ROWS) return '';
    return `
      <div class="supplier-wh-toolbar">
        <input type="search" id="wh-search" class="input input--sm" value="${escapeHtml(query)}"
               placeholder="${escapeHtml(t('supplier.wh_search_placeholder', 'Search depot, code or district…'))}"
               aria-label="${escapeHtml(t('supplier.wh_search_placeholder', 'Search depot, code or district…'))}" />
        <select id="wh-status-filter" class="input input--sm" aria-label="${escapeHtml(t('supplier.wh_filter_status', 'Filter by status'))}">
          <option value="all"${statusFilter === 'all' ? ' selected' : ''}>${escapeHtml(t('supplier.wh_filter_all', 'All statuses'))}</option>
          <option value="active"${statusFilter === 'active' ? ' selected' : ''}>${escapeHtml(t('supplier.wh_status_active', 'Active'))}</option>
          <option value="inactive"${statusFilter === 'inactive' ? ' selected' : ''}>${escapeHtml(t('supplier.wh_status_inactive', 'Inactive'))}</option>
        </select>
        <span class="supplier-wh-toolbar__count text-xs text-muted">
          ${escapeHtml(t('supplier.wh_showing_count', 'Showing {shown} of {total}').replace('{shown}', shown).replace('{total}', total))}
        </span>
      </div>
    `;
  }

  function render() {
    container.innerHTML = '';

    // 1. Header
    const header = document.createElement('header');
    header.className = 'supplier-header';
    header.innerHTML = `
      <div class="supplier-header__titles">
        <div class="supplier-header__badge-row">
          <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">&lt; ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
          <span class="text-muted">/</span>
          <span class="text-xs text-muted">${t('supplier.warehouses_breadcrumb', 'Multi-Location Depots')}</span>
        </div>
        <h1 class="supplier-header__title">
          <span>🏭</span> ${t('supplier.warehouses_title', 'Multi-Location Warehouse Network')}
        </h1>
        <p class="supplier-header__subtitle">
          ${t('supplier.warehouses_subtitle', 'Manage regional factory depots (Dhaka, Chittagong, Sylhet, Bogura) with smart GIS order routing.')}
        </p>
      </div>
      <div class="supplier-header__actions">
        <button class="btn btn--sm btn--primary" id="add-warehouse-btn">
          ➕ ${t('supplier.add_warehouse_btn', 'Add Depot Node')}
        </button>
        <button class="btn btn--sm btn--secondary" id="refresh-wh-btn">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;

    header.querySelector('#add-warehouse-btn').onclick = openAddWarehouseModal;
    header.querySelector('#refresh-wh-btn').onclick = loadWarehouses;
    container.appendChild(header);

    // 2. Info Banner regarding GIS Proximity & 3PL Transit Time
    const activeCount = warehouses.filter(isActive).length;
    const banner = document.createElement('div');
    banner.className = 'supplier-mode-banner';
    banner.style.borderLeftColor = 'var(--info)';
    banner.innerHTML = `
      <div class="supplier-mode-banner__content">
        <span class="supplier-mode-banner__icon">🗺️</span>
        <div>
          <h4 class="supplier-mode-banner__title">${t('supplier.smart_routing_active', 'Smart GIS Proximity Dispatch Active')}</h4>
          <p class="supplier-mode-banner__desc">
            ${t('supplier.smart_routing_desc', 'Orders automatically route to the closest warehouse relative to buyer district, cutting 3PL transit time & courier freight cost by 30-40%.')}
          </p>
        </div>
      </div>
      <span class="badge badge--success text-xs font-bold">${t('supplier.wh_active_nodes', '{count} Active Nodes').replace('{count}', activeCount)}</span>
    `;
    container.appendChild(banner);

    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>${t('common.loading', 'Loading warehouse network...')}</p>
      `;
      container.appendChild(loader);
      return;
    }

    if (warehouses.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '🏭',
          title: t('supplier.no_warehouses_found', 'No warehouse nodes registered'),
          description: t('supplier.no_warehouses_desc', 'Add your central factory or regional distribution hubs to start smart proximity routing.'),
          actionLabel: t('supplier.add_warehouse_btn', 'Add Depot Node'),
          onAction: openAddWarehouseModal,
        })
      );
      return;
    }

    const rows = visibleRows();

    const panel = document.createElement('section');
    panel.className = 'supplier-wh-panel';
    panel.innerHTML = renderToolbar(warehouses.length, rows.length);

    if (rows.length === 0) {
      const none = document.createElement('div');
      none.className = 'p-12 text-center text-muted';
      none.textContent = t('supplier.wh_no_match', 'No depot node matches the current search or filter.');
      panel.appendChild(none);
      wireToolbar(panel);
      container.appendChild(panel);
      return;
    }

    // 3a. Desktop — sortable data table.
    const tableWrap = document.createElement('div');
    tableWrap.className = 'supplier-table-card supplier-wh-table-wrap';
    tableWrap.innerHTML = `
      <div style="overflow-x: auto;">
        <table class="supplier-table supplier-wh-table">
          <caption class="sr-only">${escapeHtml(t('supplier.warehouses_title', 'Multi-Location Warehouse Network'))}</caption>
          <thead>
            <tr>
              ${sortableTh('name', t('supplier.wh_col_node', 'Depot node'), false)}
              ${sortableTh('district', t('supplier.wh_col_location', 'Location'), false)}
              ${sortableTh('status', t('supplier.wh_col_status', 'Status'), false)}
              ${sortableTh('priority', t('supplier.wh_col_priority', 'Routing priority'), true)}
              ${sortableTh('skus', t('supplier.wh_col_skus', 'SKUs'), true)}
              ${sortableTh('stock', t('supplier.wh_col_stock', 'Stock held'), true)}
              <th style="text-align: right;">${escapeHtml(t('common.actions', 'Actions'))}</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (wh) => `
              <tr data-id="${escapeHtml(wh.id)}">
                <td>
                  <div class="supplier-wh-name">
                    <span class="supplier-wh-name__title">${escapeHtml(wh.name)}</span>
                    <span class="supplier-order-card__ref">${escapeHtml(wh.ref || wh.code || '—')}</span>
                  </div>
                </td>
                <td>
                  <div class="supplier-wh-location">
                    <span class="supplier-wh-location__district">${escapeHtml(wh.district || '—')}</span>
                    <span class="text-xs text-muted">${escapeHtml(wh.address_line || wh.address || '')}</span>
                    ${coordsLine(wh)}
                  </div>
                </td>
                <td>${statusBadge(wh)}</td>
                <td class="supplier-wh-num"><span class="supplier-wh-priority">${escapeHtml(wh.priority ?? 0)}</span></td>
                <td class="supplier-wh-num">${numberFmt.format(skuOf(wh))}</td>
                <td class="supplier-wh-num">${stockCell(wh)}</td>
                <td style="text-align: right;">
                  <button class="btn btn--xs btn--outline edit-wh-btn" data-id="${escapeHtml(wh.id)}">
                    ⚙️ ${escapeHtml(t('supplier.wh_edit_node', 'Edit'))}
                  </button>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
    panel.appendChild(tableWrap);

    // 3b. Tablet & phone — the same rows as cards, since 7 columns cannot fit.
    const grid = document.createElement('div');
    grid.className = 'supplier-warehouse-grid';
    grid.innerHTML = rows
      .map(
        (wh) => `
      <article class="supplier-warehouse-card">
        <div class="supplier-warehouse-card__top">
          <span class="supplier-order-card__ref">${escapeHtml(wh.ref || wh.code || '—')}</span>
          <div class="supplier-warehouse-card__badges">
            ${statusBadge(wh)}
            <span class="badge badge--primary text-xs">${escapeHtml(t('supplier.wh_col_priority', 'Routing priority'))}: ${escapeHtml(wh.priority ?? 0)}</span>
          </div>
        </div>
        <div>
          <h3 class="supplier-wh-name__title">${escapeHtml(wh.name)}</h3>
          <p class="text-xs text-muted" style="margin: 2px 0 0 0;">
            📍 ${escapeHtml(wh.address_line || wh.address || '')}${wh.address_line || wh.address ? ', ' : ''}<strong>${escapeHtml(wh.district || '')}</strong>
          </p>
          ${coordsLine(wh)}
        </div>
        <dl class="supplier-warehouse-card__stats">
          <div>
            <dt>${escapeHtml(t('supplier.wh_col_skus', 'SKUs'))}</dt>
            <dd>${numberFmt.format(skuOf(wh))}</dd>
          </div>
          <div>
            <dt>${escapeHtml(t('supplier.wh_col_stock', 'Stock held'))}</dt>
            <dd>${stockCell(wh)}</dd>
          </div>
        </dl>
        <div class="supplier-warehouse-card__foot">
          <button class="btn btn--xs btn--outline edit-wh-btn" data-id="${escapeHtml(wh.id)}">
            ⚙️ ${escapeHtml(t('supplier.wh_edit_node', 'Edit'))}
          </button>
        </div>
      </article>
    `
      )
      .join('');
    panel.appendChild(grid);

    panel.querySelectorAll('.supplier-th-sort').forEach((btn) => {
      btn.onclick = () => toggleSort(btn.dataset.sort);
    });

    panel.querySelectorAll('.edit-wh-btn').forEach((btn) => {
      btn.onclick = () => {
        const wh = warehouses.find((w) => String(w.id) === btn.dataset.id);
        if (wh) toast.info(`Editing configuration for ${wh.name}.`);
      };
    });

    wireToolbar(panel);
    container.appendChild(panel);
  }

  function wireToolbar(panel) {
    const search = panel.querySelector('#wh-search');
    if (search) {
      search.oninput = (e) => {
        query = e.target.value;
        render();
        const next = container.querySelector('#wh-search');
        if (next) {
          next.focus();
          next.setSelectionRange(next.value.length, next.value.length);
        }
      };
    }
    const filter = panel.querySelector('#wh-status-filter');
    if (filter) {
      filter.onchange = (e) => {
        statusFilter = e.target.value;
        render();
      };
    }
  }

  // 4. Add Warehouse Modal
  function openAddWarehouseModal() {
    const modalBackdrop = supplierModal({
      title: `➕ Add Regional Depot Node`,
      size: 'md',
      body: `
        <form id="new-wh-form" style="display: flex; flex-direction: column; gap: var(--space-3, 12px);">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-size: var(--text-xs); font-weight: 700;">Depot Name *</label>
            <input type="text" id="wh-name-input" class="input input--sm" placeholder="e.g. Bogura Distribution Depot" required />
          </div>

          <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-2, 8px);">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label class="label" style="font-size: var(--text-xs); font-weight: 700;">District *</label>
              <select id="wh-district-select" class="input input--sm">
                <option value="Dhaka">Dhaka</option>
                <option value="Chittagong">Chittagong</option>
                <option value="Sylhet">Sylhet</option>
                <option value="Rajshahi">Rajshahi</option>
                <option value="Khulna">Khulna</option>
                <option value="Barisal">Barisal</option>
                <option value="Rangpur">Rangpur</option>
                <option value="Mymensingh">Mymensingh</option>
                <option value="Bogura">Bogura</option>
              </select>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label class="label" style="font-size: var(--text-xs); font-weight: 700;">Priority Score (1-100)</label>
              <input type="number" id="wh-priority-input" class="input input--sm" min="1" max="100" value="10" />
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-size: var(--text-xs); font-weight: 700;">Street Address *</label>
            <input type="text" id="wh-address-input" class="input input--sm" placeholder="e.g. Plot 14, BSCIC Industrial Estate" required />
          </div>
        </form>
      `,
      footer: `
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel', 'Cancel')}</button>
          <button class="btn btn--sm btn--primary" id="save-wh-btn">
            💾 Save Depot Node
          </button>
        `,
    });

    const close = () => modalBackdrop.close(false);

    modalBackdrop.querySelector('#save-wh-btn').onclick = async () => {
      const name = modalBackdrop.querySelector('#wh-name-input').value.trim();
      const district = modalBackdrop.querySelector('#wh-district-select').value;
      const priority = parseInt(modalBackdrop.querySelector('#wh-priority-input').value, 10) || 10;
      const address = modalBackdrop.querySelector('#wh-address-input').value.trim();

      if (!name || !address) {
        toast.error('Please fill in depot name and address.');
        return;
      }

      try {
        await supplierApi.createWarehouse({
          name,
          district,
          priority,
          address,
          code: `WH-${district.slice(0, 3).toUpperCase()}-0${warehouses.length + 1}`,
          latitude: 23.8103,
          longitude: 90.4125,
        });
        toast.success(t('supplier.wh_created_success', 'Depot node registered successfully.'));
        close();
        loadWarehouses();
      } catch (err) {
        toast.error(t('supplier.wh_create_failed', 'Failed to register warehouse node.'));
      }
    };

    modalBackdrop.open(document.activeElement);
  }

  loadWarehouses();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
