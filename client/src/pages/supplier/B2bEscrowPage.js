/**
 * B2bEscrowPage.js — Wholesale B2B Escrow & Milestone Settlement Studio (Prompt 10.6).
 *
 * Implements /supplier/b2b-escrow and /saler/b2b-escrow:
 * - Multi-stage milestone tracking and release manager.
 * - Mutual cryptographic terms agreement signoff.
 * - Evidence upload drawer & validation.
 * - 1-Click Signed Contract PDF generation and download.
 * - Dispute arbitration trigger with milestone freezing.
 */

import {
  listB2bDeals,
  getB2bDeal,
  createB2bDeal,
  acceptB2bDeal,
  submitMilestoneEvidence,
  releaseMilestone,
  raiseB2bDispute,
  refundMilestone,
  getContractPdfUrl,
} from '../../services/b2bEscrow.api.js';

import { createMilestoneProgressStepper } from '../../components/b2b/MilestoneProgressStepper.js';
import { Card } from '../../components/ui/Card.js';
import { Button } from '../../components/ui/Button.js';
import { Tabs } from '../../components/ui/Tabs.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { Modal } from '../../components/ui/Modal.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatCurrency } from '../../services/format.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';

export default function B2bEscrowPage(root, ctx = {}) {
  const container = document.createElement('div');
  container.className = 'b2b-escrow-page p-4 md:p-6 max-w-7xl mx-auto space-y-6';

  let activeTab = 'deals';
  let deals = [];
  let currentUserId = ctx.user?.id || 6;
  let currentUserRole = ctx.user?.role || 'supplier';
  let activeEvidenceModal = null;
  let activeDisputeModal = null;

  // 1. Module Gating Check
  if (!isFeatureEnabled('b2b_escrow')) {
    container.append(
      EmptyState({
        title: t('b2b_escrow.module_disabled_title'),
        description: t('b2b_escrow.module_disabled_desc'),
      })
    );
    root.append(container);
    return () => {
      container.remove();
    };
  }

  // 2. Page Header
  const header = document.createElement('div');
  header.className = 'page-header flex-between flex-wrap gap-4 border-b pb-4';
  header.innerHTML = `
    <div>
      <div class="flex items-center gap-2">
        <span class="text-2xl">🤝</span>
        <h2 class="text-2xl font-bold tracking-tight m-0">${t('b2b_escrow.page_title')}</h2>
      </div>
      <p class="text-sm text-muted m-0 mt-1">${t('b2b_escrow.page_subtitle')}</p>
    </div>
  `;

  const newDealBtn = Button({
    label: `+ ${t('b2b_escrow.new_proposal_btn')}`,
    variant: 'primary',
    onClick: () => {
      activeTab = 'new_proposal';
      renderCurrentTab();
    },
  });
  header.append(newDealBtn);
  container.append(header);

  // 3. KPI Metrics Summary Row
  const metricsRow = document.createElement('div');
  metricsRow.className = 'grid grid-cols-2 md:grid-cols-4 gap-4';
  container.append(metricsRow);

  // 4. Tab Navigation
  const tabNav = document.createElement('div');
  tabNav.className = 'tabs-navigation border-b';
  container.append(tabNav);

  const contentArea = document.createElement('div');
  contentArea.className = 'tab-content-area space-y-6';
  container.append(contentArea);

  async function loadDeals() {
    try {
      const res = await listB2bDeals();
      deals = res?.data || res || [];
      renderMetrics();
    } catch {
      deals = [];
    }
  }

  function renderMetrics() {
    const totalDeals = deals.length;
    const totalEscrow = deals.reduce((acc, d) => acc + (parseFloat(d.total_amount) || 0), 0);
    const totalReleased = deals.reduce((acc, d) => acc + (parseFloat(d.released_amount) || 0), 0);
    const totalDisputed = deals.filter((d) => d.status === 'DISPUTED').length;

    metricsRow.innerHTML = `
      <div class="card p-3 border rounded bg-surface">
        <span class="text-xs text-muted block uppercase">${t('b2b_escrow.metric_active_contracts')}</span>
        <span class="text-xl font-bold font-mono">${totalDeals}</span>
      </div>
      <div class="card p-3 border rounded bg-surface">
        <span class="text-xs text-muted block uppercase">${t('b2b_escrow.metric_total_escrow')}</span>
        <span class="text-xl font-bold font-mono text-primary">${formatCurrency(totalEscrow)}</span>
      </div>
      <div class="card p-3 border rounded bg-success-soft">
        <span class="text-xs text-muted block uppercase">${t('b2b_escrow.metric_total_released')}</span>
        <span class="text-xl font-bold font-mono text-success">${formatCurrency(totalReleased)}</span>
      </div>
      <div class="card p-3 border rounded ${totalDisputed > 0 ? 'bg-danger-soft' : 'bg-surface'}">
        <span class="text-xs text-muted block uppercase">${t('b2b_escrow.metric_in_dispute')}</span>
        <span class="text-xl font-bold font-mono ${totalDisputed > 0 ? 'text-danger' : ''}">${totalDisputed}</span>
      </div>
    `;
  }

  function renderTabNav() {
    tabNav.innerHTML = `
      <div class="flex gap-4">
        <button class="tab-btn py-2 px-1 text-sm font-semibold border-b-2 ${activeTab === 'deals' ? 'border-primary text-primary' : 'border-transparent text-muted'}" data-tab="deals">
          📋 ${t('b2b_escrow.tab_deals')} (${deals.length})
        </button>
        <button class="tab-btn py-2 px-1 text-sm font-semibold border-b-2 ${activeTab === 'new_proposal' ? 'border-primary text-primary' : 'border-transparent text-muted'}" data-tab="new_proposal">
          📝 ${t('b2b_escrow.tab_new_proposal')}
        </button>
      </div>
    `;

    tabNav.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        renderTabNav();
        renderCurrentTab();
      });
    });
  }

  function renderCurrentTab() {
    contentArea.innerHTML = '';
    renderTabNav();

    if (activeTab === 'deals') {
      renderDealsTab();
    } else {
      renderNewProposalTab();
    }
  }

  // -------------------------------------------------------------
  // DEALS TAB
  // -------------------------------------------------------------
  function renderDealsTab() {
    if (deals.length === 0) {
      contentArea.append(
        EmptyState({
          title: t('b2b_escrow.no_deals_title'),
          description: t('b2b_escrow.no_deals_desc'),
        })
      );
      return;
    }

    const listContainer = document.createElement('div');
    listContainer.className = 'space-y-6';

    deals.forEach((deal) => {
      const isBuyer = Number(deal.buyer_id) === Number(currentUserId);
      const isSupplier = Number(deal.supplier_id) === Number(currentUserId);
      const isPendingSign = !deal.buyer_signed_at || !deal.supplier_signed_at;
      const isDisputed = deal.status === 'DISPUTED';
      const lang = getLanguage();
      const title = lang === 'bn' ? deal.title_bn : deal.title_en;

      const dealCard = document.createElement('div');
      dealCard.className = `card p-5 border rounded bg-surface shadow-sm space-y-4 ${isDisputed ? 'border-danger' : ''}`;

      dealCard.innerHTML = `
        <div class="flex-between flex-wrap gap-3 border-b pb-3">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="badge badge-primary font-mono text-xs font-bold">${deal.ref}</span>
              <span class="badge ${deal.status === 'COMPLETED' ? 'badge-success' : deal.status === 'DISPUTED' ? 'badge-danger' : 'badge-neutral'} text-xs font-mono">
                ${deal.status}
              </span>
              ${deal.agreed_terms_hash ? `
                <span class="badge badge-neutral text-xs font-mono text-muted" title="${deal.agreed_terms_hash}">
                  🔒 SHA-256: ${deal.agreed_terms_hash.substring(0, 8)}...
                </span>
              ` : ''}
            </div>
            <h3 class="text-lg font-bold mt-1 mb-0">${title}</h3>
            <div class="text-xs text-muted mt-1 flex gap-4 flex-wrap">
              <span>🛒 Buyer: <b>${deal.buyer_name || `User #${deal.buyer_id}`}</b></span>
              <span>🏭 Supplier: <b>${deal.supplier_name || `User #${deal.supplier_id}`}</b></span>
            </div>
          </div>

          <div class="text-right">
            <span class="text-xs text-muted block uppercase">${t('b2b_escrow.total_deal_value')}</span>
            <span class="text-2xl font-bold font-mono text-primary">${formatCurrency(deal.total_amount)}</span>
          </div>
        </div>

        <!-- Staged Milestone Stepper Container -->
        <div class="milestones-mount-point" id="milestones-${deal.id}"></div>

        <!-- Footer Actions Bar -->
        <div class="pt-3 border-t flex-between flex-wrap gap-2 text-xs">
          <div class="flex items-center gap-2">
            <a href="${getContractPdfUrl(deal.id)}" target="_blank" download="contract-${deal.ref}.pdf" class="btn btn-sm btn-secondary text-xs inline-flex items-center gap-1">
              📄 ${t('b2b_escrow.download_pdf')}
            </a>
            ${deal.contract_terms_json ? `
              <button class="view-terms-btn text-muted hover:underline" data-id="${deal.id}">
                📜 ${t('b2b_escrow.view_terms')}
              </button>
            ` : ''}
          </div>

          <div class="flex items-center gap-2">
            ${isPendingSign && ((isBuyer && !deal.buyer_signed_at) || (isSupplier && !deal.supplier_signed_at)) ? `
              <button class="sign-terms-btn btn btn-sm btn-success font-bold text-xs" data-id="${deal.id}">
                ✍️ ${t('b2b_escrow.sign_and_accept')}
              </button>
            ` : ''}

            ${!isDisputed && deal.status === 'IN_PROGRESS' ? `
              <button class="dispute-deal-btn btn btn-sm btn-ghost text-danger text-xs" data-id="${deal.id}">
                ⚠️ ${t('b2b_escrow.raise_dispute')}
              </button>
            ` : ''}
          </div>
        </div>
      `;

      // Mount MilestoneProgressStepper
      const stepper = createMilestoneProgressStepper({
        milestones: deal.milestones || [],
        dealStatus: deal.status,
        userRole: currentUserRole,
        isBuyer,
        isAdmin: currentUserRole === 'admin' || currentUserRole === 'super_admin',
        onEvidenceClick: (milestone) => openEvidenceModal(deal, milestone),
        onReleaseClick: (milestone) => handleReleaseMilestone(deal, milestone),
        onRefundClick: (milestone) => handleRefundMilestone(deal, milestone),
      });

      dealCard.querySelector(`#milestones-${deal.id}`)?.append(stepper.element);

      // Listeners
      dealCard.querySelector('.sign-terms-btn')?.addEventListener('click', async () => {
        try {
          await acceptB2bDeal(deal.id);
          toast.success(t('b2b_escrow.signed_success'));
          await loadDeals();
          renderCurrentTab();
        } catch (err) {
          toast.error(err?.message || t('b2b_escrow.sign_failed'));
        }
      });

      dealCard.querySelector('.dispute-deal-btn')?.addEventListener('click', () => {
        openDisputeModal(deal);
      });

      dealCard.querySelector('.view-terms-btn')?.addEventListener('click', () => {
        const terms = deal.contract_terms_json || {};
        alert(`Contract Terms & Quality Specs:\n\nDelivery Days: ${terms.delivery_days || 30}\nInspection Window: ${terms.inspection_period_hours || 48}h\nQuality Specs: ${terms.quality_specs || 'Standard'}\n\nAgreed SHA-256 Hash:\n${deal.agreed_terms_hash}`);
      });

      listContainer.append(dealCard);
    });

    contentArea.append(listContainer);
  }

  // -------------------------------------------------------------
  // NEW PROPOSAL TAB
  // -------------------------------------------------------------
  function renderNewProposalTab() {
    const proposalCard = document.createElement('div');
    proposalCard.className = 'card p-6 border rounded bg-surface space-y-6 max-w-3xl';

    proposalCard.innerHTML = `
      <h3 class="text-xl font-bold m-0 border-b pb-3">${t('b2b_escrow.new_proposal_heading')}</h3>

      <div class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold uppercase text-muted mb-1">${t('b2b_escrow.deal_title_en')}</label>
            <input type="text" id="deal-title-en" class="input w-full" placeholder="e.g. Bulk 1,000 Pcs Export Cotton Shirts Batch">
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase text-muted mb-1">${t('b2b_escrow.deal_title_bn')}</label>
            <input type="text" id="deal-title-bn" class="input w-full" placeholder="উদাঃ ১,০০০ পিস রপ্তানি সুতি শার্ট পাইকারি লট">
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold uppercase text-muted mb-1">${t('b2b_escrow.supplier_id_label')}</label>
            <input type="number" id="deal-supplier-id" class="input w-full font-mono" value="5">
          </div>
          <div>
            <label class="block text-xs font-semibold uppercase text-muted mb-1">${t('b2b_escrow.total_amount_label')}</label>
            <input type="number" id="deal-total-amount" class="input w-full font-mono font-bold" value="500000" step="1000">
          </div>
        </div>

        <div class="border-t pt-4">
          <h4 class="text-sm font-bold uppercase tracking-wider text-muted mb-2">${t('b2b_escrow.milestone_template_heading')}</h4>
          <div class="space-y-2" id="milestones-template-editor">
            <div class="p-3 border rounded bg-surface-subtle flex-between text-xs font-mono">
              <span>Phase 1 (30%): Order Confirmation & Material Sourcing</span>
              <span class="badge badge-neutral">NONE</span>
            </div>
            <div class="p-3 border rounded bg-surface-subtle flex-between text-xs font-mono">
              <span>Phase 2 (40%): Factory Dispatch & Bill of Lading</span>
              <span class="badge badge-primary">DISPATCH_PROOF</span>
            </div>
            <div class="p-3 border rounded bg-surface-subtle flex-between text-xs font-mono">
              <span>Phase 3 (30%): Central Warehouse Quality Inspection</span>
              <span class="badge badge-success">INSPECTION</span>
            </div>
          </div>
        </div>

        <div class="border-t pt-4 flex justify-end gap-3">
          <button class="btn btn-secondary text-sm" id="cancel-proposal-btn">${t('common.cancel')}</button>
          <button class="btn btn-primary text-sm font-bold" id="submit-proposal-btn">${t('b2b_escrow.create_proposal_btn')}</button>
        </div>
      </div>
    `;

    proposalCard.querySelector('#cancel-proposal-btn')?.addEventListener('click', () => {
      activeTab = 'deals';
      renderCurrentTab();
    });

    proposalCard.querySelector('#submit-proposal-btn')?.addEventListener('click', async () => {
      const titleEn = proposalCard.querySelector('#deal-title-en')?.value?.trim();
      const titleBn = proposalCard.querySelector('#deal-title-bn')?.value?.trim();
      const supplierId = parseInt(proposalCard.querySelector('#deal-supplier-id')?.value, 10);
      const totalAmount = parseFloat(proposalCard.querySelector('#deal-total-amount')?.value);

      if (!titleEn || !titleBn) {
        toast.error(t('b2b_escrow.error_titles_required'));
        return;
      }
      if (!totalAmount || totalAmount <= 0) {
        toast.error(t('b2b_escrow.error_amount_required'));
        return;
      }

      try {
        await createB2bDeal({
          title_en: titleEn,
          title_bn: titleBn,
          supplier_id: supplierId,
          total_amount: totalAmount,
          contract_terms: {
            delivery_days: 21,
            inspection_period_hours: 48,
            quality_specs: 'Commercial Grade Wholesale A1',
          },
          milestones: [
            { sequence_no: 1, release_pct: 30.0, evidence_required: 'NONE', label_en: 'Order Confirmation & Sourcing', label_bn: 'অর্ডার নিশ্চিতকরণ ও সোর্সিং' },
            { sequence_no: 2, release_pct: 40.0, evidence_required: 'DISPATCH_PROOF', label_en: 'Factory Dispatch & Challan', label_bn: 'কারখানা থেকে প্রেরণ ও চালান' },
            { sequence_no: 3, release_pct: 30.0, evidence_required: 'INSPECTION', label_en: 'Quality Inspection & Final Acceptance', label_bn: 'গুণমান পরিদর্শন ও গ্রহণ' },
          ],
        });

        toast.success(t('b2b_escrow.proposal_created_success'));
        await loadDeals();
        activeTab = 'deals';
        renderCurrentTab();
      } catch (err) {
        toast.error(err?.message || t('b2b_escrow.proposal_create_failed'));
      }
    });

    contentArea.append(proposalCard);
  }

  // -------------------------------------------------------------
  // ACTIONS: EVIDENCE MODAL & RELEASE
  // -------------------------------------------------------------
  function openEvidenceModal(deal, milestone) {
    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4 p-2';

    modalContent.innerHTML = `
      <p class="text-xs text-muted m-0">
        Milestone: <b>${milestone.label_en}</b> (${milestone.release_pct}% · ${formatCurrency(milestone.amount)})
      </p>

      <div>
        <label class="block text-xs font-semibold text-muted mb-1">${t('b2b_escrow.evidence_type_label')}</label>
        <select id="evidence-type-select" class="input w-full">
          <option value="DISPATCH_PROOF">DISPATCH_PROOF (Challan / Bill of Lading)</option>
          <option value="DELIVERY_PROOF">DELIVERY_PROOF (Courier Signed Receipt)</option>
          <option value="INSPECTION">INSPECTION (Quality Lab / Inspection Certificate)</option>
        </select>
      </div>

      <div>
        <label class="block text-xs font-semibold text-muted mb-1">${t('b2b_escrow.evidence_url_label')}</label>
        <input type="text" id="evidence-url-input" class="input w-full font-mono text-xs" placeholder="https://cdn.explooro.com/proofs/challan-9921.pdf" value="/placeholder-challan.pdf">
      </div>

      <div>
        <label class="block text-xs font-semibold text-muted mb-1">${t('b2b_escrow.evidence_notes_label')}</label>
        <textarea id="evidence-notes-input" class="input w-full text-xs" rows="3" placeholder="Dispatched via truck #DH-8812 with QA inspector signoff..."></textarea>
      </div>
    `;

    const modal = Modal({
      title: `📤 ${t('b2b_escrow.submit_evidence_modal_title')}`,
      body: modalContent,
      confirmLabel: t('common.submit'),
      onConfirm: async () => {
        const evidenceType = modalContent.querySelector('#evidence-type-select')?.value;
        const url = modalContent.querySelector('#evidence-url-input')?.value?.trim();
        const notes = modalContent.querySelector('#evidence-notes-input')?.value?.trim();

        try {
          await submitMilestoneEvidence(milestone.id, {
            evidence_type: evidenceType,
            media_urls: url ? [url] : [],
            notes,
          });
          toast.success(t('b2b_escrow.evidence_submitted_success'));
          modal.close();
          await loadDeals();
          renderCurrentTab();
        } catch (err) {
          toast.error(err?.message || t('b2b_escrow.evidence_submit_failed'));
        }
      },
    });

    document.body.append(modal.element);
    modal.open();
  }

  async function handleReleaseMilestone(deal, milestone) {
    if (!confirm(t('b2b_escrow.confirm_release', { amount: formatCurrency(milestone.amount) }))) return;

    try {
      const res = await releaseMilestone(milestone.id);
      if (res?.data?.is_pending_maker_checker) {
        toast.info(res.data.message || t('b2b_escrow.maker_checker_queued'));
      } else {
        toast.success(t('b2b_escrow.released_success'));
      }
      await loadDeals();
      renderCurrentTab();
    } catch (err) {
      toast.error(err?.message || t('b2b_escrow.release_failed'));
    }
  }

  async function handleRefundMilestone(deal, milestone) {
    const reason = prompt(t('b2b_escrow.prompt_refund_reason'));
    if (!reason) return;

    try {
      await refundMilestone(milestone.id, { reason });
      toast.success(t('b2b_escrow.refunded_success'));
      await loadDeals();
      renderCurrentTab();
    } catch (err) {
      toast.error(err?.message || t('b2b_escrow.refund_failed'));
    }
  }

  function openDisputeModal(deal) {
    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4 p-2';

    modalContent.innerHTML = `
      <div class="card p-3 border rounded bg-danger-soft text-xs text-danger">
        ⚠️ <b>Freeze Warning:</b> Raising a dispute will immediately freeze all remaining unreleased milestones in this deal and route to the Arbitration Workspace.
      </div>

      <div>
        <label class="block text-xs font-semibold text-muted mb-1">Dispute Reason (English)</label>
        <input type="text" id="dispute-reason-en" class="input w-full" placeholder="e.g. Quality inspection failed; fabric weight below specification">
      </div>

      <div>
        <label class="block text-xs font-semibold text-muted mb-1">Dispute Reason (Bengali)</label>
        <input type="text" id="dispute-reason-bn" class="input w-full" placeholder="উদাঃ গুণমান পরিদর্শন ব্যর্থ; কাপড়ের স্পেসিফিকেশন সঠিক নয়">
      </div>
    `;

    const modal = Modal({
      title: `⚠️ ${t('b2b_escrow.raise_dispute_modal_title')}`,
      body: modalContent,
      confirmLabel: t('b2b_escrow.confirm_dispute_btn'),
      confirmVariant: 'danger',
      onConfirm: async () => {
        const reasonEn = modalContent.querySelector('#dispute-reason-en')?.value?.trim();
        const reasonBn = modalContent.querySelector('#dispute-reason-bn')?.value?.trim();

        if (!reasonEn) {
          toast.error('Please enter a dispute reason.');
          return;
        }

        try {
          await raiseB2bDispute(deal.id, {
            reason_en: reasonEn,
            reason_bn: reasonBn || reasonEn,
          });
          toast.success(t('b2b_escrow.dispute_raised_success'));
          modal.close();
          await loadDeals();
          renderCurrentTab();
        } catch (err) {
          toast.error(err?.message || t('b2b_escrow.dispute_failed'));
        }
      },
    });

    document.body.append(modal.element);
    modal.open();
  }

  // Initial Load
  loadDeals().then(() => {
    renderCurrentTab();
  });

  root.append(container);

  return () => {
    container.remove();
  };
}
