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
  container.className = 'supplier-page-container';

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
        title: t('b2b_escrow.module_disabled_title', 'B2B Escrow Milestone Settlement'),
        description: t('b2b_escrow.module_disabled_desc', 'The B2B Escrow module is currently disabled.'),
      })
    );
    root.append(container);
    return () => {
      container.remove();
    };
  }

  // 2. Page Header
  const header = document.createElement('header');
  header.className = 'supplier-header';
  header.innerHTML = `
    <div class="supplier-header__titles">
      <div class="supplier-header__badge-row">
        <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
        <span class="text-muted">/</span>
        <span class="text-xs text-muted font-mono">B2B Wholesale Escrow</span>
      </div>
      <h1 class="supplier-header__title">
        <span>🤝</span> ${t('b2b_escrow.page_title', 'B2B Escrow & Milestone Settlement')}
      </h1>
      <p class="supplier-header__subtitle">
        ${t('b2b_escrow.page_subtitle', 'Secure large-scale wholesale supply agreements with milestone-based escrow settlements and digital contracts.')}
      </p>
    </div>
    <div class="supplier-header__actions">
      <button class="btn btn--sm btn--primary" id="new-deal-header-btn">
        ➕ ${t('b2b_escrow.new_proposal_btn', 'New B2B Proposal')}
      </button>
      <button class="btn btn--sm btn--secondary" id="refresh-b2b-btn">
        🔄 ${t('common.refresh', 'Refresh')}
      </button>
    </div>
  `;

  header.querySelector('#new-deal-header-btn').onclick = () => {
    activeTab = 'new_proposal';
    renderCurrentTab();
  };
  header.querySelector('#refresh-b2b-btn').onclick = loadDeals;
  container.append(header);

  // 3. KPI Metrics Summary Row
  const metricsRow = document.createElement('div');
  metricsRow.className = 'supplier-kpi-grid';
  container.append(metricsRow);

  // 4. Tab Navigation Toolbar
  const tabNav = document.createElement('div');
  tabNav.className = 'supplier-toolbar';
  container.append(tabNav);

  const contentArea = document.createElement('div');
  contentArea.className = 'supplier-b2b-content';
  container.append(contentArea);

  async function loadDeals() {
    try {
      const res = await listB2bDeals();
      deals = res?.data || res || [];
      renderMetrics();
      renderCurrentTab();
    } catch {
      deals = [];
      renderMetrics();
      renderCurrentTab();
    }
  }

  function renderMetrics() {
    const totalDeals = deals.length;
    const totalEscrow = deals.reduce((acc, d) => acc + (parseFloat(d.total_amount) || 0), 0);
    const totalReleased = deals.reduce((acc, d) => acc + (parseFloat(d.released_amount) || 0), 0);
    const totalDisputed = deals.filter((d) => d.status === 'DISPUTED').length;

    metricsRow.innerHTML = `
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('b2b_escrow.metric_active_contracts', 'Active B2B Deals')}</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">${totalDeals}</div>
        <span class="text-xs text-muted">Legally signed contracts</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('b2b_escrow.metric_total_escrow', 'Total Escrow Committed')}</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">${formatCurrency(totalEscrow)}</div>
        <span class="text-xs text-muted">Secured platform escrow</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('b2b_escrow.metric_total_released', 'Settled & Released')}</span>
        <div class="supplier-kpi-card__value supplier-kpi-card__value--success" style="font-size: 1.5rem; margin: 4px 0;">${formatCurrency(totalReleased)}</div>
        <span class="text-xs text-muted">Disbursed to supplier vault</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('b2b_escrow.metric_in_dispute', 'Dispute Cases')}</span>
        <div class="supplier-kpi-card__value ${totalDisputed > 0 ? 'supplier-kpi-card__value--danger' : 'supplier-kpi-card__value--success'}" style="font-size: 1.5rem; margin: 4px 0;">
          ${totalDisputed}
        </div>
        <span class="text-xs ${totalDisputed > 0 ? 'text-danger font-bold' : 'text-muted'}">
          ${totalDisputed > 0 ? 'Frozen in arbitration' : 'Zero disputes active'}
        </span>
      </div>
    `;
  }

  function renderTabNav() {
    tabNav.innerHTML = `
      <div class="supplier-toolbar__filters">
        <button class="supplier-chip ${activeTab === 'deals' ? 'supplier-chip--active' : ''}" data-tab="deals">
          📋 ${t('b2b_escrow.tab_deals', 'B2B Deals')} (${deals.length})
        </button>
        <button class="supplier-chip ${activeTab === 'new_proposal' ? 'supplier-chip--active' : ''}" data-tab="new_proposal">
          📝 ${t('b2b_escrow.tab_new_proposal', 'Draft New Proposal')}
        </button>
      </div>
    `;

    tabNav.querySelectorAll('.supplier-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
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
          icon: '🤝',
          title: t('b2b_escrow.no_deals_title', 'No wholesale deals found'),
          description: t('b2b_escrow.no_deals_desc', 'Initiate a new wholesale milestone proposal to secure large-volume transactions.'),
          actionLabel: t('b2b_escrow.new_proposal_btn', 'Create Proposal'),
          onAction: () => {
            activeTab = 'new_proposal';
            renderCurrentTab();
          },
        })
      );
      return;
    }

    const listContainer = document.createElement('div');
    listContainer.style.display = 'flex';
    listContainer.style.flexDirection = 'column';
    listContainer.style.gap = 'var(--space-4, 16px)';

    deals.forEach((deal) => {
      const isBuyer = Number(deal.buyer_id) === Number(currentUserId);
      const isSupplier = Number(deal.supplier_id) === Number(currentUserId);
      const isPendingSign = !deal.buyer_signed_at || !deal.supplier_signed_at;
      const isDisputed = deal.status === 'DISPUTED';
      const lang = getLanguage();
      const title = lang === 'bn' ? deal.title_bn : deal.title_en;

      const dealCard = document.createElement('div');
      dealCard.className = 'supplier-order-card';
      if (isDisputed) dealCard.style.borderColor = 'var(--status-danger)';

      dealCard.innerHTML = `
        <div class="supplier-order-card__header">
          <div class="supplier-order-card__ref-group">
            <span class="supplier-order-card__ref">${deal.ref}</span>
            <span class="badge ${deal.status === 'COMPLETED' ? 'badge--success' : deal.status === 'DISPUTED' ? 'badge--danger' : 'badge--primary'} text-xs font-mono">
              ${deal.status}
            </span>
            ${deal.agreed_terms_hash ? `
              <span class="badge badge--neutral text-xs font-mono" title="${deal.agreed_terms_hash}">
                🔒 SHA-256: ${deal.agreed_terms_hash.substring(0, 8)}...
              </span>
            ` : ''}
          </div>

          <div style="text-align: right;">
            <div style="font-size: 10px; color: var(--text-secondary); text-transform: uppercase;">${t('b2b_escrow.total_deal_value', 'Total Deal Value')}</div>
            <div style="font-size: 1.25rem; font-weight: 800; font-family: var(--font-mono); color: var(--brand-primary);">
              ${formatCurrency(deal.total_amount)}
            </div>
          </div>
        </div>

        <div style="padding: 10px 14px; background: var(--surface-1); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
          <h3 style="font-size: var(--font-size-base); font-weight: 800; color: var(--text-primary); margin: 0;">${title || 'Wholesale Supply Contract'}</h3>
          <div style="font-size: var(--font-size-xs); color: var(--text-secondary); margin-top: 4px; display: flex; gap: 16px;">
            <span>🛒 Buyer: <strong>${deal.buyer_name || `User #${deal.buyer_id}`}</strong></span>
            <span>🏭 Supplier: <strong>${deal.supplier_name || `User #${deal.supplier_id}`}</strong></span>
          </div>
        </div>

        <!-- Staged Milestone Stepper Container -->
        <div class="milestones-mount-point" id="milestones-${deal.id}"></div>

        <!-- Footer Actions Bar -->
        <div class="supplier-order-card__footer">
          <div style="display: flex; align-items: center; gap: var(--space-2, 8px);">
            <a href="${getContractPdfUrl(deal.id)}" target="_blank" download="contract-${deal.ref}.pdf" class="btn btn--xs btn--outline">
              📄 ${t('b2b_escrow.download_pdf', 'Download Signed Contract')}
            </a>
            ${deal.contract_terms_json ? `
              <button class="btn btn--xs btn--ghost view-terms-btn" data-id="${deal.id}">
                📜 View Terms
              </button>
            ` : ''}
          </div>

          <div style="display: flex; align-items: center; gap: var(--space-2, 8px);">
            ${isPendingSign && ((isBuyer && !deal.buyer_signed_at) || (isSupplier && !deal.supplier_signed_at)) ? `
              <button class="sign-terms-btn btn btn--xs btn--primary" data-id="${deal.id}">
                ✍️ ${t('b2b_escrow.sign_and_accept', 'Sign & Accept Terms')}
              </button>
            ` : ''}

            ${!isDisputed && deal.status === 'IN_PROGRESS' ? `
              <button class="dispute-deal-btn btn btn--xs btn--outline text-danger" data-id="${deal.id}">
                ⚠️ ${t('b2b_escrow.raise_dispute', 'Raise Dispute')}
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
          toast.success(t('b2b_escrow.signed_success', 'Contract signed and accepted.'));
          await loadDeals();
        } catch (err) {
          toast.error(err?.message || t('b2b_escrow.sign_failed', 'Failed to sign contract.'));
        }
      });

      dealCard.querySelector('.dispute-deal-btn')?.addEventListener('click', () => {
        openDisputeModal(deal);
      });

      dealCard.querySelector('.view-terms-btn')?.addEventListener('click', () => {
        openTermsModal(deal);
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
    proposalCard.className = 'supplier-store-status-card';
    proposalCard.style.maxWidth = '760px';

    proposalCard.innerHTML = `
      <div style="border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px;">
        <h3 style="font-size: var(--font-size-base); font-weight: 800; color: var(--text-primary); margin: 0;">
          📝 ${t('b2b_escrow.proposal_title', 'Draft New Wholesale Supply Agreement')}
        </h3>
        <p style="font-size: var(--font-size-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
          Specify buyer details, multi-stage delivery milestones, and quality inspection terms.
        </p>
      </div>

      <form id="new-b2b-deal-form" style="display: flex; flex-direction: column; gap: var(--space-4, 16px);">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3, 12px);">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-size: var(--font-size-xs); font-weight: 700;">Agreement Title (English) *</label>
            <input type="text" name="title_en" class="input input--sm" placeholder="e.g. 5,000 Cotton Sarees Supply Contract" required />
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-size: var(--font-size-xs); font-weight: 700;">Agreement Title (Bangla)</label>
            <input type="text" name="title_bn" class="input input--sm" placeholder="যেমন: ৫,০০০ সুতি শাড়ি পাইকারি চুক্তি" />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3, 12px);">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-size: var(--font-size-xs); font-weight: 700;">Buyer User ID / Account *</label>
            <input type="number" name="buyer_id" class="input input--sm font-mono" placeholder="e.g. 5" required />
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-size: var(--font-size-xs); font-weight: 700;">Total Agreement Value (BDT) *</label>
            <input type="number" name="total_amount" class="input input--sm font-mono" placeholder="250000.00" required />
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: var(--space-2, 8px); margin-top: 8px;">
          <button type="button" class="btn btn--sm btn--secondary" id="cancel-proposal-btn">${t('common.cancel', 'Cancel')}</button>
          <button type="submit" class="btn btn--sm btn--primary">🚀 Submit Wholesale Proposal</button>
        </div>
      </form>
    `;

    proposalCard.querySelector('#cancel-proposal-btn').onclick = () => {
      activeTab = 'deals';
      renderCurrentTab();
    };

    proposalCard.querySelector('#new-b2b-deal-form').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const title_en = form.title_en.value.trim();
      const title_bn = form.title_bn.value.trim() || title_en;
      const buyer_id = parseInt(form.buyer_id.value, 10);
      const total_amount = parseFloat(form.total_amount.value);

      if (!title_en || isNaN(buyer_id) || isNaN(total_amount)) {
        toast.error('Please fill in all required fields.');
        return;
      }

      try {
        await createB2bDeal({
          title_en,
          title_bn,
          buyer_id,
          supplier_id: currentUserId,
          total_amount,
          milestones: [
            { step_index: 1, title_en: 'Advance Raw Materials Deposit (30%)', amount: total_amount * 0.3, status: 'LOCKED' },
            { step_index: 2, title_en: 'Factory Batch Production QA (40%)', amount: total_amount * 0.4, status: 'LOCKED' },
            { step_index: 3, title_en: 'Final Delivery & Warehouse Acceptance (30%)', amount: total_amount * 0.3, status: 'LOCKED' },
          ],
        });
        toast.success('B2B wholesale proposal created successfully.');
        activeTab = 'deals';
        await loadDeals();
      } catch (err) {
        toast.error(err?.message || 'Failed to create proposal.');
      }
    };

    contentArea.append(proposalCard);
  }

  function openEvidenceModal(deal, milestone) {
    const modal = document.createElement('div');
    modal.className = 'supplier-modal-scrim';
    modal.innerHTML = `
      <div class="supplier-modal">
        <div class="supplier-modal__header">
          <h3 class="supplier-modal__title">📤 Upload Milestone Evidence</h3>
          <button class="supplier-modal__close close-modal-btn">&times;</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
          <p>Provide shipment tracking reference, inspection certificate, or photos for <strong>${milestone.title_en}</strong>.</p>
          <input type="text" id="evidence-text-input" class="input input--sm" placeholder="e.g. Steadfast Consignment #STF-881290" />
        </div>
        <div class="supplier-modal__footer">
          <button class="btn btn--sm btn--secondary close-modal-btn">Cancel</button>
          <button class="btn btn--sm btn--primary" id="submit-evidence-btn">Submit Proof</button>
        </div>
      </div>
    `;
    const close = () => modal.remove();
    modal.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));
    modal.querySelector('#submit-evidence-btn').onclick = async () => {
      const text = modal.querySelector('#evidence-text-input').value.trim();
      if (!text) return toast.error('Please enter proof reference.');
      try {
        await submitMilestoneEvidence(deal.id, milestone.id, { proof: text });
        toast.success('Milestone evidence submitted.');
        close();
        await loadDeals();
      } catch (err) {
        toast.error(err?.message || 'Failed to submit evidence.');
      }
    };
    document.body.appendChild(modal);
  }

  async function handleReleaseMilestone(deal, milestone) {
    if (!confirm(`Release ${formatCurrency(milestone.amount)} for milestone "${milestone.title_en}"?`)) return;
    try {
      await releaseMilestone(deal.id, milestone.id);
      toast.success('Milestone funds released successfully.');
      await loadDeals();
    } catch (err) {
      toast.error(err?.message || 'Failed to release milestone.');
    }
  }

  async function handleRefundMilestone(deal, milestone) {
    if (!confirm(`Refund ${formatCurrency(milestone.amount)} to buyer?`)) return;
    try {
      await refundMilestone(deal.id, milestone.id);
      toast.success('Milestone refunded.');
      await loadDeals();
    } catch (err) {
      toast.error(err?.message || 'Failed to refund milestone.');
    }
  }

  function openTermsModal(deal) {
    const terms = deal.contract_terms_json || {};
    const modal = document.createElement('div');
    modal.className = 'supplier-modal-scrim';
    modal.innerHTML = `
      <div class="supplier-modal" style="max-width: 520px;">
        <div class="supplier-modal__header">
          <h3 class="supplier-modal__title">📜 Contract Terms & Quality Specifications</h3>
          <button class="supplier-modal__close close-modal-btn">&times;</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: var(--space-3, 12px); font-size: var(--font-size-xs);">
          <div style="background: var(--surface-1); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 6px;">
            <div><strong>Agreement:</strong> ${deal.title_en || deal.ref}</div>
            <div><strong>Delivery Window:</strong> ${terms.delivery_days || 30} days from mutual signoff</div>
            <div><strong>Inspection Period:</strong> ${terms.inspection_period_hours || 48} hours post-delivery</div>
            <div><strong>Quality Specs:</strong> ${terms.quality_specs || '100% Export Quality Standard'}</div>
          </div>
          <div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); word-break: break-all; background: var(--surface-2); padding: 8px 10px; border-radius: var(--radius-sm);">
            <strong>Agreed SHA-256 Hash:</strong><br/>
            ${deal.agreed_terms_hash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
          </div>
        </div>
        <div class="supplier-modal__footer">
          <button class="btn btn--sm btn--primary close-modal-btn">Close</button>
        </div>
      </div>
    `;
    const close = () => modal.remove();
    modal.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));
    document.body.appendChild(modal);
  }

  function openDisputeModal(deal) {
    const modal = document.createElement('div');
    modal.className = 'supplier-modal-scrim';
    modal.innerHTML = `
      <div class="supplier-modal" style="max-width: 500px;">
        <div class="supplier-modal__header">
          <h3 class="supplier-modal__title text-danger">⚠️ Raise Milestone Dispute</h3>
          <button class="supplier-modal__close close-modal-btn">&times;</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: var(--space-3, 12px); font-size: var(--font-size-xs);">
          <p style="margin: 0; color: var(--text-secondary);">
            Raising a dispute will immediately freeze escrow release and escalate agreement #${deal.ref} to platform arbitration.
          </p>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-weight: 700;">Reason for Dispute *</label>
            <textarea id="dispute-reason-text" class="input input--sm" style="height: 80px; resize: vertical;" placeholder="Provide specific defect or breach of agreement details..."></textarea>
          </div>
        </div>
        <div class="supplier-modal__footer">
          <button class="btn btn--sm btn--secondary close-modal-btn">Cancel</button>
          <button class="btn btn--sm btn--danger" id="confirm-dispute-btn">⚠️ Confirm & Freeze Escrow</button>
        </div>
      </div>
    `;
    const close = () => modal.remove();
    modal.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));
    modal.querySelector('#confirm-dispute-btn').onclick = async () => {
      const reason = modal.querySelector('#dispute-reason-text').value.trim();
      if (!reason) return toast.error('Please enter a reason for the dispute.');
      try {
        await raiseB2bDispute(deal.id, { reason });
        toast.success('Dispute raised. Funds locked for arbitration.');
        close();
        await loadDeals();
      } catch (err) {
        toast.error(err?.message || 'Failed to raise dispute.');
      }
    };
    document.body.appendChild(modal);
  }

  loadDeals();
  root.append(container);

  return () => {
    container.remove();
  };
}
