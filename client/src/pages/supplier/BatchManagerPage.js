/**
 * BatchManagerPage.js — FEFO Batch Expiration Timeline, Clearance Sale Actions & Recalls (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AJ:
 * - Lot/Batch Number tracking with Mfg & Exp dates.
 * - FEFO expiration timeline: Color-coded buckets (<30d urgent, 30-60d alert, >60d active, expired).
 * - 1-Click clearance flash sale trigger with recommended markdown % (15% / 30%).
 * - Rapid recall isolation without disrupting other catalog items.
 * - Create new lot intake modal.
 */

import { supplierApi } from '../../services/supplier.api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function BatchManagerPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-batches-page container py-6 space-y-6';

  if (!isFeatureEnabled('fefo_batches')) {
    container.appendChild(
      EmptyState({
        icon: '🏷️',
        title: t('supplier.batches_fefo', 'FEFO Batch Manager'),
        description: t('supplier.fefo_module_disabled', 'The FEFO Batch & Expiration Management module is currently disabled.'),
      })
    );
    root.appendChild(container);
    return () => container.remove();
  }

  let batches = [];
  let warehouses = [];
  let loading = true;
  let filterStatus = 'all'; // 'all' | 'EXPIRING_SOON' | 'ACTIVE' | 'EXPIRED' | 'RECALLED'

  async function loadData() {
    loading = true;
    render();
    try {
      const [batchRes, whRes] = await Promise.all([
        supplierApi.getBatches({ status: filterStatus }),
        supplierApi.getWarehouses(),
      ]);
      batches = batchRes.data || batchRes || [];
      warehouses = whRes.data || whRes || [];
    } catch (err) {
      console.error('Failed to load batch data:', err);
      toast.error(t('supplier.batches_load_failed', 'Failed to load batches.'));
      batches = [];
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
          <span>🏷️</span> ${t('supplier.batches_title', 'FEFO Batch & Expiry Timeline')}
        </h1>
        <p class="text-sm text-muted mt-1">
          ${t('supplier.batches_subtitle', 'Automated First-Expired First-Out dispatch, 30/60-day early clearance alerts, and batch recall isolation.')}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn--sm btn--primary" id="create-batch-btn">
          ➕ ${t('supplier.create_batch_btn', 'New Stock Lot / Batch')}
        </button>
        <button class="btn btn--sm btn--secondary" id="refresh-batch-btn">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;

    header.querySelector('#create-batch-btn').onclick = openCreateBatchModal;
    header.querySelector('#refresh-batch-btn').onclick = loadData;
    container.appendChild(header);

    // 2. Timeline Status Filters
    const filterBar = document.createElement('div');
    filterBar.className = 'flex flex-wrap items-center justify-between gap-3 p-3 bg-surface-2 rounded-xl border border-subtle';
    filterBar.innerHTML = `
      <div class="flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span class="text-muted mr-1">${t('supplier.filter_by_timeline', 'Timeline')}:</span>
        <button class="filter-chip px-3 py-1.5 rounded-lg ${filterStatus === 'all' ? 'bg-primary text-white' : 'bg-surface border border-subtle text-secondary'}" data-status="all">
          ${t('common.all', 'All Batches')}
        </button>
        <button class="filter-chip px-3 py-1.5 rounded-lg ${filterStatus === 'EXPIRING_SOON' ? 'bg-amber-600 text-white' : 'bg-surface border border-subtle text-secondary'}" data-status="EXPIRING_SOON">
          ⚠️ ${t('supplier.expiring_soon', 'Expiring Soon (≤60d)')}
        </button>
        <button class="filter-chip px-3 py-1.5 rounded-lg ${filterStatus === 'ACTIVE' ? 'bg-green-600 text-white' : 'bg-surface border border-subtle text-secondary'}" data-status="ACTIVE">
          🟢 ${t('supplier.active_healthy', 'Healthy (>60d)')}
        </button>
        <button class="filter-chip px-3 py-1.5 rounded-lg ${filterStatus === 'EXPIRED' ? 'bg-red-600 text-white' : 'bg-surface border border-subtle text-secondary'}" data-status="EXPIRED">
          🚫 ${t('supplier.expired', 'Expired')}
        </button>
        <button class="filter-chip px-3 py-1.5 rounded-lg ${filterStatus === 'RECALLED' ? 'bg-purple-600 text-white' : 'bg-surface border border-subtle text-secondary'}" data-status="RECALLED">
          🚨 ${t('supplier.recalled', 'Recalled')}
        </button>
      </div>
    `;

    filterBar.querySelectorAll('.filter-chip').forEach((chip) => {
      chip.onclick = () => {
        filterStatus = chip.dataset.status;
        loadData();
      };
    });

    container.appendChild(filterBar);

    // 3. Batch List or Empty State
    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `<div class="animate-spin inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full mb-3"></div><p>${t('common.loading', 'Loading batch timeline...')}</p>`;
      container.appendChild(loader);
      return;
    }

    if (batches.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '🏷️',
          title: t('supplier.no_batches_found', 'No batches found in this view'),
          description: t('supplier.no_batches_desc', 'Track FMCG, skincare, food or medicine lots by recording your manufacturing and expiration dates.'),
          actionLabel: t('supplier.create_batch_btn', 'Create New Batch'),
          onAction: openCreateBatchModal,
        })
      );
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';

    batches.forEach((batch) => {
      const daysLeft = Number(batch.days_to_expiry);
      const isUrgent = daysLeft <= 30 && daysLeft > 0;
      const isApproaching = daysLeft > 30 && daysLeft <= 60;
      const isExpired = daysLeft <= 0 || batch.status === 'EXPIRED';
      const isRecalled = batch.status === 'RECALLED';

      let timelineBadge = `<span class="badge badge--success text-xs">🟢 ${daysLeft} days left</span>`;
      let cardBorder = 'border-subtle';

      if (isRecalled) {
        timelineBadge = `<span class="badge badge--danger text-xs">🚨 RECALLED</span>`;
        cardBorder = 'border-purple-500/40 bg-purple-500/5';
      } else if (isExpired) {
        timelineBadge = `<span class="badge badge--danger text-xs">🚫 EXPIRED</span>`;
        cardBorder = 'border-red-500/40 bg-red-500/5';
      } else if (isUrgent) {
        timelineBadge = `<span class="badge badge--warning text-xs animate-pulse">⚠️ Expiring in ${daysLeft}d</span>`;
        cardBorder = 'border-red-500/40 bg-red-500/5';
      } else if (isApproaching) {
        timelineBadge = `<span class="badge badge--warning text-xs">⏳ ${daysLeft} days left</span>`;
        cardBorder = 'border-amber-500/40 bg-amber-500/5';
      }

      const card = document.createElement('div');
      card.className = `batch-card p-5 rounded-2xl border ${cardBorder} bg-surface flex flex-col justify-between shadow-sm`;

      card.innerHTML = `
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
              #${batch.batch_number}
            </span>
            ${timelineBadge}
          </div>

          <h3 class="font-bold text-base text-foreground mb-1">${batch.product_title_en}</h3>
          <p class="text-xs text-muted font-bangla mb-3">${batch.product_title_bn || ''}</p>

          <div class="space-y-1.5 text-xs text-secondary bg-surface-2 p-3 rounded-lg border border-subtle font-mono">
            <div class="flex justify-between">
              <span class="text-muted">Available Stock:</span>
              <span class="font-bold">${batch.qty} units</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">Expiry Date:</span>
              <span>${batch.exp_date ? batch.exp_date.slice(0, 10) : 'N/A'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">Mfg Date:</span>
              <span>${batch.mfg_date ? batch.mfg_date.slice(0, 10) : 'N/A'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">Depot Node:</span>
              <span>${batch.warehouse_name || 'Dhaka Central'}</span>
            </div>
            ${batch.recall_reason ? `<div class="text-red-500 font-sans text-2xs mt-1">Reason: ${batch.recall_reason}</div>` : ''}
          </div>
        </div>

        <div class="flex items-center gap-2 pt-4 border-t border-subtle mt-4">
          ${(isUrgent || isApproaching) && !isRecalled ? `
            <button class="btn btn--xs btn--primary flex-1 clearance-btn" data-id="${batch.id}" data-num="${batch.batch_number}">
              ⚡ 1-Click Clearance (${isUrgent ? '30%' : '15%'} Off)
            </button>
          ` : ''}

          ${!isRecalled ? `
            <button class="btn btn--xs btn--outline text-red-500 hover:bg-red-500/10 recall-btn" data-id="${batch.id}" data-num="${batch.batch_number}">
              🚨 Recall
            </button>
          ` : `
            <span class="text-xs text-purple-600 font-bold">🔒 Isolated in Quarantine</span>
          `}
        </div>
      `;

      // 1-Click clearance action handler
      const clearanceBtn = card.querySelector('.clearance-btn');
      if (clearanceBtn) {
        clearanceBtn.onclick = async () => {
          const discountPct = isUrgent ? 30 : 15;
          try {
            const res = await supplierApi.triggerBatchClearance(batch.id, discountPct);
            toast.success(res.data?.message || t('supplier.clearance_success', 'Clearance flash sale activated!'));
            loadData();
          } catch (err) {
            toast.error(t('supplier.clearance_failed', 'Failed to activate clearance sale.'));
          }
        };
      }

      // Recall handler
      const recallBtn = card.querySelector('.recall-btn');
      if (recallBtn) {
        recallBtn.onclick = () => openRecallModal(batch.id, batch.batch_number, batch.product_title_en);
      }

      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  function openCreateBatchModal() {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    modalBackdrop.innerHTML = `
      <div class="modal-box bg-surface p-6 rounded-2xl border border-subtle max-w-lg w-full shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-subtle pb-3">
          <h3 class="font-bold text-lg flex items-center gap-2">
            <span>🏷️</span> ${t('supplier.create_batch_modal_title', 'Create New FEFO Stock Batch')}
          </h3>
          <button class="text-muted hover:text-foreground text-xl close-modal-btn">&times;</button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-xs font-semibold mb-1">${t('supplier.batch_product_id', 'Product ID')}</label>
            <input type="number" id="batch-product-id" class="input w-full" placeholder="e.g. 1" required />
          </div>
          <div>
            <label class="block text-xs font-semibold mb-1">${t('supplier.batch_number', 'Batch / Lot Number')}</label>
            <input type="text" id="batch-num-input" class="input w-full font-mono" placeholder="e.g. LOT-2026-OCT-01" required />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold mb-1">${t('supplier.mfg_date', 'Manufacturing Date')}</label>
              <input type="date" id="batch-mfg-date" class="input w-full" />
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1">${t('supplier.exp_date', 'Expiration Date (FEFO)')}</label>
              <input type="date" id="batch-exp-date" class="input w-full" required />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold mb-1">${t('supplier.initial_qty', 'Initial Units')}</label>
              <input type="number" id="batch-qty-input" class="input w-full" min="1" value="100" required />
            </div>
            <div>
              <label class="block text-xs font-semibold mb-1">${t('supplier.warehouse_node', 'Warehouse Node')}</label>
              <select id="batch-warehouse-node" class="select w-full">
                ${warehouses.map((w) => `<option value="${w.id}">${w.name} (${w.district})</option>`).join('')}
                ${warehouses.length === 0 ? '<option value="1">Central Depot (Dhaka)</option>' : ''}
              </select>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-subtle">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel', 'Cancel')}</button>
          <button class="btn btn--sm btn--primary" id="save-batch-btn">${t('supplier.save_batch', 'Save Batch')}</button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));

    modalBackdrop.querySelector('#save-batch-btn').onclick = async () => {
      const productId = parseInt(modalBackdrop.querySelector('#batch-product-id').value, 10);
      const batchNumber = modalBackdrop.querySelector('#batch-num-input').value.trim();
      const mfgDate = modalBackdrop.querySelector('#batch-mfg-date').value || null;
      const expDate = modalBackdrop.querySelector('#batch-exp-date').value || null;
      const qty = parseInt(modalBackdrop.querySelector('#batch-qty-input').value, 10);
      const warehouseNodeId = parseInt(modalBackdrop.querySelector('#batch-warehouse-node').value, 10);

      if (!productId || !batchNumber || !expDate || isNaN(qty)) {
        toast.error(t('supplier.fill_required_fields', 'Please fill all required batch fields.'));
        return;
      }

      try {
        await supplierApi.createBatch({
          productId,
          warehouseNodeId,
          batchNumber,
          mfgDate,
          expDate,
          qty,
        });
        toast.success(t('supplier.batch_created_success', 'Batch lot registered successfully.'));
        close();
        loadData();
      } catch (err) {
        toast.error(t('supplier.batch_create_failed', 'Failed to register batch lot.'));
      }
    };

    document.body.appendChild(modalBackdrop);
  }

  function openRecallModal(batchId, batchNumber, productTitle) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    modalBackdrop.innerHTML = `
      <div class="modal-box bg-surface p-6 rounded-2xl border border-red-500/40 max-w-md w-full shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-subtle pb-3">
          <h3 class="font-bold text-lg text-red-600 flex items-center gap-2">
            <span>🚨</span> ${t('supplier.recall_batch_title', 'Isolate & Recall Batch')}
          </h3>
          <button class="text-muted hover:text-foreground text-xl close-modal-btn">&times;</button>
        </div>

        <p class="text-xs text-muted">
          ${t('supplier.recall_warning_desc', 'This action will instantly isolate batch')} <strong>#${batchNumber}</strong> (${productTitle}) ${t('supplier.recall_warning_suffix', 'and block further dispatches without affecting the rest of your catalog.')}
        </p>

        <div>
          <label class="block text-xs font-semibold mb-1">${t('supplier.recall_reason_label', 'Reason for Recall (Defect / Quality / Contamination)')}</label>
          <textarea id="recall-reason-input" class="textarea w-full" rows="3" placeholder="e.g. Packaging seal integrity compromised during transit."></textarea>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-subtle">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel', 'Cancel')}</button>
          <button class="btn btn--sm btn--danger" id="confirm-recall-btn">${t('supplier.confirm_recall', 'Confirm Recall')}</button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));

    modalBackdrop.querySelector('#confirm-recall-btn').onclick = async () => {
      const reason = modalBackdrop.querySelector('#recall-reason-input').value.trim();
      if (!reason) {
        toast.error(t('supplier.recall_reason_required', 'Please state a reason for the batch recall.'));
        return;
      }
      try {
        await supplierApi.recallBatch(batchId, reason);
        toast.success(t('supplier.batch_recalled_success', 'Batch isolated and recalled successfully.'));
        close();
        loadData();
      } catch (err) {
        toast.error(t('supplier.batch_recall_failed', 'Failed to recall batch.'));
      }
    };

    document.body.appendChild(modalBackdrop);
  }

  loadData();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
