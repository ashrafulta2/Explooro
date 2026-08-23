/**
 * VerificationCenterPage.js — Admin KYC Verification & Trust Center (Prompt 7.5).
 *
 * Implements:
 * 1. Side-by-side submission list and document reviewer workspace.
 * 2. Audited document viewer modal.
 * 3. Verification checklist.
 * 4. High-tier Maker-Checker authorization notice on approvals.
 * 5. Rejection and appeal handling.
 */

import { api } from '../../core/api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export default function VerificationCenterPage() {
  const container = document.createElement('div');
  container.className = 'page-container verification-center-page';

  let queueItems = [];
  let selectedKyc = null;
  let currentFilter = 'PENDING';
  let currentUserRole = 'moderator';
  let loading = true;
  let inspectingDoc = null;

  async function init() {
    try {
      const meRes = await api.get('/me');
      currentUserRole = meRes.data?.role || 'moderator';
    } catch {}
    fetchQueue();
  }

  async function fetchQueue() {
    try {
      loading = true;
      render();
      const res = await api.get(`/admin/kyc/queue?status=${currentFilter}`);
      queueItems = res.data?.items || [];
      if (queueItems.length > 0 && !selectedKyc) {
        loadKycDetails(queueItems[0].id);
      } else if (selectedKyc) {
        loadKycDetails(selectedKyc.id);
      }
    } catch (err) {
      toast.error('Failed to load verification queue.');
      queueItems = [];
    } finally {
      loading = false;
      render();
    }
  }

  async function loadKycDetails(kycId) {
    try {
      const res = await api.get(`/admin/kyc/${kycId}`);
      selectedKyc = res.data;
      render();
    } catch (err) {
      toast.error('Failed to load KYC submission details.');
    }
  }

  async function handleInspectDoc(docId) {
    try {
      const res = await api.get(`/admin/kyc/${selectedKyc.id}/documents/${docId}`);
      inspectingDoc = res.data;
      openDocViewerModal();
    } catch (err) {
      toast.error(err.message || 'Failed to inspect document.');
    }
  }

  function openDocViewerModal() {
    if (!inspectingDoc) return;

    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog card max-w-2xl p-6 animate-scale-in">
        <div class="flex items-center justify-between mb-4 pb-2 border-b">
          <div>
            <h3 class="text-base font-bold flex items-center gap-2">
              🔒 <span>${inspectingDoc.doc_type}</span>
            </h3>
            <span class="text-xxs text-secondary">View Count: ${inspectingDoc.view_count} (Access logged to audit trail)</span>
          </div>
          <button class="btn btn--ghost btn--xs text-secondary" id="btn-close-viewer">✕</button>
        </div>

        <div class="p-4 bg-surface-subtle border rounded text-center min-h-64 flex flex-col items-center justify-center">
          <div class="w-32 h-40 bg-surface border rounded flex items-center justify-center text-4xl mb-2 shadow-sm">
            🪪
          </div>
          <span class="font-mono text-xs text-secondary">[SECURE WATERMARKED PREVIEW]</span>
          <span class="text-xxs text-tertiary mt-1">Storage Key: <code>${inspectingDoc.storage_key}</code></span>
        </div>

        <div class="flex justify-end gap-2 mt-4">
          <button class="btn btn--secondary btn--sm" id="btn-close-viewer-footer">${t('common.close')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    modalBackdrop.querySelector('#btn-close-viewer')?.addEventListener('click', () => modalBackdrop.remove());
    modalBackdrop.querySelector('#btn-close-viewer-footer')?.addEventListener('click', () => modalBackdrop.remove());
  }

  async function handleApprove() {
    if (!selectedKyc) return;
    try {
      const res = await api.post(`/admin/kyc/${selectedKyc.id}/decide`, {
        decision: 'VERIFIED',
      });

      if (res.data?.makerCheckerPending) {
        toast.info(t('kyc.approval_maker_checker_pending'));
      } else {
        toast.success(t('kyc.approve_success'));
      }

      await fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Approval failed.');
    }
  }

  function openRejectModal() {
    if (!selectedKyc) return;

    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog card max-w-md p-6 animate-scale-in">
        <h3 class="text-lg font-bold mb-1">❌ ${t('kyc.reject_modal_title')}</h3>
        <p class="text-xs text-secondary mb-4">${t('kyc.reject_modal_desc')}</p>

        <div class="space-y-3 text-xs">
          <div>
            <label class="font-semibold block mb-1">Rejection Reason (English):</label>
            <textarea id="txt-reject-en" class="form-textarea w-full" rows="2" placeholder="e.g. NID image is blurry, trade license number not verifiable..."></textarea>
          </div>

          <div>
            <label class="font-semibold block mb-1">বাতিলের কারণ (বাংলা):</label>
            <textarea id="txt-reject-bn" class="form-textarea w-full font-bengali" rows="2" placeholder="এনআইডির ছবি স্পষ্ট নয় অথবা তথ্যে অমিল রয়েছে..."></textarea>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-6">
          <button class="btn btn--secondary btn--sm" id="btn-cancel-reject">${t('common.cancel')}</button>
          <button class="btn btn--danger btn--sm" id="btn-confirm-reject">${t('kyc.confirm_rejection')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    modalBackdrop.querySelector('#btn-cancel-reject').addEventListener('click', () => modalBackdrop.remove());

    modalBackdrop.querySelector('#btn-confirm-reject').addEventListener('click', async () => {
      const reasonEn = modalBackdrop.querySelector('#txt-reject-en').value.trim();
      const reasonBn = modalBackdrop.querySelector('#txt-reject-bn').value.trim();
      modalBackdrop.remove();

      try {
        await api.post(`/admin/kyc/${selectedKyc.id}/decide`, {
          decision: 'REJECTED',
          reason_en: reasonEn,
          reason_bn: reasonBn,
        });
        toast.success(t('kyc.reject_success'));
        await fetchQueue();
      } catch (err) {
        toast.error(err.message || 'Rejection failed.');
      }
    });
  }

  function renderQueueList() {
    if (loading) {
      return `<div class="p-8 text-center text-secondary text-xs">${t('common.loading')}...</div>`;
    }

    if (queueItems.length === 0) {
      return `<div class="p-8 text-center text-secondary text-xs">${t('kyc.queue_empty')}</div>`;
    }

    return `
      <div class="divide-y text-xs">
        ${queueItems
          .map(
            (item) => `
          <div class="p-3 cursor-pointer transition hover:bg-surface-subtle ${selectedKyc?.id === item.id ? 'bg-surface-subtle border-l-4 border-primary font-semibold' : ''}" data-kyc-id="${item.id}">
            <div class="flex items-center justify-between mb-1">
              <span class="font-mono text-primary">${item.ref}</span>
              <span class="badge ${item.status === 'VERIFIED' ? 'badge--emerald' : item.status === 'REJECTED' ? 'badge--rose' : item.status === 'APPEALED' ? 'badge--indigo' : 'badge--amber'} badge--xs">
                ${item.status}
              </span>
            </div>
            <div class="text-text font-bold">${item.applicant_name || 'Applicant'}</div>
            <div class="text-secondary text-xxs flex justify-between mt-1">
              <span>👤 ${item.kyc_type} (${item.current_tier})</span>
              <span>📄 ${item.doc_count} docs</span>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  function renderDetailsPane() {
    if (!selectedKyc) {
      return `<div class="p-16 text-center text-secondary text-xs card">${t('kyc.select_submission_hint')}</div>`;
    }

    const isPending = ['PENDING', 'UNDER_REVIEW', 'APPEALED'].includes(selectedKyc.status);

    return `
      <div class="card p-6 space-y-6 text-xs">
        <!-- Top Title & Status -->
        <div class="flex items-start justify-between pb-4 border-b">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono text-base font-bold text-primary">${selectedKyc.ref}</span>
              <span class="badge ${selectedKyc.status === 'VERIFIED' ? 'badge--emerald' : selectedKyc.status === 'REJECTED' ? 'badge--rose' : 'badge--amber'}">
                ${selectedKyc.status}
              </span>
            </div>
            <h2 class="text-lg font-bold text-text mt-1">${selectedKyc.applicant_name} (${selectedKyc.kyc_type})</h2>
            <div class="text-secondary text-xxs mt-0.5">Submitted: ${formatDate(selectedKyc.created_at)} • Email: ${selectedKyc.applicant_email}</div>
          </div>

          <div class="text-right">
            <span class="text-secondary block">Trust Tier:</span>
            <span class="badge badge--indigo font-bold">${selectedKyc.current_tier} (${selectedKyc.trust_score} pts)</span>
          </div>
        </div>

        <!-- Maker-Checker Notice if Moderator -->
        ${
          currentUserRole !== 'super_admin' && isPending
            ? `
          <div class="p-3 bg-amber-subtle border border-amber rounded text-amber-dark text-xs flex items-center gap-2">
            <span>ℹ️</span>
            <span>${t('kyc.maker_checker_notice')}</span>
          </div>
        `
            : ''
        }

        <!-- Business Details Grid -->
        <div class="grid grid-cols-2 gap-3 p-3 bg-surface-subtle border rounded">
          <div>
            <span class="text-secondary block">Business Name:</span>
            <span class="font-semibold">${selectedKyc.business_name || 'N/A'}</span>
          </div>
          <div>
            <span class="text-secondary block">Address:</span>
            <span class="font-semibold">${selectedKyc.business_address || 'N/A'}</span>
          </div>
        </div>

        <!-- Documents Checklist & Inspection -->
        <div class="space-y-3">
          <h3 class="font-bold text-sm">🗂️ Uploaded Verification Documents (${selectedKyc.documents?.length || 0})</h3>
          <div class="grid grid-cols-2 gap-3">
            ${(selectedKyc.documents || [])
              .map(
                (doc) => `
              <div class="p-3 border rounded bg-surface flex items-center justify-between">
                <div>
                  <span class="font-semibold block">${doc.doc_type}</span>
                  <span class="text-xxs text-secondary">Mime: ${doc.mime_type} • Views: ${doc.view_count}</span>
                </div>
                <button class="btn btn--secondary btn--xs btn-inspect-doc" data-doc-id="${doc.id}">
                  👁️ Inspect
                </button>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <!-- Verification Checklist -->
        <div class="space-y-2 p-3 border rounded bg-surface">
          <h4 class="font-bold">✅ Reviewer Compliance Checklist</h4>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked/>
            <span>NID front and back match name on account</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked/>
            <span>Selfie face matches portrait on government NID</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked/>
            <span>Trade License and physical warehouse verified</span>
          </label>
        </div>

        <!-- Action Toolbar -->
        ${
          isPending
            ? `
          <div class="flex justify-end gap-3 pt-4 border-t">
            <button class="btn btn--danger btn--sm" id="btn-reject-kyc">❌ Reject Submission</button>
            <button class="btn btn--primary btn--sm" id="btn-approve-kyc">✅ Approve Verification</button>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  function render() {
    container.innerHTML = `
      <div class="verification-center">
        <!-- Header -->
        <div class="flex items-center justify-between pb-4 mb-4 border-b">
          <div>
            <h1 class="text-2xl font-bold flex items-center gap-2">
              🛡️ ${t('kyc.admin_center_title')}
            </h1>
            <p class="text-xs text-secondary">${t('kyc.admin_center_subtitle')}</p>
          </div>

          <div class="flex items-center gap-2">
            <select id="sel-filter-status" class="form-select form-select--sm text-xs">
              <option value="PENDING" ${currentFilter === 'PENDING' ? 'selected' : ''}>Pending Verification</option>
              <option value="APPEALED" ${currentFilter === 'APPEALED' ? 'selected' : ''}>Appealed Submissions</option>
              <option value="VERIFIED" ${currentFilter === 'VERIFIED' ? 'selected' : ''}>Verified (Blue-Tick)</option>
              <option value="REJECTED" ${currentFilter === 'REJECTED' ? 'selected' : ''}>Rejected</option>
              <option value="ALL" ${currentFilter === 'ALL' ? 'selected' : ''}>All Submissions</option>
            </select>
          </div>
        </div>

        <!-- Two Column Workspace -->
        <div class="grid grid-cols-12 gap-6">
          <div class="col-span-4 card overflow-hidden max-h-[80vh] overflow-y-auto">
            ${renderQueueList()}
          </div>
          <div class="col-span-8">
            ${renderDetailsPane()}
          </div>
        </div>
      </div>
    `;

    attachListeners();
  }

  function attachListeners() {
    container.querySelector('#sel-filter-status')?.addEventListener('change', (e) => {
      currentFilter = e.target.value;
      fetchQueue();
    });

    container.querySelectorAll('[data-kyc-id]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-kyc-id');
        loadKycDetails(id);
      });
    });

    container.querySelectorAll('.btn-inspect-doc').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const docId = btn.getAttribute('data-doc-id');
        handleInspectDoc(docId);
      });
    });

    container.querySelector('#btn-approve-kyc')?.addEventListener('click', handleApprove);
    container.querySelector('#btn-reject-kyc')?.addEventListener('click', openRejectModal);
  }

  init();
  return container;
}
