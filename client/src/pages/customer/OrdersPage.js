/**
 * OrdersPage.js — Customer Orders & Visual Tracking Hub (Prompt 11.3 / idea §AL.3).
 *
 * Route: /account/orders
 *
 * Data source: getMyOrders() → GET /orders/my-orders (handled by mock orders.js handler).
 * All UI strings resolved via t('order_tracking.*') so language-switching works correctly.
 */

import '../../styles/components/customer-orders.css';
import { getMyOrders } from '../../services/order.api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Tabs } from '../../components/ui/Tabs.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import {
  getSubOrderStatusLabel,
  getStageIndex,
  ORDER_STAGES,
} from '../../components/order/OrderTracker.js';
import { resolveProductImage } from '../../components/product/ProductCard.js';

export default function OrdersPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'orders-page';

  let currentTab = 'ALL';

  // 1. Header
  const header = document.createElement('div');
  header.className = 'orders-page__header';
  header.innerHTML = `
    <div>
      <a href="/account" class="orders-page__back-link">
        ${t('order_tracking.back_to_account')}
      </a>
      <h1 class="orders-page__title">
        ${t('order_tracking.my_orders_title')}
      </h1>
      <p class="orders-page__subtitle">
        ${t('order_tracking.page_subtitle')}
      </p>
    </div>
  `;
  container.append(header);

  // 2. Status Filter Tabs
  const tabFilterSlot = document.createElement('div');
  tabFilterSlot.className = 'orders-page__tabs';
  container.append(tabFilterSlot);

  const ordersListSlot = document.createElement('div');
  ordersListSlot.className = 'orders-page__list';

  const tabs = Tabs({
    tabs: [
      { id: 'ALL',        label: t('order_tracking.tab_all') },
      { id: 'PROCESSING', label: `📦 ${t('order_tracking.tab_processing')}` },
      { id: 'IN_TRANSIT', label: `🚚 ${t('order_tracking.tab_in_transit')}` },
      { id: 'DELIVERED',  label: `✓ ${t('order_tracking.tab_delivered')}` },
      { id: 'CANCELLED',  label: t('order_tracking.tab_cancelled') },
    ],
    activeTab: currentTab,
    onChange: (tabId) => {
      if (tabId === currentTab) return;
      currentTab = tabId;
      loadOrders();
    },
  });
  tabFilterSlot.append(tabs);

  // 3. Orders List Slot
  container.append(ordersListSlot);
  root.append(container);

  async function loadOrders() {
    ordersListSlot.innerHTML = '';
    ordersListSlot.append(
      Skeleton({ width: '100%', height: '160px' }),
      Skeleton({ width: '100%', height: '160px' })
    );

    try {
      // Uses order.api.js → GET /orders/my-orders (mocked)
      const res = await getMyOrders({ status: currentTab !== 'ALL' ? currentTab : undefined });
      const allOrders = res.orders || res.data?.orders || [];

      // Client-side status filter (mock returns all; real API would filter server-side)
      const orders = currentTab === 'ALL'
        ? allOrders
        : allOrders.filter((o) => {
            const statuses = (o.sub_orders || []).map((s) => s.status);
            if (currentTab === 'PROCESSING') return statuses.some((s) => ['PLACED', 'CONFIRMED', 'PROCESSING'].includes(s));
            if (currentTab === 'IN_TRANSIT') return statuses.some((s) => ['SHIPPED', 'IN_TRANSIT'].includes(s));
            if (currentTab === 'DELIVERED')  return statuses.every((s) => s === 'DELIVERED');
            if (currentTab === 'CANCELLED')  return statuses.every((s) => s === 'CANCELLED');
            return true;
          });

      renderOrdersList(ordersListSlot, orders, nav, currentTab);
    } catch (err) {
      ordersListSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'alert alert--danger';
      errBox.textContent = t('order_tracking.load_orders_failed', { message: err.message });
      ordersListSlot.append(errBox);
    }
  }

  loadOrders();

  return () => {
    container.remove();
  };
}

/**
 * Renders the list of order cards or an empty state.
 */
function renderOrdersList(container, orders, nav, currentTab) {
  container.innerHTML = '';

  if (orders.length === 0) {
    const isFiltered = currentTab !== 'ALL';
    const empty = EmptyState({
      icon: '📦',
      title: isFiltered ? t('order_tracking.no_orders_filter') : t('order_tracking.no_orders'),
      description: isFiltered ? '' : t('cart.empty_description'),
      action: Button({
        label: `🛍️ ${t('order_tracking.start_shopping')}`,
        variant: 'primary',
        size: 'sm',
        onClick: () => nav('/'),
      }),
    });
    container.append(empty);
    return;
  }

  orders.forEach((order) => {
    const card = renderSingleOrderCard(order, nav);
    container.append(card);
  });
}

/**
 * Derives an aggregate order-level status from its sub-orders.
 * If all are DELIVERED → DELIVERED; any CANCELLED → CANCELLED; any SHIPPED/IN_TRANSIT → SHIPPED; else PLACED/PROCESSING.
 */
function deriveOrderStatus(order) {
  const subStatuses = (order.sub_orders || []).map((s) => s.status);
  if (!subStatuses.length) return order.status || 'PLACED';
  if (subStatuses.every((s) => s === 'DELIVERED')) return 'DELIVERED';
  if (subStatuses.every((s) => s === 'CANCELLED')) return 'CANCELLED';
  if (subStatuses.some((s) => s === 'SHIPPED' || s === 'IN_TRANSIT')) return 'SHIPPED';
  if (subStatuses.some((s) => s === 'PROCESSING' || s === 'CONFIRMED')) return 'PROCESSING';
  return 'PLACED';
}

/**
 * Builds a single order card with visual tracking progress bar.
 */
function renderSingleOrderCard(order, nav) {
  const card = document.createElement('div');
  card.className = 'customer-order-card';

  const status = deriveOrderStatus(order);

  const statusColor =
    status === 'DELIVERED' ? 'success'
    : status === 'CANCELLED' ? 'danger'
    : status === 'RETURNED' ? 'neutral'
    : 'primary';

  // Resolve status label through i18n-aware function
  const statusLabel = getSubOrderStatusLabel(status);

  // Locale-aware date formatting
  const lang = getLanguage();
  const locale = lang === 'bn' ? 'bn-BD' : 'en-US';
  const orderDate = new Date(order.created_at || order.placed_at || Date.now())
    .toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  // Top Row: Ref, Date, Status, Total
  const topRow = document.createElement('div');
  topRow.className = 'customer-order-card__top';
  topRow.innerHTML = `
    <div class="customer-order-card__ref-group">
      <div class="customer-order-card__ref-row">
        <span class="customer-order-card__ref">#${order.ref}</span>
        <span class="badge badge--${statusColor}">${statusLabel}</span>
      </div>
      <div class="customer-order-card__date">${t('order_tracking.order_date_label')}: ${orderDate}</div>
    </div>
    <div class="customer-order-card__price-group">
      <div class="customer-order-card__payment-label">${t('order_tracking.total_label')} (${order.payment_method || 'COD'})</div>
      <div class="customer-order-card__total">${formatCurrency(order.total_amount || 0)}</div>
    </div>
  `;
  card.append(topRow);

  // Visual Tracking Progress Stepper (skip for cancelled/returned)
  if (!['CANCELLED', 'RETURNED'].includes(status)) {
    const stepperWrap = document.createElement('div');
    stepperWrap.className = 'customer-order-card__stepper-wrap';

    // Use stage index from OrderTracker's shared logic
    const currentStageIdx = getStageIndex(status);

    const stepsHtml = ORDER_STAGES.map((stage, idx) => {
      const isDone   = idx < currentStageIdx;
      const isActive = idx === currentStageIdx;
      const cls = isDone ? 'customer-order-card__step--done'
                : isActive ? 'customer-order-card__step--active'
                : '';
      return `
        <div class="customer-order-card__step ${cls}">
          <div class="customer-order-card__step-num">${stage.icon}</div>
          <div class="customer-order-card__step-label">${t(stage.labelKey)}</div>
        </div>
      `;
    }).join('');

    stepperWrap.innerHTML = `<div class="customer-order-card__stepper">${stepsHtml}</div>`;
    card.append(stepperWrap);
  }

  // Items List — flatten from sub_orders if top-level items is empty
  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'customer-order-card__items';

  const topItems = order.items || [];
  const subItems = (order.sub_orders || []).flatMap((so) => so.items || []);
  const allItems = topItems.length ? topItems : subItems;

  allItems.forEach((item) => {
    const itemRow = document.createElement('div');
    itemRow.className = 'customer-order-card__item';

    const itemTitle = item.title_bn || item.title_en || item.title_snapshot || item.title
      || t('order_tracking.product_fallback');
    const itemImg = resolveProductImage({
      ...item,
      id: item.product_id || item.id,
      title_en: item.title_en || item.title_snapshot || item.title,
      title_bn: item.title_bn,
    });
    const qty = item.quantity || item.qty || 1;
    const unitPrice = item.unit_price || item.retail_price || 0;
    const lineTotal = item.total_price || item.line_total || 0;

    itemRow.innerHTML = `
      <div class="customer-order-card__item-left">
        <div class="customer-order-card__item-img-wrap">
          <img src="${itemImg}" alt="${itemTitle}" class="customer-order-card__item-img" onerror="this.src='/placeholder.svg'"/>
        </div>
        <div class="customer-order-card__item-info">
          <div class="customer-order-card__item-title">${itemTitle}</div>
          <div class="customer-order-card__item-meta">${t('order_tracking.qty_label')}: ${qty} × ${formatCurrency(unitPrice)}</div>
          ${
            item.warranty_card_id
              ? `<span class="badge badge--success badge--sm" style="margin-top:2px;">🛡️ ${t('order_tracking.warranty_active')}</span>`
              : ''
          }
        </div>
      </div>
      <div class="customer-order-card__item-price">${formatCurrency(lineTotal)}</div>
    `;

    itemsContainer.append(itemRow);
  });
  card.append(itemsContainer);

  // 3PL Courier Logistics Row (if available)
  const subOrderWithTracking = (order.sub_orders || []).find((s) => s.tracking_number);
  if (subOrderWithTracking) {
    const courierRow = document.createElement('div');
    courierRow.className = 'customer-order-card__courier';
    const trackUrl = subOrderWithTracking.tracking_url || '#';
    courierRow.innerHTML = `
      <div class="customer-order-card__courier-info">
        <span>🚚</span>
        <div>
          <strong>${subOrderWithTracking.courier_partner || subOrderWithTracking.courier_name || t('order_tracking.courier_partner')}:</strong>
          <code class="font-mono">${subOrderWithTracking.tracking_number}</code>
        </div>
      </div>
      <a href="${trackUrl}" target="_blank" rel="noopener noreferrer" class="customer-order-card__courier-link">
        ${t('order_tracking.courier_track_link')}
      </a>
    `;
    card.append(courierRow);
  }

  // Bottom Actions Row
  const bottomRow = document.createElement('div');
  bottomRow.className = 'customer-order-card__actions';

  const leftActions = document.createElement('div');
  leftActions.className = 'customer-order-card__action-left';

  // Print Invoice — subtle ghost style
  const invoiceBtn = document.createElement('button');
  invoiceBtn.type = 'button';
  invoiceBtn.className = 'order-action-btn order-action-btn--ghost';
  invoiceBtn.innerHTML = `<span class="order-action-btn__icon">🖨️</span><span>${t('order_tracking.invoice_btn')}</span>`;
  invoiceBtn.addEventListener('click', () => {
    toast.success(t('order_tracking.invoice_btn'));
    window.print();
  });
  leftActions.append(invoiceBtn);

  if (status === 'DELIVERED') {
    const reviewBtn = document.createElement('button');
    reviewBtn.type = 'button';
    reviewBtn.className = 'order-action-btn order-action-btn--ghost';
    reviewBtn.innerHTML = `<span class="order-action-btn__icon">⭐</span><span>${getLanguage() === 'bn' ? 'রিভিউ দিন' : 'Review'}</span>`;
    reviewBtn.addEventListener('click', () => nav(`/account/reviews?order_ref=${order.ref}`));
    leftActions.append(reviewBtn);
  }

  if (order.is_return_eligible) {
    const returnBtn = document.createElement('button');
    returnBtn.type = 'button';
    returnBtn.className = 'order-action-btn order-action-btn--ghost';
    returnBtn.innerHTML = `<span class="order-action-btn__icon">🔄</span><span>${t('order_tracking.request_return')}</span>`;
    returnBtn.addEventListener('click', () => nav('/account/returns'));
    leftActions.append(returnBtn);
  }

  const rightActions = document.createElement('div');
  rightActions.className = 'customer-order-card__action-right';

  // Track Details — branded pill CTA
  const trackDetailBtn = document.createElement('button');
  trackDetailBtn.type = 'button';
  trackDetailBtn.className = 'order-action-btn order-action-btn--primary';
  trackDetailBtn.innerHTML = `<span>${t('order_tracking.view_tracking')}</span><span class="order-action-btn__arrow">→</span>`;
  trackDetailBtn.addEventListener('click', () => nav(`/orders/${order.ref}`));
  rightActions.append(trackDetailBtn);

  const hasWarranty = allItems.some((i) => i.warranty_card_id);
  if (hasWarranty) {
    const warrantyBtn = document.createElement('button');
    warrantyBtn.type = 'button';
    warrantyBtn.className = 'order-action-btn order-action-btn--ghost';
    warrantyBtn.innerHTML = `<span class="order-action-btn__icon">🛡️</span><span>${t('order_tracking.warranty_active')}</span>`;
    warrantyBtn.addEventListener('click', () => nav('/account/warranties'));
    rightActions.append(warrantyBtn);
  }

  bottomRow.append(leftActions, rightActions);
  card.append(bottomRow);

  return card;
}
