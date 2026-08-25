/**
 * ReturnsQueuePage.js — Admin & Staff Returns Moderation Workspace (Prompt 7.2).
 *
 * Implements:
 * 1. Filter tabs by state (REQUESTED, APPROVED, PICKUP_SCHEDULED, RECEIVED, INSPECTED, REFUNDED, REJECTED)
 * 2. Customer Trust Score badge & return rate exposure
 * 3. Evidence gallery preview & customer claim notes
 * 4. One-click workflow actions:
 *    - Review (Approve -> schedules reverse courier pickup, Reject)
 *    - Receive & Inspect (Pass -> INSPECTED, Fail -> DISPUTED)
 *    - Execute Refund (triggers clawback & ledger balance payout)
 */

import { api } from '../../core/api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export default function ReturnsQueuePage(root) {
  const container = document.createElement('div');
  container.className = 'page-container returns-queue-page';

  let currentTab = 'ALL';
  let returns = [];
  let loading = true;

  async function fetchQueue() {
    try {
      loading = true;
      render();
      const statusParam = currentTab !== 'ALL' ? `?status=${currentTab}` : '';
      const res = await api.get(`/admin/returns/queue${statusParam}`);
      returns = res.data?.returns || [];
    } catch (err) {
      toast.error(err.message || 'Failed to fetch returns queue.');
      returns = [];
    } finally {
      loading = false;
      render();
    }
  }

  async function handleApprove(returnId) {
    try {
      await api.post(`/admin/returns/${returnId}/review`, { action: 'APPROVE' });
      toast.success(t('returns.approve_success'));
      fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to approve return.');
    }
  }

  async function handleReject(returnId) {
    const reason = prompt(t('returns.prompt_reject_reason'));
    if (!reason) return;

    try {
      await api.post(`/admin/returns/${returnId}/review`, { action: 'REJECT', rejection_reason: reason });
      toast.success(t('returns.reject_success'));
      fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to reject return.');
    }
  }

  async function handleInspect(returnId, pass = true) {
    try {
      await api.post(`/admin/returns/${returnId}/inspect`, {
        inspection_notes: pass ? 'Physical condition verified: PASS' : 'Item damaged by customer: FAIL',
        condition_pass: pass,
      });
      toast.success(pass ? t('returns.inspect_pass_success') : t('returns.inspect_fail_disputed'));
      fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to inspect return.');
    }
  }

  async function handleRefund(returnId) {
    if (!confirm(t('returns.confirm_execute_refund'))) return;

    try {
      await api.post(`/admin/returns/${returnId}/refund`, {});
      toast.success(t('returns.refund_executed_success'));
      fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to execute refund.');
    }
  }

  function render() {
    container.innerHTML = `
      <div class="returns-queue-page__header">
        <div>
          <h1 class="text-2xl font-bold">${t('returns.queue_title')}</h1>
          <p class="text-sm text-secondary">${t('returns.queue_subtitle')}</p>
        </div>
        <button class="btn btn--secondary btn--sm" id="btn-refresh-queue">
          🔄 ${t('common.refresh')}
        </button>
      </div>

      <!-- State Filter Tabs -->
      <div class="returns-queue__tabs flex gap-2 border-b pb-2">
        ${['ALL', 'REQUESTED', 'APPROVED', 'PICKUP_SCHEDULED', 'RECEIVED', 'INSPECTED', 'REFUNDED', 'REJECTED', 'DISPUTED'].map((tab) => `
          <button class="btn btn--sm ${currentTab === tab ? 'btn--primary' : 'btn--outline'} tab-btn" data-tab="${tab}">
            ${tab}
          </button>
        `).join('')}
      </div>

      ${loading ? `
        <div class="returns-queue__loading py-8 text-center">
          <div class="spinner"></div>
          <p class="text-secondary mt-2">${t('common.loading')}</p>
        </div>
      ` : returns.length === 0 ? `
        <div class="card p-8 text-center">
          <p class="text-secondary font-medium">${t('returns.no_returns_in_queue')}</p>
        </div>
      ` : `
        <div class="returns-queue__list flex flex-col gap-4 mt-4">
          ${returns.map((ret) => `
            <div class="card return-card p-4">
              <div class="return-card__top flex justify-between items-start flex-wrap gap-2">
                <div>
                  <div class="flex items-center gap-2">
                    <strong class="font-mono text-base">${ret.ref}</strong>
                    <span class="badge ${getStatusBadgeClass(ret.status)}">${ret.status}</span>
                    <span class="badge badge--neutral text-xs font-mono">Order: ${ret.sub_order_ref || ret.sub_order_id}</span>
                  </div>
                  <div class="text-xs text-secondary mt-1">
                    ${t('returns.customer')}: <strong>${ret.customer_name || 'Customer'}</strong> (${ret.customer_phone || 'N/A'})
                    ${ret.customer_trust_score !== undefined && ret.customer_trust_score !== null ? `
                      • Trust: <span class="badge badge--${ret.customer_trust_score >= 80 ? 'success' : ret.customer_trust_score >= 50 ? 'warning' : 'danger'} font-mono">${ret.customer_trust_score}</span>
                    ` : ''}
                  </div>
                </div>

                <div class="text-right">
                  <div class="text-xs text-secondary">${t('returns.refund_target')}</div>
                  <strong class="text-lg font-mono text-success">${formatCurrency(ret.refund_amount)}</strong>
                </div>
              </div>

              <div class="return-card__body grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 pt-3 border-t">
                <div>
                  <div class="text-xs text-secondary mb-1"><strong>Reason:</strong> ${ret.reason_code}</div>
                  ${ret.customer_note ? `<p class="text-xs text-secondary italic">"${ret.customer_note}"</p>` : ''}
                  ${ret.reverse_tracking_number ? `
                    <div class="mt-2 text-xs font-mono bg-secondary p-2 rounded">
                      📦 Reverse Tracking: <strong>${ret.reverse_tracking_number}</strong> (${ret.reverse_carrier || '3PL'})
                    </div>
                  ` : ''}
                </div>

                <div>
                  <div class="text-xs text-secondary mb-1"><strong>Evidence Media:</strong></div>
                  <div class="evidence-thumbnails flex gap-2 flex-wrap">
                    ${(Array.isArray(ret.evidence_urls_json) ? ret.evidence_urls_json : []).map((url, i) => `
                      <a href="${url}" target="_blank" class="badge badge--neutral text-xs">📷 Media ${i + 1} ↗</a>
                    `).join('') || '<span class="text-xs text-secondary">None attached</span>'}
                  </div>
                </div>
              </div>

              <div class="return-card__actions flex justify-end gap-2 mt-4 pt-3 border-t">
                ${ret.status === 'REQUESTED' || ret.status === 'UNDER_REVIEW' ? `
                  <button class="btn btn--outline btn--sm text-danger btn-reject-return" data-id="${ret.id}">
                    ${t('returns.btn_reject')}
                  </button>
                  <button class="btn btn--primary btn--sm btn-approve-return" data-id="${ret.id}">
                    ✓ ${t('returns.btn_approve')}
                  </button>
                ` : ''}

                ${ret.status === 'APPROVED' || ret.status === 'PICKUP_SCHEDULED' || ret.status === 'RECEIVED' ? `
                  <button class="btn btn--secondary btn--sm btn-inspect-pass" data-id="${ret.id}">
                    🔍 ${t('returns.btn_inspect_pass')}
                  </button>
                  <button class="btn btn--outline btn--sm text-warning btn-inspect-fail" data-id="${ret.id}">
                    ⚠️ ${t('returns.btn_inspect_dispute')}
                  </button>
                ` : ''}

                ${ret.status === 'INSPECTED' ? `
                  <button class="btn btn--success btn--sm btn-execute-refund" data-id="${ret.id}">
                    💰 ${t('returns.btn_execute_refund')}
                  </button>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;

    // Event Bindings
    container.querySelector('#btn-refresh-queue')?.addEventListener('click', fetchQueue);

    container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        currentTab = e.target.dataset.tab;
        fetchQueue();
      });
    });

    container.querySelectorAll('.btn-approve-return').forEach((btn) => {
      btn.addEventListener('click', (e) => handleApprove(e.target.dataset.id));
    });

    container.querySelectorAll('.btn-reject-return').forEach((btn) => {
      btn.addEventListener('click', (e) => handleReject(e.target.dataset.id));
    });

    container.querySelectorAll('.btn-inspect-pass').forEach((btn) => {
      btn.addEventListener('click', (e) => handleInspect(e.target.dataset.id, true));
    });

    container.querySelectorAll('.btn-inspect-fail').forEach((btn) => {
      btn.addEventListener('click', (e) => handleInspect(e.target.dataset.id, false));
    });

    container.querySelectorAll('.btn-execute-refund').forEach((btn) => {
      btn.addEventListener('click', (e) => handleRefund(e.target.dataset.id));
    });
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case 'REFUNDED': return 'badge--success';
      case 'APPROVED':
      case 'INSPECTED': return 'badge--primary';
      case 'PICKUP_SCHEDULED':
      case 'RECEIVED': return 'badge--warning';
      case 'DISPUTED':
      case 'REJECTED': return 'badge--danger';
      default: return 'badge--neutral';
    }
  }

  fetchQueue();
  root.append(container);
}
