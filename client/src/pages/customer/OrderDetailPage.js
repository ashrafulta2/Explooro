/**
 * OrderDetailPage.js — Order details, parcel tracking, and order cancellation (Prompt 5.4).
 *
 * Implements:
 *  - Full order inspection with parent billing and recipient details
 *  - Sub-order parcel cards with OrderTracker (4-stage visual stepper, courier partner, map)
 *  - Order cancellation dialog and live status updates
 *  - Fallback list view when accessed at /orders or /orders/my-orders
 */

import { getOrderById, getMyOrders, cancelOrder } from '../../services/order.api.js';
import { OrderTracker, getSubOrderStatusLabel, getPaymentStatusLabel } from '../../components/order/OrderTracker.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';

export default function OrderDetailPage(root, { params = {}, navigate } = {}) {
  const container = document.createElement('div');
  container.className = 'order-detail-page container';

  const orderIdOrRef = params.id;

  if (!orderIdOrRef) {
    renderOrdersList(container, navigate);
  } else {
    renderOrderDetail(container, orderIdOrRef, navigate);
  }

  root.append(container);
}

async function renderOrdersList(container, navigate) {
  container.innerHTML = `
    <div class="order-detail-page__header">
      <h1 class="order-detail-page__title">${t('order_tracking.my_orders_title')}</h1>
    </div>
    <div class="order-detail-page__loading text-center p-8">${t('common.loading')}</div>
  `;

  try {
    const result = await getMyOrders({ limit: 20 });
    const orders = result.data?.orders || [];

    container.querySelector('.order-detail-page__loading')?.remove();

    if (orders.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'card text-center p-8';
      emptyEl.innerHTML = `
        <h3>${t('order_tracking.no_orders')}</h3>
        <p class="text-secondary mt-2">${t('cart.empty_description')}</p>
      `;
      container.append(emptyEl);
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'order-list-grid';

    orders.forEach((ord) => {
      const card = document.createElement('div');
      card.className = 'order-card card';
      card.innerHTML = `
        <div class="order-card__header">
          <div>
            <strong>${ord.ref}</strong>
            <div class="text-xs text-secondary">${formatDate(ord.placed_at)}</div>
          </div>
          <span class="badge ${ord.payment_status === 'PAID' ? 'badge--success' : 'badge--neutral'}">${getPaymentStatusLabel(ord.payment_status)}</span>
        </div>
        <div class="order-card__body">
          <div class="text-sm">${t('order_tracking.parcel_count_label', { count: ord.sub_order_count || 1 })} · ${ord.payment_method}</div>
          <div class="order-card__total">${formatCurrency(ord.total_amount)}</div>
        </div>
        <div class="order-card__footer">
          <button type="button" class="btn btn--secondary btn--sm">${t('order_tracking.view_details')}</button>
        </div>
      `;

      card.querySelector('button').addEventListener('click', () => {
        if (navigate) navigate(`/orders/${ord.ref}`);
      });

      listEl.append(card);
    });

    container.append(listEl);
  } catch (err) {
    container.innerHTML = `<div class="alert alert--danger">${t('order_tracking.load_orders_failed', { message: err.message })}</div>`;
  }
}

async function renderOrderDetail(container, orderIdOrRef, navigate) {
  container.innerHTML = `
    <div class="order-detail-page__header">
      <h1 class="order-detail-page__title">${t('order_tracking.title')}</h1>
      <p class="text-secondary">${t('order_tracking.ref_label')}: <code class="font-bold">${orderIdOrRef}</code></p>
    </div>
    <div class="order-detail-page__loading text-center p-8">${t('common.loading')}</div>
  `;

  try {
    const order = await getOrderById(orderIdOrRef);
    container.querySelector('.order-detail-page__loading')?.remove();

    if (!order) {
      container.innerHTML = `<div class="alert alert--danger">${t('order_tracking.not_found')}</div>`;
      return;
    }

    // Top Summary Banner
    const isPaid = order.payment_status === 'PAID';
    const banner = document.createElement('div');
    banner.className = 'order-detail__summary-banner card';
    banner.innerHTML = `
      <div class="order-detail__banner-grid">
        <div>
          <span class="text-xs text-secondary uppercase font-semibold">${t('order_tracking.placed_on')}</span>
          <div>${formatDate(order.placed_at || order.created_at)}</div>
        </div>
        <div>
          <span class="text-xs text-secondary uppercase font-semibold">${t('checkout.payment_method')}</span>
          <div><strong>${order.payment_method}</strong></div>
        </div>
        <div>
          <span class="text-xs text-secondary uppercase font-semibold">${t('order_tracking.payment_status')}</span>
          <div><span class="badge ${isPaid ? 'badge--success' : 'badge--warning'}">${getPaymentStatusLabel(order.payment_status)}</span></div>
        </div>
        <div>
          <span class="text-xs text-secondary uppercase font-semibold">${t('cart.total')}</span>
          <div class="text-lg text-primary font-bold">${formatCurrency(order.total_amount)}</div>
        </div>
      </div>
    `;
    container.append(banner);

    // Layout: Details & Parcels
    const contentLayout = document.createElement('div');
    contentLayout.className = 'order-detail__content-layout';

    // Left Column: Parcels & Trackers
    const parcelsCol = document.createElement('div');
    parcelsCol.className = 'order-detail__parcels-col';

    const parcelsHeader = document.createElement('h3');
    parcelsHeader.className = 'order-detail__section-title';
    parcelsHeader.textContent = t('order_tracking.sub_orders_title');
    parcelsCol.append(parcelsHeader);

    const subOrders = order.sub_orders || [];
    subOrders.forEach((so, idx) => {
      const parcelCard = document.createElement('div');
      parcelCard.className = 'order-parcel card';

      const pHeader = document.createElement('div');
      pHeader.className = 'order-parcel__header';
      pHeader.innerHTML = `
        <div>
          <h4>${t('order_tracking.parcel_num', { index: idx + 1, total: subOrders.length })}</h4>
          <span class="text-xs text-secondary">${t('checkout.supplier_label')}: <strong>${so.supplier_name || t('product_detail.supplier.tier.verified')}</strong></span>
        </div>
        <span class="badge ${so.status === 'DELIVERED' ? 'badge--success' : so.status === 'CANCELLED' ? 'badge--danger' : 'badge--primary'}">${getSubOrderStatusLabel(so.status)}</span>
      `;
      parcelCard.append(pHeader);

      // Line Items
      const itemsList = document.createElement('div');
      itemsList.className = 'order-parcel__items';
      (so.items || []).forEach((item) => {
        const itemRow = document.createElement('div');
        itemRow.className = 'order-parcel__item-row';
        itemRow.innerHTML = `
          <div class="order-parcel__item-info">
            <strong>${item.qty}x ${item.title_snapshot || t('order_tracking.product_fallback')}</strong>
            <div class="text-xs text-secondary">${t('order_tracking.unit_price_label')}: ${formatCurrency(item.retail_price)}</div>
          </div>
          <div class="order-parcel__item-total font-semibold">${formatCurrency(item.line_total)}</div>
        `;
        itemsList.append(itemRow);
      });
      parcelCard.append(itemsList);

      // Tracker & Logistics
      const tracker = OrderTracker({ subOrder: so, parentOrder: order });
      parcelCard.append(tracker.element);

      parcelsCol.append(parcelCard);
    });

    contentLayout.append(parcelsCol);

    // Right Column: Delivery Address & Billing Breakdown
    const sidebarCol = document.createElement('div');
    sidebarCol.className = 'order-detail__sidebar-col';

    // Address Card
    const addrCard = document.createElement('div');
    addrCard.className = 'card order-detail__address-card';
    addrCard.innerHTML = `
      <h3 class="order-detail__card-title">📍 ${t('order_tracking.delivery_address')}</h3>
      <div class="order-detail__address-body">
        <strong>${order.recipient_name}</strong><br />
        📞 ${order.recipient_phone}<br />
        ${order.address_line}<br />
        ${order.upazila ? order.upazila + ', ' : ''}${order.district}, ${order.division}
      </div>
    `;
    sidebarCol.append(addrCard);

    // Billing Breakdown Card
    const billCard = document.createElement('div');
    billCard.className = 'card order-detail__bill-card';
    billCard.innerHTML = `
      <h3 class="order-detail__card-title">💳 ${t('order_tracking.billing_summary')}</h3>
      <div class="order-detail__bill-row">
        <span>${t('cart.subtotal')}</span>
        <span>${formatCurrency(order.items_amount)}</span>
      </div>
      <div class="order-detail__bill-row">
        <span>${t('cart.shipping_estimate', { count: subOrders.length })}</span>
        <span>${formatCurrency(order.shipping_amount)}</span>
      </div>
      ${Number(order.discount_amount) > 0 ? `
        <div class="order-detail__bill-row text-success">
          <span>${t('cart.discount')}</span>
          <span>- ${formatCurrency(order.discount_amount)}</span>
        </div>
      ` : ''}
      <div class="order-detail__divider"></div>
      <div class="order-detail__bill-row order-detail__bill-row--total">
        <span>${t('cart.total')}</span>
        <span class="text-primary font-bold">${formatCurrency(order.total_amount)}</span>
      </div>
    `;
    sidebarCol.append(billCard);

    // Cancellation Action (if eligible)
    const canCancel = subOrders.some((s) => s.status === 'PLACED');
    if (canCancel) {
      const cancelWrap = document.createElement('div');
      cancelWrap.className = 'order-detail__cancel-wrap mt-4';

      const cancelBtn = Button({
        label: t('order_tracking.cancel_order_btn'),
        variant: 'danger',
        size: 'md',
        className: 'w-full',
        onClick: () => {
          showCancelModal(order, navigate, () => {
            renderOrderDetail(container, orderIdOrRef, navigate);
          });
        },
      });
      cancelWrap.append(cancelBtn);
      sidebarCol.append(cancelWrap);
    }

    contentLayout.append(sidebarCol);
    container.append(contentLayout);
  } catch (err) {
    container.innerHTML = `<div class="alert alert--danger">${t('order_tracking.load_details_failed', { message: err.message })}</div>`;
  }
}

function showCancelModal(order, navigate, onRefresh) {
  const modalContent = document.createElement('div');
  modalContent.className = 'p-4';
  modalContent.innerHTML = `
    <p>${t('order_tracking.cancel_confirm_desc')}</p>
    <div class="form-group mt-4">
      <label class="form-label">${t('order_tracking.cancel_reason_label')}:</label>
      <input type="text" class="form-input" id="cancel-reason-input" placeholder="${t('order_tracking.cancel_reason_placeholder')}" />
    </div>
    <div class="flex justify-end gap-3 mt-6">
      <button type="button" class="btn btn--ghost btn--md" id="modal-cancel-btn">${t('common.cancel') || 'Cancel'}</button>
      <button type="button" class="btn btn--danger btn--md" id="modal-confirm-btn">${t('order_tracking.cancel_order_btn')}</button>
    </div>
  `;

  const modal = Modal({
    title: t('order_tracking.cancel_confirm_title'),
    content: modalContent,
    size: 'sm',
  });

  modalContent.querySelector('#modal-cancel-btn').addEventListener('click', () => modal.close());
  modalContent.querySelector('#modal-confirm-btn').addEventListener('click', async () => {
    const reason = modalContent.querySelector('#cancel-reason-input').value.trim();
    try {
      await cancelOrder(order.id, reason);
      toast.success(t('order_tracking.cancel_success') || 'Order cancelled successfully.');
      modal.close();
      if (onRefresh) onRefresh();
    } catch (err) {
      toast.error(err.message || t('order_tracking.cancel_failed'));
    }
  });

  modal.open();
}
