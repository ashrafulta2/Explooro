/**
 * SalerOrderDetailPage.js — Detailed Reseller Order Breakdown & Delivery Timeline (Prompt 11.2).
 *
 * Route: /saler/orders/:id
 */

import { salerApi } from '../../services/saler.api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function SalerOrderDetailPage(root, { params, navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const orderId = params?.id;
  const container = document.createElement('div');
  container.className = 'saler-page-container';

  let order = null;
  let loading = true;
  let unsubscribeLang = null;

  async function loadData() {
    loading = true;
    render();
    try {
      const res = await salerApi.getOrderDetail(orderId);
      order = res?.data?.order || null;
    } catch (err) {
      toast.error(err.message || 'Failed to load order details');
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = '';
    const isBn = getLanguage() === 'bn';

    if (loading) {
      container.append(
        Skeleton({ width: '100%', height: '80px' }),
        Skeleton({ width: '100%', height: '240px' }),
        Skeleton({ width: '100%', height: '300px' })
      );
      return;
    }

    if (!order) {
      container.append(
        EmptyState({
          icon: '❓',
          title: 'Order Not Found',
          description: 'The requested order could not be located.',
          action: Button({
            label: t('saler_orders.detail_back'),
            variant: 'primary',
            onClick: () => nav('/saler/orders'),
          }),
        })
      );
      return;
    }

    // 1. Header
    const header = document.createElement('div');
    header.className = 'saler-header-row';
    header.innerHTML = `
      <div class="saler-header-row__titles">
        <div class="saler-header-row__breadcrumb">
          <a href="/saler/orders" class="hover:text-primary font-bold">← ${t('saler_orders.detail_back')}</a>
          <span>/</span>
          <span class="text-primary font-mono">${order.order_ref}</span>
        </div>
        <h1 class="saler-header-row__title">
          <span>📦</span>
          <span>${t('saler_orders.detail_title')}: ${order.order_ref}</span>
        </h1>
        <p class="saler-header-row__subtitle">
          Placed on ${formatDate(order.placed_at)} · Payment: <strong class="font-mono">${order.payment_method}</strong> (${order.payment_status})
        </p>
      </div>
      <div class="saler-header-row__actions">
        <a
          href="https://api.whatsapp.com/send?phone=${order.customer_phone.replace(/[^0-9]/g, '')}&text=${encodeURIComponent(`Hello ${order.customer_name}, updates regarding your order ${order.order_ref}:`)}"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn--sm bg-[#25D366] text-white hover:bg-[#1ebc59] font-bold flex items-center gap-1.5"
        >
          ${t('saler_orders.btn_contact_whatsapp')}
        </a>
      </div>
    `;
    container.append(header);

    // 2. Settlement & Commission KPI Callout
    const kpiBox = document.createElement('div');
    kpiBox.className = 'p-6 rounded-2xl bg-surface-0 border border-emerald-500/30 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4';
    kpiBox.innerHTML = `
      <div class="space-y-1">
        <div class="text-xs font-bold text-muted uppercase tracking-wider">Your Reseller Commission on this Order</div>
        <div class="text-3xl font-black font-mono text-emerald-600">+${formatCurrency(order.saler_commission_earned)}</div>
        <div class="text-xs text-muted">
          Escrow Status: <strong class="${order.escrow_status === 'RELEASED' ? 'text-emerald-600' : 'text-amber-600'}">${order.escrow_status === 'RELEASED' ? '✓ Settled & Available in Vault' : '🔒 Locked in Escrow (Clears upon delivery confirmation)'}</strong>
        </div>
      </div>
      <div class="flex items-center gap-4 text-right">
        <div>
          <div class="text-[10px] text-muted uppercase">Customer Total</div>
          <div class="text-lg font-bold font-mono text-foreground">${formatCurrency(order.total_retail_amount)}</div>
        </div>
        <div class="h-8 w-px bg-subtle"></div>
        <div>
          <div class="text-[10px] text-muted uppercase">Wholesale Cost</div>
          <div class="text-lg font-bold font-mono text-muted">${formatCurrency(order.total_wholesale_cost)}</div>
        </div>
      </div>
    `;
    container.append(kpiBox);

    // 3. Grid: Left (Items & Breakdown) + Right (Buyer Info & Courier Timeline)
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 lg:grid-cols-12 gap-6';

    // Left Column: Items (7 Cols)
    const leftCol = document.createElement('div');
    leftCol.className = 'lg:col-span-7 space-y-6';

    const itemsCard = document.createElement('div');
    itemsCard.className = 'saler-kpi-card space-y-4';
    itemsCard.innerHTML = `
      <div class="border-b border-subtle pb-3">
        <h3 class="font-bold text-sm text-foreground flex items-center gap-2">
          🛍️ ${t('saler_orders.detail_items_title')}
        </h3>
      </div>
      <div class="space-y-3">
        ${(order.items || []).map((item) => `
          <div class="flex items-center justify-between p-3 rounded-xl border border-subtle bg-surface-1">
            <div class="flex items-center gap-3">
              <img src="${item.image_url || '/placeholder-product.png'}" alt="${item.title_en}" class="w-14 h-14 rounded-lg object-cover border border-subtle" />
              <div>
                <div class="font-bold text-sm text-foreground">${isBn ? (item.title_bn || item.title_en) : item.title_en}</div>
                <div class="text-xs text-muted">Quantity: ${item.qty}</div>
                <div class="text-xs font-mono mt-1 text-muted">
                  Wholesale Base: ৳${item.wholesale_price} → Your Selling Price: ৳${item.retail_price}
                </div>
              </div>
            </div>
            <div class="text-right">
              <div class="text-base font-black font-mono text-emerald-600">+${formatCurrency(item.saler_profit)}</div>
              <div class="text-[10px] text-muted uppercase">Net Profit</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    leftCol.append(itemsCard);
    grid.append(leftCol);

    // Right Column: Buyer Info & Timeline (5 Cols)
    const rightCol = document.createElement('div');
    rightCol.className = 'lg:col-span-5 space-y-6';

    const buyerCard = document.createElement('div');
    buyerCard.className = 'saler-kpi-card space-y-3';
    buyerCard.innerHTML = `
      <div class="border-b border-subtle pb-2">
        <h3 class="font-bold text-sm text-foreground">👤 Customer & Shipping Details</h3>
      </div>
      <div class="space-y-2 text-xs">
        <div>
          <span class="text-muted font-bold uppercase text-[10px]">Name:</span>
          <div class="font-bold text-sm text-foreground">${order.customer_name}</div>
        </div>
        <div>
          <span class="text-muted font-bold uppercase text-[10px]">Phone Number:</span>
          <div class="font-mono text-primary font-bold">${order.customer_phone}</div>
        </div>
        <div>
          <span class="text-muted font-bold uppercase text-[10px]">Delivery Address:</span>
          <div class="text-foreground">${order.shipping_address} (${order.district})</div>
        </div>
        <div class="pt-2 border-t border-subtle">
          <span class="text-muted font-bold uppercase text-[10px]">Courier Tracking:</span>
          <div class="font-bold text-foreground">${order.courier_name}</div>
          <div class="font-mono text-muted">${order.tracking_number}</div>
        </div>
      </div>
    `;
    rightCol.append(buyerCard);

    // Timeline Card
    const timelineCard = document.createElement('div');
    timelineCard.className = 'saler-kpi-card space-y-3';
    timelineCard.innerHTML = `
      <div class="border-b border-subtle pb-2">
        <h3 class="font-bold text-sm text-foreground">🚚 ${t('saler_orders.detail_timeline_title')}</h3>
      </div>
      <div class="space-y-3 text-xs pl-2 border-l-2 border-primary/30">
        <div class="relative pl-4">
          <div class="absolute -left-[9px] top-1 w-2.5 h-2.5 rounded-full bg-primary"></div>
          <div class="font-bold text-foreground">${t('saler_orders.timeline_placed')}</div>
          <div class="text-muted text-[11px]">${formatDate(order.placed_at)}</div>
        </div>
        <div class="relative pl-4">
          <div class="absolute -left-[9px] top-1 w-2.5 h-2.5 rounded-full ${['SHIPPED', 'DELIVERED'].includes(order.fulfillment_status) ? 'bg-primary' : 'bg-muted'}"></div>
          <div class="font-bold text-foreground">${t('saler_orders.timeline_confirmed')}</div>
        </div>
        <div class="relative pl-4">
          <div class="absolute -left-[9px] top-1 w-2.5 h-2.5 rounded-full ${['SHIPPED', 'DELIVERED'].includes(order.fulfillment_status) ? 'bg-primary' : 'bg-muted'}"></div>
          <div class="font-bold text-foreground">${t('saler_orders.timeline_shipped')}</div>
          <div class="text-muted text-[11px]">${order.courier_name} (${order.tracking_number})</div>
        </div>
        <div class="relative pl-4">
          <div class="absolute -left-[9px] top-1 w-2.5 h-2.5 rounded-full ${order.fulfillment_status === 'DELIVERED' ? 'bg-emerald-500' : 'bg-muted'}"></div>
          <div class="font-bold text-foreground">${t('saler_orders.timeline_delivered')}</div>
        </div>
      </div>
    `;
    rightCol.append(timelineCard);

    grid.append(rightCol);
    container.append(grid);
  }

  unsubscribeLang = subscribeLang(() => render());

  loadData();
  root.append(container);

  return () => {
    if (unsubscribeLang) unsubscribeLang();
    container.remove();
  };
}
