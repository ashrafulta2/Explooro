/**
 * SalerDashboardPage.js — Central Saler Operating Hub & Business Control Center (Prompt 11.2 / idea §AL.2).
 *
 * Implements:
 * 1. Dual-mode UI: Simple Mode (≤ 6 primary actions) vs. Pro Dashboard.
 * 2. Complete aggregation of all 15 Saler tools across Phases 4–10 with module & permission gating.
 * 3. Prescriptive AI Growth Assistant with 1-click executable actions.
 * 4. First-run Onboarding checklist with 15-second interactive video walkthrough modals.
 * 5. Reconciled telemetry (revenue, profit, vault balances, order fulfillment queue).
 *
 * Route: /saler
 */

import { salerApi } from '../../services/saler.api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { can } from '../../services/permissions.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Modal } from '../../components/ui/Modal.js';
import { GrowthAssistant } from '../../components/saler/GrowthAssistant.js';

const SALER_MODE_KEY = 'explooro:saler_mode_preference';

export default function SalerDashboardPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'saler-page-container';

  let currentMode = 'pro';
  try {
    const saved = localStorage.getItem(SALER_MODE_KEY);
    if (saved === 'simple' || saved === 'pro') currentMode = saved;
  } catch {}

  let dashboardData = null;

  // Header & Mode Toggle
  const header = document.createElement('div');
  header.className = 'saler-dashboard-header';

  const titleBox = document.createElement('div');
  titleBox.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
      <span class="badge badge--primary" style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Saler Portal</span>
      <span class="font-mono text-muted" style="font-size: 11px;" id="store-slug-badge">...</span>
    </div>
    <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.02em;">
      ${t('saler.dashboard.title', 'Saler Commerce Command Center')}
    </h1>
    <p style="margin: 4px 0 0; font-size: 13px; color: var(--text-muted);">
      ${t('saler.dashboard.subtitle', 'Dropship wholesale sourcing, AI creative tools, viral distribution & multi-channel selling.')}
    </p>
  `;

  const toggleBox = document.createElement('div');
  toggleBox.className = 'saler-mode-toggle';

  const simpleBtn = document.createElement('button');
  simpleBtn.type = 'button';
  simpleBtn.className = currentMode === 'simple' ? 'saler-mode-btn active' : 'saler-mode-btn';
  simpleBtn.textContent = `⚡ ${t('saler.dashboard.mode_simple', 'Simple Mode')}`;
  simpleBtn.onclick = () => switchMode('simple');

  const proBtn = document.createElement('button');
  proBtn.type = 'button';
  proBtn.className = currentMode === 'pro' ? 'saler-mode-btn active' : 'saler-mode-btn';
  proBtn.textContent = `🚀 ${t('saler.dashboard.mode_pro', 'Pro Dashboard')}`;
  proBtn.onclick = () => switchMode('pro');

  toggleBox.append(simpleBtn, proBtn);
  header.append(titleBox, toggleBox);
  container.append(header);

  // Dynamic Workspace View Slot
  const viewSlot = document.createElement('div');
  viewSlot.style.display = 'flex';
  viewSlot.style.flexDirection = 'column';
  viewSlot.style.gap = 'var(--space-6, 24px)';
  container.append(viewSlot);
  root.append(container);

  function switchMode(newMode) {
    currentMode = newMode;
    try {
      localStorage.setItem(SALER_MODE_KEY, newMode);
    } catch {}

    simpleBtn.className = currentMode === 'simple' ? 'saler-mode-btn active' : 'saler-mode-btn';
    proBtn.className = currentMode === 'pro' ? 'saler-mode-btn active' : 'saler-mode-btn';

    if (dashboardData) {
      renderContent();
    }
  }

  async function loadData() {
    viewSlot.innerHTML = '';
    viewSlot.append(Skeleton({ width: '100%', height: '140px' }), Skeleton({ width: '100%', height: '300px' }));

    try {
      const res = await salerApi.getDashboard();
      dashboardData = res.data || {};

      const slugBadge = container.querySelector('#store-slug-badge');
      if (slugBadge && dashboardData.store?.slug) {
        slugBadge.textContent = `@${dashboardData.store.slug}`;
      }

      renderContent();
    } catch (err) {
      viewSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.style.padding = '32px';
      errBox.style.textAlign = 'center';
      errBox.style.color = 'var(--danger-500)';
      errBox.textContent = t('saler.dashboard.load_failed', 'Failed to load saler dashboard data.');
      viewSlot.append(errBox);
    }
  }

  function renderContent() {
    viewSlot.innerHTML = '';

    if (currentMode === 'simple') {
      renderSimpleMode(viewSlot, dashboardData, nav);
    } else {
      renderProMode(viewSlot, dashboardData, nav);
    }
  }

  loadData();

  return () => {
    container.remove();
  };
}

/**
 * 1. Simple Mode: Progressive Disclosure displaying ≤ 6 Primary Actions
 */
function renderSimpleMode(container, data, nav) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = 'var(--space-5, 20px)';

  // Welcome Header
  const welcome = document.createElement('div');
  welcome.className = 'saler-simple-welcome';
  welcome.innerHTML = `
    <div>
      <h2 style="margin: 0; font-size: 17px; font-weight: 700; color: var(--text-primary);">
        ${t('saler.dashboard.simple_welcome', 'Simple Mode Active')}
      </h2>
      <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">
        ${t('saler.dashboard.simple_desc', 'Your 6 essential daily tasks organized with zero clutter.')}
      </p>
    </div>
    <div class="saler-simple-stats">
      <div class="saler-simple-stat">
        <span class="saler-simple-stat-label">Today's Profit</span>
        <span class="saler-simple-stat-val saler-simple-stat-val--profit">+${formatCurrency(data.metrics?.today_net_profit || 0)}</span>
      </div>
      <div style="width: 1px; height: 32px; background: var(--border-subtle);"></div>
      <div class="saler-simple-stat">
        <span class="saler-simple-stat-label">Vault Balance</span>
        <span class="saler-simple-stat-val">${formatCurrency(data.metrics?.available_balance || 0)}</span>
      </div>
    </div>
  `;
  wrap.append(welcome);

  // 6 Primary Simple Mode Cards
  const grid = document.createElement('div');
  grid.className = 'saler-simple-grid';

  const simpleCards = [
    {
      id: 'simple_add_product',
      title: t('saler.dashboard.action_add_product', '1. Add Product'),
      desc: t('saler.dashboard.action_add_product_desc', 'Browse 100+ wholesale items with 20-35% profit margin.'),
      icon: '🔍',
      url: '/saler/sourcing',
      btnText: 'Source Products →',
      badge: `${data.store?.curated_products_count || 0} in store`,
    },
    {
      id: 'simple_share_store',
      title: t('saler.dashboard.action_share_store', '2. Share Store'),
      desc: t('saler.dashboard.action_share_store_desc', 'Download WhatsApp flyer banners or copy your storefront link.'),
      icon: '📣',
      url: '/saler/social-kit',
      btnText: 'Get Flyers & Link →',
      badge: 'WhatsApp / FB',
    },
    {
      id: 'simple_orders',
      title: t('saler.dashboard.action_orders', '3. Customer Orders'),
      desc: t('saler.dashboard.action_orders_desc', 'Track placed orders and supplier fulfillment dispatch status.'),
      icon: '📦',
      url: '/saler/orders',
      btnText: 'View Orders →',
      badge: `${data.metrics?.pending_fulfillment_count || 0} pending`,
    },
    {
      id: 'simple_earnings',
      title: t('saler.dashboard.action_earnings', '4. Check Earnings'),
      desc: t('saler.dashboard.action_earnings_desc', 'Review delivered order profits and withdraw instantly to bKash/Bank.'),
      icon: '💰',
      url: '/saler/vault',
      btnText: 'Open Digital Vault →',
      badge: `${formatCurrency(data.metrics?.available_balance || 0)} ready`,
    },
    {
      id: 'simple_messages',
      title: t('saler.dashboard.action_messages', '5. Customer Messages'),
      desc: t('saler.dashboard.action_messages_desc', 'Chat with buyers across WhatsApp, Messenger, and live store chat.'),
      icon: '💬',
      url: '/saler/inbox',
      btnText: 'Open Unified Inbox →',
      badge: data.metrics?.unread_messages_count > 0 ? `${data.metrics.unread_messages_count} new` : 'All read',
    },
    {
      id: 'simple_help',
      title: t('saler.dashboard.action_help', '6. Seller Academy & Help'),
      desc: t('saler.dashboard.action_help_desc', 'Watch 15-second selling tutorials and learn how to scale your profit.'),
      icon: '🎓',
      url: '/academy',
      btnText: 'Watch Academy Lessons →',
      badge: 'Free Guides',
    },
  ];

  simpleCards.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'saler-simple-card';
    card.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div class="saler-card-icon-box">${c.icon}</div>
          <span class="badge badge--neutral text-[10px] font-mono">${c.badge}</span>
        </div>
        <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-primary);">${c.title}</h3>
        <p style="margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.45;">${c.desc}</p>
      </div>
    `;

    const btn = Button({
      label: c.btnText,
      variant: 'primary',
      size: 'sm',
      onClick: () => nav(c.url),
    });
    card.append(btn);
    grid.append(card);
  });

  wrap.append(grid);
  container.append(wrap);
}

/**
 * 2. Pro Mode: Comprehensive Control Deck Aggregating all 15 Saler Tools
 */
function renderProMode(container, data, nav) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = 'var(--space-6, 24px)';

  // 1. KPI Telemetry Bar
  renderProKpiBar(wrap, data);

  // 2. First-Run Onboarding Checklist (if brand new or incomplete)
  if (data.onboarding && data.onboarding.completed_steps_count < data.onboarding.total_steps) {
    renderOnboardingWidget(wrap, data.onboarding, nav);
  }

  // 3. Embedded Prescriptive Growth Assistant
  const growth = GrowthAssistant({ onNavigate: nav });
  wrap.append(growth.element);

  // 4. All 15 Saler Tools Grid (Phases 4–10 Aggregation)
  renderToolsGrid(wrap, data, nav);

  container.append(wrap);
}

/**
 * Pro Mode KPI Telemetry Bar
 */
function renderProKpiBar(container, data) {
  const m = data.metrics || {};
  const kpis = [
    {
      title: t('saler.dashboard.today_profit', "Today's Profit"),
      value: `+${formatCurrency(m.today_net_profit || 0)}`,
      sub: `${m.today_orders_count || 0} orders today (${formatCurrency(m.today_gross_sales || 0)} GMV)`,
      icon: '💎',
      isProfit: true,
    },
    {
      title: t('saler.dashboard.profit_30d', '30-Day Net Profit'),
      value: formatCurrency(m.profit_30d || 0),
      sub: `${m.total_orders || 0} total converted orders`,
      icon: '📈',
      isProfit: false,
    },
    {
      title: t('saler.dashboard.vault_available', 'Vault Available Balance'),
      value: formatCurrency(m.available_balance || 0),
      sub: `${formatCurrency(m.escrow_balance || 0)} in active escrow`,
      icon: '💰',
      isProfit: false,
    },
    {
      title: t('saler.dashboard.curated_products', 'Curated Storefront SKUs'),
      value: `${data.store?.curated_products_count || 0} SKUs`,
      sub: `${data.store?.shelves_count || 0} organized shelves · ${m.total_link_clicks || 0} clicks`,
      icon: '🏪',
      isProfit: false,
    },
  ];

  const grid = document.createElement('div');
  grid.className = 'saler-kpi-grid';

  kpis.forEach((k) => {
    const card = document.createElement('div');
    card.className = 'saler-kpi-card';
    card.innerHTML = `
      <div class="saler-kpi-card__header">
        <span>${k.title}</span>
        <span>${k.icon}</span>
      </div>
      <div class="saler-kpi-card__value ${k.isProfit ? 'saler-kpi-card__value--profit' : ''}">
        ${k.value}
      </div>
      <div class="saler-kpi-card__subtext">
        ${k.sub}
      </div>
    `;
    grid.append(card);
  });

  container.append(grid);
}

/**
 * First-Run Onboarding Checklist with 15-second Interactive Video Walkthrough Modals
 */
function renderOnboardingWidget(container, onboarding, nav) {
  const card = document.createElement('div');
  card.className = 'saler-onboarding-card';

  const progressPct = Math.round((onboarding.completed_steps_count / onboarding.total_steps) * 100);

  card.innerHTML = `
    <div class="saler-onboarding-header">
      <div>
        <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
          🚀 ${t('saler.onboarding.title', 'Quick Start Guide: Road to Your First Sale')}
          <span class="badge badge--primary text-[10px]">${onboarding.completed_steps_count}/${onboarding.total_steps} Completed</span>
        </h3>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">
          ${t('saler.onboarding.desc', 'Follow these 4 simple steps to launch your virtual business and make your first profit deposit.')}
        </p>
      </div>
      <div class="saler-onboarding-progress-track">
        <div class="saler-onboarding-progress-fill" style="width: ${progressPct}%;"></div>
      </div>
    </div>
  `;

  const stepsList = document.createElement('div');
  stepsList.className = 'saler-onboarding-steps';

  onboarding.steps.forEach((step, idx) => {
    const item = document.createElement('div');
    item.className = step.completed ? 'saler-onboarding-step saler-onboarding-step--completed' : 'saler-onboarding-step';

    item.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 12px; font-family: var(--font-mono); font-weight: 700; color: ${step.completed ? 'var(--success-600, #16a34a)' : 'var(--brand-600, #d99f00)'};">
            ${step.completed ? '✓ Done' : `Step ${idx + 1}`}
          </span>
          <button type="button" class="video-btn" style="background: none; border: none; padding: 0; cursor: pointer; font-size: 11px; font-weight: 600; color: var(--primary-600, #2563eb); display: flex; align-items: center; gap: 4px;" data-step="${step.id}">
            🎬 ${step.video_duration} Video
          </button>
        </div>
        <div style="font-size: 12px; font-weight: 700; color: var(--text-primary);">${step.title_en}</div>
        <div style="font-size: 11px; color: var(--text-muted); line-height: 1.4;">${step.desc_en}</div>
      </div>
    `;

    const actionBtn = Button({
      label: step.completed ? 'Revisit →' : step.action_label_en,
      variant: step.completed ? 'secondary' : 'primary',
      size: 'xs',
      onClick: () => nav(step.action_url),
    });

    item.append(actionBtn);

    // Video Walkthrough Trigger
    item.querySelector('.video-btn').onclick = (e) => {
      e.stopPropagation();
      openVideoWalkthroughModal(step, nav);
    };

    stepsList.append(item);
  });

  card.append(stepsList);
  container.append(card);
}

/**
 * 15-Second Interactive Video Walkthrough Simulator Modal
 */
function openVideoWalkthroughModal(step, nav) {
  let modal;
  const body = document.createElement('div');
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '16px';

  body.innerHTML = `
    <div style="position: relative; width: 100%; aspect-ratio: 16/9; border-radius: var(--radius-xl, 16px); background: #0f172a; border: 1px solid var(--border-subtle); overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #ffffff; padding: 24px; text-align: center; gap: 12px;">
      <div style="width: 48px; height: 48px; border-radius: 9999px; background: var(--brand-500, #ecae00); color: #000; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700;">
        ▶
      </div>
      <div>
        <div style="font-size: 14px; font-weight: 700;">${step.video_title_en}</div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">15-Second Express Masterclass (Zero Fluff)</div>
      </div>
      <div style="width: 100%; max-width: 200px; background: #1e293b; height: 6px; border-radius: 9999px; overflow: hidden;">
        <div style="background: var(--brand-500, #ecae00); height: 100%; width: 75%; border-radius: 9999px;"></div>
      </div>
    </div>
    <div style="padding: 12px 14px; border-radius: var(--radius-md, 10px); background: var(--surface-1); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 4px;">
      <div style="font-size: 12px; font-weight: 700; color: var(--text-primary);">Key Takeaways:</div>
      <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">${step.desc_en}</div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.alignItems = 'center';
  footer.style.width = '100%';

  const closeBtn = Button({
    label: 'Close',
    variant: 'secondary',
    size: 'sm',
    onClick: () => modal.close(),
  });

  const goBtn = Button({
    label: `Start Now (${step.action_label_en}) →`,
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      modal.close();
      nav(step.action_url);
    },
  });

  footer.append(closeBtn, goBtn);

  modal = Modal({
    title: `🎬 ${step.video_title_en}`,
    content: body,
    footer,
    size: 'md',
  });

  modal.open();
}

/**
 * Grid Aggregating All 15 Saler Tools (Phases 4–10)
 */
function renderToolsGrid(container, data, nav) {
  const section = document.createElement('div');
  section.className = 'saler-tools-section';

  section.innerHTML = `
    <div class="saler-tools-header">
      <div>
        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary);">
          🧰 ${t('saler.dashboard.tools_title', 'Complete Saler Tool Suite')}
        </h3>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">
          ${t('saler.dashboard.tools_desc', 'Every specialized sales, marketing, sourcing, and vault tool reachable within 2 clicks.')}
        </p>
      </div>
      <a href="/saler/analytics" style="font-size: 12px; font-weight: 700; color: var(--primary-600, #2563eb); text-decoration: none; display: flex; align-items: center; gap: 4px;">
        📈 View Full Analytics →
      </a>
    </div>
  `;

  const tools = [
    {
      id: 'tool_storefront',
      name: t('saler.tools.storefront', 'Virtual Storefront Builder'),
      desc: t('saler.tools.storefront_desc', 'Custom logo, vanity slug, banner design, and product shelf organizer.'),
      icon: '🏪',
      url: '/saler/store-builder',
      module: 'virtual_storefront',
      perm: 'saler.store.manage',
      badge: 'Store Editor',
    },
    {
      id: 'tool_sourcing',
      name: t('saler.tools.sourcing', 'Wholesale Sourcing Catalog'),
      desc: t('saler.tools.sourcing_desc', 'Source authentic Bangladeshi products with guaranteed wholesale price floors.'),
      icon: '🔍',
      url: '/saler/sourcing',
      module: 'sourcing',
      perm: 'saler.sourcing.view',
      badge: '20-35% Margins',
    },
    {
      id: 'tool_creative',
      name: t('saler.tools.creative', 'AI Creative Studio'),
      desc: t('saler.tools.creative_desc', 'Generate high-converting Bengali ad copy and flat matte product visuals.'),
      icon: '🎨',
      url: '/saler/creative-studio',
      module: 'ai_creative_studio',
      perm: 'ai.creative.use',
      badge: 'AI Powered',
    },
    {
      id: 'tool_bundling',
      name: t('saler.tools.bundling', 'Combo Bundling Studio'),
      desc: t('saler.tools.bundling_desc', 'Create multi-supplier combo bundles and capture demand surge recommendations.'),
      icon: '🎁',
      url: '/saler/bundles',
      module: 'product_bundling',
      perm: 'saler.bundle.manage',
      badge: 'Combos & Surge',
    },
    {
      id: 'tool_inbox',
      name: t('saler.tools.inbox', 'Unified Multi-Channel Inbox'),
      desc: t('saler.tools.inbox_desc', 'Centralized WhatsApp, Messenger, and live web conversational commerce.'),
      icon: '💬',
      url: '/saler/inbox',
      module: 'whatsapp_bridge',
      perm: 'chat.thread.view_own',
      badge: `${data.metrics?.unread_messages_count || 0} unread`,
    },
    {
      id: 'tool_social_kit',
      name: t('saler.tools.social_kit', 'Social Seller Kit & Flyers'),
      desc: t('saler.tools.social_kit_desc', 'Generate print-ready vector flyers with zero-dependency QR code tracking.'),
      icon: '📣',
      url: '/saler/social-kit',
      module: 'social_seller_kit',
      perm: null,
      badge: 'Status & QR',
    },
    {
      id: 'tool_live_studio',
      name: t('saler.tools.live_studio', 'Live Stream Studio'),
      desc: t('saler.tools.live_studio_desc', 'Host live interactive wholesale and retail selling broadcasts.'),
      icon: '🎥',
      url: '/saler/live-studio',
      module: 'live_commerce',
      perm: 'live.stream.host',
      badge: 'WebRTC Studio',
    },
    {
      id: 'tool_referrals',
      name: t('saler.tools.referrals', '2-Tier Referral Network Hub'),
      desc: t('saler.tools.referrals_desc', 'Earn 5% direct and 2% secondary sponsor commissions on network sales.'),
      icon: '🤝',
      url: '/saler/referrals',
      module: 'referral_engine',
      perm: 'growth.referral.view_own',
      badge: `${data.metrics?.referral_count || 0} members`,
    },
    {
      id: 'tool_analytics',
      name: t('saler.tools.analytics', 'Sales & Profit Analytics'),
      desc: t('saler.tools.analytics_desc', 'Pure inline SVG revenue trends, conversion funnels, and traffic sources.'),
      icon: '📈',
      url: '/saler/analytics',
      module: 'core',
      perm: 'saler.order.view',
      badge: 'SVG Charts',
    },
    {
      id: 'tool_vault',
      name: t('saler.tools.vault', 'Digital Vault & Payouts'),
      desc: t('saler.tools.vault_desc', 'Instant bKash, Nagad, and bank withdrawal requests with automated escrow releases.'),
      icon: '💰',
      url: '/saler/vault/payouts',
      module: 'vault_escrow',
      perm: 'vault.withdraw.request',
      badge: `${formatCurrency(data.metrics?.available_balance || 0)} ready`,
    },
    {
      id: 'tool_ads',
      name: t('saler.tools.ads', 'Sponsored Ad Campaigns'),
      desc: t('saler.tools.ads_desc', 'Run second-price keyword auction ads on marketplace search & category pages.'),
      icon: '📢',
      url: '/saler/ads',
      module: 'sponsored_ads',
      perm: 'growth.campaign.manage',
      badge: 'CPC Auction',
    },
    {
      id: 'tool_quests',
      name: t('saler.tools.quests', 'Daily Quests & Leaderboard'),
      desc: t('saler.tools.quests_desc', 'Gamified merchant challenges, daily streak bonuses, and national podium prizes.'),
      icon: '🏆',
      url: '/saler/quests',
      module: 'gamification',
      perm: null,
      badge: 'Prizes & Coins',
    },
    {
      id: 'tool_cart_recovery',
      name: t('saler.tools.cart_recovery', 'Abandoned Cart Insights'),
      desc: t('saler.tools.cart_recovery_desc', 'Automated 3-step recovery funnel and 1-click custom discount offer dispatch.'),
      icon: '🛒',
      url: '/saler/cart-insights',
      module: 'cart_recovery',
      perm: 'saler.analytics.view',
      badge: '3-Step Funnel',
    },
    {
      id: 'tool_store_status',
      name: t('saler.tools.store_status', 'Physical Showroom Status'),
      desc: t('saler.tools.store_status_desc', 'Weekly hours schedule, customer pickup desk toggle, and concierge phone.'),
      icon: '🚪',
      url: '/saler/store-status',
      module: 'virtual_storefront',
      perm: 'saler.store.manage',
      badge: 'Pickup Desk',
    },
    {
      id: 'tool_my_products',
      name: t('saler.tools.my_products', 'Curated Store Products'),
      desc: t('saler.tools.my_products_desc', 'Adjust price markups, review supplier stock levels, and set custom retail margins.'),
      icon: '🏷️',
      url: '/saler/products',
      module: 'virtual_storefront',
      perm: 'saler.store.manage',
      badge: `${data.store?.curated_products_count || 0} SKUs`,
    },
  ];

  const grid = document.createElement('div');
  grid.className = 'saler-tools-grid';

  tools.forEach((tool) => {
    const isModuleOn = tool.module === 'core' || isFeatureEnabled(tool.module);
    const hasPerm = !tool.perm || can(tool.perm);
    const isAccessible = isModuleOn && hasPerm;

    const card = document.createElement('div');
    card.className = 'saler-tool-card';

    if (!isAccessible) {
      card.style.opacity = '0.5';
      card.style.cursor = 'not-allowed';
    }

    card.innerHTML = `
      <div class="saler-tool-card__top">
        <div class="saler-tool-card__icon">${tool.icon}</div>
        <span class="badge badge--neutral text-[10px] font-mono">${tool.badge}</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <h4 class="saler-tool-card__title">${tool.name}</h4>
        <p class="saler-tool-card__desc">${tool.desc}</p>
      </div>
      <div style="display: flex; align-items: center; justify-content: flex-end; font-size: 11px; font-weight: 700; color: var(--primary-600, #2563eb); padding-top: 4px;">
        ${isAccessible ? 'Launch →' : '🔒 Locked'}
      </div>
    `;

    if (isAccessible) {
      card.addEventListener('click', () => nav(tool.url));
    } else {
      card.addEventListener('click', () => {
        toast.info('This specialized tool is restricted by your role tier or platform module configuration.');
      });
    }

    grid.append(card);
  });

  section.append(grid);
  container.append(section);
}
