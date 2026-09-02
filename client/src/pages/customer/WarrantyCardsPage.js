/**
 * WarrantyCardsPage.js — Customer Digital Warranty & Protection Hub (Prompt 10.4).
 *
 * Route: /warranties, /account/warranties, /customer/warranties
 * Gated by: `digital_warranty` module flag.
 */

import { api } from '../../core/api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { WarrantyCard } from '../../components/warranty/WarrantyCard.js';
import { openClaimModal } from '../../components/warranty/ClaimModal.js';
import { ClaimTimeline } from '../../components/warranty/ClaimTimeline.js';
import { openCertificateModal } from '../../components/warranty/CertificateModal.js';
import { openRegisterWarrantyModal } from '../../components/warranty/RegisterWarrantyModal.js';
import { bindBackControl } from '../../core/navBack.js';

export default function WarrantyCardsPage(root, { navigate } = {}) {
  const container = document.createElement('div');
  container.className = 'warranties-page container';
  container.setAttribute('data-module', 'digital_warranty');

  if (!isFeatureEnabled('digital_warranty')) {
    container.append(
      EmptyState({
        title: t('warranty.hub_title'),
        description: t('warranty.module_disabled'),
      })
    );
    root.append(container);
    return () => {};
  }

  let activeTab = 'active'; // 'active' | 'expired' | 'all' | 'claims'
  let searchQuery = '';
  let sortBy = 'expiring_soon'; // 'expiring_soon' | 'newest' | 'title'
  let cards = [];
  let loading = true;

  // Header Section
  const header = document.createElement('header');
  header.className = 'warranties-page__header';
  header.innerHTML = `
    <a href="/account" class="warranties-page__back">
      ← ${t('common.back') || 'Back'}
    </a>
    <div class="warranties-page__title-wrap">
      <div>
        <h1 class="warranties-page__title">
          <span>🛡️</span> ${t('warranty.hub_title')}
        </h1>
        <p class="warranties-page__subtitle">
          ${t('warranty.hub_subtitle')}
        </p>
      </div>
      <div class="warranties-page__header-actions">
        <button class="warranties-page__btn-register btn-register-warranty" type="button">
          <span>➕</span> ${t('warranty.register_warranty_title') || 'Register Warranty'}
        </button>
      </div>
    </div>
  `;
  container.appendChild(header);

  bindBackControl(header.querySelector('.warranties-page__back'), navigate, '/account');

  // KPI Summary Bar
  const kpiBar = document.createElement('div');
  kpiBar.className = 'warranties-kpis';
  container.appendChild(kpiBar);

  // Search & Filter Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'warranties-toolbar';
  toolbar.innerHTML = `
    <div class="warranties-search-wrap">
      <span class="warranties-search-icon">🔍</span>
      <input
        type="text"
        class="warranties-search-input"
        placeholder="${t('warranty.search_placeholder') || 'Search by product name, serial number, or ID...'}"
        value=""
      />
    </div>
    <div class="flex items-center gap-2">
      <select class="warranties-sort-select">
        <option value="expiring_soon">${t('warranty.sort_expiring_soon') || 'Expiring Soonest'}</option>
        <option value="newest">${t('warranty.sort_newest') || 'Recently Added'}</option>
        <option value="title">${t('warranty.sort_title') || 'Product Name (A-Z)'}</option>
      </select>
    </div>
  `;
  container.appendChild(toolbar);

  // Tabs Bar
  const navTabs = document.createElement('div');
  navTabs.className = 'warranties-tabs';
  navTabs.innerHTML = `
    <button class="warranties-tab-btn warranties-tab-btn--active" data-tab="active">
      <span>🛡️ ${t('warranty.tab_active')}</span>
      <span class="warranties-tab-badge" id="count-active">0</span>
    </button>
    <button class="warranties-tab-btn" data-tab="expired">
      <span>⏳ ${t('warranty.tab_expired')}</span>
      <span class="warranties-tab-badge" id="count-expired">0</span>
    </button>
    <button class="warranties-tab-btn" data-tab="all">
      <span>📁 ${t('warranty.tab_all') || 'All Certificates'}</span>
      <span class="warranties-tab-badge" id="count-all">0</span>
    </button>
    <button class="warranties-tab-btn" data-tab="claims">
      <span>📋 ${t('warranty.tab_my_claims')}</span>
      <span class="warranties-tab-badge" id="count-claims">0</span>
    </button>
  `;
  container.appendChild(navTabs);

  // Main Content Area
  const contentArea = document.createElement('div');
  contentArea.className = 'warranties-content min-h-[300px]';
  container.appendChild(contentArea);

  // How Warranties Work Guide & FAQ
  const guideSection = document.createElement('section');
  guideSection.className = 'warranties-guide';
  guideSection.innerHTML = `
    <div class="warranties-guide__head">
      <div>
        <h3 class="warranties-guide__title">
          <span>💡</span> ${t('warranty.how_it_works_title') || 'How Digital Warranties & Protection Work'}
        </h3>
        <p class="warranties-guide__subtitle">
          ${t('warranty.how_it_works_sub') || 'Simple, transparent, zero-hassle manufacturer guarantees.'}
        </p>
      </div>
    </div>

    <div class="warranties-steps-grid">
      <div class="warranties-step-card">
        <div class="warranties-step-num">1</div>
        <h4 class="warranties-step-title">${t('warranty.step1_title') || 'Automatic Digital Issuance'}</h4>
        <p class="warranties-step-desc">
          ${t('warranty.step1_desc') || 'When you receive any warrantied product, an official digital certificate is generated with a verified serial number.'}
        </p>
      </div>

      <div class="warranties-step-card">
        <div class="warranties-step-num">2</div>
        <h4 class="warranties-step-title">${t('warranty.step2_title') || '1-Click Online Claim'}</h4>
        <p class="warranties-step-desc">
          ${t('warranty.step2_desc') || 'If an issue occurs, click "File Claim" anytime with photo proof. Suppliers are committed to a 72-hour review SLA.'}
        </p>
      </div>

      <div class="warranties-step-card">
        <div class="warranties-step-num">3</div>
        <h4 class="warranties-step-title">${t('warranty.step3_title') || 'Free Pickup & Repair'}</h4>
        <p class="warranties-step-desc">
          ${t('warranty.step3_desc') || 'Upon claim approval, reverse courier pickup is arranged at your doorstep and delivered back repaired or replaced at no extra cost.'}
        </p>
      </div>
    </div>

    <div class="warranties-faq-grid" style="margin-top: var(--space-2);">
      <div class="warranties-faq-card">
        <h5 class="warranties-faq-card__q">❓ ${t('warranty.faq1_q') || 'Can I transfer my warranty certificate?'}</h5>
        <p class="warranties-faq-card__a">${t('warranty.faq1_a') || 'Yes! Eligible items marked as "Transferable" can be transferred to friends or buyers via phone number.'}</p>
      </div>
      <div class="warranties-faq-card">
        <h5 class="warranties-faq-card__q">❓ ${t('warranty.faq2_q') || 'What if I bought in an offline retail store?'}</h5>
        <p class="warranties-faq-card__a">${t('warranty.faq2_a') || 'Click "Register Warranty" at the top and enter your invoice reference to activate coverage.'}</p>
      </div>
    </div>
  `;
  container.appendChild(guideSection);

  async function loadData() {
    loading = true;
    renderContent();

    try {
      const res = await api.get('/warranties/my-cards');
      cards = res.data?.cards || [];
    } catch (err) {
      toast.error(err.message || t('warranty.load_error'));
      cards = [];
    } finally {
      loading = false;
      renderKPIs();
      renderContent();
    }
  }

  function renderKPIs() {
    const activeCount = cards.filter((c) => c.is_active !== false && c.status !== 'EXPIRED').length;
    const expiredCount = cards.filter((c) => c.is_active === false || c.status === 'EXPIRED').length;
    const allClaims = cards.flatMap((c) => c.claims || []);
    const openClaims = allClaims.filter((c) => ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS'].includes(c.status));

    const countActiveEl = navTabs.querySelector('#count-active');
    const countExpiredEl = navTabs.querySelector('#count-expired');
    const countAllEl = navTabs.querySelector('#count-all');
    const countClaimsEl = navTabs.querySelector('#count-claims');

    if (countActiveEl) countActiveEl.textContent = String(activeCount);
    if (countExpiredEl) countExpiredEl.textContent = String(expiredCount);
    if (countAllEl) countAllEl.textContent = String(cards.length);
    if (countClaimsEl) countClaimsEl.textContent = String(allClaims.length);

    kpiBar.innerHTML = `
      <div class="warranties-kpi-card">
        <div class="warranties-kpi-card__head">
          <span class="warranties-kpi-card__label">${t('warranty.kpi_active_warranties')}</span>
          <span class="warranties-kpi-card__dot ${activeCount > 0 ? 'warranties-kpi-card__dot--active' : ''}"></span>
        </div>
        <div class="warranties-kpi-card__val warranties-kpi-card__val--success">${activeCount}</div>
        <div class="warranties-kpi-card__sub">${t('warranty.active_protection_active') || 'Active protection cards'}</div>
      </div>

      <div class="warranties-kpi-card">
        <div class="warranties-kpi-card__head">
          <span class="warranties-kpi-card__label">${t('warranty.kpi_total_certificates')}</span>
          <span class="warranties-kpi-card__dot"></span>
        </div>
        <div class="warranties-kpi-card__val">${cards.length}</div>
        <div class="warranties-kpi-card__sub">${t('warranty.issued_lifetime') || 'Lifetime digital cards'}</div>
      </div>

      <div class="warranties-kpi-card">
        <div class="warranties-kpi-card__head">
          <span class="warranties-kpi-card__label">${t('warranty.kpi_active_claims')}</span>
          <span class="warranties-kpi-card__dot ${openClaims.length > 0 ? 'warranties-kpi-card__dot--warning' : ''}"></span>
        </div>
        <div class="warranties-kpi-card__val ${openClaims.length > 0 ? 'warranties-kpi-card__val--warning' : ''}">${openClaims.length}</div>
        <div class="warranties-kpi-card__sub">${openClaims.length > 0 ? '72h SLA In Progress' : t('warranty.no_active_claims') || 'All claims resolved'}</div>
      </div>

      <div class="warranties-kpi-card">
        <div class="warranties-kpi-card__head">
          <span class="warranties-kpi-card__label">${t('warranty.tab_expired')}</span>
          <span class="warranties-kpi-card__dot"></span>
        </div>
        <div class="warranties-kpi-card__val" style="color: var(--text-muted);">${expiredCount}</div>
        <div class="warranties-kpi-card__sub">${t('warranty.past_completed') || 'Completed validity'}</div>
      </div>
    `;
  }

  function getFilteredAndSortedCards() {
    let filtered = [...cards];

    // Filter by Tab
    if (activeTab === 'active') {
      filtered = filtered.filter((c) => c.is_active !== false && c.status !== 'EXPIRED');
    } else if (activeTab === 'expired') {
      filtered = filtered.filter((c) => c.is_active === false || c.status === 'EXPIRED');
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((c) => {
        const titleEn = (c.product_title_en || c.title_en || c.title_snapshot || '').toLowerCase();
        const titleBn = (c.product_title_bn || c.title_bn || '').toLowerCase();
        const serial = (c.serial_number || '').toLowerCase();
        const ref = (c.ref || '').toLowerCase();
        const supplier = (c.supplier_shop_name || c.supplier_name || '').toLowerCase();
        return titleEn.includes(q) || titleBn.includes(q) || serial.includes(q) || ref.includes(q) || supplier.includes(q);
      });
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'expiring_soon') {
        const expA = a.expires_at ? new Date(a.expires_at).getTime() : 0;
        const expB = b.expires_at ? new Date(b.expires_at).getTime() : 0;
        return expA - expB;
      }
      if (sortBy === 'newest') {
        const startA = a.starts_at ? new Date(a.starts_at).getTime() : 0;
        const startB = b.starts_at ? new Date(b.starts_at).getTime() : 0;
        return startB - startA;
      }
      if (sortBy === 'title') {
        const titleA = (a.product_title_en || a.title_en || '').toLowerCase();
        const titleB = (b.product_title_en || b.title_en || '').toLowerCase();
        return titleA.localeCompare(titleB);
      }
      return 0;
    });

    return filtered;
  }

  function renderContent() {
    contentArea.innerHTML = '';

    if (loading) {
      const skeletonGrid = document.createElement('div');
      skeletonGrid.className = 'warranties-grid';
      for (let i = 0; i < 3; i++) {
        const sk = document.createElement('div');
        sk.className = 'warranty-card';
        sk.style.padding = 'var(--space-5)';
        sk.style.gap = 'var(--space-3)';
        sk.innerHTML = `
          <div style="height: 20px; width: 40%; background: var(--surface-2); border-radius: 4px;" class="animate-pulse"></div>
          <div style="height: 60px; width: 100%; background: var(--surface-2); border-radius: 8px;" class="animate-pulse"></div>
          <div style="height: 50px; width: 100%; background: var(--surface-2); border-radius: 8px;" class="animate-pulse"></div>
        `;
        skeletonGrid.appendChild(sk);
      }
      contentArea.appendChild(skeletonGrid);
      return;
    }

    // Claims tab view
    if (activeTab === 'claims') {
      const allClaims = cards.flatMap((c) =>
        (c.claims || []).map((cl) => ({
          ...cl,
          card_ref: c.ref,
          serial_number: c.serial_number,
          product_title_en: c.product_title_en || c.title_en,
          product_title_bn: c.product_title_bn || c.title_bn,
          product_image: c.product_image || c.image_url,
        }))
      );

      if (allClaims.length === 0) {
        contentArea.appendChild(
          EmptyState({
            title: t('warranty.no_claims_filed'),
            description: t('warranty.no_claims_filed_desc'),
          })
        );
        return;
      }

      const list = document.createElement('div');
      list.className = 'space-y-4';
      allClaims.forEach((claim) => {
        list.appendChild(ClaimTimeline({ claim, isSupplier: false }));
      });
      contentArea.appendChild(list);
      return;
    }

    const currentCards = getFilteredAndSortedCards();

    if (currentCards.length === 0) {
      if (searchQuery.trim()) {
        contentArea.appendChild(
          EmptyState({
            title: t('warranty.no_results_found') || 'No Matching Warranties',
            description: t('warranty.no_results_desc') || `No warranties match your search "${searchQuery}". Try a different keyword or serial number.`,
          })
        );
        return;
      }

      if (activeTab === 'active') {
        const emptyEl = document.createElement('div');
        emptyEl.innerHTML = `
          <div style="background: var(--surface-0); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); padding: var(--space-8) var(--space-4); text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--space-3);">
            <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--surface-2); display: flex; align-items: center; justify-content: center; font-size: 28px;">
              🛡️
            </div>
            <h3 style="font-size: var(--text-lg); font-weight: 800; color: var(--text-primary); margin: 0;">
              ${t('warranty.no_active_warranties')}
            </h3>
            <p style="font-size: var(--text-xs); color: var(--text-muted); max-width: 440px; margin: 0; line-height: 1.5;">
              ${t('warranty.no_active_warranties_desc')}
            </p>
            <div style="display: flex; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; justify-content: center;">
              <button class="btn-register-warranty-empty" type="button" style="height: 38px; padding: 0 18px; border-radius: var(--radius-full); background: var(--brand); border: 1px solid var(--brand); color: var(--brand-contrast); font-size: var(--text-xs); font-weight: 800; cursor: pointer;">
                ➕ ${t('warranty.register_warranty_title') || 'Register Warranty'}
              </button>
              <a href="/" style="display: inline-flex; align-items: center; height: 38px; padding: 0 18px; border-radius: var(--radius-full); background: var(--surface-1); border: 1px solid var(--border-strong); color: var(--text-primary); font-size: var(--text-xs); font-weight: 700; text-decoration: none;">
                🛍️ ${t('warranty.browse_warrantied_products') || 'Browse Products'}
              </a>
            </div>
          </div>
        `;

        emptyEl.querySelector('.btn-register-warranty-empty')?.addEventListener('click', () => {
          openRegisterWarrantyModal({
            onSuccess: () => loadData(),
          });
        });

        contentArea.appendChild(emptyEl);
        return;
      }

      contentArea.appendChild(
        EmptyState({
          title: t('warranty.no_expired_warranties'),
          description: t('warranty.no_expired_warranties_desc'),
        })
      );
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'warranties-grid';
    currentCards.forEach((card) => {
      grid.appendChild(
        WarrantyCard({
          card,
          onClaimClick: handleClaimClick,
          onTransferClick: handleTransferClick,
          onViewClaimsClick: handleViewClaimsClick,
          onViewCertificateClick: handleViewCertificateClick,
        })
      );
    });
    contentArea.appendChild(grid);
  }

  function handleClaimClick(card) {
    openClaimModal({
      card,
      onSuccess: () => {
        loadData();
      },
    });
  }

  function handleViewCertificateClick(card) {
    openCertificateModal({ card });
  }

  function handleTransferClick(card) {
    const targetPhoneOrEmail = window.prompt(t('warranty.enter_recipient_prompt'));
    if (!targetPhoneOrEmail || !targetPhoneOrEmail.trim()) return;

    api.post(`/warranties/${card.id}/transfer`, {
      target_phone_or_email: targetPhoneOrEmail.trim(),
    })
      .then(() => {
        toast.success(t('warranty.transfer_success'));
        loadData();
      })
      .catch((err) => {
        toast.error(err.message || t('warranty.transfer_error'));
      });
  }

  function handleViewClaimsClick(card) {
    activeTab = 'claims';
    updateTabsUI();
    renderContent();
  }

  function updateTabsUI() {
    navTabs.querySelectorAll('.warranties-tab-btn').forEach((btn) => {
      const isCurrent = btn.dataset.tab === activeTab;
      btn.className = `warranties-tab-btn ${isCurrent ? 'warranties-tab-btn--active' : ''}`;
    });
  }

  // Event Listeners
  navTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.warranties-tab-btn');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    updateTabsUI();
    renderContent();
  });

  const searchInput = toolbar.querySelector('.warranties-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderContent();
    });
  }

  const sortSelect = toolbar.querySelector('.warranties-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      sortBy = e.target.value;
      renderContent();
    });
  }

  const registerBtn = header.querySelector('.btn-register-warranty');
  if (registerBtn) {
    registerBtn.addEventListener('click', () => {
      openRegisterWarrantyModal({
        onSuccess: () => loadData(),
      });
    });
  }

  root.appendChild(container);
  loadData();

  return () => {
    container.remove();
  };
}
