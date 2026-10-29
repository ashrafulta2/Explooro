/**
 * AdminWarrantyClaimsPage.ts — the admin queue for warranty claims.
 *
 * A supplier may not refund a warranty claim on their own: their REFUND escalates the claim here,
 * and the money moves only when an admin approves it (decided 2026-10-15). One claim refunds one
 * unit of the order item, paid by the supplier. The approve and reject buttons call
 * POST /admin/warranties/:id/override, which re-checks everything on the server.
 */

import { api } from '../../core/api.ts';
import { formatCurrency, formatDate } from '../../services/format.ts';
import { t } from '../../services/i18n.ts';
import { toast } from '../../services/toast.ts';

const TABS = ['ESCALATED', 'all'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** One unit of the order item: line_total / qty, the amount an approved refund pays. */
export function unitRefundAmount(claim) {
  const qty = Math.max(1, Math.floor(Number(claim.item_qty)) || 1);
  const linePaisa = Math.round(Number(claim.item_line_total || 0) * 100);
  return Math.floor(linePaisa / qty) / 100;
}

export default function AdminWarrantyClaimsPage(root: HTMLElement) {
  const container = document.createElement('div');
  container.className = 'admin-warranty-claims';
  container.style.cssText = 'max-width: 1280px; margin: 0 auto; padding: 24px 20px 48px; display: flex; flex-direction: column; gap: 20px;';

  let currentTab = 'ESCALATED';
  let claims = [];
  let loading = true;
  let busyId = null;

  async function fetchQueue() {
    loading = true;
    render();
    try {
      const res = await api.get(`/admin/warranties/queue?status=${encodeURIComponent(currentTab)}`);
      claims = res.data?.claims || [];
    } catch (err) {
      toast.error(err.message || t('warranty_admin.load_error', 'Could not load warranty claims.'));
      claims = [];
    } finally {
      loading = false;
      render();
    }
  }

  async function decide(claim, body, successKey, successFallback) {
    busyId = claim.id;
    render();
    try {
      await api.post(`/admin/warranties/${claim.id}/override`, body);
      toast.success(t(successKey, successFallback));
      await fetchQueue();
    } catch (err) {
      toast.error(err.message || t('warranty_admin.action_error', 'The decision could not be saved.'));
    } finally {
      busyId = null;
      render();
    }
  }

  function approveRefund(claim) {
    const notes = container.querySelector<HTMLInputElement>(`.admin-warranty-claims__notes[data-id="${claim.id}"]`)?.value.trim() || '';
    decide(claim, { action: 'APPROVE', resolution: 'REFUND', notes }, 'warranty_admin.refund_approved', 'Refund approved and paid to the customer wallet.');
  }

  function reject(claim) {
    const reason = container.querySelector<HTMLInputElement>(`.admin-warranty-claims__notes[data-id="${claim.id}"]`)?.value.trim() || '';
    if (reason.length < 5) {
      toast.error(t('warranty_admin.reason_required', 'Write a reason of at least 5 characters before rejecting.'));
      return;
    }
    decide(claim, { action: 'REJECT', rejection_reason: reason }, 'warranty_admin.rejected', 'Claim rejected.');
  }

  function claimCard(claim) {
    const isRefundProposal = claim.status === 'ESCALATED' && claim.resolution === 'REFUND';
    const busy = busyId === claim.id;
    const notesId = `warranty-admin-notes-${claim.id}`;
    return `
      <article class="card" style="padding: 16px; display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-1);">
        <header style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div>
            <strong>${escapeHtml(claim.ref)}</strong>
            <span style="color: var(--text-secondary);"> · ${escapeHtml(claim.product_title_en)}</span>
          </div>
          <span class="badge ${claim.status === 'ESCALATED' ? 'badge--warning' : 'badge--info'}">${escapeHtml(t(`warranty.status_${String(claim.status).toLowerCase()}`, claim.status))}</span>
        </header>
        <dl style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin: 0; font-size: var(--text-sm);">
          <div><dt style="color: var(--text-secondary);">${t('warranty_admin.customer', 'Customer')}</dt><dd style="margin: 0;">${escapeHtml(claim.customer_name || '—')}</dd></div>
          <div><dt style="color: var(--text-secondary);">${t('warranty_admin.supplier', 'Supplier')}</dt><dd style="margin: 0;">${escapeHtml(claim.supplier_name || '—')}</dd></div>
          <div><dt style="color: var(--text-secondary);">${t('warranty_admin.sub_order', 'Sub-order')}</dt><dd style="margin: 0;">${escapeHtml(claim.sub_order_ref || '—')}</dd></div>
          <div><dt style="color: var(--text-secondary);">${t('warranty_admin.filed', 'Filed')}</dt><dd style="margin: 0;">${claim.created_at ? formatDate(claim.created_at) : '—'}</dd></div>
          ${isRefundProposal ? `<div><dt style="color: var(--text-secondary);">${t('warranty_admin.refund_amount', 'Refund (one unit, paid by the supplier)')}</dt><dd style="margin: 0; font-weight: 700;">${formatCurrency(unitRefundAmount(claim))}</dd></div>` : ''}
        </dl>
        <p style="margin: 0; font-size: var(--text-sm);"><strong>${t('warranty_admin.issue', 'Issue')}:</strong> ${escapeHtml(claim.issue_description || '—')}</p>
        ${claim.supplier_notes ? `<p style="margin: 0; font-size: var(--text-sm);"><strong>${t('warranty_admin.supplier_notes', 'Supplier notes')}:</strong> ${escapeHtml(claim.supplier_notes)}</p>` : ''}
        ${isRefundProposal ? `
          <label for="${notesId}" style="font-size: var(--text-sm); font-weight: 600;">${t('warranty_admin.notes_label', 'Notes, or the reason if you reject')}</label>
          <textarea id="${notesId}" class="input admin-warranty-claims__notes" data-id="${claim.id}" rows="2"></textarea>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn btn--primary admin-warranty-claims__approve" data-id="${claim.id}" ${busy ? 'disabled' : ''}>${t('warranty_admin.approve_refund', 'Approve refund')}</button>
            <button type="button" class="btn btn--secondary admin-warranty-claims__reject" data-id="${claim.id}" ${busy ? 'disabled' : ''}>${t('warranty_admin.reject', 'Reject claim')}</button>
          </div>
        ` : ''}
      </article>
    `;
  }

  function render() {
    container.innerHTML = `
      <header>
        <h1 style="margin: 0; font-size: var(--text-2xl);">${t('warranty_admin.title', 'Warranty claims')}</h1>
        <p style="margin: 4px 0 0; color: var(--text-secondary);">${t('warranty_admin.subtitle', 'Suppliers cannot refund on their own. Approve or reject the refunds they propose.')}</p>
      </header>
      <div role="tablist" aria-label="${t('warranty_admin.tabs_label', 'Claim filter')}" style="display: flex; gap: 8px;">
        ${TABS.map((tab) => `
          <button type="button" role="tab" aria-selected="${tab === currentTab}" class="btn btn--sm ${tab === currentTab ? 'btn--primary' : 'btn--secondary'} admin-warranty-claims__tab" data-tab="${tab}">
            ${tab === 'ESCALATED' ? t('warranty_admin.tab_awaiting', 'Awaiting decision') : t('warranty_admin.tab_all', 'All claims')}
          </button>`).join('')}
      </div>
      ${loading
        ? `<p style="color: var(--text-secondary);">${t('common.loading', 'Loading…')}</p>`
        : claims.length === 0
          ? `<p style="color: var(--text-secondary);">${t('warranty_admin.empty', 'No claims here.')}</p>`
          : `<div style="display: flex; flex-direction: column; gap: 12px;">${claims.map(claimCard).join('')}</div>`}
    `;

    container.querySelectorAll<HTMLElement>('.admin-warranty-claims__tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentTab = btn.dataset.tab;
        fetchQueue();
      });
    });
    const byId = (id) => claims.find((c) => String(c.id) === String(id));
    container.querySelectorAll<HTMLElement>('.admin-warranty-claims__approve').forEach((btn) => {
      btn.addEventListener('click', () => approveRefund(byId(btn.dataset.id)));
    });
    container.querySelectorAll<HTMLElement>('.admin-warranty-claims__reject').forEach((btn) => {
      btn.addEventListener('click', () => reject(byId(btn.dataset.id)));
    });
  }

  root.appendChild(container);
  fetchQueue();
}
