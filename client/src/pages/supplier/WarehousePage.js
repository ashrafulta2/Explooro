/**
 * WarehousePage.js — Multi-Location Warehouse Hub & Regional Allocation (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AK:
 * - Multi-Node Warehouse Mapping: Regional factory nodes, regional storage facilities, partner fulfillment depots.
 * - Smart Proximity GIS allocation telemetry & great-circle distance resolution.
 * - Admin/Supplier priority configuration & add depot modal.
 */

import { supplierApi } from '../../services/supplier.api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function WarehousePage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-warehouses-page container py-6 space-y-6';

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

  function render() {
    container.innerHTML = '';

    // 1. Header
    const header = document.createElement('header');
    header.className = 'page-header flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-subtle';
    header.innerHTML = `
      <div>
        <div class="flex items-center gap-2">
          <a href="/supplier" class="text-xs text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
        </div>
        <h1 class="text-2xl font-bold flex items-center gap-2 mt-1">
          <span>🏭</span> ${t('supplier.warehouses_title', 'Multi-Location Warehouse Network')}
        </h1>
        <p class="text-sm text-muted mt-1">
          ${t('supplier.warehouses_subtitle', 'Manage regional factory depots (Dhaka, Chittagong, Sylhet, Bogura) with smart GIS order routing.')}
        </p>
      </div>
      <div class="flex items-center gap-2">
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
    const banner = document.createElement('div');
    banner.className = 'p-4 rounded-xl bg-surface-2 border border-subtle flex flex-col md:flex-row md:items-center justify-between gap-3';
    banner.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-2xl">🗺️</span>
        <div>
          <h4 class="font-bold text-sm text-foreground">${t('supplier.smart_routing_active', 'Smart GIS Proximity Dispatch Active')}</h4>
          <p class="text-xs text-muted">${t('supplier.smart_routing_desc', 'Orders automatically route to the closest warehouse relative to buyer district, cutting 3PL transit time & courier freight cost by 30-40%.')}</p>
        </div>
      </div>
      <span class="badge badge--success text-xs font-mono">${warehouses.length} Active Regional Nodes</span>
    `;
    container.appendChild(banner);

    // 3. Grid of Warehouse Nodes
    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `<div class="animate-spin inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full mb-3"></div><p>${t('common.loading', 'Loading warehouse nodes...')}</p>`;
      container.appendChild(loader);
      return;
    }

    if (warehouses.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '🏭',
          title: t('supplier.no_warehouses_found', 'No warehouse nodes registered'),
          description: t('supplier.no_warehouses_desc', 'Add regional storage nodes to enable proximity dispatch and faster customer fulfillment.'),
          actionLabel: t('supplier.add_warehouse_btn', 'Add First Depot'),
          onAction: openAddWarehouseModal,
        })
      );
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5';

    warehouses.forEach((wh) => {
      const card = document.createElement('div');
      card.className = 'warehouse-card p-5 rounded-2xl border border-subtle bg-surface flex flex-col justify-between shadow-sm hover:shadow-md transition-all';
      card.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">${wh.ref}</span>
            <span class="badge ${wh.is_active ? 'badge--success' : 'badge--neutral'} text-xs">${wh.is_active ? '🟢 ' + t('common.active', 'Active') : '⚪ ' + t('common.inactive', 'Inactive')}</span>
          </div>

          <h3 class="font-bold text-base text-foreground mt-1">${wh.name}</h3>
          <p class="text-xs text-muted flex items-center gap-1 mt-0.5">
            <span>📍</span> ${wh.address_line}, ${wh.upazila ? wh.upazila + ', ' : ''}${wh.district} (${wh.division})
          </p>

          <div class="mt-4 p-3 bg-surface-2 rounded-xl border border-subtle space-y-1.5 text-xs">
            <div class="flex justify-between">
              <span class="text-muted">${t('supplier.dispatch_priority', 'Dispatch Priority')}:</span>
              <span class="font-bold font-mono text-primary">${wh.priority || 0}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">${t('supplier.coordinates', 'GIS Coordinates')}:</span>
              <span class="font-mono text-muted">${wh.latitude ? `${Number(wh.latitude).toFixed(4)}, ${Number(wh.longitude).toFixed(4)}` : 'Auto-resolved'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">${t('supplier.skus_stored', 'Assigned SKUs')}:</span>
              <span class="font-bold">${wh.sku_count || 0} SKUs</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">${t('supplier.total_units_stocked', 'Units Stocked')}:</span>
              <span class="font-bold font-mono text-green-600">${wh.total_units_stored || 0} units</span>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-4 border-t border-subtle mt-4">
          <a href="/supplier/inventory" class="btn btn--xs btn--secondary flex-1 text-center">${t('supplier.view_node_stock', 'View Depot Stock')}</a>
        </div>
      `;
      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  function openAddWarehouseModal() {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    modalBackdrop.innerHTML = `
      <div class="modal-box bg-surface p-6 rounded-2xl border border-subtle max-w-lg w-full shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-subtle pb-3">
          <h3 class="font-bold text-lg flex items-center gap-2">
            <span>🏭</span> ${t('supplier.add_warehouse_modal_title', 'Register Regional Warehouse / Factory')}
          </h3>
          <button class="text-muted hover:text-foreground text-xl close-modal-btn">&times;</button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-xs font-semibold mb-1">${t('supplier.warehouse_name', 'Warehouse / Facility Name')}</label>
            <input type="text" id="wh-name-input" class="input w-full" placeholder="e.g. Tejgaon Industrial Depot" required />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold mb-1">${t('supplier.division', 'Division')}</label>
              <select id="wh-division-select" class="select w-full">
                <option value="Dhaka">Dhaka</option>
                <option value="Chittagong">Chittagong</option>
                <option value="Rajshahi">Rajshahi</option>
                <option value="Sylhet">Sylhet</option>
                <option value="Khulna">Khulna</option>
                <option value="Barishal">Barishal</option>
                <option value="Rangpur">Rangpur</option>
                <option value="Mymensingh">Mymensingh</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1">${t('supplier.district', 'District')}</label>
              <input type="text" id="wh-district-input" class="input w-full" placeholder="e.g. Dhaka, Bogura, Sylhet" required />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold mb-1">${t('supplier.upazila', 'Upazila / Area')}</label>
              <input type="text" id="wh-upazila-input" class="input w-full" placeholder="e.g. Tejgaon, Agrabad" />
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1">${t('supplier.priority_order', 'Dispatch Priority (0-100)')}</label>
              <input type="number" id="wh-priority-input" class="input w-full" value="10" min="0" max="100" />
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1">${t('supplier.address_line', 'Detailed Address Line')}</label>
            <input type="text" id="wh-address-input" class="input w-full" placeholder="e.g. Plot 14, Block B, Tejgaon I/A" required />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-subtle">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel', 'Cancel')}</button>
          <button class="btn btn--sm btn--primary" id="save-wh-btn">${t('supplier.save_warehouse', 'Save Warehouse')}</button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));

    modalBackdrop.querySelector('#save-wh-btn').onclick = async () => {
      const name = modalBackdrop.querySelector('#wh-name-input').value.trim();
      const division = modalBackdrop.querySelector('#wh-division-select').value;
      const district = modalBackdrop.querySelector('#wh-district-input').value.trim();
      const upazila = modalBackdrop.querySelector('#wh-upazila-input').value.trim();
      const priority = parseInt(modalBackdrop.querySelector('#wh-priority-input').value, 10) || 0;
      const addressLine = modalBackdrop.querySelector('#wh-address-input').value.trim();

      if (!name || !district || !addressLine) {
        toast.error(t('supplier.fill_required_fields', 'Please fill all required warehouse fields.'));
        return;
      }

      try {
        await supplierApi.createWarehouse({
          name,
          division,
          district,
          upazila,
          priority,
          addressLine,
        });
        toast.success(t('supplier.warehouse_created_success', 'Warehouse node added successfully.'));
        close();
        loadWarehouses();
      } catch (err) {
        toast.error(t('supplier.warehouse_create_failed', 'Failed to add warehouse node.'));
      }
    };

    document.body.appendChild(modalBackdrop);
  }

  loadWarehouses();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
