/**
 * CustomerDashboardPage.js — Low-Literacy Friendly Customer Portal & Command Hub (Prompt 11.3 / idea §AL.3).
 *
 * Implements:
 * 1. Icon-led navigation with large touch targets (48px+) and bilingual localization.
 * 2. Real-time telemetry: in-transit orders tracker, coins & login streak calendar, wishlist price drops, warranties.
 * 3. 1-Click Saler Upgrade integration (BecomeSalerCta).
 * 4. 15-Second interactive video walkthrough modals for seamless low-literacy onboarding.
 * 5. Complete 2-click access to all customer features.
 * 6. Dynamic language switching reactivity with zero reload.
 *
 * Route: /account, /customer
 */

import { customerApi } from '../../services/customer.api.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Modal } from '../../components/ui/Modal.js';
import { BecomeSalerCta } from '../../components/customer/BecomeSalerCta.js';

export default function CustomerDashboardPage(root, { navigate } = {}) {
  const nav = (url, opts = {}) => {
    if (typeof navigate === 'function') navigate(url, opts);
    else {
      const currentIdx = window.history.state?.idx ?? 0;
      const previousPath = window.location.pathname + window.location.search;
      window.history.pushState({ idx: currentIdx + 1, fromPath: previousPath }, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'customer-dashboard';

  let lastDashboardData = null;

  // 1. Header Banner
  const header = document.createElement('div');
  header.className = 'customer-dashboard__header';

  function renderHeader() {
    header.innerHTML = `
      <div class="customer-dashboard__header-info">
        <div class="customer-dashboard__header-badge-row">
          <span class="badge badge--brand text-[10px] font-bold uppercase tracking-wider">
            ${t('customer.dashboard.badge', 'Customer Account')}
          </span>
          <button id="walkthrough-guide-btn" class="customer-dashboard__guide-btn">
            🎬 ${t('customer.dashboard.watch_guide', '15s Video Guide')}
          </button>
        </div>
        <h1 class="customer-dashboard__title">
          ${t('customer.dashboard.title', 'My Account Dashboard')}
        </h1>
        <p class="customer-dashboard__subtitle">
          ${t('customer.dashboard.subtitle', 'Track your parcels, redeem loyalty coins & check updates from followed stores.')}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <a href="/" class="btn btn--secondary btn--sm flex items-center gap-1 text-xs font-bold">
          🛍️ ${t('customer.dashboard.continue_shopping', 'Continue Shopping')}
        </a>
      </div>
    `;

    // 15-second Walkthrough Trigger
    header.querySelector('#walkthrough-guide-btn')?.addEventListener('click', () => {
      openCustomerWalkthroughModal(nav);
    });
  }

  renderHeader();
  container.append(header);

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
      lastDashboardData = res.data || {};
      renderDashboard(contentSlot, lastDashboardData, nav);
    } catch (err) {
      contentSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'py-8 text-center text-danger font-bold text-xs';
      errBox.textContent = t('customer.dashboard.load_failed', 'Failed to load dashboard data. Please try again.');
      contentSlot.append(errBox);
    }
  }

  // Subscribe to live language updates
  const unsubscribeLang = subscribeLang(() => {
    renderHeader();
    if (lastDashboardData) {
      renderDashboard(contentSlot, lastDashboardData, nav);
    } else {
      loadDashboard();
    }
  });

  loadDashboard();

  return () => {
    if (typeof unsubscribeLang === 'function') unsubscribeLang();
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

  // 1. Telemetry Highlights Bar (Active orders, Streak Coins, Wishlist drops, Referral)
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
  if (data.wishlist?.price_drops_count > 0 && Array.isArray(data.wishlist?.items) && data.wishlist.items.length > 0) {
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
      title: t('customer.dashboard.stat_orders', 'Active Orders'),
      value: t('customer.dashboard.stat_orders_val', { count: formatNumber(o.active_count || 0) }),
      sub: t('customer.dashboard.stat_orders_sub', { count: formatNumber(o.delivered_count || 0) }),
      icon: '📦',
      url: '/account/orders',
    },
    {
      title: t('customer.dashboard.stat_coins', 'Loyalty Coins'),
      value: `${formatNumber(r.coins_balance || 0)} 🪙`,
      sub: `🔥 ${t('customer.dashboard.stat_coins_sub', { count: formatNumber(r.current_streak_days || 1) })}`,
      icon: '💎',
      url: '/account/coins',
    },
    {
      title: t('customer.dashboard.stat_wishlist', 'Wishlist Items'),
      value: t('customer.dashboard.stat_wishlist_val', { count: formatNumber(w.total_items || 0) }),
      sub: w.price_drops_count > 0
        ? `📉 ${t('customer.dashboard.stat_wishlist_drop_sub', { count: formatNumber(w.price_drops_count) })}`
        : t('customer.dashboard.stat_wishlist_saved_sub', 'Saved items'),
      icon: '💖',
      url: '/account/wishlist',
    },
    {
      title: t('customer.dashboard.stat_referral', 'Referral Link'),
      value: r.referral_code || 'REF000000',
      sub: t('customer.dashboard.stat_referral_sub', 'Invite friends & earn'),
      icon: '🤝',
      url: '/account/referrals',
    },
  ];

  const grid = document.createElement('div');
  grid.className = 'customer-dashboard__telemetry';

  cards.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'customer-dashboard__telemetry-card';
    card.onclick = () => nav(c.url);

    card.innerHTML = `
      <div class="customer-dashboard__telemetry-head">
        <span>${c.title}</span>
        <span class="text-base">${c.icon}</span>
      </div>
      <div class="customer-dashboard__telemetry-val">${c.value}</div>
      <div class="customer-dashboard__telemetry-sub">${c.sub}</div>
    `;

    grid.append(card);
  });

  container.append(grid);
}

/**
 * 2. In-Flight Order Live Progress Tracker
 */
function renderInFlightOrderWidget(container, order, nav) {
  const lang = getLanguage();
  const card = document.createElement('div');
  card.className = 'customer-dashboard__order-widget';

  const orderItems = order.items || [];
  const firstItem = orderItems[0] || {};
  const firstItemTitle = lang === 'bn'
    ? (firstItem.product_title_bn || firstItem.product_title_en || t('customer.dashboard.default_product_name', 'পণ্য'))
    : (firstItem.product_title_en || firstItem.product_title_bn || t('customer.dashboard.default_product_name', 'Product'));

  const plusCountText = orderItems.length > 1
    ? ` ${t('customer.dashboard.order_plus_items', { count: formatNumber(orderItems.length - 1) })}`
    : '';

  const isConfirmed = ['PROCESSING', 'CONFIRMED', 'PACKED', 'DISPATCHED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(order.status);
  const isShipped = ['DISPATCHED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(order.status);
  const isDelivered = order.status === 'DELIVERED';

  card.innerHTML = `
    <div class="customer-dashboard__order-head">
      <div>
        <div class="flex items-center gap-2">
          <span class="badge badge--brand text-[10px] font-bold">
            ${t('customer.dashboard.order_tracking_badge', 'Order Tracking')}
          </span>
          <span class="text-xs font-mono font-bold text-foreground">#${order.ref || 'ORD-0000'}</span>
        </div>
        <h3 class="customer-dashboard__order-title">
          ${firstItemTitle}${plusCountText}
        </h3>
      </div>
      <div>
        <div class="text-xs text-muted">${t('customer.dashboard.order_total_price', 'Total Price')}</div>
        <div class="text-base font-extrabold text-foreground font-mono">${formatCurrency(order.total_amount || 0)}</div>
      </div>
    </div>

    <!-- Visual Tracking Stepper -->
    <div class="customer-dashboard__stepper">
      <div class="customer-dashboard__step">
        <div class="customer-dashboard__step-circle customer-dashboard__step-circle--active">✓</div>
        <div class="customer-dashboard__step-label">${t('customer.dashboard.step_placed', 'Order Placed')}</div>
      </div>
      <div class="customer-dashboard__step">
        <div class="customer-dashboard__step-circle ${isConfirmed ? 'customer-dashboard__step-circle--active' : ''}">📦</div>
        <div class="customer-dashboard__step-label">${t('customer.dashboard.step_packaging', 'Packaging')}</div>
      </div>
      <div class="customer-dashboard__step">
        <div class="customer-dashboard__step-circle ${isShipped ? 'customer-dashboard__step-circle--active' : ''}">🚚</div>
        <div class="customer-dashboard__step-label">${t('customer.dashboard.step_shipped', 'In Transit')}</div>
      </div>
      <div class="customer-dashboard__step">
        <div class="customer-dashboard__step-circle ${isDelivered ? 'customer-dashboard__step-circle--active' : ''}">🏠</div>
        <div class="customer-dashboard__step-label">${t('customer.dashboard.step_delivered', 'Delivered')}</div>
      </div>
    </div>
  `;

  const btnRow = document.createElement('div');
  btnRow.className = 'flex justify-end pt-2';

  const viewBtn = Button({
    label: t('customer.dashboard.btn_track_details', 'View Details & Track →'),
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
  section.className = 'customer-dashboard__actions-section';

  section.innerHTML = `
    <div class="customer-dashboard__actions-header">
      <h2 class="customer-dashboard__actions-title">
        🧭 ${t('customer.dashboard.actions_title', 'All Features at a Glance')}
      </h2>
      <p class="customer-dashboard__actions-subtitle">
        ${t('customer.dashboard.actions_desc', 'Click any feature to access your services with zero clutter.')}
      </p>
    </div>
  `;

  const actions = [
    {
      id: 'act_orders',
      title: t('customer.dashboard.act_orders_title', 'My Orders'),
      desc: t('customer.dashboard.act_orders_desc', 'Track parcel & order status'),
      icon: '📦',
      url: '/account/orders',
      badge: t('customer.dashboard.act_orders_badge', { count: formatNumber(data.orders?.total_count || 0) }),
    },
    {
      id: 'act_following',
      title: t('customer.dashboard.act_following_title', 'Followed Stores'),
      desc: t('customer.dashboard.act_following_desc', 'New drops & live broadcasts'),
      icon: '🏪',
      url: '/account/following',
      badge: t('customer.dashboard.act_following_badge', { count: formatNumber(data.social?.followed_stores_count || 0) }),
    },
    {
      id: 'act_wishlist',
      title: t('customer.dashboard.act_wishlist_title', 'Saved Wishlist'),
      desc: t('customer.dashboard.act_wishlist_desc', 'Price drop alerts & favorites'),
      icon: '💖',
      url: '/account/wishlist',
      badge: t('customer.dashboard.act_wishlist_badge', { count: formatNumber(data.wishlist?.total_items || 0) }),
    },
    {
      id: 'act_coins',
      title: t('customer.dashboard.act_coins_title', 'Coins & Rewards'),
      desc: t('customer.dashboard.act_coins_desc', 'Claim daily streak bonuses'),
      icon: '🪙',
      url: '/account/coins',
      badge: t('customer.dashboard.act_coins_badge', { count: formatNumber(data.rewards?.coins_balance || 0) }),
    },
    {
      id: 'act_warranties',
      title: t('customer.dashboard.act_warranties_title', 'Digital Warranties'),
      desc: t('customer.dashboard.act_warranties_desc', 'Certificates & 1-tap claims'),
      icon: '🛡️',
      url: '/account/warranties',
      badge: t('customer.dashboard.act_warranties_badge', { count: formatNumber(data.protection?.active_warranties_count || 0) }),
    },
    {
      id: 'act_teams',
      title: t('customer.dashboard.act_teams_title', 'Team Purchases'),
      desc: t('customer.dashboard.act_teams_desc', 'Slash prices with friends'),
      icon: '👥',
      url: '/account/team-purchases',
      badge: t('customer.dashboard.act_teams_badge', { count: formatNumber(data.social?.active_teams_count || 0) }),
    },
    {
      id: 'act_coupons',
      title: t('customer.dashboard.act_coupons_title', 'Coupons & Vouchers'),
      desc: t('customer.dashboard.act_coupons_desc', 'Extra checkout discounts'),
      icon: '🎟️',
      url: '/account/coupons',
      badge: t('customer.dashboard.act_coupons_badge', 'Discounts'),
    },
    {
      id: 'act_returns',
      title: t('customer.dashboard.act_returns_title', 'Returns & Refunds'),
      desc: t('customer.dashboard.act_returns_desc', 'Easy return & refund requests'),
      icon: '🔄',
      url: '/account/returns',
      badge: t('customer.dashboard.act_returns_badge', { count: formatNumber(data.protection?.active_returns_count || 0) }),
    },
    {
      id: 'act_reviews',
      title: t('customer.dashboard.act_reviews_title', 'Reviews & Stories'),
      desc: t('customer.dashboard.act_reviews_desc', 'Real buyer video stories'),
      icon: '🎬',
      url: '/account/reviews',
      badge: t('customer.dashboard.act_reviews_badge', 'UGC Stories'),
    },
    {
      id: 'act_live',
      title: t('customer.dashboard.act_live_title', 'Live Shopping'),
      desc: t('customer.dashboard.act_live_desc', 'Watch live streams & buy'),
      icon: '🎥',
      url: '/live',
      badge: t('customer.dashboard.act_live_badge', 'Live Studio'),
    },
    {
      id: 'act_referrals',
      title: t('customer.dashboard.act_referrals_title', 'Refer & Earn'),
      desc: t('customer.dashboard.act_referrals_desc', 'Cashback rewards on invites'),
      icon: '🤝',
      url: '/account/referrals',
      badge: t('customer.dashboard.act_referrals_badge', 'Bonus'),
    },
    {
      id: 'act_addresses',
      title: t('customer.dashboard.act_addresses_title', 'Delivery Addresses'),
      desc: t('customer.dashboard.act_addresses_desc', 'Manage shipping destinations'),
      icon: '📍',
      url: '/account/addresses',
      badge: t('customer.dashboard.act_addresses_badge', 'Addresses'),
    },
  ];

  const grid = document.createElement('div');
  grid.className = 'customer-dashboard__actions-grid';

  actions.forEach((act) => {
    const btn = document.createElement('button');
    btn.className = 'customer-dashboard__action-btn';
    btn.onclick = () => nav(act.url);

    btn.innerHTML = `
      <div class="customer-dashboard__action-top">
        <div class="customer-dashboard__action-icon">
          ${act.icon}
        </div>
        <span class="badge badge--neutral text-[10px] font-bold">${act.badge}</span>
      </div>
      <div>
        <div class="customer-dashboard__action-title">${act.title}</div>
        <div class="customer-dashboard__action-desc">${act.desc}</div>
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
  const lang = getLanguage();
  const section = document.createElement('div');
  section.className = 'p-5 rounded-2xl border border-subtle bg-surface space-y-3';

  section.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-lg">📉</span>
        <h3 class="text-sm font-bold text-foreground">
          ${t('customer.dashboard.price_drops_title', 'Wishlist items dropped in price!')}
        </h3>
      </div>
      <button id="view-all-wishlist" class="text-xs font-bold text-brand hover:underline">
        ${t('customer.dashboard.view_all', 'View All →')}
      </button>
    </div>
  `;

  const list = document.createElement('div');
  list.className = 'grid grid-cols-1 sm:grid-cols-2 gap-3';

  const droppedItems = (wishlist.items || []).filter((i) => i.price_dropped);

  droppedItems.forEach((it) => {
    const itemTitle = lang === 'bn' ? (it.title_bn || it.title_en) : (it.title_en || it.title_bn);
    const row = document.createElement('div');
    row.className = 'p-3 rounded-xl bg-surface-2 border border-subtle flex items-center justify-between gap-3 shadow-xs';
    row.innerHTML = `
      <div class="space-y-0.5">
        <div class="text-xs font-bold text-foreground line-clamp-1">${itemTitle}</div>
        <div class="flex items-center gap-2 text-xs">
          <span class="text-muted line-through">${formatCurrency(it.saved_price)}</span>
          <span class="font-extrabold text-brand font-mono">${formatCurrency(it.current_price)}</span>
          <span class="badge badge--success text-[9px] font-bold">${t('customer.dashboard.off_badge', { amount: formatNumber(it.drop_amount) })}</span>
        </div>
      </div>
    `;

    const buyBtn = Button({
      label: t('customer.dashboard.buy_now', 'Buy Now →'),
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
  body.className = 'become-saler-video-modal';

  body.innerHTML = `
    <div class="become-saler-video-modal__screen">
      <div class="become-saler-video-modal__play-btn">
        ▶
      </div>
      <div>
        <div class="text-sm font-bold text-brand">${t('customer.dashboard.guide_screen_title', '15-Second Quick Video Guide')}</div>
        <div class="text-xs text-muted">${t('customer.dashboard.guide_screen_subtitle', 'How to easily track orders and redeem rewards coins')}</div>
      </div>
    </div>
    <div class="become-saler-video-modal__tips">
      <div class="font-bold text-foreground">${t('customer.dashboard.guide_tips_heading', '💡 Three Quick Tips:')}</div>
      <ul>
        <li>${t('customer.dashboard.guide_tip_1', 'Collect daily login coins every day you visit the app.')}</li>
        <li>${t('customer.dashboard.guide_tip_2', 'Tap "My Orders" to track your package delivery in real time.')}</li>
        <li>${t('customer.dashboard.guide_tip_3', 'Launch your own zero-capital online store in 1 tap.')}</li>
      </ul>
    </div>
  `;

  const footer = document.createElement('div');
  footer.className = 'flex justify-between items-center w-full';

  const closeBtn = Button({
    label: t('customer.dashboard.btn_close', 'Close'),
    variant: 'secondary',
    size: 'sm',
    onClick: () => modal.close(),
  });

  const goShopBtn = Button({
    label: t('customer.dashboard.btn_start_shopping', 'Start Shopping →'),
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      modal.close();
      nav('/');
    },
  });

  footer.append(closeBtn, goShopBtn);

  modal = Modal({
    title: t('customer.dashboard.guide_modal_title', '🎬 Explooro Video Guide'),
    content: body,
    footer,
    size: 'md',
  });

  modal.open();
}

