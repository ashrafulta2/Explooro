/**
 * BecomeSalerPage.ts — 1-Click Zero-Paperwork Shop Partner Upgrade & Onboarding Hub.
 *
 * Implements:
 * 1. Low-literacy friendly, high-contrast visual shop partner onboarding with 100% bilingual i18n.
 * 2. Active Shop Partner status detection with direct deep-links to Store Builder, Shop Partner Analytics & Sourcing.
 * 3. Genuine 1-Click Shop Partner upgrade calling customerApi.becomeSaler() with role mutation & vanity store provisioning.
 * 4. How the monthly partner reward pool pays a shop partner (no per-sale profit).
 * 5. Traditional Business vs Explooro Selling comparison matrix.
 * 6. 4-Step visual workflow roadmap & interactive FAQ accordion.
 * 7. 15-Second low-literacy video guide modal.
 *
 * Route: /account/become-saler, /customer/become-saler, /become-saler
 */

import { customerApi } from '../../services/customer.api.ts';
import { t } from '../../services/i18n.ts';
import { formatNumber } from '../../services/format.ts';
import { toast } from '../../services/toast.ts';
import { Button } from '../../components/ui/Button.ts';
import { Skeleton } from '../../components/ui/Skeleton.ts';
import { Modal } from '../../components/ui/Modal.ts';
import { appStore, setMockRole } from '../../state/appStore.ts';
import { defaultPermissionsForRole } from '../../config/permissions.mock.ts';
import type { PageContext } from '../types.ts';

export default function BecomeSalerPage(root: HTMLElement, { navigate }: PageContext = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'account-page become-saler-page';

  // 1. Header with Breadcrumbs & Title
  const header = document.createElement('div');
  header.className = 'account-page__header';
  header.innerHTML = `
    <nav class="become-saler-page__breadcrumb" aria-label="Breadcrumb">
      <a href="/">${t('nav.home', 'Home')}</a>
      <span>/</span>
      <a href="/account">${t('nav.customer.dashboard', 'Customer Account')}</a>
      <span>/</span>
      <span class="text-primary font-bold">${t('customer.become_saler.page_title', '1-Click Shop Partner Upgrade')}</span>
    </nav>

    <div class="account-page__title-wrap">
      <div class="become-saler-page__badge-row">
        <span class="badge badge--primary text-[10px] font-bold uppercase tracking-wider">
          ✨ ${t('customer.become_saler.badge', 'Zero-Capital Shop Partner Hub')}
        </span>
      </div>
      <button id="saler-video-guide-btn" class="btn btn--secondary btn--sm flex items-center gap-1 text-xs font-bold">
        🎬 ${t('customer.become_saler.video_modal_headline', '15-Second Shop Partner Business Walkthrough')}
      </button>
    </div>

    <h1 class="account-page__title">
      ${t('customer.become_saler.page_title', '1-Click Shop Partner Upgrade')}
    </h1>
    <p class="account-page__subtitle">
      ${t('customer.become_saler.page_subtitle', 'Turn wholesale catalog products into your own branded store. No inventory holding, no packaging stress, zero upfront cost.')}
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
      const currentAuth: Record<string, any> = appStore.get()?.auth || {};
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
 * Ensures the session holds full Shop Partner permissions before navigating to Shop Partner routes.
 */
function elevateToSalerRole() {
  try {
    if (typeof setMockRole === 'function') {
      setMockRole('saler');
    } else {
      const auth: Record<string, any> = appStore.get()?.auth || {};
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
 * Renders complete sections of Become a Shop Partner page.
 */
function renderSalerPageContent(container, { is_saler = false } = {}, nav) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'space-y-8';

  // Section A: If user is already a shop partner, show active status banner
  if (is_saler) {
    const statusBanner = document.createElement('div');
    statusBanner.className = 'become-saler-status';
    statusBanner.innerHTML = `
      <div class="become-saler-status__header">
        <div class="become-saler-status__icon">🎉</div>
        <div class="become-saler-status__content">
          <h2 class="become-saler-status__title">
            ${t('customer.become_saler.already_saler_title', 'You are already a registered Shop Partner!')}
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
          📊 ${t('customer.become_saler.btn_saler_dashboard', 'Shop Partner Analytics Dashboard')}
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

  // Section C: How the monthly partner reward works
  renderRewardExplainer(wrap);

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
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg> ${t('customer.become_saler.headline', 'Open Your Online Store in 1 Tap')}
      </h2>
      <p class="become-saler-hero__subtext">
        ${t('customer.become_saler.subtext', 'Sell 100+ wholesale products under your own store name. Suppliers pack and ship every order, and once a month you get a share of the partner reward pool for what you did.')}
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
          <span>${t('customer.become_saler.benefit_3', 'Monthly reward, cash out to bKash or bank')}</span>
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
      : `${t('customer.become_saler.btn_upgrade_cta', 'Start Selling Now (1-Click Upgrade)')}`,
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

      // Update auth store with full Shop Partner role and permissions
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
      upgradeBtn.setLabel(`${t('customer.become_saler.btn_upgrade_cta', 'Start Selling Now (1-Click Upgrade)')}`);
    }
  }

  container.append(card);
}

/**
 * How the monthly partner reward works.
 *
 * WHY: a shop partner earns nothing per sale. A sale's partner share goes to the
 * PARTNER_REWARD_POOL and the pool is shared out once a month by score (server
 * services/partnerReward.service.ts). The weights are configuration (`partner_reward.rules`)
 * and a customer cannot read them, so this section names the four factors in the order the
 * rules require and never prints a taka figure or a percentage.
 */
const REWARD_FACTORS = ['sales', 'social', 'community', 'activity'];

function renderRewardExplainer(container) {
  const card = document.createElement('div');
  card.className = 'become-saler-reward';

  const factors = REWARD_FACTORS.map((key, idx) => `
    <li class="become-saler-reward__factor">
      <span class="become-saler-reward__rank">${formatNumber(idx + 1)}</span>
      <div>
        <h3 class="become-saler-reward__factor-title">${t(`customer.become_saler.reward_factor_${key}`)}</h3>
        <p class="become-saler-reward__factor-desc">${t(`customer.become_saler.reward_factor_${key}_desc`)}</p>
      </div>
    </li>`).join('');

  card.innerHTML = `
    <div class="become-saler-reward__header">
      <span class="badge badge--success text-[10px] font-bold">
        💰 ${t('customer.become_saler.reward_badge', 'Shop partner income')}
      </span>
      <h2 class="become-saler-reward__title">
        🏆 ${t('customer.become_saler.reward_title', 'How your monthly reward works')}
      </h2>
      <p class="become-saler-reward__subtitle">${t('customer.become_saler.reward_subtitle')}</p>
    </div>

    <p class="become-saler-reward__order-note">${t('customer.become_saler.reward_order_note', 'Listed from what counts most to what counts least.')}</p>
    <ol class="become-saler-reward__factors">${factors}</ol>

    <div class="become-saler-reward__payout">
      <h3 class="become-saler-reward__factor-title">${t('customer.become_saler.reward_payout_title', 'When you get paid')}</h3>
      <p class="become-saler-reward__factor-desc">${t('customer.become_saler.reward_payout_desc')}</p>
      <p class="become-saler-reward__factor-desc">${t('customer.become_saler.reward_estimate_note')}</p>
    </div>
  `;

  container.append(card);
}

/**
 * Traditional Business vs Explooro Selling Comparison Matrix
 */
function renderComparisonMatrix(container) {
  const card = document.createElement('div');
  card.className = 'become-saler-comparison';

  card.innerHTML = `
    <h2 class="become-saler-comparison__title">
      ⚖️ ${t('customer.become_saler.comparison_title', 'Why Selling on Explooro Beats Traditional Business')}
    </h2>

    <div class="become-saler-comparison__table-wrap">
      <table class="become-saler-comparison__table" aria-label="Comparison Table">
        <thead>
          <tr>
            <th>${t('customer.become_saler.comparison_col_feature', 'Feature')}</th>
            <th>${t('customer.become_saler.comparison_col_traditional', 'Traditional Business')}</th>
            <th>${t('customer.become_saler.comparison_col_explooro', 'Explooro Selling')}</th>
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
            <td class="become-saler-comparison__cell-feature">${t('customer.become_saler.comparison_row_payout', 'Earnings')}</td>
            <td class="become-saler-comparison__cell-trad">${t('customer.become_saler.comparison_trad_payout', 'Manual cash tracking & debt risk')}</td>
            <td class="become-saler-comparison__cell-exp">💳 ${t('customer.become_saler.comparison_exp_payout', 'Monthly reward to your vault, cash out to bKash')}</td>
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
        <h3 class="become-saler-step-card__title">${t('customer.become_saler.step_2_title', '2. Pick Products for Your Store')}</h3>
        <p class="become-saler-step-card__desc">${t('customer.become_saler.step_2_desc', 'Choose trending products from the wholesale catalog. The supplier sets the price, so there are no margins to work out.')}</p>
      </div>

      <div class="become-saler-step-card">
        <div class="become-saler-step-card__num">3</div>
        <h3 class="become-saler-step-card__title">${t('customer.become_saler.step_3_title', '3. Share & Sell on Social Media')}</h3>
        <p class="become-saler-step-card__desc">${t('customer.become_saler.step_3_desc', 'Share your store or product links on Facebook, WhatsApp, TikTok, and Instagram.')}</p>
      </div>

      <div class="become-saler-step-card">
        <div class="become-saler-step-card__num">4</div>
        <h3 class="become-saler-step-card__title">${t('customer.become_saler.step_4_title', '4. Earn Your Monthly Reward')}</h3>
        <p class="become-saler-step-card__desc">${t('customer.become_saler.step_4_desc', 'Suppliers ship orders automatically. Every delivered sale, link visit, community post and active day earns points toward your monthly share of the pool.')}</p>
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
          ${t('customer.become_saler.faq_a1', 'No. There is zero signup fee and zero inventory purchase required. You sell from supplier stock and earn a monthly share of the partner reward pool.')}
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
          ${t('customer.become_saler.faq_a3', 'You are not paid per order. A few days after each month ends, the partner reward pool is shared out by points and your share goes to your vault, ready to withdraw to bKash, Nagad or a bank.')}
        </div>
      </details>

      <details class="become-saler-faq__item">
        <summary class="become-saler-faq__summary">
          <span>${t('customer.become_saler.faq_q4', 'Can I customize my shop name, logo, and product prices?')}</span>
          <span>▾</span>
        </summary>
        <div class="become-saler-faq__content">
          ${t('customer.become_saler.faq_a4', 'You have full control over your store name, bio, logo and social links in Store Builder. Prices are set by the supplier and are the same in every store, so customers always see a fair price.')}
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
        <div class="text-sm font-bold text-primary">${t('customer.become_saler.video_modal_headline', '15-Second Shop Partner Business Walkthrough')}</div>
        <div class="text-xs text-muted">${t('customer.become_saler.video_modal_sub', 'Learn how to launch your store, share it, and earn your monthly reward.')}</div>
      </div>
    </div>
    <div class="become-saler-video-modal__tips">
      <div class="font-bold text-foreground">💡 ${t('customer.become_saler.tips_title', '3 Quick Tips for New Shop Partners:')}</div>
      <ul>
        <li>${t('customer.become_saler.tip_1', 'Launch your store in 1 tap with zero paperwork and no upfront cost.')}</li>
        <li>${t('customer.become_saler.tip_2', 'Add high-demand handloom sarees, fashion, and tech from verified suppliers.')}</li>
        <li>${t('customer.become_saler.tip_3', 'Suppliers deliver automatically; your sales, shares and posts earn points for the monthly reward.')}</li>
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
    label: `${t('customer.become_saler.cta_btn', 'Click to Become a Shop Partner')}`,
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      modal.close();
      const upgradeBtnEl = document.querySelector<HTMLElement>('#saler-upgrade-btn-slot button');
      if (upgradeBtnEl) upgradeBtnEl.click();
    },
  });

  footer.append(closeBtn, upgradeModalBtn);

  modal = Modal({
    title: `🎬 ${t('customer.become_saler.video_modal_title', 'Explooro Shop Partner Video Guide')}`,
    content: body,
    footer,
    size: 'md',
  });

  modal.open();
}
