/**
 * OrderTracker.js — 4-Stage Sub-Order Progress Tracker & Live Map Placeholder (Prompt 5.4).
 *
 * Stages:
 *  1. PLACED: Order received in system
 *  2. CONFIRMED: Allocated and packed at supplier warehouse
 *  3. SHIPPED: Dispatched with regional courier partner
 *  4. DELIVERED: Handed over to recipient
 */

import { t } from '../../services/i18n.js';

export const ORDER_STAGES = [
  { key: 'PLACED', labelKey: 'order_tracking.status_placed', icon: '📝' },
  { key: 'CONFIRMED', labelKey: 'order_tracking.status_confirmed', icon: '📦' },
  { key: 'SHIPPED', labelKey: 'order_tracking.status_shipped', icon: '🚚' },
  { key: 'DELIVERED', labelKey: 'order_tracking.status_delivered', icon: '✅' },
];

export function getStageIndex(status) {
  switch (status) {
    case 'PLACED': return 0;
    case 'CONFIRMED':
    case 'PROCESSING': return 1;
    case 'SHIPPED':
    case 'IN_TRANSIT': return 2;
    case 'DELIVERED': return 3;
    case 'CANCELLED': return -1;
    default: return 0;
  }
}

const SUB_ORDER_STATUS_KEYS = {
  PLACED: 'order_tracking.status_placed',
  CONFIRMED: 'order_tracking.status_confirmed',
  PROCESSING: 'order_tracking.status_processing',
  SHIPPED: 'order_tracking.status_shipped',
  IN_TRANSIT: 'order_tracking.status_in_transit',
  DELIVERED: 'order_tracking.status_delivered',
  CANCELLED: 'order_tracking.status_cancelled',
};

const PAYMENT_STATUS_KEYS = {
  PENDING: 'order_tracking.payment_status_pending',
  PAID: 'order_tracking.payment_status_paid',
  FAILED: 'order_tracking.payment_status_failed',
  PARTIALLY_REFUNDED: 'order_tracking.payment_status_partially_refunded',
  REFUNDED: 'order_tracking.payment_status_refunded',
};

export function getSubOrderStatusLabel(status) {
  return t(SUB_ORDER_STATUS_KEYS[status] || 'order_tracking.status_placed');
}

export function getPaymentStatusLabel(status) {
  return t(PAYMENT_STATUS_KEYS[status] || 'order_tracking.payment_status_pending');
}

export function OrderTracker({
  subOrder,
  parentOrder = null,
} = {}) {
  const container = document.createElement('div');
  container.className = 'order-tracker';

  const status = subOrder.status || 'PLACED';
  const isCancelled = status === 'CANCELLED';
  const currentStageIdx = getStageIndex(status);

  // 1. Status Stepper
  const stepperWrap = document.createElement('div');
  stepperWrap.className = 'customer-order-card__stepper-wrap mb-4';
  
  const stepper = document.createElement('div');
  stepper.className = `customer-order-card__stepper ${isCancelled ? 'order-tracker__stepper--cancelled' : ''}`;

  if (isCancelled) {
    stepper.innerHTML = `
      <div class="order-tracker__cancelled-badge alert alert--danger grid-col-span-4">
        <strong>⚠️ ${t('order_tracking.status_cancelled')}</strong>
        <p class="text-sm">${subOrder.cancel_reason || 'This sub-order was cancelled and inventory was released back to stock.'}</p>
      </div>
    `;
  } else {
    ORDER_STAGES.forEach((stage, idx) => {
      const isDone = idx < currentStageIdx;
      const isActive = idx === currentStageIdx;

      let stepClass = 'customer-order-card__step';
      if (isDone) stepClass += ' customer-order-card__step--done';
      if (isActive) stepClass += ' customer-order-card__step--active';

      const stepEl = document.createElement('div');
      stepEl.className = stepClass;
      stepEl.innerHTML = `
        <div class="customer-order-card__step-num">${isDone ? '✓' : (idx + 1)}</div>
        <div class="customer-order-card__step-label">${t(stage.labelKey)}</div>
      `;
      stepper.append(stepEl);
    });
  }

  stepperWrap.append(stepper);
  container.append(stepperWrap);

  // 2. Courier & Shipping Logistics Info
  const courierCard = document.createElement('div');
  courierCard.className = 'order-tracker__courier card card--subtle';
  const courierName = subOrder.courier_partner || 'Steadfast Logistics (Dhaka Hub)';
  const trackingNumber = subOrder.tracking_number || `EXP-${subOrder.ref || '001'}`;

  courierCard.innerHTML = `
    <div class="order-tracker__courier-header">
      <div>
        <span class="text-xs text-secondary uppercase font-semibold">${t('order_tracking.courier_partner')}</span>
        <div class="order-tracker__courier-name">🚚 ${courierName}</div>
      </div>
      <div>
        <span class="text-xs text-secondary uppercase font-semibold">${t('order_tracking.tracking_number')}</span>
        <div class="order-tracker__courier-code"><code>${trackingNumber}</code></div>
      </div>
    </div>
  `;
  container.append(courierCard);

  // 3. Interactive Route Map Placeholder (Prompt 7.1 prep)
  const mapPlaceholder = document.createElement('div');
  mapPlaceholder.className = 'order-tracker__map';
  mapPlaceholder.innerHTML = `
    <div class="order-tracker__map-canvas">
      <div class="order-tracker__map-grid"></div>
      <div class="order-tracker__map-route">
        <div class="order-tracker__map-pin order-tracker__map-pin--origin" title="Warehouse Origin">🏭</div>
        <div class="order-tracker__map-pulse"></div>
        <div class="order-tracker__map-pin order-tracker__map-pin--dest" title="Delivery Destination">📍</div>
      </div>
      <div class="order-tracker__map-overlay">
        <span class="badge badge--primary">📡 ${t('order_tracking.live_map_title')}</span>
        <p class="text-xs text-secondary mt-1">${t('order_tracking.live_map_desc')}</p>
      </div>
    </div>
  `;
  container.append(mapPlaceholder);

  return {
    element: container,
  };
}
