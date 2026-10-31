/**
 * SupplierShipmentsPage.ts — the supplier's parcels and their delivery status (Prompt 11.1).
 *
 * Route: /supplier/shipments
 * 1. Every parcel the supplier has sent, from GET /supplier/shipments (newest first, paginated).
 * 2. Search by tracking number, order ref, recipient or district; filter chips by status.
 * 3. A parcel sent by hand (carrier MANUAL, migration 097) has "Delivered" and "Returned" buttons.
 *    DELIVERED starts escrow and the profit split exactly as a courier's webhook would; RETURNED
 *    puts the stock back. A courier-booked parcel is moved by its courier, so it has no buttons.
 *
 * WHY rewritten (2026-10-31): the page built its list from the packing queue, gave parcels without
 * a tracking number a random one, and showed fixed figures (14 delivered, 98.4% success). Every
 * number here is now counted from the parcels the API returned.
 */

import { supplierApi } from '../../services/supplier.api.ts';
import { t } from '../../services/i18n.ts';
import { formatCurrency, formatDate } from '../../services/format.ts';
import { escapeHtml } from '../../services/html.ts';
import { toast } from '../../services/toast.ts';
import { EmptyState } from '../../components/ui/EmptyState.ts';
import { supplierModal } from './supplierModal.ts';

const CLOSED = ['DELIVERED', 'RETURNED', 'CANCELLED'];

export default function SupplierShipmentsPage(root: HTMLElement) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  let shipments = [];
  let nextCursor = null;
  let loading = true;
  let filterStatus = 'all'; // 'all' | 'OPEN' | 'DELIVERED' | 'RETURNED'
  let searchQuery = '';

  async function loadShipments({ append = false } = {}) {
    loading = !append;
    if (!append) render();
    try {
      const res = await supplierApi.getShipments({ limit: 50, cursor: append ? nextCursor : null });
      const page = res.data || [];
      shipments = append ? shipments.concat(page) : page;
      nextCursor = res.next_cursor ?? null;
    } catch (err) {
      console.error('Failed to load shipments:', err);
      toast.error(t('supplier.shipments_load_failed', 'Failed to load shipment logs.'));
      if (!append) shipments = [];
    } finally {
      loading = false;
      render();
    }
  }

  const district = (s) => s.delivery_address_json?.district || '';
  const courierOf = (s) => (s.carrier === 'MANUAL' ? (s.courier_name || t('supplier.manual_ship.mode_value')) : s.carrier);

  function getFilteredShipments() {
    return shipments.filter((s) => {
      if (filterStatus === 'OPEN' && CLOSED.includes(s.status)) return false;
      if (filterStatus === 'DELIVERED' && s.status !== 'DELIVERED') return false;
      if (filterStatus === 'RETURNED' && s.status !== 'RETURNED') return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const hay = [s.tracking_number, s.sub_order_ref, s.recipient_name, district(s), s.courier_name]
          .map((v) => String(v || '').toLowerCase());
        if (!hay.some((v) => v.includes(q))) return false;
      }
      return true;
    });
  }

  function render() {
    container.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'supplier-header';
    header.innerHTML = `
      <div class="supplier-header__titles">
        <div class="supplier-header__badge-row">
          <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">&lt; ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
          <span class="text-muted">/</span>
          <span class="text-xs text-muted font-mono">${t('supplier.shipments_title')}</span>
        </div>
        <h1 class="supplier-header__title">
          <span>🚚</span> ${t('supplier.shipments_title')}
        </h1>
        <p class="supplier-header__subtitle">${t('supplier.shipments_subtitle')}</p>
      </div>
      <div class="supplier-header__actions">
        <button class="btn btn--sm btn--secondary" id="refresh-shipments-btn">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;
    header.querySelector<HTMLElement>('#refresh-shipments-btn').onclick = () => loadShipments();
    container.appendChild(header);

    const openCount = shipments.filter((s) => !CLOSED.includes(s.status)).length;
    const deliveredCount = shipments.filter((s) => s.status === 'DELIVERED').length;
    const returnedCount = shipments.filter((s) => s.status === 'RETURNED').length;
    const awaitingMark = shipments.filter((s) => s.carrier === 'MANUAL' && !CLOSED.includes(s.status)).length;

    const summaryStrip = document.createElement('div');
    summaryStrip.className = 'supplier-kpi-grid';
    summaryStrip.innerHTML = `
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.shipments.kpi_open')}</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">${openCount}</div>
      </div>
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.shipments.kpi_awaiting')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 4px 0;">${awaitingMark}</div>
        <span class="text-xs text-muted">${t('supplier.shipments.kpi_awaiting_hint')}</span>
      </div>
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.shipments.kpi_delivered')}</span>
        <div class="supplier-kpi-card__value supplier-kpi-card__value--success" style="font-size: 1.5rem; margin: 4px 0;">${deliveredCount}</div>
      </div>
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('supplier.shipments.kpi_returned')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 4px 0;">${returnedCount}</div>
      </div>
    `;
    container.appendChild(summaryStrip);

    const toolbar = document.createElement('div');
    toolbar.className = 'supplier-toolbar';
    toolbar.innerHTML = `
      <div class="supplier-toolbar__search">
        <input
          type="text"
          id="shipment-search-input"
          class="input input--sm"
          style="width: 100%;"
          aria-label="${t('supplier.shipments.search')}"
          placeholder="${t('supplier.shipments.search')}"
          value="${escapeHtml(searchQuery)}"
        />
      </div>
      <div class="supplier-toolbar__filters">
        <button class="supplier-chip ${filterStatus === 'all' ? 'supplier-chip--active' : ''}" data-status="all">
          ${t('supplier.shipments.filter_all')} (${shipments.length})
        </button>
        <button class="supplier-chip ${filterStatus === 'OPEN' ? 'supplier-chip--active' : ''}" data-status="OPEN">
          🚚 ${t('supplier.shipments.filter_open')} (${openCount})
        </button>
        <button class="supplier-chip ${filterStatus === 'DELIVERED' ? 'supplier-chip--active' : ''}" data-status="DELIVERED">
          ✅ ${t('supplier.shipments.filter_delivered')} (${deliveredCount})
        </button>
        <button class="supplier-chip ${filterStatus === 'RETURNED' ? 'supplier-chip--active' : ''}" data-status="RETURNED">
          ↩ ${t('supplier.shipments.filter_returned')} (${returnedCount})
        </button>
      </div>
    `;

    const searchInput = toolbar.querySelector<HTMLInputElement>('#shipment-search-input');
    let debounceTimer;
    searchInput.oninput = (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = (e.target as HTMLInputElement).value.trim();
        renderShipmentsList();
      }, 250);
    };

    toolbar.querySelectorAll<HTMLElement>('.supplier-chip').forEach((chip) => {
      chip.onclick = () => {
        filterStatus = chip.dataset.status;
        render();
      };
    });
    container.appendChild(toolbar);

    const listWrap = document.createElement('div');
    listWrap.id = 'shipments-list-wrap';
    container.appendChild(listWrap);

    renderShipmentsList();
  }

  function openStatusModal(s, status) {
    const isDelivered = status === 'DELIVERED';
    const modal = supplierModal({
      title: `${isDelivered ? '✅' : '↩'} ${t(isDelivered ? 'supplier.shipments.mark_delivered' : 'supplier.shipments.mark_returned')}: ${escapeHtml(s.tracking_number)}`,
      size: 'md',
      danger: !isDelivered,
      body: `
        <div style="display: flex; flex-direction: column; gap: var(--space-3, 12px);">
          <p class="text-sm">${t(isDelivered ? 'supplier.shipments.delivered_desc' : 'supplier.shipments.returned_desc', {
            amount: formatCurrency(s.cod_amount || 0),
          })}</p>
          <div class="form-field">
            <label class="form-label" for="shipment-status-note">${t('supplier.manual_ship.note_label')}</label>
            <input id="shipment-status-note" class="form-input" type="text" maxlength="300" />
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel')}</button>
        <button class="btn btn--sm ${isDelivered ? 'btn--primary' : 'btn--danger'} shipment-status-confirm">
          ${t(isDelivered ? 'supplier.shipments.mark_delivered' : 'supplier.shipments.mark_returned')}
        </button>
      `,
    });

    const confirmBtn = modal.querySelector<HTMLButtonElement>('.shipment-status-confirm');
    confirmBtn.onclick = async () => {
      const note = modal.querySelector<HTMLInputElement>('#shipment-status-note').value.trim();
      confirmBtn.disabled = true;
      try {
        await supplierApi.setShipmentStatus(s.id, { status, ...(note ? { note } : {}) });
        toast.success(t(isDelivered ? 'supplier.shipments.delivered_success' : 'supplier.shipments.returned_success', { ref: s.sub_order_ref }));
        modal.close(false);
        loadShipments();
      } catch (err) {
        toast.error(err?.message || t('common.error_generic'));
        confirmBtn.disabled = false;
      }
    };
    modal.open(document.activeElement);
  }

  function renderShipmentsList() {
    const wrap = container.querySelector('#shipments-list-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    if (loading) {
      wrap.innerHTML = `
        <div class="p-12 text-center text-muted">
          <div class="spinner" style="margin: 0 auto 16px auto;"></div>
          <p>${t('common.loading', 'Loading shipment tracking...')}</p>
        </div>
      `;
      return;
    }

    const filtered = getFilteredShipments();
    if (filtered.length === 0) {
      wrap.appendChild(
        EmptyState({
          icon: '🚚',
          title: t('supplier.shipments.empty_title'),
          description: t('supplier.shipments.empty_desc'),
        })
      );
      return;
    }

    const cardsContainer = document.createElement('div');
    cardsContainer.style.display = 'flex';
    cardsContainer.style.flexDirection = 'column';
    cardsContainer.style.gap = 'var(--space-4, 16px)';

    filtered.forEach((s) => {
      const isManualOpen = s.carrier === 'MANUAL' && !CLOSED.includes(s.status);
      const card = document.createElement('div');
      card.className = 'supplier-shipment-card';

      card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid var(--border-subtle); padding-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="supplier-order-card__ref font-bold" style="font-size: 13px;">${escapeHtml(s.tracking_number)}</span>
            <span class="badge badge--primary text-xs font-bold">${escapeHtml(courierOf(s))}</span>
            <span class="badge ${s.status === 'DELIVERED' ? 'badge--success' : s.status === 'RETURNED' ? 'badge--danger' : 'badge--info'} text-xs font-mono">
              ${escapeHtml(s.status)}
            </span>
          </div>
          <div style="font-size: var(--text-xs); color: var(--text-secondary);">
            ${t('supplier.shipments.order')}: <strong class="font-mono">${escapeHtml(s.sub_order_ref)}</strong> · ${escapeHtml(formatDate(s.created_at))}
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: var(--text-xs); padding-top: 8px;">
          <div>
            <span>${t('supplier.shipments.recipient')}: <strong>${escapeHtml(s.recipient_name)}</strong> (${escapeHtml(s.recipient_phone)})</span> ·
            <span>📍 <strong>${escapeHtml(district(s))}</strong></span>
          </div>
          <div style="font-family: var(--font-mono); font-weight: 700;">
            ${s.payment_method === 'COD' ? `COD: ${formatCurrency(s.cod_amount || 0)}` : t('supplier.shipments.prepaid')}
          </div>
        </div>

        ${isManualOpen ? `
          <div style="display: flex; justify-content: flex-end; gap: var(--space-2, 8px); padding-top: 8px;">
            <button class="btn btn--xs btn--secondary returned-btn">↩ ${t('supplier.shipments.mark_returned')}</button>
            <button class="btn btn--xs btn--primary delivered-btn">✅ ${t('supplier.shipments.mark_delivered')}</button>
          </div>
        ` : ''}
      `;

      card.querySelector<HTMLElement>('.delivered-btn')?.addEventListener('click', () => openStatusModal(s, 'DELIVERED'));
      card.querySelector<HTMLElement>('.returned-btn')?.addEventListener('click', () => openStatusModal(s, 'RETURNED'));
      cardsContainer.appendChild(card);
    });

    wrap.appendChild(cardsContainer);

    if (nextCursor) {
      const more = document.createElement('button');
      more.className = 'btn btn--sm btn--secondary';
      more.style.marginTop = 'var(--space-4, 16px)';
      more.textContent = t('supplier.shipments.load_more');
      more.onclick = () => loadShipments({ append: true });
      wrap.appendChild(more);
    }
  }

  loadShipments();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
