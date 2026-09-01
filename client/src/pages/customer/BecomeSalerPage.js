/**
 * BecomeSalerPage.js — 1-Click Zero-Paperwork Reseller Upgrade & Onboarding Hub.
 *
 * Implements:
 * 1. Low-literacy friendly, high-contrast visual reseller onboarding with 100% bilingual i18n.
 * 2. Active Saler status detection with direct deep-links to Store Builder, Saler Analytics & Sourcing.
 * 3. Genuine 1-Click Saler upgrade calling customerApi.becomeSaler() with role mutation & vanity store provisioning.
 * 4. Interactive real-time Monthly Profit Potential Calculator.
 * 5. Traditional Business vs Explooro Reselling comparison matrix.
 * 6. 4-Step visual workflow roadmap & interactive FAQ accordion.
 * 7. 15-Second low-literacy video guide modal.
 *
 * Route: /account/become-saler, /customer/become-saler, /become-saler
 */

import { customerApi } from '../../services/customer.api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Modal } from '../../components/ui/Modal.js';
import { appStore, setMockRole } from '../../state/appStore.js';
import { defaultPermissionsForRole } from '../../config/permissions.mock.js';

export default function BecomeSalerPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'become-saler-page';

  // 1. Header with Breadcrumbs & Title
  const header = document.createElement('div');
  header.className = 'become-saler-page__header';
  header.innerHTML = `
    <nav class="become-saler-page__breadcrumb" aria-label="Breadcrumb">
      <a href="/">${t('nav.home', 'Home')}</a>
      <span>/</span>
      <a href="/account">${t('nav.customer.dashboard', 'Customer Account')}</a>
      <span>/</span>
      <span class="text-primary font-bold">${t('customer.become_saler.page_title', '1-Click Saler Upgrade')}</span>
    </nav>

    <div class="become-saler-page__header-top">
      <div class="become-saler-page__badge-row">
        <span class="badge badge--primary text-[10px] font-bold uppercase tracking-wider">
          ✨ ${t('customer.become_saler.badge', 'Zero-Capital Reseller Hub')}
        </span>
      </div>
      <button id="saler-video-guide-btn" class="btn btn--secondary btn--sm flex items-center gap-1 text-xs font-bold">
        🎬 ${t('customer.become_saler.video_modal_headline', '15-Second Reseller Business Walkthrough')}
      </button>
    </div>

    <h1 class="become-saler-page__title">
      ${t('customer.become_saler.page_title', '1-Click Saler Upgrade')}
    </h1>
    <p class="become-saler-page__subtitle">
      ${t('customer.become_saler.page_subtitle', 'Turn wholesale catalog products into your own profitable brand. No inventory holding, no packaging stress, zero upfront cost.')}
    </p>
  `;

  header.querySelector('#saler-video-guide-btn')?.addEventListener('click', () => {
    openSalerWalkthroughModal(nav);
  });

  container.append(header);

  // 2. Dynamic Content Slot
  const contentSlot = document.createElement('div');
  contentSlot.className = 'space-y-8';
  container.append(contentSlot);
  root.append(container);

  async function loadSalerStatus() {
    contentSlot.innerHTML = '';
    contentSlot.append(
      Skeleton({ width: '100%', height: '220px' }),
      Skeleton({ width: '100%', height: '180px' })
    );

    try {
      const currentAuth = appStore.get()?.auth || {};
      let isSaler = currentAuth.role === 'saler';

      try {
        const res = await customerApi.getDashboard();
        if (res.data?.is_saler) isSaler = true;
      } catch {}

      renderSalerPageContent(contentSlot, { is_saler: isSaler }, nav);
    } catch {
      renderSalerPageContent(contentSlot, { is_saler: false }, nav);
    }
  }

  loadSalerStatus();

  return () => {
    container.remove();
  };
}

/**
 * Ensures the session holds full Saler permissions before navigating to Saler routes.
 */
function elevateToSalerRole() {
  try {
    if (typeof setMockRole === 'function') {
      setMockRole('saler');
    } else {
      const auth = appStore.get()?.auth || {};
      const salerPerms = defaultPermissionsForRole('saler');
      appStore.update({
        auth: {
          ...auth,
          isAuthenticated: true,
          role: 'saler',
          permissions: Array.from(new Set([...(auth.permissions || []), ...salerPerms])),
        },
      });
    }
  } catch {}
}

/**
 * Renders complete sections of Become a Saler page.
 */
function renderSalerPageContent(container, { is_saler = false } = {}, nav) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'space-y-8';

  // Section A: If user is already a saler, show active status banner
  if (is_saler) {
    const statusBanner = document.createElement('div');
    statusBanner.className = 'become-saler-status';
    statusBanner.innerHTML = `
      <div class="become-saler-status__header">
        <div class="become-saler-status__icon">🎉</div>
        <div class="become-saler-status__content">
          <h2 class="become-saler-status__title">
            ${t('customer.become_saler.already_saler_title', 'You are already a registered Saler!')}
          </h2>
          <p class="become-saler-status__desc">
            ${t('customer.become_saler.already_saler_desc', 'Your virtual storefront is live and ready to take customer orders.')}
          </p>
        </div>
      </div>
      <div class="become-saler-status__actions">
        <button id="goto-store-builder-btn" class="btn btn--primary btn--sm font-bold">
          🏬 ${t('customer.become_saler.btn_store_builder', 'Open Storefront Builder')}
        </button>
        <button id="goto-saler-dash-btn" class="btn btn--secondary btn--sm font-bold">
          📊 ${t('customer.become_saler.btn_saler_dashboard', 'Saler Analytics Dashboard')}
        </button>
        <button id="goto-sourcing-btn" class="btn btn--secondary btn--sm font-bold">
          📦 ${t('customer.become_saler.btn_sourcing', 'Browse Sourcing Catalog')}
        </button>
      </div>
    `;

    statusBanner.querySelector('#goto-store-builder-btn')?.addEventListener('click', () => {
      elevateToSalerRole();
      nav('/saler/store-builder');
    });
    statusBanner.querySelector('#goto-saler-dash-btn')?.addEventListener('click', () => {
      elevateToSalerRole();
      nav('/saler');
    });
    statusBanner.querySelector('#goto-sourcing-btn')?.addEventListener('click', () => {
      elevateToSalerRole();
      nav('/saler/sourcing');
    });

    wrap.append(statusBanner);
  }

  // Section B: 1-Click Provisioning Hero Card
  renderProvisioningHero(wrap, { is_saler }, nav);

  // Section C: Interactive Monthly Profit Potential Calculator
  renderProfitCalculator(wrap);

  // Section D: Explooro vs Traditional Business Comparison Matrix
  renderComparisonMatrix(wrap);

  // Section E: 4-Step Visual How It Works Roadmap
  renderHowItWorks(wrap);

  // Section F: FAQ Accordion
  renderFaqSection(wrap);

  container.append(wrap);
}

/**
 * 1-Click Storefront Provisioning Hero
 */
function renderProvisioningHero(container, { is_saler }, nav) {
  const card = document.createElement('div');
  card.className = 'become-saler-hero';

  card.innerHTML = `
    <div class="become-saler-hero__content">
      <h2 class="become-saler-hero__headline">
        🚀 ${t('customer.become_saler.headline', 'Open Your Online Store in 1 Tap')}
      </h2>
      <p class="become-saler-hero__subtext">
        ${t('customer.become_saler.subtext', 'Sell 100+ wholesale products under your own store name and earn 20-35% profit per order. Zero hassle packaging & shipping, with instant bKash/Bank cashouts.')}
      </p>

      <div class="become-saler-hero__benefits">
        <div class="become-saler-hero__benefit-item">
          <span class="become-saler-hero__benefit-check">✓</span>
          <span>${t('customer.become_saler.benefit_1', 'Zero upfront capital required')}</span>
        </div>
        <div class="become-saler-hero__benefit-item">
          <span class="become-saler-hero__benefit-check">✓</span>
          <span>${t('customer.become_saler.benefit_2', 'Suppliers pack & ship directly')}</span>
        </div>
        <div class="become-saler-hero__benefit-item">
          <span class="become-saler-hero__benefit-check">✓</span>
          <span>${t('customer.become_saler.benefit_3', 'Instant bKash & Bank cashouts')}</span>
        </div>
      </div>
    </div>

    <!-- Action Slot & Vanity URL Preview -->
    <div class="become-saler-hero__action-box">
      <div class="become-saler-hero__slug-preview">
        <div class="become-saler-hero__slug-label">
          ${t('customer.become_saler.store_slug_label', 'Your Virtual Storefront URL')}
        </div>
        <div class="become-saler-hero__slug-input-wrap">
          <span class="become-saler-hero__slug-prefix">explooro.com/store/</span>
          <span id="store-slug-preview-val" class="become-saler-hero__slug-val">my-smart-store</span>
        </div>
        <div class="become-saler-hero__slug-hint">
          ${t('customer.become_saler.store_slug_hint', 'You can customize your shop branding anytime in Store Builder.')}
        </div>
      </div>

      <div class="become-saler-hero__cta-wrap">
        <div id="saler-upgrade-btn-slot"></div>
        <div class="become-saler-hero__promise">
          ⚡ ${t('customer.become_saler.instant_promise', '3-Second Activation · Zero Paperwork · No Upfront Capital')}
        </div>
      </div>
    </div>
  `;

  const btnSlot = card.querySelector('#saler-upgrade-btn-slot');
  let isUpgrading = false;

  const upgradeBtn = Button({
    label: is_saler
      ? `🏬 ${t('customer.become_saler.btn_store_builder', 'Open Storefront Builder')}`
      : `🚀 ${t('customer.become_saler.btn_upgrade_cta', 'Start Reselling Now (1-Click Upgrade)')}`,
    variant: 'primary',
    size: 'lg',
    fullWidth: true,
    onClick: is_saler
      ? () => {
          elevateToSalerRole();
          nav('/saler/store-builder');
        }
      : handleUpgrade,
  });

  btnSlot.append(upgradeBtn);

  async function handleUpgrade() {
    if (isUpgrading) return;
    isUpgrading = true;
    upgradeBtn.setLoading(true);
    upgradeBtn.setLabel(`⏳ ${t('customer.become_saler.btn_upgrading', 'Provisioning Storefront...')}`);

    try {
      const res = await customerApi.becomeSaler();
      const data = res.data || {};

      toast.success(data.message_bn || data.message_en || t('customer.become_saler.upgrade_success', 'Congratulations! Your digital store is active.'));

      // Update auth store with full Saler role and permissions
      elevateToSalerRole();

      // Navigate to store builder
      const targetUrl = data.redirect_url || '/saler/store-builder';
      setTimeout(() => {
        nav(targetUrl);
      }, 300);
    } catch (err) {
      toast.error(err.message || 'Upgrade failed. Please try again.');
      isUpgrading = false;
      upgradeBtn.setLoading(false);
      upgradeBtn.setLabel(`🚀 ${t('customer.become_saler.btn_upgrade_cta', 'Start Reselling Now (1-Click Upgrade)')}`);
    }
  }

  container.append(card);
}

/**
 * Interactive Monthly Profit Potential Calculator
 */
function renderProfitCalculator(container) {
  const card = document.createElement('div');
  card.className = 'become-saler-calculator';

  card.innerHTML = `
    <div class="become-saler-calculator__header">
      <div class="inline-flex items-center gap-2">
        <span class="badge badge--success text-[10px] font-bold">
          💰 ${t('customer.become_saler.calculator_badge', 'Passive & Reseller Income')}
        </span>
      </div>
      <h2 class="become-saler-calculator__title">
        🧮 ${t('customer.become_saler.calculator_title', 'Monthly Profit Potential Calculator')}
      </h2>
      <p class="become-saler-calculator__subtitle">
        ${t('customer.become_saler.calculator_subtitle', 'See how much you can earn every month with Explooro zero-inventory reselling.')}
      </p>
    </div>

    <div class="become-saler-calculator__body">
      <div class="become-saler-calculator__controls">
        <div class="become-saler-calculator__control-group">
          <div class="become-saler-calculator__label-row">
            <span>${t('customer.become_saler.calculator_orders_label', 'Expected Daily Orders')}:</span>
            <span id="calc-orders-readout" class="become-saler-calculator__slider-val">5 ${t('customer.become_saler.calculator_orders_unit', 'orders/day')}</span>
          </div>
          <input id="calc-orders-slider" type="range" min="1" max="50" value="5" class="become-saler-calculator__range" />
        </div>

        <div class="become-saler-calculator__control-group">
          <div class="become-saler-calculator__label-row">
            <span>${t('customer.become_saler.calculator_avg_price_label', 'Average Retail Order Value')}:</span>
            <span id="calc-price-readout" class="become-saler-calculator__slider-val font-mono">${formatCurrency(1500)}</span>
          </div>
          <input id="calc-price-slider" type="range" min="500" max="10000" step="250" value="1500" class="become-saler-calculator__range" />
        </div>

        <div class="become-saler-calculator__control-group">
          <div class="become-saler-calculator__label-row">
            <span>${t('customer.become_saler.calculator_margin_label', 'Average Reseller Profit Margin')}:</span>
            <span id="calc-margin-readout" class="become-saler-calculator__slider-val font-mono">25% (${formatCurrency(375)}${t('customer.become_saler.per_order_unit', '/order')})</span>
          </div>
          <input id="calc-margin-slider" type="range" min="10" max="40" step="5" value="25" class="become-saler-calculator__range" />
        </div>
      </div>

      <div class="become-saler-calculator__readouts">
        <div class="become-saler-calculator__kpi-card">
          <span class="become-saler-calculator__kpi-label">${t('customer.become_saler.calculator_daily_profit', 'Estimated Daily Profit')}</span>
          <span id="calc-daily-total" class="become-saler-calculator__kpi-val">${formatCurrency(1875)}</span>
        </div>
        <div class="become-saler-calculator__kpi-card become-saler-calculator__kpi-card--primary">
          <span class="become-saler-calculator__kpi-label">${t('customer.become_saler.calculator_monthly_profit', 'Estimated Monthly Earnings')}</span>
          <span id="calc-monthly-total" class="become-saler-calculator__kpi-val">${formatCurrency(56250)}</span>
        </div>
      </div>
    </div>
  `;

  const ordersSlider = card.querySelector('#calc-orders-slider');
  const priceSlider = card.querySelector('#calc-price-slider');
  const marginSlider = card.querySelector('#calc-margin-slider');

  const ordersReadout = card.querySelector('#calc-orders-readout');
  const priceReadout = card.querySelector('#calc-price-readout');
  const marginReadout = card.querySelector('#calc-margin-readout');
  const dailyTotal = card.querySelector('#calc-daily-total');
  const monthlyTotal = card.querySelector('#calc-monthly-total');

  function updateCalculations() {
    const orders = Number(ordersSlider.value);
    const avgPrice = Number(priceSlider.value);
    const marginPct = Number(marginSlider.value);

    const profitPerOrder = Math.round(avgPrice * (marginPct / 100));
    const daily = orders * profitPerOrder;
    const monthly = daily * 30;

    ordersReadout.textContent = `${orders} ${t('customer.become_saler.calculator_orders_unit', 'orders/day')}`;
    priceReadout.textContent = formatCurrency(avgPrice);
    marginReadout.textContent = `${marginPct}% (${formatCurrency(profitPerOrder)}${t('customer.become_saler.per_order_unit', '/order')})`;
    dailyTotal.textContent = formatCurrency(daily);
    monthlyTotal.textContent = formatCurrency(monthly);
  }

  ordersSlider.addEventListener('input', updateCalculations);
  priceSlider.addEventListener('input', updateCalculations);
  marginSlider.addEventListener('input', updateCalculations);

  updateCalculations();
  container.append(card);
}

/**
 * Traditional Business vs Explooro Reselling Comparison Matrix
 */
function renderComparisonMatrix(container) {
  const card = document.createElement('div');
  card.className = 'become-saler-comparison';

  card.innerHTML = `
    <h2 class="become-saler-comparison__title">
      ⚖️ ${t('customer.become_saler.comparison_title', 'Why Reselling on Explooro Beats Traditional Business')}
    </h2>

    <div class="become-saler-comparison__table-wrap">
      <table class="become-saler-comparison__table" aria-label="Comparison Table">
        <thead>
          <tr>
            <th>${t('customer.become_saler.comparison_col_feature', 'Feature')}</th>
            <th>${t('customer.become_saler.comparison_col_traditional', 'Traditional Business')}</th>
            <th>${t('customer.become_saler.comparison_col_explooro', 'Explooro Reselling')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="become-saler-comparison__cell-feature">${t('customer.become_saler.comparison_row_capital', 'Initial Capital')}</td>
            <td class="become-saler-comparison__cell-trad">${t('customer.become_saler.comparison_trad_capital', 'Tk 50,000 - 5,00,000+ required')}</td>
            <td class="become-saler-comparison__cell-exp">✨ ${t('customer.become_saler.comparison_exp_capital', 'Tk 0 (Completely Free)')}</td>
          </tr>
          <tr>
            <td class="become-saler-comparison__cell-feature">${t('customer.become_saler.comparison_row_stock', 'Inventory & Warehouse')}</td>
            <td class="become-saler-comparison__cell-trad">${t('customer.become_saler.comparison_trad_stock', 'High deadstock & storage risk')}</td>
            <td class="become-saler-comparison__cell-exp">📦 ${t('customer.become_saler.comparison_exp_stock', '100,000+ Supplier Verified Stock')}</td>
          </tr>
          <tr>
            <td class="become-saler-comparison__cell-feature">${t('customer.become_saler.comparison_row_delivery', 'Packaging & Courier')}</td>
            <td class="become-saler-comparison__cell-trad">${t('customer.become_saler.comparison_trad_delivery', 'Daily manual packing & courier runs')}</td>
            <td class="become-saler-comparison__cell-exp">🚚 ${t('customer.become_saler.comparison_exp_delivery', 'Suppliers pack & auto-ship via 3PL')}</td>
          </tr>
          <tr>
            <td class="become-saler-comparison__cell-feature">${t('customer.become_saler.comparison_row_payout', 'Earnings Settlement')}</td>
            <td class="become-saler-comparison__cell-trad">${t('customer.become_saler.comparison_trad_payout', 'Manual cash tracking & debt risk')}</td>
            <td class="become-saler-comparison__cell-exp">💳 ${t('customer.become_saler.comparison_exp_payout', 'Escrow Vault with instant bKash cashout')}</td>
          </tr>
          <tr>
            <td class="become-saler-comparison__cell-feature">${t('customer.become_saler.comparison_row_setup', 'Time to Launch')}</td>
            <td class="become-saler-comparison__cell-trad">${t('customer.become_saler.comparison_trad_setup', 'Weeks of licensing and agreements')}</td>
            <td class="become-saler-comparison__cell-exp">⚡ ${t('customer.become_saler.comparison_exp_setup', '3 Seconds (1-Click Instant)')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  container.append(card);
}

/**
 * 4-Step How It Works Visual Guide
 */
function renderHowItWorks(container) {
  const section = document.createElement('div');
  section.className = 'become-saler-steps';

  section.innerHTML = `
    <h2 class="become-saler-steps__title">
      🧭 ${t('customer.become_saler.steps_title', 'How It Works in 4 Easy Steps')}
    </h2>

    <div class="become-saler-steps__grid">
      <div class="become-saler-step-card">
        <div class="become-saler-step-card__num">1</div>
        <h3 class="become-saler-step-card__title">${t('customer.become_saler.step_1_title', '1. One-Click Store Activation')}</h3>
        <p class="become-saler-step-card__desc">${t('customer.become_saler.step_1_desc', 'Click upgrade to instantly get your branded virtual storefront with zero paperwork.')}</p>
      </div>

      <div class="become-saler-step-card">
        <div class="become-saler-step-card__num">2</div>
        <h3 class="become-saler-step-card__title">${t('customer.become_saler.step_2_title', '2. Select Products & Set Prices')}</h3>
        <p class="become-saler-step-card__desc">${t('customer.become_saler.step_2_desc', 'Pick trending products from the wholesale catalog, customize retail prices and margins.')}</p>
      </div>

      <div class="become-saler-step-card">
        <div class="become-saler-step-card__num">3</div>
        <h3 class="become-saler-step-card__title">${t('customer.become_saler.step_3_title', '3. Share & Sell on Social Media')}</h3>
        <p class="become-saler-step-card__desc">${t('customer.become_saler.step_3_desc', 'Share your store or product links on Facebook, WhatsApp, TikTok, and Instagram.')}</p>
      </div>

      <div class="become-saler-step-card">
        <div class="become-saler-step-card__num">4</div>
        <h3 class="become-saler-step-card__title">${t('customer.become_saler.step_4_title', '4. Collect Profits to bKash')}</h3>
        <p class="become-saler-step-card__desc">${t('customer.become_saler.step_4_desc', 'Suppliers ship orders automatically. When delivered, your profit lands instantly in your wallet.')}</p>
      </div>
    </div>
  `;

  container.append(section);
}

/**
 * FAQ Accordion Section
 */
function renderFaqSection(container) {
  const card = document.createElement('div');
  card.className = 'become-saler-faq';

  card.innerHTML = `
    <h2 class="become-saler-faq__title">
      ❓ ${t('customer.become_saler.faq_title', 'Frequently Asked Questions')}
    </h2>

    <div class="become-saler-faq__list">
      <details class="become-saler-faq__item" open>
        <summary class="become-saler-faq__summary">
          <span>${t('customer.become_saler.faq_q1', 'Do I need any money or advance payment to start?')}</span>
          <span>▾</span>
        </summary>
        <div class="become-saler-faq__content">
          ${t('customer.become_saler.faq_a1', 'No. There is zero signup fee and zero inventory purchase required. You sell from supplier stock and earn profit on every successful sale.')}
        </div>
      </details>

      <details class="become-saler-faq__item">
        <summary class="become-saler-faq__summary">
          <span>${t('customer.become_saler.faq_q2', 'Who handles packaging, courier delivery, and customer returns?')}</span>
          <span>▾</span>
        </summary>
        <div class="become-saler-faq__content">
          ${t('customer.become_saler.faq_a2', 'The verified suppliers and Explooro integrated 3PL logistics handle packing and delivery. In case of returns, standard platform policies protect both you and the customer.')}
        </div>
      </details>

      <details class="become-saler-faq__item">
        <summary class="become-saler-faq__summary">
          <span>${t('customer.become_saler.faq_q3', 'How and when do I receive my earnings?')}</span>
          <span>▾</span>
        </summary>
        <div class="become-saler-faq__content">
          ${t('customer.become_saler.faq_a3', 'Once an order is marked delivered and passes the 7-day warranty window, your profit automatically moves to your Available Vault balance for instant bKash/Nagad/Bank withdrawal.')}
        </div>
      </details>

      <details class="become-saler-faq__item">
        <summary class="become-saler-faq__summary">
          <span>${t('customer.become_saler.faq_q4', 'Can I customize my shop name, logo, and product prices?')}</span>
          <span>▾</span>
        </summary>
        <div class="become-saler-faq__content">
          ${t('customer.become_saler.faq_a4', 'Yes! You have 100% control over your storefront name, bio, social links, and custom retail margins inside Store Builder.')}
        </div>
      </details>
    </div>
  `;

  container.append(card);
}

/**
 * 15-Second Video Walkthrough Modal Simulator for Low-Literacy Users
 */
function openSalerWalkthroughModal(nav) {
  let modal;
  const body = document.createElement('div');
  body.className = 'become-saler-video-modal';

  body.innerHTML = `
    <div class="become-saler-video-modal__screen">
      <div class="become-saler-video-modal__play-btn">
        ▶
      </div>
      <div>
        <div class="text-sm font-bold text-primary">${t('customer.become_saler.video_modal_headline', '15-Second Reseller Business Walkthrough')}</div>
        <div class="text-xs text-muted">${t('customer.become_saler.video_modal_sub', 'Learn how to launch, sell, and withdraw your first profit.')}</div>
      </div>
    </div>
    <div class="become-saler-video-modal__tips">
      <div class="font-bold text-foreground">💡 ${t('customer.become_saler.tips_title', '3 Quick Tips for New Salers:')}</div>
      <ul>
        <li>${t('customer.become_saler.tip_1', 'Launch your store in 1 tap with zero paperwork and no upfront cost.')}</li>
        <li>${t('customer.become_saler.tip_2', 'Add high-demand handloom sarees, fashion, and tech from verified suppliers.')}</li>
        <li>${t('customer.become_saler.tip_3', 'Suppliers deliver automatically; collect profit instantly to bKash upon delivery.')}</li>
      </ul>
    </div>
  `;

  const footer = document.createElement('div');
  footer.className = 'flex justify-between items-center w-full';

  const closeBtn = Button({
    label: t('btn.close', 'Close'),
    variant: 'secondary',
    size: 'sm',
    onClick: () => modal.close(),
  });

  const upgradeModalBtn = Button({
    label: `🚀 ${t('customer.become_saler.cta_btn', 'Click to Become a Saler')}`,
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      modal.close();
      const upgradeBtnEl = document.querySelector('#saler-upgrade-btn-slot button');
      if (upgradeBtnEl) upgradeBtnEl.click();
    },
  });

  footer.append(closeBtn, upgradeModalBtn);

  modal = Modal({
    title: `🎬 ${t('customer.become_saler.video_modal_title', 'Explooro Saler Video Guide')}`,
    content: body,
    footer,
    size: 'md',
  });

  modal.open();
}
