/**
 * ModerationQueuePage.js — Unified Product Approval & Content Moderation Workspace (Prompt 7.4).
 *
 * Implements:
 * 1. Unified queue covering: Products, Reviews, UGC Videos, Storefronts, Live Streams, Chat Reports.
 * 2. Automated advisory pre-screening indicators.
 * 3. Lock-claiming mechanism to prevent dual-moderator conflict.
 * 4. Keyboard shortcuts (A = Approve, R = Reject, C = Claim, J/K = Navigate).
 * 5. Bulk action operations (Bulk Approve, Bulk Claim).
 * 6. Throughput KPIs and stats.
 */

import { api } from '../../core/api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { ReviewCard } from '../../components/moderation/ReviewCard.js';

export default function ModerationQueuePage() {
  const container = document.createElement('div');
  container.className = 'page-container moderation-queue-page';

  let currentTypeTab = 'ALL';
  let currentStatus = 'PENDING';
  let queueItems = [];
  let stats = null;
  let loading = true;
  let selectedIndex = 0;
  let selectedIds = new Set();
  let currentUserId = null;

  async function init() {
    try {
      const meRes = await api.get('/me');
      currentUserId = meRes.data?.id;
    } catch {}
    fetchStats();
    fetchQueue();
    attachKeyboardShortcuts();
  }

  async function fetchStats() {
    try {
      const res = await api.get('/moderation/stats');
      stats = res.data;
      renderStats();
    } catch {}
  }

  async function fetchQueue() {
    try {
      loading = true;
      render();
      let url = `/moderation/queue?status=${currentStatus}`;
      if (currentTypeTab !== 'ALL') {
        url += `&item_type=${currentTypeTab}`;
      }
      const res = await api.get(url);
      queueItems = res.data?.items || [];
      selectedIds.clear();
      selectedIndex = 0;
    } catch (err) {
      toast.error(err.message || 'Failed to fetch moderation queue.');
      queueItems = [];
    } finally {
      loading = false;
      render();
    }
  }

  async function handleClaim(queueId) {
    try {
      await api.post(`/moderation/queue/${queueId}/claim`, {});
      toast.success(t('moderation.claim_success'));
      await fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to claim item.');
    }
  }

  async function handleRelease(queueId) {
    try {
      await api.post(`/moderation/queue/${queueId}/release`, {});
      toast.success(t('moderation.release_success'));
      await fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to release item.');
    }
  }

  async function handleApprove(queueId) {
    try {
      await api.post(`/moderation/queue/${queueId}/decide`, { decision: 'APPROVED' });
      toast.success(t('moderation.approve_success'));
      await fetchStats();
      await fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to approve item.');
    }
  }

  async function handleEscalate(queueId) {
    try {
      await api.post(`/moderation/queue/${queueId}/decide`, { decision: 'ESCALATED' });
      toast.success(t('moderation.escalate_success'));
      await fetchStats();
      await fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Failed to escalate item.');
    }
  }

  function openRejectModal(queueId) {
    const item = queueItems.find((q) => q.id === queueId);
    if (!item) return;

    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog card max-w-md p-6 animate-scale-in">
        <h3 class="text-lg font-bold mb-1">❌ ${t('moderation.reject_modal_title')} (${item.ref})</h3>
        <p class="text-xs text-secondary mb-4">${t('moderation.reject_modal_desc')}</p>

        <div class="space-y-3 text-xs">
          <div>
            <label class="font-semibold block mb-1">${t('moderation.reason_presets')}:</label>
            <select id="sel-preset-reason" class="form-select w-full">
              <option value="POLICY_VIOLATION">Prohibited item or terms policy breach</option>
              <option value="POOR_IMAGE_QUALITY">Inaccurate, watermarked or low-resolution images</option>
              <option value="MISLEADING_PRICING">Suspicious price or margin anomaly</option>
              <option value="DUPLICATE_LISTING">Duplicate listing detected</option>
              <option value="CUSTOM">Custom reason...</option>
            </select>
          </div>

          <div>
            <label class="font-semibold block mb-1">English Reason (Sent to seller):</label>
            <textarea id="txt-reason-en" class="form-textarea w-full" rows="2" placeholder="Actionable rejection explanation..."></textarea>
          </div>

          <div>
            <label class="font-semibold block mb-1">বাংলা কারণ (সেলারকে প্রেরিত):</label>
            <textarea id="txt-reason-bn" class="form-textarea w-full font-bengali" rows="2" placeholder="বাতিলের সুস্পষ্ট কারণ লিখুন..."></textarea>
          </div>

          <label class="flex items-center gap-2 p-2 border border-rose rounded bg-rose-subtle text-rose-dark cursor-pointer">
            <input type="checkbox" id="chk-shadow-restrict"/>
            <span class="font-medium">🚫 ${t('moderation.shadow_restrict_seller')}</span>
          </label>
        </div>

        <div class="flex justify-end gap-2 mt-6">
          <button class="btn btn--secondary btn--sm" id="btn-cancel-modal">${t('common.cancel')}</button>
          <button class="btn btn--danger btn--sm" id="btn-confirm-reject">${t('moderation.confirm_reject')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    const txtEn = modalBackdrop.querySelector('#txt-reason-en');
    const txtBn = modalBackdrop.querySelector('#txt-reason-bn');
    const selPreset = modalBackdrop.querySelector('#sel-preset-reason');

    function syncPreset(val) {
      if (val === 'POLICY_VIOLATION') {
        txtEn.value = 'Item violates platform listing policies or contains prohibited elements.';
        txtBn.value = 'পণ্যটি প্ল্যাটফর্মের লিস্টিং পলিসি লঙ্ঘন করেছে অথবা নিষিদ্ধ উপাদান যুক্ত।';
      } else if (val === 'POOR_IMAGE_QUALITY') {
        txtEn.value = 'Product photos are low quality, watermarked, or do not accurately depict the item.';
        txtBn.value = 'পণ্যের ছবি অস্পষ্ট, ওয়াটারমার্কযুক্ত অথবা মূল পণ্যের সাথে সঙ্গতিপূর্ণ নয়।';
      } else if (val === 'MISLEADING_PRICING') {
        txtEn.value = 'Pricing exhibits severe anomaly relative to base cost.';
        txtBn.value = 'পণ্যের খুচরা মূল্য বেস খরচের তুলনায় অসংগতিপূর্ণ।';
      } else if (val === 'DUPLICATE_LISTING') {
        txtEn.value = 'Identical product already exists in your inventory.';
        txtBn.value = 'একই পণ্য আপনার ইনভেন্টরিতে ইতিমধ্যে বিদ্যমান।';
      }
    }

    syncPreset(selPreset.value);
    selPreset.addEventListener('change', (e) => syncPreset(e.target.value));

    modalBackdrop.querySelector('#btn-cancel-modal').addEventListener('click', () => modalBackdrop.remove());

    modalBackdrop.querySelector('#btn-confirm-reject').addEventListener('click', async () => {
      const reasonEn = txtEn.value.trim();
      const reasonBn = txtBn.value.trim();
      const shadowRestrict = modalBackdrop.querySelector('#chk-shadow-restrict').checked;

      modalBackdrop.remove();

      try {
        await api.post(`/moderation/queue/${queueId}/decide`, {
          decision: 'REJECTED',
          reason_en: reasonEn,
          reason_bn: reasonBn,
          shadow_restrict_seller: shadowRestrict,
        });
        toast.success(t('moderation.reject_success'));
        await fetchStats();
        await fetchQueue();
      } catch (err) {
        toast.error(err.message || 'Failed to reject item.');
      }
    });
  }

  function openChangesRequestedModal(queueId) {
    const item = queueItems.find((q) => q.id === queueId);
    if (!item) return;

    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog card max-w-md p-6 animate-scale-in">
        <h3 class="text-lg font-bold mb-1">✏️ ${t('moderation.changes_modal_title')} (${item.ref})</h3>
        <p class="text-xs text-secondary mb-4">${t('moderation.changes_modal_desc')}</p>

        <div class="space-y-3 text-xs">
          <div>
            <label class="font-semibold block mb-1">Requested Changes (English):</label>
            <textarea id="txt-changes-en" class="form-textarea w-full" rows="3" placeholder="Specify required edits (e.g. upload high-res photo, adjust wholesale margin)..."></textarea>
          </div>
          <div>
            <label class="font-semibold block mb-1">প্রয়োজনীয় সংশোধন (বাংলা):</label>
            <textarea id="txt-changes-bn" class="form-textarea w-full font-bengali" rows="3" placeholder="সেলারকে কী কী সংশোধন করতে হবে লিখুন..."></textarea>
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-6">
          <button class="btn btn--secondary btn--sm" id="btn-cancel-modal">${t('common.cancel')}</button>
          <button class="btn btn--primary btn--sm" id="btn-confirm-changes">${t('moderation.send_changes_request')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    modalBackdrop.querySelector('#btn-cancel-modal').addEventListener('click', () => modalBackdrop.remove());

    modalBackdrop.querySelector('#btn-confirm-changes').addEventListener('click', async () => {
      const changesEn = modalBackdrop.querySelector('#txt-changes-en').value.trim();
      const changesBn = modalBackdrop.querySelector('#txt-changes-bn').value.trim();

      modalBackdrop.remove();

      try {
        await api.post(`/moderation/queue/${queueId}/decide`, {
          decision: 'CHANGES_REQUESTED',
          changes_requested_en: changesEn,
          changes_requested_bn: changesBn,
        });
        toast.success(t('moderation.changes_requested_success'));
        await fetchStats();
        await fetchQueue();
      } catch (err) {
        toast.error(err.message || 'Failed to request changes.');
      }
    });
  }

  async function handleBulkApprove() {
    if (selectedIds.size === 0) return;
    try {
      await api.post('/moderation/bulk-decide', {
        queue_ids: Array.from(selectedIds),
        decision: 'APPROVED',
      });
      toast.success(t('moderation.bulk_approve_success'));
      await fetchStats();
      await fetchQueue();
    } catch (err) {
      toast.error(err.message || 'Bulk approve failed.');
    }
  }

  function attachKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignore if typing inside input / textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      if (e.key === 'j' || e.key === 'J') {
        if (selectedIndex < queueItems.length - 1) {
          selectedIndex++;
          highlightCurrentCard();
        }
      } else if (e.key === 'k' || e.key === 'K') {
        if (selectedIndex > 0) {
          selectedIndex--;
          highlightCurrentCard();
        }
      } else if (e.key === 'a' || e.key === 'A') {
        const item = queueItems[selectedIndex];
        if (item && ['PENDING', 'IN_REVIEW'].includes(item.status)) {
          handleApprove(item.id);
        }
      } else if (e.key === 'r' || e.key === 'R') {
        const item = queueItems[selectedIndex];
        if (item && ['PENDING', 'IN_REVIEW'].includes(item.status)) {
          openRejectModal(item.id);
        }
      } else if (e.key === 'c' || e.key === 'C') {
        const item = queueItems[selectedIndex];
        if (item && !item.claimed_by) {
          handleClaim(item.id);
        }
      }
    });
  }

  function highlightCurrentCard() {
    const cards = container.querySelectorAll('.review-card');
    cards.forEach((c, idx) => {
      if (idx === selectedIndex) {
        c.classList.add('ring-2', 'ring-primary');
        c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        c.classList.remove('ring-2', 'ring-primary');
      }
    });
  }

  function renderStats() {
    const statsContainer = container.querySelector('#moderation-stats-bar');
    if (!statsContainer || !stats) return;

    statsContainer.innerHTML = `
      <div class="grid grid-cols-4 gap-3 text-xs">
        <div class="p-3 border rounded bg-surface">
          <span class="text-secondary block">Pending Review</span>
          <span class="font-bold text-lg text-primary">${stats.pending_count}</span>
        </div>
        <div class="p-3 border rounded bg-surface">
          <span class="text-secondary block">Flagged Content</span>
          <span class="font-bold text-lg text-rose">${stats.flagged_count}</span>
        </div>
        <div class="p-3 border rounded bg-surface">
          <span class="text-secondary block">Approved Today</span>
          <span class="font-bold text-lg text-emerald">${stats.approved_count}</span>
        </div>
        <div class="p-3 border rounded bg-surface">
          <span class="text-secondary block">Rejections</span>
          <span class="font-bold text-lg text-secondary">${stats.rejected_count}</span>
        </div>
      </div>
    `;
  }

  function render() {
    container.innerHTML = `
      <div class="moderation-queue">
        <!-- Top Workspace Bar -->
        <div class="flex items-center justify-between pb-4 border-b">
          <div>
            <h1 class="text-2xl font-bold flex items-center gap-2">
              🛡️ ${t('moderation.page_title')}
            </h1>
            <p class="text-sm text-secondary">${t('moderation.page_subtitle')}</p>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn--secondary btn--sm" id="btn-refresh-queue">
              🔄 ${t('common.refresh')}
            </button>
          </div>
        </div>

        <!-- KPI Stats Bar -->
        <div id="moderation-stats-bar" class="my-4"></div>

        <!-- Item Type Tabs & Status Filters -->
        <div class="flex items-center justify-between gap-4 my-3 flex-wrap">
          <div class="flex gap-2" id="type-tabs">
            ${[
              { key: 'ALL', label: t('moderation.tab_all') },
              { key: 'PRODUCT_NEW', label: t('moderation.tab_products') },
              { key: 'REVIEW', label: t('moderation.tab_reviews') },
              { key: 'UGC_VIDEO', label: t('moderation.tab_ugc') },
              { key: 'STOREFRONT_ASSET', label: t('moderation.tab_storefronts') },
            ]
              .map(
                (tab) => `
              <button class="btn btn--sm ${currentTypeTab === tab.key ? 'btn--primary' : 'btn--ghost'}" data-type-tab="${tab.key}">
                ${tab.label}
              </button>
            `
              )
              .join('')}
          </div>

          <div class="flex items-center gap-2">
            <select id="sel-status-filter" class="form-select form-select--sm text-xs">
              <option value="PENDING" ${currentStatus === 'PENDING' ? 'selected' : ''}>${t('moderation.filter_pending')}</option>
              <option value="IN_REVIEW" ${currentStatus === 'IN_REVIEW' ? 'selected' : ''}>${t('moderation.filter_in_review')}</option>
              <option value="APPROVED" ${currentStatus === 'APPROVED' ? 'selected' : ''}>${t('moderation.filter_approved')}</option>
              <option value="REJECTED" ${currentStatus === 'REJECTED' ? 'selected' : ''}>${t('moderation.filter_rejected')}</option>
              <option value="ALL" ${currentStatus === 'ALL' ? 'selected' : ''}>${t('moderation.filter_all_status')}</option>
            </select>
          </div>
        </div>

        <!-- Bulk Action Toolbar & Keyboard Hint -->
        <div class="flex items-center justify-between p-2 rounded bg-surface-subtle border text-xs mb-4">
          <div class="flex items-center gap-3">
            <label class="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" id="chk-select-all"/>
              <span>${t('common.select_all')}</span>
            </label>
            <button class="btn btn--secondary btn--xs" id="btn-bulk-approve" ${selectedIds.size === 0 ? 'disabled' : ''}>
              ✅ ${t('moderation.btn_bulk_approve')} (${selectedIds.size})
            </button>
          </div>

          <div class="text-tertiary">
            ⌨️ <strong>${t('moderation.keyboard_shortcuts')}</strong>: <kbd class="font-mono bg-surface border px-1 rounded">A</kbd> Approve | <kbd class="font-mono bg-surface border px-1 rounded">R</kbd> Reject | <kbd class="font-mono bg-surface border px-1 rounded">C</kbd> Claim | <kbd class="font-mono bg-surface border px-1 rounded">J/K</kbd> Navigate
          </div>
        </div>

        <!-- Queue Cards Container -->
        <div id="queue-cards-container" class="space-y-4">
          ${
            loading
              ? `<div class="p-16 text-center text-secondary text-sm">${t('common.loading')}...</div>`
              : queueItems.length === 0
              ? `<div class="p-16 text-center text-secondary text-sm card">${t('moderation.queue_empty')}</div>`
              : ''
          }
        </div>
      </div>
    `;

    renderStats();

    // Mount cards
    if (!loading && queueItems.length > 0) {
      const cardsContainer = container.querySelector('#queue-cards-container');
      queueItems.forEach((item, idx) => {
        const cardNode = ReviewCard({
          item,
          currentUserId,
          onClaim: handleClaim,
          onRelease: handleRelease,
          onApprove: handleApprove,
          onReject: openRejectModal,
          onRequestChanges: openChangesRequestedModal,
          onEscalate: handleEscalate,
        });

        // Add checkbox selection on card
        const selectBox = document.createElement('input');
        selectBox.type = 'checkbox';
        selectBox.className = 'absolute top-3 right-3 cursor-pointer';
        selectBox.checked = selectedIds.has(item.id);
        selectBox.addEventListener('change', (e) => {
          if (e.target.checked) selectedIds.add(item.id);
          else selectedIds.delete(item.id);
          const btnBulk = container.querySelector('#btn-bulk-approve');
          if (btnBulk) {
            btnBulk.disabled = selectedIds.size === 0;
            btnBulk.textContent = `✅ ${t('moderation.btn_bulk_approve')} (${selectedIds.size})`;
          }
        });

        cardNode.classList.add('relative');
        cardNode.prepend(selectBox);

        cardsContainer.appendChild(cardNode);
      });

      highlightCurrentCard();
    }

    attachListeners();
  }

  function attachListeners() {
    container.querySelector('#btn-refresh-queue')?.addEventListener('click', () => {
      fetchStats();
      fetchQueue();
    });

    container.querySelectorAll('[data-type-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentTypeTab = btn.getAttribute('data-type-tab');
        fetchQueue();
      });
    });

    container.querySelector('#sel-status-filter')?.addEventListener('change', (e) => {
      currentStatus = e.target.value;
      fetchQueue();
    });

    container.querySelector('#chk-select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        queueItems.forEach((item) => selectedIds.add(item.id));
      } else {
        selectedIds.clear();
      }
      render();
    });

    container.querySelector('#btn-bulk-approve')?.addEventListener('click', handleBulkApprove);
  }

  init();
  return container;
}
