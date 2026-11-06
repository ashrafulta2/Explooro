/**
 * ReturnsQueuePage.ts — Admin & Staff Returns Moderation Workspace (Prompt 7.2).
 *
 * Implements:
 * 1. Filter tabs by state (REQUESTED, APPROVED, PICKUP_SCHEDULED, RECEIVED, INSPECTED, REFUNDED, REJECTED, DISPUTED)
 * 2. Customer Trust Score badge & return rate exposure
 * 3. Evidence gallery preview & customer claim notes
 * 4. One-click workflow actions:
 *    - Review (Approve -> schedules reverse courier pickup, Reject)
 *    - Receive & Inspect (Pass -> INSPECTED, Fail -> DISPUTED)
 *    - Execute Refund (triggers clawback & ledger balance payout)
 * 5. Who pays to send it back (migration 106, server/src/services/returnShipping.service.ts):
 *    Approve asks, defaulting to the policy's answer for the reason; passing inspection of a
 *    hand-sent return the supplier pays for asks for the customer's courier receipt.
 */

import { api } from '../../core/api.ts';
import { formatCurrency, formatDate } from '../../services/format.ts';
import { t } from '../../services/i18n.ts';
import { toast } from '../../services/toast.ts';
import { showActionResult } from '../../components/guide/ActionResult.ts';
import { Modal } from '../../components/ui/Modal.ts';
import { Select } from '../../components/ui/Select.ts';
import { Input } from '../../components/ui/Input.ts';
import { Button } from '../../components/ui/Button.ts';
import '../../styles/components/returns.css';

export default function ReturnsQueuePage(root: HTMLElement) {
  const container = document.createElement('div');
  container.className = 'returns-queue-page';
  container.style.cssText = `
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    color: var(--text-primary, #0f172a);
    background: var(--surface-0, transparent);
    font-family: inherit;
  `;

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

  const findReturn = (id) => returns.find((r) => String(r.id) === String(id));

  /**
   * Asks something before an action, in a dialog with Cancel and a confirm button. Resolves to the
   * fields' values, or null when cancelled.
   */
  function askInDialog({ title, description, fields, confirmLabel }): Promise<Record<string, string> | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const body = document.createElement('div');
      body.className = 'flex flex-col gap-3';
      body.append(...fields.map((f) => f.field));
      const footer = document.createElement('div');
      footer.className = 'flex justify-end gap-2';
      const cancel = Button({ label: t('common.cancel'), variant: 'ghost', onClick: () => modal.closeModal(null) });
      const ok = Button({
        label: confirmLabel,
        variant: 'primary',
        onClick: () => {
          const values = Object.fromEntries(fields.map((f) => [f.name, f.field.value]));
          done(values);
          modal.closeModal(values);
        },
      });
      footer.append(cancel, ok);
      const modal = Modal({ title, description, content: body, footer, size: 'sm', onClose: () => done(null) });
      modal.open();
    });
  }

  const payerLabel = (payer) => t(`returns.shipping.payer_${String(payer).toLowerCase()}`);

  async function handleApprove(returnId) {
    const ret = findReturn(returnId);
    const terms = ret?.return_shipping;
    const payer = Select({
      label: t('returns.shipping.payer_label'),
      hint: t('returns.shipping.payer_hint'),
      name: 'return_shipping_paid_by',
      options: ['SUPPLIER', 'CUSTOMER'].map((value) => ({ value, label: payerLabel(value) })),
      value: terms?.paid_by || 'SUPPLIER',
    });
    const answer = await askInDialog({
      title: t('returns.shipping.approve_title'),
      description: t('returns.shipping.approve_desc', { ref: ret?.ref || '' }),
      fields: [{ name: 'return_shipping_paid_by', field: payer }],
      confirmLabel: t('returns.btn_approve', 'Approve'),
    });
    if (!answer) return;
    try {
      await api.post(`/admin/returns/${returnId}/review`, { action: 'APPROVE', return_shipping_paid_by: answer.return_shipping_paid_by });
      await fetchQueue();
      // Prompt 13.3: approval ends on a result panel that says what the courier and refund do next.
      // The same page serves /moderator/returns and /admin/returns, so the role comes from the path.
      showActionResult(root, window.location.pathname.startsWith('/moderator') ? 'return_approved_moderator' : 'return_approved_admin');
    } catch (err) {
      toast.error(err.message || 'Failed to approve return.');
    }
  }

  async function handleReject(returnId) {
    const reason = prompt(t('returns.prompt_reject_reason', 'Enter reason for rejecting return request:'));
    if (!reason) return;

    try {
      await api.post(`/admin/returns/${returnId}/review`, { action: 'REJECT', rejection_reason: reason });
      toast.success(t('returns.reject_success', 'Return request rejected.'));
      await fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to reject return.');
    }
  }

  async function handleInspect(returnId, pass = true) {
    const ret = findReturn(returnId);
    let courierCost = null;
    // A hand-sent return the supplier pays for: the customer's courier receipt is repaid at refund.
    if (pass && ret?.reverse_carrier === 'MANUAL' && ret?.return_shipping?.paid_by === 'SUPPLIER') {
      const cost = Input({
        label: t('returns.shipping.cost_label'),
        hint: t('returns.shipping.cost_hint', { max: formatCurrency(ret.return_shipping.max_courier_refund) }),
        type: 'number',
        name: 'customer_courier_cost',
      });
      cost.input.min = '0';
      cost.input.step = '0.01';
      const answer = await askInDialog({
        title: t('returns.shipping.inspect_title'),
        description: t('returns.shipping.inspect_desc'),
        fields: [{ name: 'customer_courier_cost', field: cost }],
        confirmLabel: t('returns.btn_inspect_pass', 'Pass Physical Inspection'),
      });
      if (!answer) return;
      courierCost = answer.customer_courier_cost === '' ? null : Number(answer.customer_courier_cost);
    }
    try {
      await api.post(`/admin/returns/${returnId}/inspect`, {
        inspection_notes: pass ? 'Physical condition verified: PASS' : 'Item damaged by customer: FAIL',
        condition_pass: pass,
        ...(courierCost != null ? { customer_courier_cost: courierCost } : {}),
      });
      toast.success(pass ? t('returns.inspect_pass_success', 'Physical inspection passed.') : t('returns.inspect_fail_disputed', 'Failed inspection; case moved to dispute.'));
      await fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to inspect return.');
    }
  }

  async function handleRefund(returnId) {
    if (!confirm(t('returns.confirm_execute_refund', 'Refund the buyer in full and take the Explooro partner\'s share back for this return?'))) return;

    try {
      await api.post(`/admin/returns/${returnId}/refund`, {});
      toast.success(t('returns.refund_executed_success', 'Refund executed successfully! Funds credited and stock restored.'));
      await fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to execute refund.');
    }
  }

  function renderHeader() {
    return `
      <div style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 20px;
        border-bottom: 1px solid var(--border-subtle, #e2e8f0);
        flex-wrap: wrap;
        gap: 16px;
      ">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 26px;">🔄</span>
            <h1 style="font-size: 22px; font-weight: 800; margin: 0; color: var(--text-primary, #0f172a); letter-spacing: -0.02em;">
              ${t('returns.queue_title', 'Returns & Reverse Quality Inspection Queue')}
            </h1>
          </div>
          <p data-page-info style="font-size: 13px; color: var(--text-muted, #64748b); margin: 4px 0 0 0;">
            ${t('returns.queue_subtitle', 'Review customer return claims, verify photo evidence, and manage reverse courier inspections.')}
          </p>
        </div>

        <button id="btn-refresh-queue" style="
          padding: 8px 16px;
          font-size: 12px;
          font-weight: 600;
          border-radius: var(--radius-md, 8px);
          border: 1px solid var(--border-subtle, #e2e8f0);
          background: var(--surface-1, #ffffff);
          color: var(--text-primary, #0f172a);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          box-shadow: var(--elevation-1, 0 1px 2px rgba(0,0,0,0.05));
          transition: all 0.15s ease;
        ">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;
  }

  function renderFilterTabs() {
    const tabs = [
      { key: 'ALL', label: 'All Cases' },
      { key: 'REQUESTED', label: 'Requested' },
      { key: 'APPROVED', label: 'Approved' },
      { key: 'RECEIVED', label: 'Received' },
      { key: 'INSPECTED', label: 'Inspected' },
      { key: 'REFUNDED', label: 'Refunded' },
      { key: 'REJECTED', label: 'Rejected' },
      { key: 'DISPUTED', label: 'Disputed' },
    ];

    return `
      <div style="
        background: var(--surface-1, #ffffff);
        border: 1px solid var(--border-subtle, #e2e8f0);
        border-radius: var(--radius-lg, 12px);
        padding: 10px 14px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        box-shadow: var(--elevation-1, 0 1px 3px rgba(0,0,0,0.05));
      ">
        ${tabs
          .map(
            (tab) => `
          <button class="tab-btn" data-tab="${tab.key}" style="
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 700;
            border-radius: var(--radius-md, 8px);
            border: 1px solid ${currentTab === tab.key ? 'var(--brand, #4f46e5)' : 'var(--border-subtle, #e2e8f0)'};
            background: ${currentTab === tab.key ? 'var(--brand, #4f46e5)' : 'var(--surface-1, #ffffff)'};
            color: ${currentTab === tab.key ? 'var(--brand-contrast, #ffffff)' : 'var(--text-secondary, #475569)'};
            cursor: pointer;
            transition: all 0.15s ease;
          ">
            ${tab.label}
          </button>
        `
          )
          .join('')}
      </div>
    `;
  }

  function renderQueueList() {
    if (loading) {
      return `
        <div style="padding: 48px; text-align: center; color: var(--text-muted, #64748b);">
          <div style="display: inline-block; width: 32px; height: 32px; border: 3px solid var(--border-subtle, #e2e8f0); border-top-color: var(--brand, #4f46e5); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px;"></div>
          <div>${t('common.loading')}</div>
        </div>
      `;
    }

    if (returns.length === 0) {
      return `
        <div style="
          padding: 60px 20px;
          text-align: center;
          background: var(--surface-1, #ffffff);
          border: 1px solid var(--border-subtle, #e2e8f0);
          border-radius: var(--radius-lg, 12px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
        ">
          <span style="font-size: 36px;">🎉</span>
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary, #0f172a);">
            ${t('returns.no_returns_in_queue', 'No returns in queue.')}
          </h3>
          <p style="margin: 0; font-size: 13px; color: var(--text-muted, #64748b); max-width: 420px;">
            All customer return requests and reverse parcel inspections are currently up to date.
          </p>
        </div>
      `;
    }

    return `
      <div style="display: flex; flex-direction: column; gap: 16px;">
        ${returns
          .map((ret) => {
            const trustScore = ret.customer_trust_score ?? 85;
            const trustColor = trustScore >= 80 ? 'var(--success, #059669)' : trustScore >= 50 ? 'var(--warning, #d97706)' : 'var(--danger, #e11d48)';
            const trustBg = trustScore >= 80 ? 'var(--success-bg, rgba(5, 150, 105, 0.1))' : trustScore >= 50 ? 'var(--warning-bg, rgba(217, 119, 6, 0.1))' : 'var(--danger-bg, rgba(225, 29, 72, 0.1))';

            return `
              <div style="
                background: var(--surface-1, #ffffff);
                border: 1px solid var(--border-subtle, #e2e8f0);
                border-left: 4px solid ${ret.status === 'REFUNDED' ? 'var(--success, #059669)' : ret.status === 'REJECTED' || ret.status === 'DISPUTED' ? 'var(--danger, #e11d48)' : 'var(--brand, #4f46e5)'};
                border-radius: var(--radius-lg, 12px);
                padding: 20px;
                box-shadow: var(--elevation-1, 0 1px 3px rgba(0,0,0,0.05));
                display: flex;
                flex-direction: column;
                gap: 14px;
              ">
                <!-- Top Row -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
                  <div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                      <strong style="font-family: var(--font-mono); font-size: 14px; color: var(--text-brand, #4f46e5);">${ret.ref}</strong>
                      <span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 700; background: var(--info-bg, rgba(79, 70, 229, 0.1)); color: var(--text-brand, #4f46e5); border: 1px solid var(--info-border, rgba(79, 70, 229, 0.25));">${t(`returns.status_${ret.status.toLowerCase()}`, ret.status)}</span>
                      <span style="font-size: 11px; font-family: var(--font-mono); padding: 2px 6px; border-radius: 4px; background: var(--surface-2, #f8fafc); border: 1px solid var(--border-subtle, #e2e8f0); color: var(--text-muted, #64748b);">Order #${ret.sub_order_ref || ret.sub_order_id}</span>
                    </div>

                    <div style="font-size: 12px; color: var(--text-muted, #64748b); margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                      <span>Customer: <strong style="color: var(--text-primary, #0f172a);">${ret.customer_name || 'Customer'}</strong> (${ret.customer_phone || 'N/A'})</span>
                      <span>•</span>
                      <span style="font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${trustBg}; color: ${trustColor};">
                        Trust Score: ${trustScore}/100
                      </span>
                    </div>
                  </div>

                  <div style="text-align: right;">
                    <span style="font-size: 11px; color: var(--text-muted, #64748b); display: block;">Refund Claim Target</span>
                    <strong style="font-size: 18px; font-weight: 800; color: var(--success, #059669); font-family: var(--font-mono);">${formatCurrency(ret.refund_amount)}</strong>
                  </div>
                </div>

                <!-- Middle Details Grid -->
                <div style="
                  display: grid;
                  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
                  gap: 14px;
                  padding: 12px 14px;
                  border-radius: var(--radius-md, 8px);
                  background: var(--surface-2, #f8fafc);
                  border: 1px solid var(--border-subtle, #e2e8f0);
                  font-size: 12px;
                ">
                  <div>
                    <div style="color: var(--text-muted, #64748b); margin-bottom: 2px;">Reason Code: <strong style="color: var(--text-primary, #0f172a);">${ret.reason_code}</strong></div>
                    ${ret.return_shipping ? `<div style="color: var(--text-muted, #64748b); margin-bottom: 2px;" data-return-shipping>${t('returns.shipping.payer_label')}: <strong style="color: var(--text-primary, #0f172a);">${payerLabel(ret.return_shipping.paid_by)}</strong>${ret.return_shipping.decided ? '' : ` (${t('returns.shipping.by_reason')})`}</div>` : ''}
                    ${ret.customer_note ? `<p style="margin: 4px 0 0 0; color: var(--text-secondary, #475569); font-style: italic;">"${ret.customer_note}"</p>` : ''}
                    ${
                      ret.reverse_tracking_number
                        ? `
                      <div style="margin-top: 8px; font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border-radius: 4px; background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); display: inline-block;">
                        📦 Reverse Tracking: <strong>${ret.reverse_tracking_number}</strong> (${ret.reverse_carrier || 'Steadfast'})
                      </div>
                    `
                        : ''
                    }
                  </div>

                  <div>
                    <div style="color: var(--text-muted, #64748b); margin-bottom: 4px;">Evidence Media:</div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                      ${
                        (Array.isArray(ret.evidence_urls_json) ? ret.evidence_urls_json : []).length > 0
                          ? ret.evidence_urls_json
                              .map(
                                (url, i) => `
                            <a href="${url}" target="_blank" style="font-size: 11px; padding: 3px 8px; border-radius: 4px; background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); color: var(--text-brand, #4f46e5); text-decoration: none; display: flex; align-items: center; gap: 4px;">
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg> Evidence Photo ${i + 1} ↗
                            </a>
                          `
                              )
                              .join('')
                          : `<span style="color: var(--text-muted, #64748b); font-style: italic;">No photo attachments</span>`
                      }
                    </div>
                  </div>
                </div>

                <!-- Action Toolbar -->
                <div style="display: flex; justify-content: flex-end; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border-subtle, #e2e8f0); flex-wrap: wrap;">
                  ${
                    ret.status === 'REQUESTED' || ret.status === 'UNDER_REVIEW'
                      ? `
                    <button class="btn-reject-return" data-id="${ret.id}" style="padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 6px; border: 1px solid var(--danger-border, #e11d48); background: var(--danger-bg, rgba(225, 29, 72, 0.08)); color: var(--danger, #e11d48); cursor: pointer;">
                      ${t('returns.btn_reject', 'Reject Claim')}
                    </button>
                    <button class="btn-approve-return" data-id="${ret.id}" style="padding: 6px 16px; font-size: 12px; font-weight: 700; border-radius: 6px; border: none; background: var(--brand, #4f46e5); color: var(--brand-contrast, #1f1f1f); cursor: pointer;">
                      ✓ ${t('returns.btn_approve', 'Approve & Schedule Courier')}
                    </button>
                  `
                      : ''
                  }

                  ${
                    ret.status === 'APPROVED' || ret.status === 'PICKUP_SCHEDULED' || ret.status === 'RECEIVED'
                      ? `
                    <button class="btn-inspect-pass" data-id="${ret.id}" style="padding: 6px 14px; font-size: 12px; font-weight: 700; border-radius: 6px; border: none; background: var(--success, #059669); color: #ffffff; cursor: pointer;">
                      🔍 ${t('returns.btn_inspect_pass', 'Pass Physical Inspection')}
                    </button>
                    <button class="btn-inspect-fail" data-id="${ret.id}" style="padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: 6px; border: 1px solid var(--warning-border, #d97706); background: var(--warning-bg, rgba(217, 119, 6, 0.08)); color: var(--warning, #d97706); cursor: pointer;">
                      ⚠️ ${t('returns.btn_inspect_dispute', 'Fail Inspection (Dispute)')}
                    </button>
                  `
                      : ''
                  }

                  ${
                    ret.status === 'INSPECTED'
                      ? `
                    <button class="btn-execute-refund" data-id="${ret.id}" style="padding: 6px 18px; font-size: 12px; font-weight: 700; border-radius: 6px; border: none; background: var(--success, #059669); color: #ffffff; cursor: pointer;">
                      💰 ${t('returns.btn_execute_refund', 'Execute Refund & Clawback')}
                    </button>
                  `
                      : ''
                  }
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  function render() {
    container.innerHTML = `
      ${renderHeader()}
      ${renderFilterTabs()}
      ${renderQueueList()}
    `;

    container.querySelector('#btn-refresh-queue')?.addEventListener('click', fetchQueue);

    container.querySelectorAll<HTMLElement>('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        currentTab = (e.target as HTMLElement).dataset.tab;
        fetchQueue();
      });
    });

    container.querySelectorAll<HTMLElement>('.btn-approve-return').forEach((btn) => {
      btn.addEventListener('click', (e) => handleApprove((e.target as HTMLElement).dataset.id));
    });

    container.querySelectorAll<HTMLElement>('.btn-reject-return').forEach((btn) => {
      btn.addEventListener('click', (e) => handleReject((e.target as HTMLElement).dataset.id));
    });

    container.querySelectorAll<HTMLElement>('.btn-inspect-pass').forEach((btn) => {
      btn.addEventListener('click', (e) => handleInspect((e.target as HTMLElement).dataset.id, true));
    });

    container.querySelectorAll<HTMLElement>('.btn-inspect-fail').forEach((btn) => {
      btn.addEventListener('click', (e) => handleInspect((e.target as HTMLElement).dataset.id, false));
    });

    container.querySelectorAll<HTMLElement>('.btn-execute-refund').forEach((btn) => {
      btn.addEventListener('click', (e) => handleRefund((e.target as HTMLElement).dataset.id));
    });
  }

  fetchQueue();
  root.append(container);
}
