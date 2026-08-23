/**
 * PayoutQueuePage.js — Admin Payout Queue & Risk Management Dashboard (Prompt 6.3).
 *
 * Implements:
 * - Payout queue with status, method, and amount filtering
 * - Automated risk indicators: First Payout, High Value, Name Mismatch, New User
 * - Maker-Checker workflow integration: Moderator approval vs Super Admin execution
 * - Single and multi-item batch disbursement with per-item isolation
 * - Rejection dialog with reason recording and immediate HELD balance release
 */

import { api } from '../../core/api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';

export function PayoutQueuePage() {
  const container = document.createElement('div');
  container.className = 'page payout-queue-page';

  let payouts = [];
  let selectedIds = new Set();
  let statusFilter = 'REQUESTED';
  let methodFilter = '';
  let isLoading = true;

  async function loadData() {
    isLoading = true;
    render();

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (methodFilter) params.set('method', methodFilter);
      params.set('limit', '50');

      const res = await api.get(`/api/v1/admin/finance/payouts?${params.toString()}`);
      payouts = res.data?.payouts || [];
    } catch (err) {
      toast.error(err.message || 'Failed to load payout queue');
      payouts = [];
    } finally {
      isLoading = false;
      render();
    }
  }

  function getRiskBadge(flag) {
    const code = flag.code || flag;
    switch (code) {
      case 'HIGH_VALUE_DISBURSEMENT':
        return `<span class="badge badge--danger" title="${flag.message || ''}">⚠️ ${t('payout.risk.high_value')}</span>`;
      case 'FIRST_WITHDRAWAL':
        return `<span class="badge badge--warning" title="${flag.message || ''}">🆕 ${t('payout.risk.first_payout')}</span>`;
      case 'NAME_MISMATCH':
        return `<span class="badge badge--danger" title="${flag.message || ''}">⚡ ${t('payout.risk.name_mismatch')}</span>`;
      case 'NEW_ACCOUNT':
        return `<span class="badge badge--info" title="${flag.message || ''}">⏳ ${t('payout.risk.new_account')}</span>`;
      default:
        return `<span class="badge badge--warning">${code}</span>`;
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'COMPLETED':
        return `<span class="badge badge--success">${t('payout.status.completed')}</span>`;
      case 'REQUESTED':
        return `<span class="badge badge--warning">${t('payout.status.requested')}</span>`;
      case 'HELD':
        return `<span class="badge badge--purple">${t('payout.status.held_maker_checker')}</span>`;
      case 'FAILED':
        return `<span class="badge badge--danger">${t('payout.status.failed')}</span>`;
      case 'REJECTED':
        return `<span class="badge badge--muted">${t('payout.status.rejected')}</span>`;
      default:
        return `<span class="badge">${status}</span>`;
    }
  }

  async function handleApprove(payout) {
    try {
      const res = await api.post(`/api/v1/admin/finance/payouts/${payout.id}/approve`, {
        note: 'Approved from Admin Payout Queue',
      });

      if (res.meta?.maker_checker?.requires_super_admin) {
        toast.info(t('payout.maker_checker_pending_notice'));
      } else {
        toast.success(t('payout.disburse_success_notice'));
      }
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Approval failed');
    }
  }

  async function handleReject(payout) {
    const reason = window.prompt(t('payout.enter_reject_reason'), 'Account verification failure');
    if (!reason) return;

    try {
      await api.post(`/api/v1/admin/finance/payouts/${payout.id}/reject`, { reason });
      toast.success(t('payout.reject_success_notice'));
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Rejection failed');
    }
  }

  async function handleBatchDisburse() {
    if (selectedIds.size === 0) return;

    const confirmed = await confirmDialog({
      title: t('payout.batch_disburse_title'),
      message: t('payout.batch_disburse_confirm', { count: selectedIds.size }),
      confirmLabel: t('payout.batch_disburse_btn'),
      variant: 'primary',
    });
    if (!confirmed) return;

    try {
      const res = await api.post('/api/v1/admin/finance/payouts/batch-disburse', {
        payout_ids: Array.from(selectedIds),
      });

      const { successCount, failureCount } = res.data;
      toast.success(t('payout.batch_disburse_result', { success: successCount, failed: failureCount }));
      selectedIds.clear();
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Batch disbursement failed');
    }
  }

  function render() {
    const totalPendingAmount = payouts
      .filter((p) => p.status === 'REQUESTED' || p.status === 'HELD')
      .reduce((acc, p) => acc + parseFloat(p.amount), 0);

    const highRiskCount = payouts.filter((p) => {
      const flags = typeof p.risk_flags_json === 'string' ? JSON.parse(p.risk_flags_json) : (p.risk_flags_json || []);
      return flags.length > 0;
    }).length;

    container.innerHTML = `
      <div class="payout-queue-page__header">
        <div>
          <h1 class="page-title">${t('payout.admin_queue_title')}</h1>
          <p class="text-secondary">${t('payout.admin_queue_subtitle')}</p>
        </div>
        <div class="payout-queue-page__header-actions">
          <button type="button" class="btn btn--secondary payout-queue-page__refresh-btn">
            🔄 ${t('common.refresh')}
          </button>
          ${selectedIds.size > 0 ? `
            <button type="button" class="btn btn--primary payout-queue-page__batch-btn">
              ⚡ ${t('payout.batch_disburse_btn')} (${selectedIds.size})
            </button>
          ` : ''}
        </div>
      </div>

      <div class="payout-queue-page__metrics-grid">
        <div class="card metric-card">
          <span class="text-secondary text-sm">${t('payout.metric.pending_queue')}</span>
          <h3 class="metric-card__val">${payouts.filter((p) => p.status === 'REQUESTED' || p.status === 'HELD').length}</h3>
        </div>
        <div class="card metric-card">
          <span class="text-secondary text-sm">${t('payout.metric.total_pending_amount')}</span>
          <h3 class="metric-card__val">${formatCurrency(totalPendingAmount)}</h3>
        </div>
        <div class="card metric-card">
          <span class="text-secondary text-sm">${t('payout.metric.risk_flagged')}</span>
          <h3 class="metric-card__val text-danger">${highRiskCount}</h3>
        </div>
      </div>

      <div class="card payout-queue-page__filter-card">
        <div class="payout-queue-page__filters">
          <div class="form-group">
            <label class="form-label">${t('payout.filter.status')}</label>
            <select class="select payout-queue-page__status-select">
              <option value="REQUESTED" ${statusFilter === 'REQUESTED' ? 'selected' : ''}>${t('payout.status.requested')}</option>
              <option value="HELD" ${statusFilter === 'HELD' ? 'selected' : ''}>${t('payout.status.held_maker_checker')}</option>
              <option value="COMPLETED" ${statusFilter === 'COMPLETED' ? 'selected' : ''}>${t('payout.status.completed')}</option>
              <option value="FAILED" ${statusFilter === 'FAILED' ? 'selected' : ''}>${t('payout.status.failed')}</option>
              <option value="REJECTED" ${statusFilter === 'REJECTED' ? 'selected' : ''}>${t('payout.status.rejected')}</option>
              <option value="" ${statusFilter === '' ? 'selected' : ''}>${t('common.all')}</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">${t('payout.filter.method')}</label>
            <select class="select payout-queue-page__method-select">
              <option value="" ${methodFilter === '' ? 'selected' : ''}>${t('common.all_methods')}</option>
              <option value="BKASH" ${methodFilter === 'BKASH' ? 'selected' : ''}>bKash</option>
              <option value="NAGAD" ${methodFilter === 'NAGAD' ? 'selected' : ''}>Nagad</option>
              <option value="ROCKET" ${methodFilter === 'ROCKET' ? 'selected' : ''}>Rocket</option>
              <option value="BANK" ${methodFilter === 'BANK' ? 'selected' : ''}>Bank Transfer</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card payout-queue-page__table-card">
        ${isLoading ? `
          <div class="payout-queue-page__loading">
            <div class="spinner"></div>
            <span>${t('common.loading')}...</span>
          </div>
        ` : payouts.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state__icon">💳</div>
            <h3>${t('payout.no_requests_found')}</h3>
            <p class="text-secondary">${t('payout.no_requests_desc')}</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th width="40">
                    <input type="checkbox" class="checkbox payout-queue-page__select-all" ${selectedIds.size === payouts.length && payouts.length > 0 ? 'checked' : ''} />
                  </th>
                  <th>${t('payout.col_ref')}</th>
                  <th>${t('payout.col_user')}</th>
                  <th>${t('payout.col_destination')}</th>
                  <th>${t('payout.col_amount')}</th>
                  <th>${t('payout.col_risk')}</th>
                  <th>${t('payout.col_status')}</th>
                  <th class="text-right">${t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                ${payouts.map((p) => {
                  const flags = typeof p.risk_flags_json === 'string' ? JSON.parse(p.risk_flags_json) : (p.risk_flags_json || []);
                  const isChecked = selectedIds.has(p.id);
                  const isActionable = p.status === 'REQUESTED' || p.status === 'HELD';

                  return `
                    <tr class="${isChecked ? 'is-selected' : ''}">
                      <td>
                        <input type="checkbox" class="checkbox payout-queue-page__item-check" data-id="${p.id}" ${isChecked ? 'checked' : ''} ${!isActionable ? 'disabled' : ''} />
                      </td>
                      <td>
                        <span class="font-mono font-bold">${p.ref}</span>
                        <div class="text-xs text-secondary">${formatDate(p.created_at)}</div>
                      </td>
                      <td>
                        <div>${p.user_full_name || p.user_ref || `User #${p.user_id}`}</div>
                        <div class="text-xs text-secondary font-mono">${p.user_phone || ''}</div>
                      </td>
                      <td>
                        <span class="badge badge--neutral">${p.method}</span>
                        <div class="text-sm font-mono">${p.account_number || ''}</div>
                        <div class="text-xs text-secondary">${p.account_name || ''} ${p.bank_name ? `(${p.bank_name})` : ''}</div>
                      </td>
                      <td>
                        <span class="font-bold">${formatCurrency(p.amount)}</span>
                        ${p.fee_amount && parseFloat(p.fee_amount) > 0 ? `<div class="text-xs text-secondary">Fee: ${formatCurrency(p.fee_amount)}</div>` : ''}
                      </td>
                      <td>
                        <div class="payout-queue-page__risk-badges">
                          ${flags.length === 0 ? `<span class="badge badge--success">✓ Low Risk</span>` : flags.map(getRiskBadge).join('')}
                        </div>
                      </td>
                      <td>${getStatusBadge(p.status)}</td>
                      <td class="text-right">
                        ${isActionable ? `
                          <div class="btn-group">
                            <button type="button" class="btn btn--primary btn--sm payout-queue-page__approve-btn" data-id="${p.id}">
                              ✓ ${t('payout.btn_approve')}
                            </button>
                            <button type="button" class="btn btn--ghost btn--sm text-danger payout-queue-page__reject-btn" data-id="${p.id}">
                              ✕
                            </button>
                          </div>
                        ` : `
                          <span class="text-xs text-secondary font-mono">${p.gateway_ref || p.failure_reason || '-'}</span>
                        `}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    // Event listeners
    container.querySelector('.payout-queue-page__refresh-btn')?.addEventListener('click', loadData);

    const statusSelect = container.querySelector('.payout-queue-page__status-select');
    statusSelect?.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      selectedIds.clear();
      loadData();
    });

    const methodSelect = container.querySelector('.payout-queue-page__method-select');
    methodSelect?.addEventListener('change', (e) => {
      methodFilter = e.target.value;
      selectedIds.clear();
      loadData();
    });

    const selectAll = container.querySelector('.payout-queue-page__select-all');
    selectAll?.addEventListener('change', (e) => {
      if (e.target.checked) {
        payouts
          .filter((p) => p.status === 'REQUESTED' || p.status === 'HELD')
          .forEach((p) => selectedIds.add(p.id));
      } else {
        selectedIds.clear();
      }
      render();
    });

    container.querySelectorAll('.payout-queue-page__item-check').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const id = parseInt(e.target.dataset.id, 10);
        if (e.target.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        render();
      });
    });

    container.querySelector('.payout-queue-page__batch-btn')?.addEventListener('click', handleBatchDisburse);

    container.querySelectorAll('.payout-queue-page__approve-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        const payout = payouts.find((p) => p.id === id);
        if (payout) handleApprove(payout);
      });
    });

    container.querySelectorAll('.payout-queue-page__reject-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        const payout = payouts.find((p) => p.id === id);
        if (payout) handleReject(payout);
      });
    });
  }

  loadData();
  return container;
}
