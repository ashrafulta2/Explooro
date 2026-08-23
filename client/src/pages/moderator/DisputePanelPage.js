/**
 * DisputePanelPage.js — Buyer ↔ Saler ↔ Supplier Three-Way Arbitration Workspace (Prompt 7.3).
 *
 * Implements:
 * 1. Multi-role dispute queue with SLA urgency sorting and breach alerts.
 * 2. Full three-way communication channel with internal moderator-only note privacy.
 * 3. Integrated EvidenceTimeline.
 * 4. Precedent search for historical consistency.
 * 5. Arbitration resolution modal supporting Full Refund, Partial Refund, Split Liability, Reject, Replacement.
 * 6. High-tier Maker-Checker deferral notifications for moderator submissions above threshold.
 */

import { api } from '../../core/api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { EvidenceTimeline } from '../../components/dispute/EvidenceTimeline.js';

export default function DisputePanelPage() {
  const container = document.createElement('div');
  container.className = 'page-container dispute-panel-page';

  let currentTab = 'ALL';
  let disputes = [];
  let selectedDispute = null;
  let timelineData = null;
  let precedents = [];
  let loading = true;
  let detailsLoading = false;
  let activeView = 'CHAT'; // 'CHAT' | 'TIMELINE' | 'PRECEDENTS'
  let isInternalNote = false;

  async function fetchDisputes() {
    try {
      loading = true;
      render();
      const statusParam = currentTab !== 'ALL' ? `?status=${currentTab}` : '';
      const res = await api.get(`/disputes${statusParam}`);
      disputes = res.data?.disputes || [];
      if (disputes.length > 0 && !selectedDispute) {
        selectDispute(disputes[0].id);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to fetch disputes.');
      disputes = [];
    } finally {
      loading = false;
      render();
    }
  }

  async function selectDispute(disputeId) {
    try {
      detailsLoading = true;
      render();
      const [disputeRes, timelineRes] = await Promise.all([
        api.get(`/disputes/${disputeId}`),
        api.get(`/disputes/${disputeId}/timeline`),
      ]);
      selectedDispute = disputeRes.data;
      timelineData = timelineRes.data;
      // Also fetch precedents based on dispute reason
      if (selectedDispute?.reason) {
        try {
          const precRes = await api.get(`/disputes/precedents?reason=${encodeURIComponent(selectedDispute.reason)}`);
          precedents = precRes.data?.precedents || [];
        } catch {}
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load dispute details.');
    } finally {
      detailsLoading = false;
      render();
    }
  }

  async function handleSendMessage(body, attachments = []) {
    if (!body || !selectedDispute) return;
    try {
      await api.post(`/disputes/${selectedDispute.id}/messages`, {
        body,
        attachments,
        is_internal_note: isInternalNote,
      });
      toast.success(isInternalNote ? t('dispute.internal_note_saved') : t('dispute.message_sent'));
      await selectDispute(selectedDispute.id);
    } catch (err) {
      toast.error(err.message || 'Failed to post message.');
    }
  }

  async function handleArbitrate({ outcome, outcomeSplit, resolutionNotes }) {
    if (!selectedDispute) return;
    try {
      const res = await api.post(`/disputes/${selectedDispute.id}/arbitrate`, {
        outcome,
        outcome_split: outcomeSplit,
        resolution_notes: resolutionNotes,
      });

      if (res.meta?.maker_checker?.requires_super_admin) {
        toast.info(t('dispute.maker_checker_pending'));
      } else {
        toast.success(t('dispute.arbitrate_success'));
      }

      await fetchDisputes();
      if (selectedDispute) {
        await selectDispute(selectedDispute.id);
      }
    } catch (err) {
      toast.error(err.message || 'Arbitration failed.');
    }
  }

  async function handleEscalate() {
    if (!selectedDispute) return;
    const reason = prompt(t('dispute.prompt_escalation_reason'));
    if (!reason) return;

    try {
      await api.post(`/disputes/${selectedDispute.id}/escalate`, { reason });
      toast.success(t('dispute.escalate_success'));
      await fetchDisputes();
      if (selectedDispute) {
        await selectDispute(selectedDispute.id);
      }
    } catch (err) {
      toast.error(err.message || 'Escalation failed.');
    }
  }

  function renderStatusBadge(status) {
    switch (status) {
      case 'OPEN':
        return `<span class="badge badge--blue">${t('dispute.status.open')}</span>`;
      case 'UNDER_ARBITRATION':
        return `<span class="badge badge--amber">${t('dispute.status.under_arbitration')}</span>`;
      case 'ESCALATED':
        return `<span class="badge badge--rose animate-pulse">${t('dispute.status.escalated')}</span>`;
      case 'AWAITING_SUPER_ADMIN':
        return `<span class="badge badge--purple">${t('dispute.status.awaiting_super_admin')}</span>`;
      case 'RESOLVED':
        return `<span class="badge badge--emerald">${t('dispute.status.resolved')}</span>`;
      case 'CLOSED':
        return `<span class="badge badge--gray">${t('dispute.status.closed')}</span>`;
      default:
        return `<span class="badge badge--gray">${status}</span>`;
    }
  }

  function renderSlaBadge(dispute) {
    if (['RESOLVED', 'CLOSED'].includes(dispute.status)) return '';
    if (dispute.is_sla_breached) {
      return `<span class="badge badge--rose badge--xs">⚠️ ${t('dispute.sla_breached')}</span>`;
    }
    const hours = Math.round(dispute.remaining_sla_minutes / 60);
    const badgeClass = hours < 6 ? 'badge--rose' : hours < 24 ? 'badge--amber' : 'badge--emerald';
    return `<span class="badge ${badgeClass} badge--xs">⏱️ ${hours}h ${t('dispute.sla_left')}</span>`;
  }

  function render() {
    container.innerHTML = `
      <div class="dispute-panel">
        <!-- Top Workspace Bar -->
        <div class="dispute-panel__header flex items-center justify-between pb-4 border-b">
          <div>
            <h1 class="text-2xl font-bold flex items-center gap-2">
              ⚖️ ${t('dispute.panel_title')}
            </h1>
            <p class="text-sm text-secondary">${t('dispute.panel_subtitle')}</p>
          </div>
          <button class="btn btn--secondary btn--sm" id="btn-refresh-disputes">
            🔄 ${t('common.refresh')}
          </button>
        </div>

        <!-- Filter Tabs -->
        <div class="dispute-panel__tabs flex gap-2 my-4">
          ${['ALL', 'OPEN', 'UNDER_ARBITRATION', 'ESCALATED', 'RESOLVED']
            .map(
              (tab) => `
            <button class="btn btn--sm ${currentTab === tab ? 'btn--primary' : 'btn--ghost'}" data-tab="${tab}">
              ${t(`dispute.tab_${tab.toLowerCase()}`)}
            </button>
          `
            )
            .join('')}
        </div>

        <!-- Two-Column Workspace Layout -->
        <div class="dispute-panel__grid grid grid-cols-12 gap-4">
          <!-- Left Column: Dispute Queue -->
          <div class="col-span-4 dispute-queue-card card p-0 overflow-hidden">
            <div class="p-3 border-b bg-surface-hover font-semibold text-sm flex items-center justify-between">
              <span>${t('dispute.queue_list')} (${disputes.length})</span>
            </div>
            <div class="dispute-queue-list divide-y max-h-[700px] overflow-y-auto">
              ${
                loading
                  ? `<div class="p-8 text-center text-secondary text-sm">${t('common.loading')}...</div>`
                  : disputes.length === 0
                  ? `<div class="p-8 text-center text-secondary text-sm">${t('dispute.no_disputes')}</div>`
                  : disputes
                      .map(
                        (d) => `
                  <div class="dispute-queue-item p-3 cursor-pointer transition hover:bg-surface-hover ${selectedDispute?.id === d.id ? 'bg-surface-selected border-l-4 border-primary' : ''}" data-dispute-id="${d.id}">
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-bold text-sm text-primary">${d.ref}</span>
                      ${renderStatusBadge(d.status)}
                    </div>
                    <div class="text-xs text-secondary mb-1 flex items-center justify-between">
                      <span>Order: #${d.sub_order_ref}</span>
                      <span class="font-semibold text-text">${formatCurrency(d.disputed_amount)}</span>
                    </div>
                    <div class="text-xs text-secondary truncate">
                      👤 ${d.customer_name} ↔️ 🏪 ${d.saler_name || 'Direct'} ↔️ 🏭 ${d.supplier_name}
                    </div>
                    <div class="mt-2 flex items-center justify-between">
                      <span class="text-xs text-tertiary">${formatDate(d.created_at)}</span>
                      ${renderSlaBadge(d)}
                    </div>
                  </div>
                `
                      )
                      .join('')
              }
            </div>
          </div>

          <!-- Right Column: Dispute Detail & Action Panel -->
          <div class="col-span-8 dispute-detail-panel card p-4">
            ${
              detailsLoading
                ? `<div class="p-16 text-center text-secondary">${t('common.loading')}...</div>`
                : !selectedDispute
                ? `<div class="p-16 text-center text-secondary">${t('dispute.select_a_dispute')}</div>`
                : `
                <!-- Dispute Header -->
                <div class="dispute-detail__header flex items-start justify-between pb-4 border-b">
                  <div>
                    <div class="flex items-center gap-2">
                      <h2 class="text-xl font-bold">${selectedDispute.ref}</h2>
                      ${renderStatusBadge(selectedDispute.status)}
                      ${renderSlaBadge(selectedDispute)}
                    </div>
                    <div class="text-xs text-secondary mt-1">
                      Sub-Order: <strong>${selectedDispute.sub_order_ref}</strong> |
                      Disputed: <strong class="text-rose font-semibold">${formatCurrency(selectedDispute.disputed_amount)}</strong> |
                      Reason: <em>${selectedDispute.reason}</em>
                    </div>
                  </div>

                  <!-- Quick Action Buttons -->
                  <div class="flex items-center gap-2">
                    ${
                      !['RESOLVED', 'CLOSED'].includes(selectedDispute.status)
                        ? `
                      <button class="btn btn--danger btn--sm" id="btn-escalate-dispute">
                        🚨 ${t('dispute.btn_escalate')}
                      </button>
                      <button class="btn btn--primary btn--sm" id="btn-open-arbitrate-modal">
                        ⚖️ ${t('dispute.btn_arbitrate')}
                      </button>
                    `
                        : ''
                    }
                  </div>
                </div>

                <!-- Three Parties Summary Cards -->
                <div class="grid grid-cols-3 gap-2 my-3">
                  <div class="p-2 border rounded text-xs bg-surface-subtle">
                    <span class="font-bold block text-blue">👤 ${t('dispute.party_buyer')}</span>
                    <span class="font-medium">${selectedDispute.customer_name}</span>
                  </div>
                  <div class="p-2 border rounded text-xs bg-surface-subtle">
                    <span class="font-bold block text-purple">🏪 ${t('dispute.party_saler')}</span>
                    <span class="font-medium">${selectedDispute.saler_name || t('common.none')}</span>
                  </div>
                  <div class="p-2 border rounded text-xs bg-surface-subtle">
                    <span class="font-bold block text-amber">🏭 ${t('dispute.party_supplier')}</span>
                    <span class="font-medium">${selectedDispute.supplier_name}</span>
                  </div>
                </div>

                <!-- Sub-Navigation Tabs for Detail Panel -->
                <div class="flex gap-2 border-b pb-2 mb-3">
                  <button class="btn btn--xs ${activeView === 'CHAT' ? 'btn--primary' : 'btn--ghost'}" id="tab-view-chat">
                    💬 ${t('dispute.view_chat')} (${selectedDispute.messages?.length || 0})
                  </button>
                  <button class="btn btn--xs ${activeView === 'TIMELINE' ? 'btn--primary' : 'btn--ghost'}" id="tab-view-timeline">
                    📜 ${t('dispute.view_timeline')}
                  </button>
                  <button class="btn btn--xs ${activeView === 'PRECEDENTS' ? 'btn--primary' : 'btn--ghost'}" id="tab-view-precedents">
                    🔍 ${t('dispute.view_precedents')} (${precedents.length})
                  </button>
                </div>

                <!-- View Container -->
                <div class="dispute-view-outlet min-h-[420px]">
                  ${
                    activeView === 'TIMELINE'
                      ? `<div class="timeline-container"></div>`
                      : activeView === 'PRECEDENTS'
                      ? `
                        <div class="precedents-list space-y-3">
                          <h4 class="text-sm font-bold">${t('dispute.similar_past_cases')}</h4>
                          ${
                            precedents.length === 0
                              ? `<p class="text-xs text-secondary">${t('dispute.no_precedents_found')}</p>`
                              : precedents
                                  .map(
                                    (p) => `
                              <div class="p-3 border rounded text-xs bg-surface-subtle">
                                <div class="flex justify-between font-bold mb-1">
                                  <span>${p.ref} (${p.reason})</span>
                                  <span class="text-primary">${p.outcome}</span>
                                </div>
                                <div class="text-secondary mb-1">Amount: ${formatCurrency(p.disputed_amount)} | Resolved: ${formatDate(p.resolved_at)}</div>
                                <div class="text-tertiary">Notes: ${p.resolution_notes || 'N/A'}</div>
                              </div>
                            `
                                  )
                                  .join('')
                          }
                        </div>
                      `
                      : `
                        <!-- Chat View with Internal Note Toggle -->
                        <div class="dispute-chat flex flex-col h-[420px]">
                          <div class="dispute-chat__messages flex-1 overflow-y-auto space-y-3 p-2 border rounded bg-surface-subtle" id="chat-messages-container">
                            ${
                              selectedDispute.messages?.length === 0
                                ? `<p class="text-center text-xs text-secondary mt-8">${t('dispute.no_messages')}</p>`
                                : selectedDispute.messages
                                    .map(
                                      (m) => `
                              <div class="chat-bubble p-2 rounded max-w-[85%] text-xs ${
                                m.is_internal_note
                                  ? 'bg-rose-subtle border border-rose text-rose-dark ml-auto'
                                  : m.sender_role === 'MODERATOR'
                                  ? 'bg-primary-subtle text-primary border ml-auto'
                                  : 'bg-surface text-text border mr-auto'
                              }">
                                <div class="flex items-center justify-between gap-4 font-semibold mb-1">
                                  <span>${m.sender_name} (${m.sender_role})</span>
                                  <span class="text-[10px] text-secondary">${formatDate(m.created_at)}</span>
                                </div>
                                <div class="chat-bubble__body">${m.body}</div>
                                ${
                                  m.is_internal_note
                                    ? `<span class="badge badge--rose badge--xs mt-1">🔒 ${t('dispute.internal_note')}</span>`
                                    : ''
                                }
                              </div>
                            `
                                    )
                                    .join('')
                            }
                          </div>

                          <!-- Message Input -->
                          ${
                            !['RESOLVED', 'CLOSED'].includes(selectedDispute.status)
                              ? `
                            <div class="dispute-chat__input mt-3 flex flex-col gap-2">
                              <div class="flex items-center justify-between text-xs">
                                <label class="flex items-center gap-1 cursor-pointer">
                                  <input type="checkbox" id="chk-internal-note" ${isInternalNote ? 'checked' : ''}/>
                                  <span class="text-rose font-medium">🔒 ${t('dispute.toggle_internal_note')}</span>
                                </label>
                              </div>
                              <div class="flex gap-2">
                                <textarea id="txt-dispute-message" class="form-textarea flex-1 text-xs" rows="2" placeholder="${t('dispute.placeholder_message')}"></textarea>
                                <button class="btn btn--primary btn--sm px-4" id="btn-send-message">
                                  ${t('common.send')}
                                </button>
                              </div>
                            </div>
                          `
                              : `<div class="p-2 text-center text-xs text-secondary bg-surface-subtle mt-2 rounded">${t('dispute.thread_resolved')}</div>`
                          }
                        </div>
                      `
                  }
                </div>
              `
            }
          </div>
        </div>
      </div>
    `;

    // Mount EvidenceTimeline if active view is TIMELINE
    if (activeView === 'TIMELINE' && selectedDispute && timelineData) {
      const outlet = container.querySelector('.timeline-container');
      if (outlet) {
        outlet.appendChild(
          EvidenceTimeline({
            timeline: timelineData.timeline || [],
            disputeRef: selectedDispute.ref,
          })
        );
      }
    }

    attachListeners();
  }

  function openArbitrationModal() {
    if (!selectedDispute) return;
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop';

    const totalAmount = parseFloat(selectedDispute.disputed_amount);

    modalBackdrop.innerHTML = `
      <div class="modal-dialog card max-w-lg p-6 animate-scale-in">
        <h3 class="text-lg font-bold mb-2">⚖️ ${t('dispute.arbitrate_modal_title')} (${selectedDispute.ref})</h3>
        <p class="text-xs text-secondary mb-4">${t('dispute.arbitrate_modal_desc')}</p>

        <div class="space-y-4 text-xs">
          <div>
            <label class="font-semibold block mb-1">${t('dispute.select_outcome')}</label>
            <select id="sel-outcome" class="form-select w-full">
              <option value="FULL_REFUND">Full Refund (100% to Customer)</option>
              <option value="PARTIAL_REFUND">Partial Refund (Split Amount)</option>
              <option value="SPLIT_LIABILITY">Split Liability (Multi-party settlement)</option>
              <option value="REPLACEMENT">Replacement Authorized</option>
              <option value="REJECTED">Reject Dispute (Claim Denied)</option>
            </select>
          </div>

          <div id="split-inputs-group" class="p-3 border rounded bg-surface-subtle space-y-2">
            <div class="flex justify-between items-center">
              <label>Customer Refund (BDT):</label>
              <input type="number" id="num-buyer-refund" class="form-input w-28 text-right" value="${totalAmount}" max="${totalAmount}"/>
            </div>
            <div class="flex justify-between items-center">
              <label>Supplier Clawback (BDT):</label>
              <input type="number" id="num-supplier-clawback" class="form-input w-28 text-right" value="${totalAmount}" max="${totalAmount}"/>
            </div>
            <div class="flex justify-between items-center">
              <label>Saler Clawback (BDT):</label>
              <input type="number" id="num-saler-clawback" class="form-input w-28 text-right" value="0" max="${totalAmount}"/>
            </div>
          </div>

          <div>
            <label class="font-semibold block mb-1">${t('dispute.resolution_notes')}</label>
            <textarea id="txt-resolution-notes" class="form-textarea w-full" rows="3" placeholder="${t('dispute.resolution_notes_placeholder')}"></textarea>
          </div>

          ${
            totalAmount > 5000
              ? `<div class="p-2 border border-purple rounded bg-purple-subtle text-purple text-xs">
                  ℹ️ ${t('dispute.maker_checker_notice')}
                </div>`
              : ''
          }
        </div>

        <div class="flex justify-end gap-2 mt-6">
          <button class="btn btn--secondary btn--sm" id="btn-cancel-modal">${t('common.cancel')}</button>
          <button class="btn btn--primary btn--sm" id="btn-submit-arbitration">${t('dispute.confirm_decision')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    modalBackdrop.querySelector('#btn-cancel-modal').addEventListener('click', () => modalBackdrop.remove());

    modalBackdrop.querySelector('#sel-outcome').addEventListener('change', (e) => {
      const outcome = e.target.value;
      const splitGroup = modalBackdrop.querySelector('#split-inputs-group');
      const buyerInput = modalBackdrop.querySelector('#num-buyer-refund');
      const suppInput = modalBackdrop.querySelector('#num-supplier-clawback');
      const salerInput = modalBackdrop.querySelector('#num-saler-clawback');

      if (outcome === 'FULL_REFUND') {
        buyerInput.value = totalAmount;
        suppInput.value = totalAmount;
        salerInput.value = 0;
      } else if (outcome === 'PARTIAL_REFUND') {
        buyerInput.value = (totalAmount * 0.5).toFixed(2);
        suppInput.value = (totalAmount * 0.5).toFixed(2);
        salerInput.value = 0;
      } else if (outcome === 'REJECTED' || outcome === 'REPLACEMENT') {
        buyerInput.value = 0;
        suppInput.value = 0;
        salerInput.value = 0;
      }
    });

    modalBackdrop.querySelector('#btn-submit-arbitration').addEventListener('click', async () => {
      const outcome = modalBackdrop.querySelector('#sel-outcome').value;
      const notes = modalBackdrop.querySelector('#txt-resolution-notes').value;
      const buyerRefund = parseFloat(modalBackdrop.querySelector('#num-buyer-refund').value) || 0;
      const suppClawback = parseFloat(modalBackdrop.querySelector('#num-supplier-clawback').value) || 0;
      const salerClawback = parseFloat(modalBackdrop.querySelector('#num-saler-clawback').value) || 0;

      modalBackdrop.remove();
      await handleArbitrate({
        outcome,
        outcomeSplit: {
          buyer_refund: buyerRefund,
          supplier_clawback: suppClawback,
          saler_clawback: salerClawback,
        },
        resolutionNotes: notes,
      });
    });
  }

  function attachListeners() {
    container.querySelector('#btn-refresh-disputes')?.addEventListener('click', fetchDisputes);

    container.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentTab = btn.getAttribute('data-tab');
        fetchDisputes();
      });
    });

    container.querySelectorAll('[data-dispute-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = parseInt(el.getAttribute('data-dispute-id'), 10);
        selectDispute(id);
      });
    });

    container.querySelector('#tab-view-chat')?.addEventListener('click', () => {
      activeView = 'CHAT';
      render();
    });

    container.querySelector('#tab-view-timeline')?.addEventListener('click', () => {
      activeView = 'TIMELINE';
      render();
    });

    container.querySelector('#tab-view-precedents')?.addEventListener('click', () => {
      activeView = 'PRECEDENTS';
      render();
    });

    container.querySelector('#chk-internal-note')?.addEventListener('change', (e) => {
      isInternalNote = e.target.checked;
    });

    container.querySelector('#btn-send-message')?.addEventListener('click', () => {
      const txt = container.querySelector('#txt-dispute-message');
      if (txt && txt.value.trim().length > 0) {
        handleSendMessage(txt.value.trim());
      }
    });

    container.querySelector('#btn-open-arbitrate-modal')?.addEventListener('click', openArbitrationModal);
    container.querySelector('#btn-escalate-dispute')?.addEventListener('click', handleEscalate);
  }

  fetchDisputes();
  return container;
}
