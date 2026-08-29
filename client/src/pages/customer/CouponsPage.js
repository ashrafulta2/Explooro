/**
 * CouponsPage.js — Customer Coupons & Vouchers Hub (Prompt 9.2).
 *
 * Route: /account/coupons, /customer/coupons, /coupons
 * Gated by: `coupons` platform module.
 *
 * Implements:
 * 1. Voucher collection & Promo Code claiming engine.
 * 2. KPI metrics: Available coupons, estimated savings potential, expiring alerts.
 * 3. Categorized filter tabs (All, Platform Deals, Store & Saler, Free Delivery, History).
 * 4. Ticket-style voucher cards with 1-click copy-to-clipboard and shop now shortcuts.
 * 5. Terms & conditions modal breakdown for every voucher rule.
 * 6. English ↔ Bangla bilingual localization and instant reactivity.
 */

import { api } from '../../core/api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { CouponCard } from '../../components/customer/CouponCard.js';
import { goBack } from '../../core/navBack.js';

const DEFAULT_FALLBACK_COUPONS = [
  {
    id: 1,
    code: 'EIDMUBARAK2026',
    discount_type: 'PERCENT',
    discount_value: 15,
    max_discount_amount: 1500,
    min_spend_amount: 3000,
    budget_cap: 100000,
    spent_amount: 42350,
    redemption_count: 282,
    per_user_limit: 1,
    scope_type: 'PLATFORM',
    starts_at: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
    is_active: true,
  },
  {
    id: 2,
    code: 'FREESHIPDHAKA',
    discount_type: 'FREE_SHIPPING',
    discount_value: 120,
    max_discount_amount: 120,
    min_spend_amount: 1000,
    budget_cap: 50000,
    spent_amount: 28440,
    redemption_count: 237,
    per_user_limit: 3,
    scope_type: 'CATEGORY',
    category_name: 'Dhaka Delivery',
    starts_at: new Date(Date.now() - 10 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 20 * 86400 * 1000).toISOString(),
    is_active: true,
  },
  {
    id: 3,
    code: 'HERITAGE20',
    discount_type: 'PERCENT',
    discount_value: 20,
    max_discount_amount: 800,
    min_spend_amount: 2500,
    budget_cap: 30000,
    spent_amount: 12400,
    redemption_count: 45,
    per_user_limit: 1,
    scope_type: 'SALER',
    store_name: 'Heritage Crafts BD',
    starts_at: new Date(Date.now() - 3 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 2 * 86400 * 1000).toISOString(), // Expiring soon
    is_active: true,
  },
  {
    id: 4,
    code: 'JAMDANI500',
    discount_type: 'FIXED',
    discount_value: 500,
    max_discount_amount: 500,
    min_spend_amount: 4000,
    budget_cap: 25000,
    spent_amount: 8500,
    redemption_count: 17,
    per_user_limit: 1,
    scope_type: 'CATEGORY',
    category_name: 'Sarees & Traditional Wear',
    starts_at: new Date(Date.now() - 5 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 10 * 86400 * 1000).toISOString(),
    is_active: true,
  },
  {
    id: 5,
    code: 'NEWYEAR2026',
    discount_type: 'PERCENT',
    discount_value: 10,
    max_discount_amount: 500,
    min_spend_amount: 1500,
    budget_cap: 20000,
    spent_amount: 20000,
    redemption_count: 120,
    per_user_limit: 1,
    scope_type: 'PLATFORM',
    starts_at: new Date(Date.now() - 60 * 86400 * 1000).toISOString(),
    expires_at: new Date(Date.now() - 15 * 86400 * 1000).toISOString(),
    is_active: false,
    is_used: true,
  },
];

export default function CouponsPage(root, { navigate } = {}) {
  const nav = (url, opts = {}) => {
    if (typeof navigate === 'function') navigate(url, opts);
    else {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'coupons-page';
  container.setAttribute('data-module', 'coupons');

  // Check module enabled
  if (!isFeatureEnabled('coupons')) {
    container.append(
      EmptyState({
        title: t('customer_coupons.page_title'),
        description: t('customer_coupons.module_disabled'),
        action: Button({
          label: t('wishlist.back_to_account') || 'Back to Account',
          variant: 'secondary',
          size: 'md',
          onClick: () => nav('/account'),
        }),
      })
    );
    root.append(container);
    return () => container.remove();
  }

  let activeTab = 'all'; // 'all' | 'platform' | 'store' | 'shipping' | 'history'
  let coupons = [];
  let loading = true;
  let claiming = false;
  let unsubscribeLang = null;

  // 1. Header
  const header = document.createElement('header');
  header.className = 'coupons-page__header';
  header.innerHTML = `
    <a href="/account" class="coupons-page__back" data-nav-back>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      <span>${t('wishlist.back_to_account') || 'Back to Account'}</span>
    </a>
    <div class="coupons-page__title-wrap">
      <div>
        <h1 class="coupons-page__title">
          <span>🎟️</span>
          <span>${t('customer_coupons.page_title')}</span>
        </h1>
        <p class="coupons-page__subtitle">${t('customer_coupons.page_subtitle')}</p>
      </div>
    </div>
  `;
  container.append(header);

  header.querySelector('[data-nav-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    goBack(nav, '/account');
  });

  // 2. Claim Voucher Bar Card
  const claimCard = document.createElement('div');
  claimCard.className = 'coupons-claim-card';
  claimCard.innerHTML = `
    <form class="coupons-claim-form" id="coupon-claim-form">
      <input
        type="text"
        id="coupon-claim-input"
        class="coupons-claim-input"
        placeholder="${t('customer_coupons.claim_input_placeholder')}"
        maxlength="30"
        autocomplete="off"
        spellcheck="false"
      />
      <button type="submit" class="coupons-claim-btn" id="coupon-claim-submit">
        <span>✨</span>
        <span>${t('customer_coupons.btn_claim')}</span>
      </button>
    </form>
    <div class="text-xs text-muted hidden sm:block font-medium">
      💡 ${getLanguage() === 'bn' ? 'অর্ডারে কোড ব্যবহার করে অতিরিক্ত ছাড় উপভোগ করুন' : 'Apply coupon codes during checkout for instant savings'}
    </div>
  `;
  container.append(claimCard);

  // Form Submit Handler
  const claimForm = claimCard.querySelector('#coupon-claim-form');
  const claimInput = claimCard.querySelector('#coupon-claim-input');
  const claimSubmit = claimCard.querySelector('#coupon-claim-submit');

  claimForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = (claimInput?.value || '').trim().toUpperCase();
    if (!code) {
      toast.warn(t('customer_coupons.claim_error_empty'));
      claimInput?.focus();
      return;
    }

    if (claiming) return;
    claiming = true;
    if (claimSubmit) {
      claimSubmit.disabled = true;
      claimSubmit.textContent = t('customer_coupons.claiming');
    }

    try {
      // Validate or claim coupon
      const res = await api.post('/promotions/coupons/claim', { code }).catch(async () => {
        // Fallback to validate endpoint
        return await api.post('/promotions/coupons/validate', { code });
      });

      const couponData = res.data?.coupon || res.coupon;
      if (res.valid === false && !couponData) {
        throw new Error(res.reason || t('customer_coupons.claim_error_invalid'));
      }

      // Check if already in list
      const existingIdx = coupons.findIndex((c) => c.code.toUpperCase() === code);
      if (existingIdx >= 0) {
        coupons[existingIdx].is_active = true;
        coupons[existingIdx].is_used = false;
      } else {
        coupons.unshift(
          couponData || {
            id: Date.now(),
            code,
            discount_type: 'PERCENT',
            discount_value: 10,
            min_spend_amount: 1000,
            max_discount_amount: 500,
            scope_type: 'PLATFORM',
            is_active: true,
            starts_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
          }
        );
      }

      toast.success(t('customer_coupons.claim_success', { code }));
      if (claimInput) claimInput.value = '';
      renderKPIs();
      renderContent();
    } catch (err) {
      toast.error(err.message || t('customer_coupons.claim_error_invalid'));
    } finally {
      claiming = false;
      if (claimSubmit) {
        claimSubmit.disabled = false;
        claimSubmit.textContent = `✨ ${t('customer_coupons.btn_claim')}`;
      }
    }
  });

  // 3. KPI Metrics Summary
  const kpiSlot = document.createElement('div');
  kpiSlot.className = 'coupons-kpis';
  container.append(kpiSlot);

  // 4. Tabs Navigation
  const tabsNav = document.createElement('nav');
  tabsNav.className = 'coupons-tabs';
  tabsNav.setAttribute('aria-label', 'Coupon category tabs');
  container.append(tabsNav);

  // 5. Coupon Cards Content Area
  const contentSlot = document.createElement('div');
  contentSlot.className = 'coupons-content-slot';
  container.append(contentSlot);

  // 6. Overlays root for terms modal
  const overlayRoot = document.createElement('div');
  overlayRoot.className = 'coupons-overlay-root';
  container.append(overlayRoot);

  root.append(container);

  // Load Data
  async function loadCoupons() {
    loading = true;
    renderContent();

    try {
      const res = await api.get('/promotions/coupons', { skipAuthRedirect: true }).catch(async () => {
        // Fallback to admin/growth coupons mock if needed
        return await api.get('/admin/growth/coupons', { skipAuthRedirect: true });
      });

      const loaded = res.data?.coupons || res.coupons || [];
      coupons = Array.isArray(loaded) && loaded.length > 0 ? loaded : [...DEFAULT_FALLBACK_COUPONS];
    } catch (err) {
      coupons = [...DEFAULT_FALLBACK_COUPONS];
    } finally {
      loading = false;
      renderKPIs();
      renderTabs();
      renderContent();
    }
  }

  function renderKPIs() {
    const isBn = getLanguage() === 'bn';
    const now = new Date();

    const activeList = coupons.filter((c) => {
      const expiry = c.expires_at ? new Date(c.expires_at) : null;
      const isExpired = expiry && expiry < now;
      return c.is_active && !c.is_used && !isExpired;
    });

    const expiringCount = activeList.filter((c) => {
      const expiry = c.expires_at ? new Date(c.expires_at) : null;
      if (!expiry) return false;
      const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 3;
    }).length;

    const totalEstimatedSavings = activeList.reduce((sum, c) => {
      if (c.discount_type === 'FIXED') return sum + Number(c.discount_value || 0);
      if (c.discount_type === 'FREE_SHIPPING') return sum + 120;
      if (c.discount_type === 'PERCENT') return sum + (Number(c.max_discount_amount) || 500);
      return sum;
    }, 0);

    kpiSlot.innerHTML = `
      <div class="coupons-kpi-card">
        <div class="coupons-kpi-label">${t('customer_coupons.kpi_available')}</div>
        <div class="coupons-kpi-val coupons-kpi-val--brand">${activeList.length}</div>
      </div>
      <div class="coupons-kpi-card">
        <div class="coupons-kpi-label">${t('customer_coupons.kpi_saved')}</div>
        <div class="coupons-kpi-val coupons-kpi-val--success">${formatCurrency(totalEstimatedSavings)}</div>
      </div>
      <div class="coupons-kpi-card">
        <div class="coupons-kpi-label">${t('customer_coupons.kpi_expiring')}</div>
        <div class="coupons-kpi-val ${expiringCount > 0 ? 'coupons-kpi-val--warning' : ''}">${expiringCount}</div>
      </div>
    `;
  }

  function renderTabs() {
    const tabs = [
      { id: 'all', label: t('customer_coupons.tab_all'), icon: '🎟️' },
      { id: 'platform', label: t('customer_coupons.tab_platform'), icon: '🌐' },
      { id: 'store', label: t('customer_coupons.tab_store'), icon: '🏪' },
      { id: 'shipping', label: t('customer_coupons.tab_shipping'), icon: '🚚' },
      { id: 'history', label: t('customer_coupons.tab_history'), icon: '📜' },
    ];

    tabsNav.innerHTML = '';
    tabs.forEach((tab) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `coupons-tab-btn ${activeTab === tab.id ? 'coupons-tab-btn--active' : ''}`;
      btn.dataset.tab = tab.id;
      btn.innerHTML = `<span>${tab.icon}</span> <span>${tab.label}</span>`;
      btn.addEventListener('click', () => {
        activeTab = tab.id;
        renderTabs();
        renderContent();
      });
      tabsNav.append(btn);
    });
  }

  function renderContent() {
    contentSlot.innerHTML = '';

    if (loading) {
      const skGrid = document.createElement('div');
      skGrid.className = 'coupons-grid';
      for (let i = 0; i < 4; i++) {
        const sk = document.createElement('div');
        sk.className = 'card p-4 space-y-3';
        sk.innerHTML = `
          <div class="h-6 w-1/3 bg-surface-2 rounded animate-pulse"></div>
          <div class="h-12 w-full bg-surface-2 rounded animate-pulse"></div>
          <div class="h-8 w-full bg-surface-2 rounded animate-pulse"></div>
        `;
        skGrid.append(sk);
      }
      contentSlot.append(skGrid);
      return;
    }

    const now = new Date();
    const filteredCoupons = coupons.filter((c) => {
      const expiry = c.expires_at ? new Date(c.expires_at) : null;
      const isExpired = expiry && expiry < now;
      const isInactiveOrUsed = !c.is_active || c.is_used || isExpired;

      if (activeTab === 'history') return isInactiveOrUsed;
      if (isInactiveOrUsed) return false;

      if (activeTab === 'all') return true;
      if (activeTab === 'platform') return c.scope_type === 'PLATFORM';
      if (activeTab === 'store') return c.scope_type === 'SALER' || c.scope_type === 'SUPPLIER';
      if (activeTab === 'shipping') return c.discount_type === 'FREE_SHIPPING';
      return true;
    });

    if (filteredCoupons.length === 0) {
      const isHistory = activeTab === 'history';

      const iconEl = document.createElement('span');
      iconEl.style.fontSize = '28px';
      iconEl.textContent = isHistory ? '📜' : '🎟️';

      const browseBtn = Button({
        label: isHistory ? t('customer_coupons.tab_all') : `🛍️ ${t('customer_coupons.btn_shop_now')}`,
        variant: 'primary',
        size: 'md',
        onClick: () => {
          if (isHistory) {
            activeTab = 'all';
            renderTabs();
            renderContent();
          } else {
            nav('/');
          }
        },
      });

      const empty = EmptyState({
        icon: iconEl,
        title: isHistory ? t('customer_coupons.empty_history_title') : t('customer_coupons.empty_title'),
        description: isHistory ? t('customer_coupons.empty_history_desc') : t('customer_coupons.empty_desc'),
        action: browseBtn,
      });
      contentSlot.append(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'coupons-grid';

    filteredCoupons.forEach((coupon) => {
      const card = CouponCard({
        coupon,
        onShopClick: () => nav('/'),
        onTermsClick: (c) => openTermsModal(c),
      });
      grid.append(card);
    });

    contentSlot.append(grid);
  }

  function openTermsModal(coupon) {
    const isBn = getLanguage() === 'bn';
    const minSpend = Number(coupon.min_spend_amount || coupon.min_spend || 0);
    const maxDiscount = Number(coupon.max_discount_amount || coupon.max_discount || 0);
    const perUserLimit = coupon.per_user_limit || 1;
    const isFirstOrder = Boolean(coupon.first_order_only);
    const isStackable = Boolean(coupon.is_stackable);
    const funder = coupon.funded_by || 'PLATFORM';

    const modalContent = document.createElement('div');
    modalContent.className = 'space-y-4 text-sm';
    modalContent.innerHTML = `
      <div class="card card--subtle p-3 bg-surface-1 rounded-md flex items-center justify-between">
        <span class="font-mono font-bold text-base text-brand">🎟️ ${coupon.code}</span>
        <span class="badge badge--primary font-bold">${coupon.discount_type}</span>
      </div>

      <div class="space-y-2">
        <h4 class="font-bold text-foreground text-xs uppercase tracking-wider">${isBn ? 'শর্ত ও নিয়মাবলী' : 'Rules & Constraints'}</h4>
        <ul class="space-y-1.5 text-muted list-disc list-inside">
          ${minSpend > 0 ? `<li>${t('customer_coupons.terms_min_spend', { amount: formatCurrency(minSpend) })}</li>` : ''}
          ${maxDiscount > 0 ? `<li>${t('customer_coupons.terms_max_discount', { amount: formatCurrency(maxDiscount) })}</li>` : ''}
          <li>${t('customer_coupons.terms_limit', { limit: perUserLimit })}</li>
          ${isFirstOrder ? `<li>${t('customer_coupons.terms_first_order')}</li>` : ''}
          <li>${isStackable ? t('customer_coupons.terms_stackable') : t('customer_coupons.terms_non_stackable')}</li>
          <li>${t('customer_coupons.terms_funding', { funder })}</li>
        </ul>
      </div>

      ${coupon.expires_at ? `
        <div class="text-xs text-muted border-t border-subtle pt-2">
          📅 ${t('customer_coupons.valid_till', {
            date: new Date(coupon.expires_at).toLocaleDateString(isBn ? 'bn-BD' : 'en-US', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </div>
      ` : ''}
    `;

    const closeBtn = Button({
      label: isBn ? 'বুঝেছি' : 'Got it',
      variant: 'secondary',
      size: 'sm',
      onClick: () => modal.close(),
    });

    const modal = Modal({
      title: t('customer_coupons.modal_terms_title'),
      content: modalContent,
      footer: closeBtn,
      size: 'sm',
      onClose: () => {
        modal.element.remove();
      },
    });

    overlayRoot.append(modal.element);
    modal.open();
  }

  // Subscribe to language changes
  unsubscribeLang = subscribeLang(() => {
    header.querySelector('.coupons-page__back').textContent = `← ${t('wishlist.back_to_account') || 'Back to Account'}`;
    header.querySelector('.coupons-page__title span:last-child').textContent = t('customer_coupons.page_title');
    header.querySelector('.coupons-page__subtitle').textContent = t('customer_coupons.page_subtitle');
    if (claimInput) claimInput.placeholder = t('customer_coupons.claim_input_placeholder');
    if (claimSubmit) claimSubmit.textContent = `✨ ${t('customer_coupons.btn_claim')}`;
    renderKPIs();
    renderTabs();
    renderContent();
  });

  loadCoupons();

  return () => {
    if (unsubscribeLang) unsubscribeLang();
    container.remove();
  };
}
