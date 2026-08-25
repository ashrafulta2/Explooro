/**
 * OrdersPage.js — Visual Tracking Orders Hub (Prompt 11.3 / idea §AL.3).
 *
 * Implements:
 * 1. Filter tabs (All, Processing, In-Transit, Delivered, Cancelled/Returned).
 * 2. Visual multi-stage status progress bar for low-literacy users.
 * 3. 3PL courier consignment integration and live tracking.
 * 4. 1-Click invoice download, warranty certificates links, and return request triggers.
 *
 * Route: /account/orders
 */

import { customerApi } from '../../services/customer.api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Tabs } from '../../components/ui/Tabs.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function OrdersPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'orders-page container mx-auto p-4 md:p-6 space-y-6 max-w-5xl';

  let currentTab = 'ALL';

  // 1. Header
  const header = document.createElement('div');
  header.className = 'flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-5';
  header.innerHTML = `
    <div>
      <div class="flex items-center gap-2 mb-1">
        <a href="/account" class="text-xs font-bold text-primary hover:underline flex items-center gap-1">
          ← ${t('customer.orders.back_to_account', 'ড্যাশবোর্ড')}
        </a>
      </div>
      <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
        ${t('customer.orders.title', 'আমার সকল অর্ডার ও ট্র্যাকিং')}
      </h1>
      <p class="text-xs md:text-sm text-muted mt-1">
        ${t('customer.orders.subtitle', 'আপনার সমস্ত অর্ডারের বর্তমান অবস্থা এবং কুরিয়ার ডেলিভারি ট্র্যাক করুন।')}
      </p>
    </div>
  `;
  container.append(header);

  // 2. Status Filter Tabs
  const tabFilterSlot = document.createElement('div');
  container.append(tabFilterSlot);

  // Declared before Tabs(): Tabs runs select(activeTab) during construction, which fires onChange
  // synchronously — so loadOrders() can run before this line is reached, hitting the temporal dead
  // zone on a `const` declared further down.
  const ordersListSlot = document.createElement('div');
  ordersListSlot.className = 'space-y-4';

  const tabs = Tabs({
    tabs: [
      { id: 'ALL', label: 'সব অর্ডার (All)' },
      { id: 'PROCESSING', label: '📦 প্রসেসিং' },
      { id: 'IN_TRANSIT', label: '🚚 কুরিয়ারে রওয়ানা' },
      { id: 'DELIVERED', label: '✓ সম্পন্ন (Delivered)' },
      { id: 'CANCELLED', label: 'বাতিল / ফেরত' },
    ],
    activeTab: currentTab,
    onChange: (tabId) => {
      // Ignore the callback Tabs fires for the already-active tab while mounting; the initial
      // fetch is the explicit loadOrders() below, so this would otherwise double-request.
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
      const res = await customerApi.getOrders({ status: currentTab });
      const orders = res.data?.orders || [];
      renderOrdersList(ordersListSlot, orders, nav);
    } catch (err) {
      ordersListSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'py-8 text-center text-danger';
      errBox.textContent = t('customer.orders.load_failed', 'অর্ডার লোড করতে ব্যর্থ হয়েছে।');
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
function renderOrdersList(container, orders, nav) {
  container.innerHTML = '';

  if (orders.length === 0) {
    const empty = EmptyState({
      icon: '📦',
      title: 'কোনো অর্ডার পাওয়া যায়নি',
      description: 'এই ক্যাটাগরিতে আপনার কোনো অর্ডার নেই। এক্সপ্লোরোতে এখনই নতুন কেনাকাটা করুন!',
      action: Button({
        label: '🛍️ কেনাকাটা শুরু করুন',
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
 * Builds a single order card with visual tracking progress bar.
 */
function renderSingleOrderCard(order, nav) {
  const card = document.createElement('div');
  card.className = 'p-5 md:p-6 rounded-2xl border border-subtle bg-surface shadow-xs space-y-4 hover:border-primary/30 transition-all';

  const statusColor = order.status === 'DELIVERED' ? 'success'
    : order.status === 'CANCELLED' ? 'danger'
    : order.status === 'RETURNED' ? 'neutral'
    : 'primary';

  const statusLabel = order.status === 'DELIVERED' ? '✓ ডেলিভারি সম্পন্ন'
    : order.status === 'CANCELLED' ? '✕ অর্ডার বাতিল'
    : order.status === 'RETURNED' ? '🔄 পণ্য ফেরত গৃহীত'
    : order.status === 'DISPATCHED' ? '🚚 কুরিয়ারে রওয়ানা'
    : order.status === 'PROCESSING' ? '📦 প্যাকিং চলছে'
    : '⏳ অর্ডার গৃহীত';

  const orderDate = new Date(order.created_at).toLocaleDateString('bn-BD', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Top Row: Ref, Date, Status, Total
  const topRow = document.createElement('div');
  topRow.className = 'flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-subtle pb-3';
  topRow.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono font-bold text-foreground">#${order.ref}</span>
          <span class="badge badge--${statusColor} text-[10px] font-bold">${statusLabel}</span>
        </div>
        <div class="text-[11px] text-muted">অর্ডারের তারিখ: ${orderDate}</div>
      </div>
    </div>
    <div class="text-right">
      <div class="text-[10px] text-muted uppercase">মোট মূল্য (${order.payment_method})</div>
      <div class="text-base font-extrabold text-foreground font-mono">${formatCurrency(order.total_amount)}</div>
    </div>
  `;
  card.append(topRow);

  // Visual Tracking Progress Stepper (Steps 1 to 5)
  if (!['CANCELLED', 'RETURNED'].includes(order.status)) {
    const stepper = document.createElement('div');
    stepper.className = 'py-2 px-3 rounded-xl bg-subtle/20';

    const currentStep = order.tracking_step || 1;
    stepper.innerHTML = `
      <div class="grid grid-cols-4 gap-1 text-center">
        <div class="space-y-1">
          <div class="w-6 h-6 mx-auto rounded-full ${currentStep >= 1 ? 'bg-emerald-500 text-white' : 'bg-subtle text-muted'} flex items-center justify-center text-[10px] font-bold">1</div>
          <div class="text-[10px] font-bold text-foreground">অর্ডার গৃহীত</div>
        </div>
        <div class="space-y-1">
          <div class="w-6 h-6 mx-auto rounded-full ${currentStep >= 3 ? 'bg-emerald-500 text-white' : 'bg-subtle text-muted'} flex items-center justify-center text-[10px] font-bold">2</div>
          <div class="text-[10px] font-bold text-foreground">প্যাকেজিং</div>
        </div>
        <div class="space-y-1">
          <div class="w-6 h-6 mx-auto rounded-full ${currentStep >= 4 ? 'bg-emerald-500 text-white' : 'bg-subtle text-muted'} flex items-center justify-center text-[10px] font-bold">3</div>
          <div class="text-[10px] font-bold text-foreground">কুরিয়ারে রওয়ানা</div>
        </div>
        <div class="space-y-1">
          <div class="w-6 h-6 mx-auto rounded-full ${currentStep >= 5 ? 'bg-emerald-500 text-white' : 'bg-subtle text-muted'} flex items-center justify-center text-[10px] font-bold">4</div>
          <div class="text-[10px] font-bold text-foreground">ডেলিভারি সম্পন্ন</div>
        </div>
      </div>
    `;
    card.append(stepper);
  }

  // Items List
  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'space-y-2.5';

  order.items.forEach((item) => {
    const itemRow = document.createElement('div');
    itemRow.className = 'flex items-center justify-between gap-3 p-2 rounded-xl bg-surface hover:bg-subtle/10 transition-colors';

    itemRow.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-lg bg-subtle overflow-hidden shrink-0 flex items-center justify-center">
          <img src="${item.image_url}" alt="${item.title_en}" class="w-full h-full object-cover" onerror="this.src='/placeholder-product.svg'"/>
        </div>
        <div>
          <div class="text-xs font-bold text-foreground line-clamp-1">${item.title_bn || item.title_en}</div>
          <div class="text-[11px] text-muted font-mono">পরিমাণ: ${item.quantity} × ৳${item.unit_price}</div>
          ${
            item.warranty_card_id
              ? `<span class="badge badge--success text-[9px] font-bold mt-0.5 inline-block">🛡️ ডিজিটাল ওয়ারেন্টি সক্রিয়</span>`
              : ''
          }
        </div>
      </div>
      <div class="text-right">
        <div class="text-xs font-extrabold text-foreground font-mono">৳${item.total_price}</div>
      </div>
    `;

    itemsContainer.append(itemRow);
  });
  card.append(itemsContainer);

  // 3PL Courier Logistics Row (if available)
  const subOrderWithTracking = order.sub_orders.find((s) => s.tracking_number);
  if (subOrderWithTracking) {
    const courierRow = document.createElement('div');
    courierRow.className = 'p-3 rounded-xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs';
    courierRow.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-base">🚚</span>
        <div>
          <span class="font-bold text-foreground">${subOrderWithTracking.courier_name}:</span>
          <span class="font-mono text-primary font-bold">#${subOrderWithTracking.tracking_number}</span>
        </div>
      </div>
      <a href="${subOrderWithTracking.tracking_url || '#'}" target="_blank" class="text-xs font-bold text-primary hover:underline">
        কুরিয়ারে ট্র্যাক করুন ↗
      </a>
    `;
    card.append(courierRow);
  }

  // Bottom Actions Row (Invoice, Return, Warranties)
  const bottomRow = document.createElement('div');
  bottomRow.className = 'flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-subtle';

  const leftActions = document.createElement('div');
  leftActions.className = 'flex items-center gap-2';

  const invoiceBtn = Button({
    label: '🖨️ রশিদ / ইনভয়েস',
    variant: 'secondary',
    size: 'xs',
    onClick: () => {
      toast.success('ইনভয়েস ডাউনলোড প্রস্তুত হচ্ছে...');
      window.print();
    },
  });
  leftActions.append(invoiceBtn);

  if (order.is_return_eligible) {
    const returnBtn = Button({
      label: '🔄 পণ্য ফেরত চান?',
      variant: 'secondary',
      size: 'xs',
      onClick: () => nav('/account/returns'),
    });
    leftActions.append(returnBtn);
  }

  const rightActions = document.createElement('div');
  rightActions.className = 'flex items-center gap-2';

  // Check if order has warranty
  const hasWarranty = order.items.some((i) => i.warranty_card_id);
  if (hasWarranty) {
    const warrantyBtn = Button({
      label: '🛡️ ওয়ারেন্টি কার্ড',
      variant: 'primary',
      size: 'xs',
      onClick: () => nav('/account/warranties'),
    });
    rightActions.append(warrantyBtn);
  }

  bottomRow.append(leftActions, rightActions);
  card.append(bottomRow);

  return card;
}
