/**
 * CustomerDashboardPage.js — Low-Literacy Friendly Customer Portal & Command Hub (Prompt 11.3 / idea §AL.3).
 *
 * Implements:
 * 1. Icon-led navigation with large touch targets (48px+) and concise plain Bengali copy.
 * 2. Real-time telemetry: in-transit orders tracker, coins & login streak calendar, wishlist price drops, warranties.
 * 3. 1-Click Saler Upgrade integration (BecomeSalerCta).
 * 4. 15-Second interactive video walkthrough modals for seamless low-literacy onboarding.
 * 5. Complete 2-click access to all customer features.
 *
 * Route: /account
 */

import { customerApi } from '../../services/customer.api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Modal } from '../../components/ui/Modal.js';
import { BecomeSalerCta } from '../../components/customer/BecomeSalerCta.js';

export default function CustomerDashboardPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'customer-dashboard-page container mx-auto p-4 md:p-6 space-y-6 max-w-6xl';

  // 1. Header Banner
  const header = document.createElement('div');
  header.className = 'flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-5';
  header.innerHTML = `
    <div>
      <div class="flex items-center gap-2 mb-1">
        <span class="badge badge--primary text-[10px] font-bold uppercase tracking-wider">
          ${t('customer.dashboard.badge', 'গ্রাহক একাউন্ট')}
        </span>
        <button id="walkthrough-guide-btn" class="text-xs text-primary font-bold hover:underline flex items-center gap-1">
          🎬 ${t('customer.dashboard.watch_guide', '১৫ সেকেন্ডের টিউটোরিয়াল')}
        </button>
      </div>
      <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
        ${t('customer.dashboard.title', 'আমার অ্যাকাউন্ট ড্যাশবোর্ড')}
      </h1>
      <p class="text-xs md:text-sm text-muted mt-1">
        ${t('customer.dashboard.subtitle', 'অর্ডার ট্র্যাক করুন, কয়েন দিয়ে ছাড় নিন ও পছন্দের দোকানের আপডেট দেখুন।')}
      </p>
    </div>

    <div class="flex items-center gap-2">
      <a href="/" class="btn btn--secondary btn--sm flex items-center gap-1 text-xs font-bold">
        🛍️ ${t('customer.dashboard.continue_shopping', 'কেনাকাটা করুন')}
      </a>
    </div>
  `;

  container.append(header);

  // 15-second Walkthrough Trigger
  header.querySelector('#walkthrough-guide-btn')?.addEventListener('click', () => {
    openCustomerWalkthroughModal(nav);
  });

  // Dynamic Content Slot
  const contentSlot = document.createElement('div');
  contentSlot.className = 'space-y-6';
  container.append(contentSlot);
  root.append(container);

  async function loadDashboard() {
    contentSlot.innerHTML = '';
    contentSlot.append(
      Skeleton({ width: '100%', height: '120px' }),
      Skeleton({ width: '100%', height: '220px' })
    );

    try {
      const res = await customerApi.getDashboard();
      const data = res.data || {};
      renderDashboard(contentSlot, data, nav);
    } catch (err) {
      contentSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'py-8 text-center text-danger';
      errBox.textContent = t('customer.dashboard.load_failed', 'তথ্য লোড করা যায়নি। অনুগ্রহ করে পুনরায় চেষ্টা করুন।');
      contentSlot.append(errBox);
    }
  }

  loadDashboard();

  return () => {
    container.remove();
  };
}

/**
 * Renders complete Customer Dashboard sections.
 */
function renderDashboard(container, data, nav) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'space-y-6';

  // 1. Telemetry Highlights Bar (Active orders, Streak Coins, Wishlist drops)
  renderTelemetryBar(wrap, data, nav);

  // 2. Active In-Flight Order Tracker (if any order is in transit or placed)
  if (data.orders?.latest_order && data.orders.active_count > 0) {
    renderInFlightOrderWidget(wrap, data.orders.latest_order, nav);
  }

  // 3. 1-Click Saler Upgrade CTA (BecomeSalerCta)
  if (!data.is_saler) {
    const becomeSaler = BecomeSalerCta({ onNavigate: nav });
    wrap.append(becomeSaler.element);
  }

  // 4. Quick Action Grid (Large 48px+ Touch Targets for Low Literacy)
  renderActionGrid(wrap, data, nav);

  // 5. Wishlist Price Drop Alert Highlights (if price drops exist)
  if (data.wishlist?.price_drops_count > 0) {
    renderPriceDropHighlights(wrap, data.wishlist, nav);
  }

  container.append(wrap);
}

/**
 * 1. Quick Telemetry & Rewards Cards Bar
 */
function renderTelemetryBar(container, data, nav) {
  const o = data.orders || {};
  const r = data.rewards || {};
  const w = data.wishlist || {};

  const cards = [
    {
      title: t('customer.dashboard.stat_orders', 'চলতি অর্ডার'),
      value: `${o.active_count || 0} টি`,
      sub: `${o.delivered_count || 0} টি সফল ডেলিভারি`,
      icon: '📦',
      color: 'primary',
      url: '/account/orders',
    },
    {
      title: t('customer.dashboard.stat_coins', 'লয়্যালটি কয়েন'),
      value: `${r.coins_balance || 0} 🪙`,
      sub: `🔥 ${r.current_streak_days || 1} দিনের ডেইলি স্ট্রিক`,
      icon: '💎',
      color: 'amber-500',
      url: '/account/coins',
    },
    {
      title: t('customer.dashboard.stat_wishlist', 'উইশলিস্ট পণ্য'),
      value: `${w.total_items || 0} টি`,
      sub: w.price_drops_count > 0 ? `📉 ${w.price_drops_count} টির দাম কমেছে!` : 'সংরক্ষিত পণ্য',
      icon: '💖',
      color: w.price_drops_count > 0 ? 'emerald-600' : 'foreground',
      url: '/account/wishlist',
    },
    {
      title: t('customer.dashboard.stat_referral', 'রেফারেল লিংক'),
      value: r.referral_code || 'REF000000',
      sub: 'বন্ধুকে ইনভাইট করে আয় করুন',
      icon: '🤝',
      color: 'blue-600',
      url: '/account/referrals',
    },
  ];

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4';

  cards.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'p-4 rounded-2xl border border-subtle bg-surface shadow-xs hover:border-primary/40 cursor-pointer transition-all space-y-1';
    card.onclick = () => nav(c.url);

    card.innerHTML = `
      <div class="flex items-center justify-between text-xs text-muted font-bold">
        <span>${c.title}</span>
        <span class="text-base">${c.icon}</span>
      </div>
      <div class="text-xl font-extrabold text-${c.color} tracking-tight font-mono">${c.value}</div>
      <div class="text-[11px] text-muted truncate">${c.sub}</div>
    `;

    grid.append(card);
  });

  container.append(grid);
}

/**
 * 2. In-Flight Order Live Progress Tracker
 */
function renderInFlightOrderWidget(container, order, nav) {
  const card = document.createElement('div');
  card.className = 'p-5 rounded-2xl border-2 border-primary/30 bg-primary/5 space-y-4 shadow-sm';

  const orderItems = order.items || [];
  const firstItemTitle = orderItems[0]?.product_title_bn || orderItems[0]?.product_title_en || 'পণ্য';

  card.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-primary/20 pb-3">
      <div>
        <div class="flex items-center gap-2">
          <span class="badge badge--primary text-[10px] font-bold">অর্ডার ট্র্যাকিং</span>
          <span class="text-xs font-mono font-bold text-foreground">#${order.ref}</span>
        </div>
        <h3 class="text-sm font-bold text-foreground mt-1">
          ${firstItemTitle} ${orderItems.length > 1 ? `(+${orderItems.length - 1} টি পণ্য)` : ''}
        </h3>
      </div>
      <div class="text-right">
        <div class="text-xs text-muted">মোট মূল্য</div>
        <div class="text-base font-extrabold text-foreground font-mono">${formatCurrency(order.total_amount || 0)}</div>
      </div>
    </div>

    <!-- Visual Tracking Stepper -->
    <div class="grid grid-cols-4 gap-2 pt-1 text-center">
      <div class="space-y-1">
        <div class="w-8 h-8 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">✓</div>
        <div class="text-[11px] font-bold text-foreground">অর্ডার গৃহীত</div>
      </div>
      <div class="space-y-1">
        <div class="w-8 h-8 mx-auto rounded-full ${['PROCESSING', 'DISPATCHED', 'SHIPPED', 'DELIVERED'].includes(order.status) ? 'bg-emerald-500 text-white' : 'bg-subtle text-muted'} flex items-center justify-center text-xs font-bold">📦</div>
        <div class="text-[11px] font-bold text-foreground">প্যাকেজিং</div>
      </div>
      <div class="space-y-1">
        <div class="w-8 h-8 mx-auto rounded-full ${['DISPATCHED', 'SHIPPED', 'DELIVERED'].includes(order.status) ? 'bg-emerald-500 text-white' : 'bg-subtle text-muted'} flex items-center justify-center text-xs font-bold">🚚</div>
        <div class="text-[11px] font-bold text-foreground">কুরিয়ারে রওয়ানা</div>
      </div>
      <div class="space-y-1">
        <div class="w-8 h-8 mx-auto rounded-full ${order.status === 'DELIVERED' ? 'bg-emerald-500 text-white' : 'bg-subtle text-muted'} flex items-center justify-center text-xs font-bold">🏠</div>
        <div class="text-[11px] font-bold text-foreground">ডেলিভারি</div>
      </div>
    </div>
  `;

  const btnRow = document.createElement('div');
  btnRow.className = 'flex justify-end pt-2';

  const viewBtn = Button({
    label: 'বিস্তারিত দেখুন ও ট্র্যাক করুন →',
    variant: 'primary',
    size: 'sm',
    onClick: () => nav('/account/orders'),
  });

  btnRow.append(viewBtn);
  card.append(btnRow);
  container.append(card);
}

/**
 * 3. Quick Action Grid (Large 48px+ Touch Targets for Low Literacy)
 */
function renderActionGrid(container, data, nav) {
  const section = document.createElement('div');
  section.className = 'space-y-4';

  section.innerHTML = `
    <div class="border-b border-subtle pb-2">
      <h3 class="text-base font-bold text-foreground">
        🧭 ${t('customer.dashboard.actions_title', 'এক নজরে সব ফিচার')}
      </h3>
      <p class="text-xs text-muted">
        ${t('customer.dashboard.actions_desc', 'যেকোনো অপশনে ক্লিক করে সহজেই আপনার সেবা নিন।')}
      </p>
    </div>
  `;

  const actions = [
    {
      id: 'act_orders',
      title: 'আমার সব অর্ডার',
      desc: 'অর্ডারের অবস্থান ট্র্যাক করুন',
      icon: '📦',
      url: '/account/orders',
      badge: `${data.orders?.total_count || 0} টি`,
      bgColor: 'bg-blue-500/10 text-blue-600',
    },
    {
      id: 'act_following',
      title: 'পছন্দের দোকান',
      desc: 'নতুন পণ্য ও লাইভ স্ট্রিম',
      icon: '🏪',
      url: '/account/following',
      badge: `${data.social?.followed_stores_count || 0} টি`,
      bgColor: 'bg-purple-500/10 text-purple-600',
    },
    {
      id: 'act_wishlist',
      title: 'পছন্দের পণ্য',
      desc: 'দাম কমার অ্যালার্ট দেখুন',
      icon: '💖',
      url: '/account/wishlist',
      badge: `${data.wishlist?.total_items || 0} টি`,
      bgColor: 'bg-pink-500/10 text-pink-600',
    },
    {
      id: 'act_coins',
      title: 'কয়েন ও পুরস্কার',
      desc: 'দৈনিক বোনাস কয়েন নিন',
      icon: '🪙',
      url: '/account/coins',
      badge: `${data.rewards?.coins_balance || 0} 🪙`,
      bgColor: 'bg-amber-500/10 text-amber-600',
    },
    {
      id: 'act_warranties',
      title: 'ডিজিটাল ওয়ারেন্টি',
      desc: 'সার্টিফিকেট ও ক্লেইম জমা',
      icon: '🛡️',
      url: '/account/warranties',
      badge: `${data.protection?.active_warranties_count || 0} টি`,
      bgColor: 'bg-emerald-500/10 text-emerald-600',
    },
    {
      id: 'act_teams',
      title: 'দলগত কেনাকাটা',
      desc: 'বন্ধুদের সাথে বিশেষ ছাড়',
      icon: '👥',
      url: '/account/team-purchases',
      badge: `${data.social?.active_teams_count || 0} টি দল`,
      bgColor: 'bg-indigo-500/10 text-indigo-600',
    },
    {
      id: 'act_coupons',
      title: 'কুপন ও ভাউচার',
      desc: 'অর্ডারে অতিরিক্ত ছাড় নিন',
      icon: '🎟️',
      url: '/account/coupons',
      badge: 'ডিসকাউন্ট',
      bgColor: 'bg-rose-500/10 text-rose-600',
    },
    {
      id: 'act_returns',
      title: 'রিটার্ন ও রিফান্ড',
      desc: 'পণ্য ফেরত ও টাকা ফেরত',
      icon: '🔄',
      url: '/account/returns',
      badge: `${data.protection?.active_returns_count || 0} টি`,
      bgColor: 'bg-cyan-500/10 text-cyan-600',
    },
    {
      id: 'act_reviews',
      title: 'ভিডিও রিভিউ ও ফিড',
      desc: 'ক্রেতাদের আসল রিভিউ দেখুন',
      icon: '🎬',
      url: '/account/reviews',
      badge: 'ইউজিসির গল্প',
      bgColor: 'bg-violet-500/10 text-violet-600',
    },
    {
      id: 'act_live',
      title: 'লাইভ শপিং',
      desc: 'লাইভে পণ্য দেখে অর্ডার',
      icon: '🎥',
      url: '/live',
      badge: 'লাইভ স্টুডিও',
      bgColor: 'bg-red-500/10 text-red-600',
    },
    {
      id: 'act_referrals',
      title: 'ইনভাইট করে আয়',
      desc: 'রেফার করে ক্যাশব্যাক বোনাস',
      icon: '🤝',
      url: '/account/referrals',
      badge: 'বোনাস',
      bgColor: 'bg-teal-500/10 text-teal-600',
    },
    {
      id: 'act_addresses',
      title: 'ডেলিভারি ঠিকানা',
      desc: 'ঠিকানা সংরক্ষণ ও পরিবর্তন',
      icon: '📍',
      url: '/account/addresses',
      badge: 'ঠিকানা',
      bgColor: 'bg-slate-500/10 text-slate-600',
    },
  ];

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4';

  actions.forEach((act) => {
    const btn = document.createElement('button');
    btn.className = 'min-h-[96px] p-4 rounded-2xl border border-subtle bg-surface hover:border-primary/40 hover:shadow-sm active:scale-98 transition-all flex flex-col justify-between text-left space-y-2';
    btn.onclick = () => nav(act.url);

    btn.innerHTML = `
      <div class="flex items-center justify-between w-full">
        <div class="w-11 h-11 rounded-2xl ${act.bgColor} flex items-center justify-center text-2xl shadow-xs">
          ${act.icon}
        </div>
        <span class="badge badge--neutral text-[10px] font-bold">${act.badge}</span>
      </div>
      <div>
        <div class="text-sm font-extrabold text-foreground leading-tight">${act.title}</div>
        <div class="text-[11px] text-muted mt-0.5 leading-tight line-clamp-1">${act.desc}</div>
      </div>
    `;

    grid.append(btn);
  });

  section.append(grid);
  container.append(section);
}

/**
 * 4. Wishlist Price Drop Alert Highlights
 */
function renderPriceDropHighlights(container, wishlist, nav) {
  const section = document.createElement('div');
  section.className = 'p-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 space-y-3';

  section.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-lg">📉</span>
        <h3 class="text-sm font-bold text-foreground">
          ${t('customer.dashboard.price_drops_title', 'উইশলিস্টে থাকা পণ্যের দাম কমেছে!')}
        </h3>
      </div>
      <button id="view-all-wishlist" class="text-xs font-bold text-primary hover:underline">
        সব দেখুন →
      </button>
    </div>
  `;

  const list = document.createElement('div');
  list.className = 'grid grid-cols-1 sm:grid-cols-2 gap-3';

  const droppedItems = wishlist.items.filter((i) => i.price_dropped);

  droppedItems.forEach((it) => {
    const row = document.createElement('div');
    row.className = 'p-3 rounded-xl bg-surface border border-subtle flex items-center justify-between gap-3 shadow-xs';
    row.innerHTML = `
      <div class="space-y-0.5">
        <div class="text-xs font-bold text-foreground line-clamp-1">${it.title_bn || it.title_en}</div>
        <div class="flex items-center gap-2 text-xs">
          <span class="text-muted line-through">৳${it.saved_price}</span>
          <span class="font-extrabold text-emerald-600 font-mono">৳${it.current_price}</span>
          <span class="badge badge--success text-[9px] font-bold">৳${it.drop_amount} ছাড়!</span>
        </div>
      </div>
    `;

    const buyBtn = Button({
      label: 'কিনুন →',
      variant: 'primary',
      size: 'xs',
      onClick: () => nav(`/product/${it.slug || it.product_id}`),
    });

    row.append(buyBtn);
    list.append(row);
  });

  section.append(list);
  section.querySelector('#view-all-wishlist')?.addEventListener('click', () => nav('/account/wishlist'));
  container.append(section);
}

/**
 * 15-Second Video Walkthrough Modal Simulator for Low-Literacy Users
 */
function openCustomerWalkthroughModal(nav) {
  let modal;
  const body = document.createElement('div');
  body.className = 'space-y-4';

  body.innerHTML = `
    <div class="relative w-full aspect-video rounded-2xl bg-slate-900 border border-subtle overflow-hidden flex flex-col items-center justify-center text-white p-6 text-center space-y-3 shadow-inner">
      <div class="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-2xl shadow-lg animate-pulse">
        ▶
      </div>
      <div class="space-y-1">
        <div class="text-sm font-bold">১৫ সেকেন্ডের সহজ ভিডিও গাইড</div>
        <div class="text-xs text-slate-400">কীভাবে সহজেই অর্ডার ট্র্যাক করবেন এবং কয়েন ব্যবহার করবেন</div>
      </div>
      <div class="w-full max-w-xs bg-slate-800 h-1.5 rounded-full overflow-hidden">
        <div class="bg-primary h-full w-3/4 rounded-full"></div>
      </div>
    </div>
    <div class="p-3 rounded-xl bg-surface border border-subtle space-y-2">
      <div class="text-xs font-bold text-foreground">💡 তিনটি সহজ টিপস:</div>
      <ul class="text-xs text-muted space-y-1 list-disc pl-4">
        <li>প্রতিদিন অ্যাপে ঢুকে ডেইলি লগইন কয়েন সংগ্রহ করুন।</li>
        <li>অর্ডার ট্র্যাক করতে 'আমার সব অর্ডার' অপশনে ক্লিক করুন।</li>
        <li>১ ক্লিকেই কোনো পুঁজি ছাড়া নিজের অনলাইন দোকান শুরু করুন।</li>
      </ul>
    </div>
  `;

  const footer = document.createElement('div');
  footer.className = 'flex justify-between items-center w-full';

  const closeBtn = Button({
    label: 'বন্ধ করুন',
    variant: 'secondary',
    size: 'sm',
    onClick: () => modal.close(),
  });

  const goShopBtn = Button({
    label: 'কেনাকাটা শুরু করুন →',
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      modal.close();
      nav('/');
    },
  });

  footer.append(closeBtn, goShopBtn);

  modal = Modal({
    title: '🎬 এক্সপ্লোরো ভিডিও গাইড',
    content: body,
    footer,
    size: 'md',
  });

  modal.open();
}
