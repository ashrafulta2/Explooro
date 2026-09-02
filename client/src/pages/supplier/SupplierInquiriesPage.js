/**
 * SupplierInquiriesPage.js — Supplier Wholesale Buyer Inquiries & Custom Quotations Hub (Prompt 11.1).
 *
 * Route: /supplier/inquiries
 * Implements:
 * 1. Bulk buyer and Saler wholesale quotation inquiry queue.
 * 2. Minimum Order Quantity (MOQ) negotiations.
 * 3. 1-Click Custom Wholesale Quote submission.
 * 4. WhatsApp Quick Connect link for real-time deal discussions.
 */

import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function SupplierInquiriesPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  let inquiries = [
    {
      id: 'INQ-101',
      saler_name: "Tanvir's Trend Store",
      buyer_phone: '01711223344',
      product_title: 'Traditional Handloom Cotton Jamdani',
      requested_moq: 150,
      target_unit_price: 950.0,
      current_wholesale_price: 1100.0,
      status: 'AWAITING_QUOTE',
      message: 'Looking to purchase 150 units for our upcoming Eid wholesale campaign. Can you provide a special bulk discount for 50% upfront payment?',
      created_at: '2026-08-31 11:20',
    },
    {
      id: 'INQ-102',
      saler_name: 'Sadia Beauty Corner',
      buyer_phone: '01819887766',
      product_title: 'Organic Cold-Pressed Mustard Oil 500ml',
      requested_moq: 500,
      target_unit_price: 180.0,
      current_wholesale_price: 210.0,
      status: 'QUOTED',
      message: 'Need 500 bottles dispatched across 2 batches with fresh FEFO lot tags.',
      created_at: '2026-08-30 16:45',
    },
  ];

  let filterStatus = 'all';

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
          <span class="text-xs text-muted font-mono">Wholesale Inquiries</span>
        </div>
        <h1 class="supplier-header__title">
          <span>💬</span> ${t('supplier.inquiries_title', 'Wholesale Quotation Requests & Inquiries')}
        </h1>
        <p class="supplier-header__subtitle">
          ${t('supplier.inquiries_subtitle', 'Negotiate custom bulk pricing, minimum order quantities (MOQ), and chat with Salers.')}
        </p>
      </div>
      <div class="supplier-header__actions">
        <button class="btn btn--sm btn--secondary" id="refresh-inquiries-btn">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;

    header.querySelector('#refresh-inquiries-btn').onclick = () => render();
    container.appendChild(header);

    // 2. Summary KPI Strip
    const awaitingCount = inquiries.filter((i) => i.status === 'AWAITING_QUOTE').length;

    const summaryStrip = document.createElement('div');
    summaryStrip.className = 'supplier-kpi-grid';
    summaryStrip.innerHTML = `
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">Pending Inquiries</span>
        <div class="supplier-kpi-card__value ${awaitingCount > 0 ? 'supplier-kpi-card__value--warning' : 'supplier-kpi-card__value--success'}" style="font-size: 1.5rem; margin: 4px 0;">
          ${awaitingCount}
        </div>
        <span class="text-xs text-muted">Awaiting custom quotation offer</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">Avg Wholesale MOQ</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">325 Units</div>
        <span class="text-xs text-muted">Typical batch order size</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">Conversion Rate</span>
        <div class="supplier-kpi-card__value supplier-kpi-card__value--success" style="font-size: 1.5rem; margin: 4px 0;">76.2%</div>
        <span class="text-xs text-muted">Inquiries converting to B2B deals</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">WhatsApp Response Time</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 4px 0;">&lt; 15 Mins</div>
        <span class="text-xs text-muted">Instant messaging conversion</span>
      </div>
    `;
    container.appendChild(summaryStrip);

    // 3. Filter Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'supplier-toolbar';
    toolbar.innerHTML = `
      <div class="supplier-toolbar__filters">
        <button class="supplier-chip ${filterStatus === 'all' ? 'supplier-chip--active' : ''}" data-status="all">
          ${t('common.all', 'All Inquiries')} (${inquiries.length})
        </button>
        <button class="supplier-chip supplier-chip--warning ${filterStatus === 'AWAITING_QUOTE' ? 'supplier-chip--active' : ''}" data-status="AWAITING_QUOTE">
          ⏳ Awaiting Quote (${awaitingCount})
        </button>
        <button class="supplier-chip ${filterStatus === 'QUOTED' ? 'supplier-chip--active' : ''}" data-status="QUOTED">
          ✅ Quote Sent
        </button>
      </div>
    `;

    toolbar.querySelectorAll('.supplier-chip').forEach((chip) => {
      chip.onclick = () => {
        filterStatus = chip.dataset.status;
        render();
      };
    });

    container.appendChild(toolbar);

    // 4. Inquiries List
    const filtered = inquiries.filter((i) => {
      if (filterStatus === 'all') return true;
      return i.status === filterStatus;
    });

    if (filtered.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '💬',
          title: 'No inquiries found',
          description: 'New bulk quotation requests from verified Salers will appear here automatically.',
        })
      );
      return;
    }

    const listWrap = document.createElement('div');
    listWrap.style.display = 'flex';
    listWrap.style.flexDirection = 'column';
    listWrap.style.gap = 'var(--space-4, 16px)';

    filtered.forEach((inq) => {
      const isAwaiting = inq.status === 'AWAITING_QUOTE';
      const card = document.createElement('div');
      card.className = 'supplier-inquiry-card';

      card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="supplier-order-card__ref">${inq.id}</span>
            <span class="badge ${isAwaiting ? 'badge--warning' : 'badge--success'} text-xs font-mono font-bold">
              ${isAwaiting ? '⏳ AWAITING QUOTE' : '✅ QUOTE SENT'}
            </span>
          </div>
          <span class="text-xs text-muted">${inq.created_at}</span>
        </div>

        <div>
          <div style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary);">${inq.product_title}</div>
          <div style="font-size: var(--text-xs); color: var(--text-secondary); margin-top: 2px;">
            Buyer: <strong>${inq.saler_name}</strong> · Phone: <strong>${inq.buyer_phone}</strong>
          </div>
        </div>

        <div style="padding: 12px 14px; background: var(--surface-1); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); font-size: var(--text-xs);">
          <p style="margin: 0; color: var(--text-primary); font-style: italic;">"${inq.message}"</p>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; font-size: var(--text-xs); font-family: var(--font-mono);">
          <div>
            Requested MOQ: <strong>${inq.requested_moq} units</strong>
          </div>
          <div>
            Target Unit Price: <strong class="text-primary">${formatCurrency(inq.target_unit_price)}</strong> (Standard: ${formatCurrency(inq.current_wholesale_price)})
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2, 8px); border-top: 1px solid var(--border-subtle); padding-top: 10px;">
          <a href="https://wa.me/88${inq.buyer_phone}?text=Hello%20${encodeURIComponent(inq.saler_name)},%20regarding%20your%20inquiry%20for%20${encodeURIComponent(inq.product_title)}" target="_blank" rel="noopener noreferrer" class="btn btn--xs btn--secondary">
            💬 WhatsApp Buyer
          </a>
          ${isAwaiting ? `
            <button class="btn btn--xs btn--primary quote-btn" data-id="${inq.id}">
              🏷️ Submit Custom Quote
            </button>
          ` : `
            <span class="badge badge--success text-xs font-bold">Quote Submitted (৳980.00)</span>
          `}
        </div>
      `;

      const quoteBtn = card.querySelector('.quote-btn');
      if (quoteBtn) {
        quoteBtn.onclick = () => openCustomQuoteModal(inq);
      }

      listWrap.appendChild(card);
    });

    container.appendChild(listWrap);
  }

  function openCustomQuoteModal(inq) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'supplier-modal-scrim';
    modalBackdrop.innerHTML = `
      <div class="supplier-modal">
        <div class="supplier-modal__header">
          <h3 class="supplier-modal__title">🏷️ Submit Wholesale Quotation</h3>
          <button class="supplier-modal__close close-modal-btn">&times;</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: var(--space-3, 12px); font-size: var(--text-xs);">
          <div style="background: var(--surface-1); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            <div><strong>Product:</strong> ${inq.product_title}</div>
            <div><strong>Buyer MOQ:</strong> ${inq.requested_moq} units (Buyer Target: ${formatCurrency(inq.target_unit_price)})</div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-weight: 700;">Offered Unit Price (BDT) *</label>
            <input type="number" id="offered-unit-price" class="input input--sm font-mono" value="${inq.target_unit_price + 30}" required />
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-weight: 700;">Delivery Lead Time</label>
            <select class="input input--sm" id="lead-time-select">
              <option value="3">⚡ Ready Stock: 3-5 Days Delivery</option>
              <option value="7">📦 Manufacturing Batch: 7-10 Days Delivery</option>
              <option value="14">🏭 Custom Production: 14-21 Days Delivery</option>
            </select>
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-weight: 700;">Special Notes for Buyer</label>
            <textarea id="quote-notes" class="input input--sm" style="height: 60px; resize: vertical;" placeholder="Include details regarding packaging, FEFO lot freshness, or shipping..."></textarea>
          </div>
        </div>

        <div class="supplier-modal__footer">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel', 'Cancel')}</button>
          <button class="btn btn--sm btn--primary" id="confirm-quote-btn">
            📨 Send Quote
          </button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));

    modalBackdrop.querySelector('#confirm-quote-btn').onclick = () => {
      const price = parseFloat(modalBackdrop.querySelector('#offered-unit-price').value);
      if (isNaN(price) || price <= 0) return toast.error('Please enter a valid unit price.');
      inq.status = 'QUOTED';
      toast.success('Wholesale quote sent to buyer successfully.');
      close();
      render();
    };

    document.body.appendChild(modalBackdrop);
  }

  render();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
