/**
 * PayoutQueuePage.js — Admin Payout Queue & Risk Management Dashboard (Prompt 6.3).
 *
 * Implements:
 * - Unified Admin Page layout adhering to design-system §15 & admin-pages.css tokens
 * - Real-time search by Reference, Recipient, Phone, Account, and Store Name
 * - Multi-criteria toolbar filtering (Status, Payment Method, Risk Tier)
 * - Risk indicators: High Value (≥৳25k), First Withdrawal, Name Mismatch, New Account
 * - Maker-Checker workflow integration: Moderator approval vs Super Admin execution
 * - Single & Batch disbursement with per-item isolation and aggregate selection bar
 * - Accessible rejection dialog with mandatory audit reason via confirmDialogWithReason
 * - Detailed Payout Inspection Modal with financial breakdown & fraud signals
 * - 1-Click CSV Export for finance reconciliation
 * - One-click Reference clipboard copy with instant feedback
 */

import { api } from '../../core/api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';
import { confirmDialog, confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { Modal } from '../../components/ui/Modal.js';
import { Button } from '../../components/ui/Button.js';
import { FinanceSubnav } from '../../components/admin/FinanceSubnav.js';

export default function PayoutQueuePage(root, { navigate } = {}) {
  const container = document.createElement('div');
  container.className = 'admin-page payout-queue-page';

  let payouts = [];
  let selectedIds = new Set();
  let statusFilter = 'REQUESTED';
  let methodFilter = '';
  let riskFilter = 'ALL';
  let searchQuery = '';
  let isLoading = true;

  async function loadData() {
    isLoading = true;
    render();

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (methodFilter) params.set('method', methodFilter);
      params.set('limit', '50');

      const res = await api.get(`/admin/finance/payouts?${params.toString()}`);
      payouts = res.data?.payouts || res.payouts || [];
    } catch (err) {
      toast.error(err.message || 'Failed to load payout queue');
      payouts = [];
    } finally {
      isLoading = false;
      render();
    }
  }

  function getMethodBadge(method) {
    const m = (method || '').toUpperCase();
    switch (m) {
      case 'BKASH':
        return `<span class="badge badge--bkash">bKash</span>`;
      case 'NAGAD':
        return `<span class="badge badge--nagad">Nagad</span>`;
      case 'ROCKET':
        return `<span class="badge badge--rocket">Rocket</span>`;
      case 'BANK':
        return `<span class="badge badge--bank">Bank Transfer</span>`;
      default:
        return `<span class="badge badge--neutral">${m}</span>`;
    }
  }

  function getRiskBadge(flag) {
    const code = flag.code || flag;
    const msg = flag.message || '';
    switch (code) {
      case 'HIGH_VALUE_DISBURSEMENT':
        return `<span class="badge badge--danger" title="${msg}">⚠️ ${t('payout.risk.high_value')}</span>`;
      case 'FIRST_WITHDRAWAL':
        return `<span class="badge badge--warning" title="${msg}">🆕 ${t('payout.risk.first_payout')}</span>`;
      case 'NAME_MISMATCH':
        return `<span class="badge badge--danger" title="${msg}">⚡ ${t('payout.risk.name_mismatch')}</span>`;
      case 'NEW_ACCOUNT':
        return `<span class="badge badge--info" title="${msg}">⏳ ${t('payout.risk.new_account')}</span>`;
      default:
        return `<span class="badge badge--warning" title="${msg}">${code}</span>`;
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'COMPLETED':
        return `<span class="badge badge--success">✓ ${t('payout.status.completed')}</span>`;
      case 'REQUESTED':
        return `<span class="badge badge--warning">⏳ ${t('payout.status.requested')}</span>`;
      case 'HELD':
        return `<span class="badge badge--purple">🛡️ ${t('payout.status.held_maker_checker')}</span>`;
      case 'FAILED':
        return `<span class="badge badge--danger">✕ ${t('payout.status.failed')}</span>`;
      case 'REJECTED':
        return `<span class="badge badge--muted">⊘ ${t('payout.status.rejected')}</span>`;
      default:
        return `<span class="badge">${status}</span>`;
    }
  }

  function copyRefToClipboard(ref) {
    if (!navigator.clipboard) {
      toast.info(ref);
      return;
    }
    navigator.clipboard.writeText(ref).then(() => {
      toast.success(t('payout.copied_ref_toast'));
    }).catch(() => {
      toast.info(ref);
    });
  }

  async function handleApprove(payout) {
    try {
      const res = await api.post(`/admin/finance/payouts/${payout.id}/approve`, {
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
    const res = await confirmDialogWithReason({
      title: `${t('payout.btn_reject')}: ${payout.ref}`,
      description: t('payout.enter_reject_reason'),
      reasonRequired: true,
      reasonLabel: 'Rejection Reason / কারণ',
      reasonHint: 'This reason will be recorded in the audit ledger and visible to the seller.',
      confirmLabel: t('payout.btn_reject'),
      variant: 'danger',
    });

    if (!res || !res.confirmed) return;
    const reason = res.reason;

    try {
      await api.post(`/admin/finance/payouts/${payout.id}/reject`, { reason });
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
      const res = await api.post('/admin/finance/payouts/batch-disburse', {
        payout_ids: Array.from(selectedIds),
      });

      const { successCount = selectedIds.size, failureCount = 0 } = res.data || {};
      toast.success(t('payout.batch_disburse_result', { success: successCount, failed: failureCount }));
      selectedIds.clear();
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Batch disbursement failed');
    }
  }

  function handleExportCsv(visibleList) {
    if (!visibleList.length) {
      toast.info(t('payout.no_requests_found'));
      return;
    }

    const headers = [
      'Reference',
      'Date',
      'User ID',
      'Recipient Name',
      'Phone',
      'Store/Account Name',
      'Method',
      'Account Number',
      'Bank Name',
      'Gross Amount',
      'Fee Amount',
      'Net Amount',
      'Status',
      'Risk Flags',
      'Gateway Ref',
      'Failure Reason',
    ];

    const rows = visibleList.map((p) => {
      const flags = typeof p.risk_flags_json === 'string' ? JSON.parse(p.risk_flags_json) : (p.risk_flags_json || []);
      const flagStr = flags.map((f) => f.code || f).join(';');
      return [
        `"${p.ref || ''}"`,
        `"${p.created_at || ''}"`,
        `"${p.user_id || ''}"`,
        `"${(p.user_full_name || '').replace(/"/g, '""')}"`,
        `"${p.user_phone || ''}"`,
        `"${(p.account_name || '').replace(/"/g, '""')}"`,
        `"${p.method || ''}"`,
        `"${p.account_number || ''}"`,
        `"${p.bank_name || ''}"`,
        `"${p.amount || 0}"`,
        `"${p.fee_amount || 0}"`,
        `"${p.net_amount || p.amount || 0}"`,
        `"${p.status || ''}"`,
        `"${flagStr}"`,
        `"${p.gateway_ref || ''}"`,
        `"${(p.failure_reason || '').replace(/"/g, '""')}"`,
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `explooro-payouts-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success(t('payout.export_success', { count: visibleList.length }));
  }

  function openDetailsModal(payout) {
    const flags = typeof payout.risk_flags_json === 'string' ? JSON.parse(payout.risk_flags_json) : (payout.risk_flags_json || []);
    const isActionable = payout.status === 'REQUESTED' || payout.status === 'HELD';
    const net = payout.net_amount ? parseFloat(payout.net_amount) : (parseFloat(payout.amount) - (parseFloat(payout.fee_amount) || 0));

    const content = document.createElement('div');
    content.className = 'payout-details-modal';
    content.innerHTML = `
      <div class="payout-details-grid">
        <div class="payout-details-card">
          <div class="payout-details-card__title">${t('payout.modal_sec_overview')}</div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">${t('payout.col_ref')}</span>
            <span class="payout-details-row__val font-mono font-bold">${payout.ref}</span>
          </div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">${t('payout.col_status')}</span>
            <span class="payout-details-row__val">${getStatusBadge(payout.status)}</span>
          </div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">${t('payout.col_gross_amount')}</span>
            <span class="payout-details-row__val font-bold text-primary font-mono">${formatCurrency(payout.amount)}</span>
          </div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">${t('payout.col_fee')}</span>
            <span class="payout-details-row__val text-secondary font-mono">${formatCurrency(payout.fee_amount || 0)}</span>
          </div>
          <div class="payout-details-row" style="border-top: 1px dashed var(--border-subtle); padding-top: 8px; margin-top: 4px;">
            <span class="payout-details-row__label font-bold">${t('payout.col_net_amount')}</span>
            <span class="payout-details-row__val font-bold text-brand font-mono" style="font-size: var(--text-base);">${formatCurrency(net)}</span>
          </div>
        </div>

        <div class="payout-details-card">
          <div class="payout-details-card__title">${t('payout.modal_sec_recipient')}</div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">${t('payout.col_user')}</span>
            <span class="payout-details-row__val font-bold">${payout.user_full_name || `User #${payout.user_id}`}</span>
          </div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">User ID / Ref</span>
            <span class="payout-details-row__val font-mono text-xs">${payout.user_ref || `#${payout.user_id}`}</span>
          </div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">Phone</span>
            <span class="payout-details-row__val font-mono">${payout.user_phone || '-'}</span>
          </div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">Store / Entity</span>
            <span class="payout-details-row__val text-secondary">${payout.account_name || '-'}</span>
          </div>
        </div>

        <div class="payout-details-card">
          <div class="payout-details-card__title">${t('payout.modal_sec_destination')}</div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">Channel</span>
            <span class="payout-details-row__val">${getMethodBadge(payout.method)}</span>
          </div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">Account Number</span>
            <span class="payout-details-row__val font-mono font-bold">${payout.account_number || '-'}</span>
          </div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">Account Name</span>
            <span class="payout-details-row__val">${payout.account_name || '-'}</span>
          </div>
          ${payout.bank_name ? `
            <div class="payout-details-row">
              <span class="payout-details-row__label">Bank Name</span>
              <span class="payout-details-row__val">${payout.bank_name}</span>
            </div>
          ` : ''}
          ${payout.gateway_ref ? `
            <div class="payout-details-row">
              <span class="payout-details-row__label">Gateway Ref</span>
              <span class="payout-details-row__val font-mono text-xs text-brand">${payout.gateway_ref}</span>
            </div>
          ` : ''}
          ${payout.failure_reason ? `
            <div class="payout-details-row">
              <span class="payout-details-row__label">Reject Reason</span>
              <span class="payout-details-row__val text-danger text-xs">${payout.failure_reason}</span>
            </div>
          ` : ''}
        </div>

        <div class="payout-details-card">
          <div class="payout-details-card__title">${t('payout.modal_sec_risk')}</div>
          <div class="payout-details-row">
            <span class="payout-details-row__label">Risk Level</span>
            <span class="payout-details-row__val">
              ${flags.length === 0 ? `<span class="badge badge--success">✓ ${t('payout.risk_level_low')}</span>` : `<span class="badge badge--danger">⚠️ Flagged (${flags.length})</span>`}
            </span>
          </div>
          <div style="margin-top: 8px;">
            ${flags.length > 0 ? `
              <div class="payout-risk-badges">
                ${flags.map((f) => `
                  <div style="font-size: var(--text-xs); margin-bottom: 6px;">
                    ${getRiskBadge(f)}
                    <span class="text-secondary" style="margin-inline-start: 6px;">${f.message || ''}</span>
                  </div>
                `).join('')}
              </div>
            ` : `
              <p class="text-xs text-muted" style="margin: 0; line-height: 1.5;">No fraud signals detected. Account identity and payment destination match platform trust rules.</p>
            `}
          </div>
        </div>
      </div>
    `;

    const footer = document.createDocumentFragment();

    const closeBtn = Button({
      label: t('common.close') || 'Close',
      variant: 'secondary',
      onClick: () => modal.closeModal(),
    });

    footer.append(closeBtn);

    if (isActionable) {
      const rejectBtn = Button({
        label: t('payout.btn_reject'),
        variant: 'danger',
        onClick: async () => {
          modal.closeModal();
          await handleReject(payout);
        },
      });

      const approveBtn = Button({
        label: payout.status === 'HELD' ? '⚡ Super Admin Sign-off' : `✓ ${t('payout.btn_approve')}`,
        variant: 'primary',
        onClick: async () => {
          modal.closeModal();
          await handleApprove(payout);
        },
      });

      footer.append(rejectBtn, approveBtn);
    }

    const modal = Modal({
      title: `${t('payout.modal_details_title')}: ${payout.ref}`,
      description: `${formatDate(payout.created_at)} • ${payout.user_full_name || `User #${payout.user_id}`}`,
      content,
      footer,
      size: 'lg',
      important: true,
      onClose: () => setTimeout(() => modal.remove(), 400),
    });

    document.body.append(modal);
    modal.openModal();
  }

  function render() {
    const totalPendingAmount = payouts
      .filter((p) => p.status === 'REQUESTED' || p.status === 'HELD')
      .reduce((acc, p) => acc + parseFloat(p.amount || 0), 0);

    const pendingCount = payouts.filter((p) => p.status === 'REQUESTED' || p.status === 'HELD').length;

    const highRiskCount = payouts.filter((p) => {
      const flags = typeof p.risk_flags_json === 'string' ? JSON.parse(p.risk_flags_json) : (p.risk_flags_json || []);
      return flags.length > 0;
    }).length;

    const completedCount = payouts.filter((p) => p.status === 'COMPLETED').length;

    // Filter visible payouts based on client-side search and risk level
    let visiblePayouts = payouts;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      visiblePayouts = visiblePayouts.filter((p) => {
        return (
          (p.ref && p.ref.toLowerCase().includes(q)) ||
          (p.user_full_name && p.user_full_name.toLowerCase().includes(q)) ||
          (p.user_phone && p.user_phone.toLowerCase().includes(q)) ||
          (p.account_name && p.account_name.toLowerCase().includes(q)) ||
          (p.account_number && p.account_number.toLowerCase().includes(q)) ||
          (p.bank_name && p.bank_name.toLowerCase().includes(q))
        );
      });
    }

    if (riskFilter === 'HIGH_ONLY') {
      visiblePayouts = visiblePayouts.filter((p) => {
        const flags = typeof p.risk_flags_json === 'string' ? JSON.parse(p.risk_flags_json) : (p.risk_flags_json || []);
        return flags.length > 0;
      });
    } else if (riskFilter === 'LOW_ONLY') {
      visiblePayouts = visiblePayouts.filter((p) => {
        const flags = typeof p.risk_flags_json === 'string' ? JSON.parse(p.risk_flags_json) : (p.risk_flags_json || []);
        return flags.length === 0;
      });
    }

    // Selected items sum
    const selectedTotal = payouts
      .filter((p) => selectedIds.has(p.id))
      .reduce((acc, p) => acc + parseFloat(p.amount || 0), 0);

    const actionableVisible = visiblePayouts.filter((p) => p.status === 'REQUESTED' || p.status === 'HELD');
    const isAllSelected = actionableVisible.length > 0 && actionableVisible.every((p) => selectedIds.has(p.id));
    const hasActiveFilters = statusFilter !== 'REQUESTED' || methodFilter !== '' || riskFilter !== 'ALL' || searchQuery !== '';

    container.innerHTML = `
      <!-- Header -->
      <div class="admin-page-header">
        <div>
          <div class="admin-page-eyebrow">
            <span class="badge badge--neutral">💸 ${t('finance_subnav.payouts')}</span>
          </div>
          <h1 class="admin-page-title">${t('payout.admin_queue_title')}</h1>
          <p class="admin-page-subtitle">${t('payout.admin_queue_subtitle')}</p>
        </div>

        <div class="admin-page-actions">
          <button type="button" class="btn btn--secondary btn--sm payout-queue-page__refresh-btn">
            🔄 ${t('common.refresh')}
          </button>
          <button type="button" class="btn btn--secondary btn--sm payout-queue-page__export-btn">
            📥 ${t('payout.btn_export_csv')}
          </button>
          ${selectedIds.size > 0 ? `
            <button type="button" class="btn btn--primary btn--sm payout-queue-page__batch-btn">
              ⚡ ${t('payout.batch_disburse_btn')} (${selectedIds.size})
            </button>
          ` : ''}
        </div>
      </div>

      <div class="finance-subnav-mount"></div>

      <!-- KPI Metrics Strip -->
      <div class="admin-kpi-grid">
        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${t('payout.metric.pending_queue')}</div>
          <div class="admin-kpi-card__val font-mono">${pendingCount}</div>
          <div class="admin-kpi-card__hint">${t('payout.metric.pending_hint')}</div>
        </div>

        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${t('payout.metric.total_pending_amount')}</div>
          <div class="admin-kpi-card__val font-mono text-primary">${formatCurrency(totalPendingAmount)}</div>
          <div class="admin-kpi-card__hint">${t('payout.metric.total_hint')}</div>
        </div>

        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${t('payout.metric.risk_flagged')}</div>
          <div class="admin-kpi-card__val font-mono text-danger">${highRiskCount}</div>
          <div class="admin-kpi-card__hint">${t('payout.metric.risk_hint')}</div>
        </div>

        <div class="admin-kpi-card">
          <div class="admin-kpi-card__label">${t('payout.metric.completed_today')}</div>
          <div class="admin-kpi-card__val font-mono text-emerald-600">${completedCount}</div>
          <div class="admin-kpi-card__hint">${t('payout.metric.completed_hint')}</div>
        </div>
      </div>

      <!-- Filter Toolbar -->
      <div class="payout-toolbar">
        <div class="payout-search-wrap">
          <span class="payout-search-icon">🔍</span>
          <input
            type="search"
            class="form-input payout-queue-page__search-input"
            placeholder="${t('payout.filter.search_placeholder')}"
            value="${searchQuery}"
            aria-label="${t('payout.filter.search_placeholder')}"
          />
        </div>

        <div class="payout-toolbar-filters">
          <div class="payout-filter-group">
            <select id="payout-filter-status" class="form-select payout-queue-page__status-select" aria-label="${t('payout.filter.status')}">
              <option value="REQUESTED" ${statusFilter === 'REQUESTED' ? 'selected' : ''}>${t('payout.status.requested')}</option>
              <option value="HELD" ${statusFilter === 'HELD' ? 'selected' : ''}>${t('payout.status.held_maker_checker')}</option>
              <option value="COMPLETED" ${statusFilter === 'COMPLETED' ? 'selected' : ''}>${t('payout.status.completed')}</option>
              <option value="FAILED" ${statusFilter === 'FAILED' ? 'selected' : ''}>${t('payout.status.failed')}</option>
              <option value="REJECTED" ${statusFilter === 'REJECTED' ? 'selected' : ''}>${t('payout.status.rejected')}</option>
              <option value="ALL" ${statusFilter === 'ALL' || statusFilter === '' ? 'selected' : ''}>${t('payout.filter.all_statuses')}</option>
            </select>
          </div>

          <div class="payout-filter-group">
            <select id="payout-filter-method" class="form-select payout-queue-page__method-select" aria-label="${t('payout.filter.method')}">
              <option value="" ${methodFilter === '' ? 'selected' : ''}>${t('common.all_methods')}</option>
              <option value="BKASH" ${methodFilter === 'BKASH' ? 'selected' : ''}>bKash</option>
              <option value="NAGAD" ${methodFilter === 'NAGAD' ? 'selected' : ''}>Nagad</option>
              <option value="ROCKET" ${methodFilter === 'ROCKET' ? 'selected' : ''}>Rocket</option>
              <option value="BANK" ${methodFilter === 'BANK' ? 'selected' : ''}>Bank Transfer</option>
            </select>
          </div>

          <div class="payout-filter-group">
            <select id="payout-filter-risk" class="form-select payout-queue-page__risk-select" aria-label="${t('payout.filter.risk')}">
              <option value="ALL" ${riskFilter === 'ALL' ? 'selected' : ''}>${t('payout.filter.all_risks')}</option>
              <option value="HIGH_ONLY" ${riskFilter === 'HIGH_ONLY' ? 'selected' : ''}>${t('payout.filter.high_risk_only')}</option>
              <option value="LOW_ONLY" ${riskFilter === 'LOW_ONLY' ? 'selected' : ''}>${t('payout.filter.low_risk_only')}</option>
            </select>
          </div>

          ${hasActiveFilters ? `
            <button type="button" class="btn btn--ghost btn--sm payout-queue-page__clear-btn" title="${t('payout.filter.clear')}">
              ✕ ${t('payout.filter.clear')}
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Selection Banner -->
      ${selectedIds.size > 0 ? `
        <div class="payout-selection-bar">
          <div class="payout-selection-bar__text">
            ${t('payout.selected_bar.text', { count: selectedIds.size, total: formatCurrency(selectedTotal) })}
          </div>
          <div class="payout-selection-bar__actions">
            <button type="button" class="btn btn--primary btn--sm payout-queue-page__batch-btn">
              ⚡ ${t('payout.batch_disburse_btn')} (${selectedIds.size})
            </button>
            <button type="button" class="btn btn--ghost btn--sm payout-queue-page__deselect-btn">
              ${t('payout.selected_bar.deselect')}
            </button>
          </div>
        </div>
      ` : ''}

      <!-- Payout Table Container -->
      <div class="admin-table-wrap">
        ${isLoading ? `
          <div class="payout-queue-page__loading">
            <div class="spinner"></div>
            <span>${t('common.loading')}...</span>
          </div>
        ` : visiblePayouts.length === 0 ? `
          <div class="empty-state" style="padding: var(--space-8); text-align: center;">
            <div class="empty-state__icon" style="font-size: 2.5rem; margin-bottom: var(--space-2);">💳</div>
            <h3>${t('payout.no_requests_found')}</h3>
            <p class="text-secondary" style="max-width: 480px; margin: 0 auto;">${t('payout.no_requests_desc')}</p>
          </div>
        ` : `
          <table class="admin-table">
            <thead>
              <tr>
                <th width="44" style="text-align: center;">
                  <input
                    type="checkbox"
                    aria-label="${t('payout.select_all_rows')}"
                    class="checkbox payout-queue-page__select-all"
                    ${isAllSelected ? 'checked' : ''}
                    ${actionableVisible.length === 0 ? 'disabled' : ''}
                  />
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
              ${visiblePayouts.map((p) => {
                const flags = typeof p.risk_flags_json === 'string' ? JSON.parse(p.risk_flags_json) : (p.risk_flags_json || []);
                const isChecked = selectedIds.has(p.id);
                const isActionable = p.status === 'REQUESTED' || p.status === 'HELD';
                const net = p.net_amount ? parseFloat(p.net_amount) : (parseFloat(p.amount) - (parseFloat(p.fee_amount) || 0));

                return `
                  <tr class="${isChecked ? 'is-selected' : ''}">
                    <td style="text-align: center;">
                      <input
                        type="checkbox"
                        aria-label="${t('payout.select_row', { ref: p.ref })}"
                        class="checkbox payout-queue-page__item-check"
                        data-id="${p.id}"
                        ${isChecked ? 'checked' : ''}
                        ${!isActionable ? 'disabled' : ''}
                      />
                    </td>
                    <td>
                      <div class="flex items-center gap-1">
                        <button type="button" class="payout-ref-pill payout-queue-page__copy-ref-btn" data-ref="${p.ref}" title="Click to copy reference">
                          <span>${p.ref}</span>
                          <span style="font-size: 10px; opacity: 0.7;">📋</span>
                        </button>
                      </div>
                      <div class="text-xs text-secondary font-mono" style="margin-top: 4px;">${formatDate(p.created_at)}</div>
                    </td>
                    <td>
                      <div class="font-bold text-primary">${p.user_full_name || p.user_ref || `User #${p.user_id}`}</div>
                      <div class="text-xs text-secondary">${p.account_name || ''}</div>
                      <div class="text-xs font-mono text-muted">${p.user_phone || ''}</div>
                    </td>
                    <td>
                      <div style="margin-bottom: 4px;">${getMethodBadge(p.method)}</div>
                      <div class="font-mono text-sm font-semibold">${p.account_number || ''}</div>
                      <div class="text-xs text-secondary">${p.bank_name ? `(${p.bank_name})` : ''}</div>
                    </td>
                    <td>
                      <div class="font-bold font-mono text-primary" style="font-size: var(--text-base);">${formatCurrency(p.amount)}</div>
                      <div class="text-xs text-secondary font-mono" style="margin-top: 2px;">
                        Net: <span class="font-semibold text-brand">${formatCurrency(net)}</span>
                        ${p.fee_amount && parseFloat(p.fee_amount) > 0 ? ` • Fee: ${formatCurrency(p.fee_amount)}` : ''}
                      </div>
                    </td>
                    <td>
                      <div class="payout-risk-badges">
                        ${flags.length === 0 ? `<span class="badge badge--success">✓ ${t('payout.risk_level_low')}</span>` : flags.map(getRiskBadge).join('')}
                      </div>
                    </td>
                    <td>${getStatusBadge(p.status)}</td>
                    <td class="text-right">
                      <div class="flex items-center justify-end gap-1">
                        ${isActionable ? `
                          <button
                            type="button"
                            class="btn btn--primary btn--sm payout-queue-page__approve-btn"
                            data-id="${p.id}"
                            title="${p.status === 'HELD' ? 'Super Admin Maker-Checker Sign-off' : 'Approve and trigger automated gateway payout'}"
                          >
                            ${p.status === 'HELD' ? '⚡ Sign-off' : `✓ ${t('payout.btn_approve')}`}
                          </button>
                          <button
                            type="button"
                            class="btn btn--secondary btn--sm text-danger payout-queue-page__reject-btn"
                            data-id="${p.id}"
                            title="Reject request and release funds back to vault"
                          >
                            ✕
                          </button>
                        ` : ''}
                        <button
                          type="button"
                          class="btn btn--ghost btn--sm payout-queue-page__details-btn"
                          data-id="${p.id}"
                          title="Inspect complete payout details"
                        >
                          👁️
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <div style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-3) var(--space-4); background: var(--surface-2); border-top: 1px solid var(--border-subtle); font-size: var(--text-xs); color: var(--text-secondary);">
            <span>Showing ${visiblePayouts.length} of ${payouts.length} payout requests</span>
            <span class="font-mono">Queue Balance: ${formatCurrency(totalPendingAmount)}</span>
          </div>
        `}
      </div>
    `;

    // Mount Finance Subnav
    const subnavMount = container.querySelector('.finance-subnav-mount');
    if (subnavMount) {
      subnavMount.replaceWith(FinanceSubnav({ activeKey: 'payouts', navigate }));
    }

    // Attach Event Listeners
    container.querySelector('.payout-queue-page__refresh-btn')?.addEventListener('click', loadData);

    container.querySelector('.payout-queue-page__export-btn')?.addEventListener('click', () => {
      handleExportCsv(visiblePayouts);
    });

    const searchInput = container.querySelector('.payout-queue-page__search-input');
    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      render();
    });

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

    const riskSelect = container.querySelector('.payout-queue-page__risk-select');
    riskSelect?.addEventListener('change', (e) => {
      riskFilter = e.target.value;
      render();
    });

    container.querySelector('.payout-queue-page__clear-btn')?.addEventListener('click', () => {
      statusFilter = 'REQUESTED';
      methodFilter = '';
      riskFilter = 'ALL';
      searchQuery = '';
      selectedIds.clear();
      loadData();
    });

    const selectAll = container.querySelector('.payout-queue-page__select-all');
    selectAll?.addEventListener('change', (e) => {
      if (e.target.checked) {
        actionableVisible.forEach((p) => selectedIds.add(p.id));
      } else {
        actionableVisible.forEach((p) => selectedIds.delete(p.id));
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

    container.querySelectorAll('.payout-queue-page__batch-btn').forEach((btn) => {
      btn.addEventListener('click', handleBatchDisburse);
    });

    container.querySelector('.payout-queue-page__deselect-btn')?.addEventListener('click', () => {
      selectedIds.clear();
      render();
    });

    container.querySelectorAll('.payout-queue-page__copy-ref-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ref = btn.dataset.ref;
        if (ref) copyRefToClipboard(ref);
      });
    });

    container.querySelectorAll('.payout-queue-page__approve-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const payout = payouts.find((p) => p.id === id);
        if (payout) handleApprove(payout);
      });
    });

    container.querySelectorAll('.payout-queue-page__reject-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const payout = payouts.find((p) => p.id === id);
        if (payout) handleReject(payout);
      });
    });

    container.querySelectorAll('.payout-queue-page__details-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const payout = payouts.find((p) => p.id === id);
        if (payout) openDetailsModal(payout);
      });
    });
  }

  loadData();
  root.append(container);
}
