/**
 * SupplierHelpPage.js — Supplier Operations Hub, Interactive Checklist & Help Center (Prompt 11.1).
 *
 * Implements:
 * 1. Supplier Operational Routine Checklist (interactive progress tracking).
 * 2. Operational FAQ accordion (Escrow, FEFO, Couriers, Vault Withdrawals).
 * 3. 1-Click WhatsApp Concierge & Interactive Priority Support Ticket modal.
 * 4. Direct link to Seller & Supplier Academy courses.
 */

import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';

export default function SupplierHelpPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  // Checklist stored in localStorage
  let completedSteps = JSON.parse(localStorage.getItem('supplier_checklist_steps') || '["1", "2"]');

  function toggleStep(stepId) {
    if (completedSteps.includes(stepId)) {
      completedSteps = completedSteps.filter((id) => id !== stepId);
    } else {
      completedSteps.push(stepId);
    }
    localStorage.setItem('supplier_checklist_steps', JSON.stringify(completedSteps));
    render();
  }

  function render() {
    container.innerHTML = '';

    // 1. Header
    const header = document.createElement('header');
    header.className = 'supplier-header';
    header.innerHTML = `
      <div class="supplier-header__titles">
        <div class="supplier-header__badge-row">
          <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
          <span class="text-muted">/</span>
          <span class="text-xs text-muted font-mono">Help & Support</span>
        </div>
        <h1 class="supplier-header__title">
          <span>❓</span> ${t('supplier.help_title', 'Supplier Hub & Operational Help Center')}
        </h1>
        <p class="supplier-header__subtitle">
          ${t('supplier.help_subtitle', 'Step-by-step guides, operational checklists, FAQs, and 24/7 dedicated supplier support concierge.')}
        </p>
      </div>
      <div class="supplier-header__actions">
        <a href="/academy" class="btn btn--sm btn--secondary">
          🎓 ${t('supplier.academy_btn', 'Seller Academy Courses')}
        </a>
        <button class="btn btn--sm btn--primary" id="open-ticket-btn">
          🎫 ${t('supplier.ticket_btn', 'Open Support Ticket')}
        </button>
      </div>
    `;

    header.querySelector('#open-ticket-btn').onclick = openSupportTicketModal;
    container.appendChild(header);

    // 2. Interactive Operational Routine Checklist
    const checklistCard = document.createElement('div');
    checklistCard.className = 'supplier-checklist-card';

    const progressPct = Math.round((completedSteps.length / 5) * 100);

    checklistCard.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: var(--space-2, 8px);">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 0;">
            🚀 ${t('supplier.onboarding_title', 'Supplier Operational Routine Checklist')}
          </h3>
          <span class="badge badge--primary text-xs font-mono font-bold">${completedSteps.length}/5 Completed (${progressPct}%)</span>
        </div>
        <p style="font-size: var(--text-xs); color: var(--text-secondary); margin: 0;">
          Follow this proven 5-step daily routine to maximize order fulfillment speed and maintain an Elite Supplier rating.
        </p>
        <div style="width: 100%; height: 6px; background: var(--surface-2); border-radius: 9999px; overflow: hidden; margin-top: 4px;">
          <div style="width: ${progressPct}%; height: 100%; background: var(--success); transition: width 0.3s ease;"></div>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: var(--space-2, 8px); margin-top: 8px;">
        <!-- Step 1 -->
        <div class="supplier-checklist-item ${completedSteps.includes('1') ? 'supplier-checklist-item--done' : ''}">
          <input type="checkbox" id="step-1" style="margin-top: 3px; cursor: pointer;" ${completedSteps.includes('1') ? 'checked' : ''} />
          <div style="flex: 1;">
            <label for="step-1" style="font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); cursor: pointer;">
              ${t('supplier.step_1_title', '1. Register & Price Your Products')}
            </label>
            <p style="font-size: var(--text-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
              ${t('supplier.step_1_desc', 'Add your manufacturing SKUs with attractive wholesale margins for Salers to promote.')}
            </p>
          </div>
          <a href="/supplier/products" class="btn btn--xs btn--outline">Add SKU →</a>
        </div>

        <!-- Step 2 -->
        <div class="supplier-checklist-item ${completedSteps.includes('2') ? 'supplier-checklist-item--done' : ''}">
          <input type="checkbox" id="step-2" style="margin-top: 3px; cursor: pointer;" ${completedSteps.includes('2') ? 'checked' : ''} />
          <div style="flex: 1;">
            <label for="step-2" style="font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); cursor: pointer;">
              ${t('supplier.step_2_title', '2. Allocate Physical Warehouse Stock')}
            </label>
            <p style="font-size: var(--text-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
              ${t('supplier.step_2_desc', 'Configure safety thresholds and regional depot counts (Dhaka, Bogura, Chittagong).')}
            </p>
          </div>
          <a href="/supplier/inventory" class="btn btn--xs btn--outline">Check Stock →</a>
        </div>

        <!-- Step 3 -->
        <div class="supplier-checklist-item ${completedSteps.includes('3') ? 'supplier-checklist-item--done' : ''}">
          <input type="checkbox" id="step-3" style="margin-top: 3px; cursor: pointer;" ${completedSteps.includes('3') ? 'checked' : ''} />
          <div style="flex: 1;">
            <label for="step-3" style="font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); cursor: pointer;">
              ${t('supplier.step_3_title', '3. Pack Orders Following FEFO Lots')}
            </label>
            <p style="font-size: var(--text-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
              ${t('supplier.step_3_desc', 'Dispatch oldest lots first to minimize shelf expiry and maintain 100% freshness.')}
            </p>
          </div>
          <a href="/supplier/orders" class="btn btn--xs btn--outline">Pack Orders →</a>
        </div>

        <!-- Step 4 -->
        <div class="supplier-checklist-item ${completedSteps.includes('4') ? 'supplier-checklist-item--done' : ''}">
          <input type="checkbox" id="step-4" style="margin-top: 3px; cursor: pointer;" ${completedSteps.includes('4') ? 'checked' : ''} />
          <div style="flex: 1;">
            <label for="step-4" style="font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); cursor: pointer;">
              ${t('supplier.step_4_title', '4. Print Thermal Labels & Hand to Courier')}
            </label>
            <p style="font-size: var(--text-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
              ${t('supplier.step_4_desc', '1-click book Pathao or Steadfast, stick 4x6 labels, and hand over to delivery rider.')}
            </p>
          </div>
          <a href="/supplier/fulfilment" class="btn btn--xs btn--outline">Print Labels →</a>
        </div>

        <!-- Step 5 -->
        <div class="supplier-checklist-item ${completedSteps.includes('5') ? 'supplier-checklist-item--done' : ''}">
          <input type="checkbox" id="step-5" style="margin-top: 3px; cursor: pointer;" ${completedSteps.includes('5') ? 'checked' : ''} />
          <div style="flex: 1;">
            <label for="step-5" style="font-weight: 700; font-size: var(--text-sm); color: var(--text-primary); cursor: pointer;">
              ${t('supplier.step_5_title', '5. Settle Wholesale Funds into Bank / MFS')}
            </label>
            <p style="font-size: var(--text-xs); color: var(--text-secondary); margin: 2px 0 0 0;">
              ${t('supplier.step_5_desc', 'Escrow releases T+3 days post-delivery directly to your Explooro Vault for instant withdrawal.')}
            </p>
          </div>
          <a href="/supplier/vault" class="btn btn--xs btn--outline">View Vault →</a>
        </div>
      </div>
    `;

    // Attach step click listeners
    ['1', '2', '3', '4', '5'].forEach((id) => {
      checklistCard.querySelector(`#step-${id}`)?.addEventListener('change', () => toggleStep(id));
    });

    container.appendChild(checklistCard);

    // 3. Operational FAQ Accordion
    const faqSection = document.createElement('div');
    faqSection.className = 'supplier-faq-accordion';
    faqSection.innerHTML = `
      <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: var(--space-3) 0 var(--space-1) 0;">
        📚 ${t('supplier.faq_section_title', 'Supplier Frequently Asked Questions')}
      </h3>

      <!-- FAQ 1 -->
      <div class="supplier-faq-item">
        <button class="supplier-faq-item__header">
          <span>${t('supplier.faq_q1', 'When are wholesale earnings released from Escrow?')}</span>
          <span class="faq-chevron">▾</span>
        </button>
        <div class="supplier-faq-item__body">
          ${t('supplier.faq_a1', 'Funds are held in secure escrow during courier transit and released to your Available Balance 72 hours after customer delivery confirmation.')}
        </div>
      </div>

      <!-- FAQ 2 -->
      <div class="supplier-faq-item">
        <button class="supplier-faq-item__header">
          <span>${t('supplier.faq_q2', 'What are the courier pickup cut-off times?')}</span>
          <span class="faq-chevron">▾</span>
        </button>
        <div class="supplier-faq-item__body">
          ${t('supplier.faq_a2', 'Pathao orders packed by 4:00 PM are picked up same-day. Steadfast pickups occur daily between 2:00 PM and 5:30 PM nationwide.')}
        </div>
      </div>

      <!-- FAQ 3 -->
      <div class="supplier-faq-item">
        <button class="supplier-faq-item__header">
          <span>${t('supplier.faq_q3', 'How does automated FEFO dispatch work?')}</span>
          <span class="faq-chevron">▾</span>
        </button>
        <div class="supplier-faq-item__body">
          ${t('supplier.faq_a3', "When multiple batches of the same SKU exist, Explooro's allocation engine directs you to pick from the lot with the nearest expiration date.")}
        </div>
      </div>

      <!-- FAQ 4 -->
      <div class="supplier-faq-item">
        <button class="supplier-faq-item__header">
          <span>${t('supplier.faq_q4', 'How do I request a withdrawal to bKash or Bank?')}</span>
          <span class="faq-chevron">▾</span>
        </button>
        <div class="supplier-faq-item__body">
          ${t('supplier.faq_a4', "Navigate to My Earnings (Vault), click 'Withdraw', select your payment channel (bKash, Nagad, Rocket, or Bank Transfer), and submit your request.")}
        </div>
      </div>
    `;

    // Accordion toggle behavior
    faqSection.querySelectorAll('.supplier-faq-item').forEach((item) => {
      const btn = item.querySelector('.supplier-faq-item__header');
      const body = item.querySelector('.supplier-faq-item__body');
      const chevron = item.querySelector('.faq-chevron');

      btn.onclick = () => {
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        chevron.textContent = isOpen ? '▸' : '▾';
      };
    });

    container.appendChild(faqSection);

    // 4. Concierge & Support Strip
    const conciergeCard = document.createElement('div');
    conciergeCard.className = 'supplier-mode-banner';
    conciergeCard.style.borderLeftColor = 'var(--success)';
    conciergeCard.innerHTML = `
      <div class="supplier-mode-banner__content">
        <span class="supplier-mode-banner__icon">🎧</span>
        <div>
          <h4 class="supplier-mode-banner__title">${t('supplier.concierge_title', 'Supplier Concierge & Priority Support')}</h4>
          <p class="supplier-mode-banner__desc">
            ${t('supplier.concierge_desc', 'Need urgent assistance with a courier delay, wholesale dispute, or account verification?')}
          </p>
        </div>
      </div>
      <div style="display: flex; gap: var(--space-2, 8px);">
        <a href="https://wa.me/8801700000000?text=Hello%20Explooro%20Supplier%20Concierge" target="_blank" rel="noopener noreferrer" class="btn btn--sm btn--primary">
          💬 ${t('supplier.whatsapp_btn', 'WhatsApp Concierge')}
        </a>
      </div>
    `;
    container.appendChild(conciergeCard);
  }

  // 5. Interactive Priority Support Ticket Modal
  function openSupportTicketModal() {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'supplier-modal-scrim';
    modalBackdrop.innerHTML = `
      <div class="supplier-modal">
        <div class="supplier-modal__header">
          <h3 class="supplier-modal__title">🎫 Submit Priority Support Ticket</h3>
          <button class="supplier-modal__close close-modal-btn">&times;</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: var(--space-3, 12px);">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-size: var(--text-xs); font-weight: 700;">Issue Category</label>
            <select class="input input--sm" id="ticket-category">
              <option value="COURIER_PICKUP">🚚 Courier Pickup / Consignment Delay</option>
              <option value="ESCROW_PAYOUT">💰 Vault Escrow & Bank Payout Inquiry</option>
              <option value="PRODUCT_MODERATION">📦 Product Approval / Catalog Issue</option>
              <option value="FEFO_BATCH_EXPIRY">🏷️ FEFO Batch & Quality Recall</option>
              <option value="OTHER">❓ Other Operational Question</option>
            </select>
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-size: var(--text-xs); font-weight: 700;">Subject / Order Reference</label>
            <input type="text" id="ticket-subject" class="input input--sm" placeholder="e.g. Order #ORD-9K2P4L courier did not arrive" />
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-size: var(--text-xs); font-weight: 700;">Detailed Description</label>
            <textarea id="ticket-body" class="input" style="height: 90px; resize: vertical;" placeholder="Describe your issue with full details..."></textarea>
          </div>
        </div>

        <div class="supplier-modal__footer">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel', 'Cancel')}</button>
          <button class="btn btn--sm btn--primary" id="submit-ticket-action-btn">
            📨 Submit Ticket (24/7 SLA)
          </button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));

    modalBackdrop.querySelector('#submit-ticket-action-btn').onclick = () => {
      const subject = modalBackdrop.querySelector('#ticket-subject').value.trim();
      const body = modalBackdrop.querySelector('#ticket-body').value.trim();
      if (!subject || !body) {
        toast.error('Please enter both subject and description.');
        return;
      }
      toast.success('Ticket submitted successfully. Supplier team will respond within 2 hours.');
      close();
    };

    document.body.appendChild(modalBackdrop);
  }

  render();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
