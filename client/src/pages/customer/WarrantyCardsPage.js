/**
 * WarrantyCardsPage.js — Customer Digital Warranty Hub (Prompt 10.4).
 *
 * Route: /warranties, /account/warranties, /customer/warranties
 * Gated by: `digital_warranty` module flag.
 */

import { api } from '../../core/api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { WarrantyCard } from '../../components/warranty/WarrantyCard.js';
import { openClaimModal } from '../../components/warranty/ClaimModal.js';
import { ClaimTimeline } from '../../components/warranty/ClaimTimeline.js';

export default function WarrantyCardsPage(root) {
  const container = document.createElement('div');
  container.className = 'warranty-cards-page container py-6 space-y-6';
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

  let activeTab = 'active'; // 'active' | 'expired' | 'claims'
  let cards = [];
  let loading = true;

  const header = document.createElement('header');
  header.className = 'page-header flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-subtle';
  header.innerHTML = `
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <span>🛡️</span> ${t('warranty.hub_title')}
      </h1>
      <p class="text-sm text-muted mt-1">
        ${t('warranty.hub_subtitle')}
      </p>
    </div>
  `;
  container.appendChild(header);

  // KPI Summary Bar
  const kpiBar = document.createElement('div');
  kpiBar.className = 'warranty-kpis grid grid-cols-2 sm:grid-cols-3 gap-4';
  container.appendChild(kpiBar);

  // Tabs Bar
  const navTabs = document.createElement('div');
  navTabs.className = 'warranty-tabs flex border-b border-subtle gap-2';
  navTabs.innerHTML = `
    <button class="tab-btn px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary" data-tab="active">
      ${t('warranty.tab_active')} (<span id="count-active">0</span>)
    </button>
    <button class="tab-btn px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted hover:text-primary" data-tab="expired">
      ${t('warranty.tab_expired')} (<span id="count-expired">0</span>)
    </button>
    <button class="tab-btn px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted hover:text-primary" data-tab="claims">
      ${t('warranty.tab_my_claims')} (<span id="count-claims">0</span>)
    </button>
  `;
  container.appendChild(navTabs);

  // Main Content Area
  const contentArea = document.createElement('div');
  contentArea.className = 'warranty-content min-h-[300px]';
  container.appendChild(contentArea);

  // Modal / Drawer mount root
  const overlayRoot = document.createElement('div');
  overlayRoot.className = 'warranty-overlay-root';
  container.appendChild(overlayRoot);

  async function loadData() {
    loading = true;
    renderContent();

    try {
      const res = await api.get('/api/v1/warranties/my-cards');
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
    const activeCount = cards.filter((c) => c.is_active).length;
    const expiredCount = cards.filter((c) => !c.is_active).length;
    const allClaims = cards.flatMap((c) => c.claims || []);
    const openClaims = allClaims.filter((c) => ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS'].includes(c.status));

    const countActiveEl = navTabs.querySelector('#count-active');
    const countExpiredEl = navTabs.querySelector('#count-expired');
    const countClaimsEl = navTabs.querySelector('#count-claims');

    if (countActiveEl) countActiveEl.textContent = String(activeCount);
    if (countExpiredEl) countExpiredEl.textContent = String(expiredCount);
    if (countClaimsEl) countClaimsEl.textContent = String(allClaims.length);

    kpiBar.innerHTML = `
      <div class="kpi-card card p-4 bg-surface">
        <span class="text-xs text-muted block">${t('warranty.kpi_active_warranties')}</span>
        <span class="text-2xl font-bold text-success mt-1 block">${activeCount}</span>
      </div>
      <div class="kpi-card card p-4 bg-surface">
        <span class="text-xs text-muted block">${t('warranty.kpi_total_certificates')}</span>
        <span class="text-2xl font-bold text-primary mt-1 block">${cards.length}</span>
      </div>
      <div class="kpi-card card p-4 bg-surface">
        <span class="text-xs text-muted block">${t('warranty.kpi_active_claims')}</span>
        <span class="text-2xl font-bold ${openClaims.length > 0 ? 'text-amber-500' : 'text-primary'} mt-1 block">${openClaims.length}</span>
      </div>
    `;
  }

  function renderContent() {
    contentArea.innerHTML = '';

    if (loading) {
      const skeletonGrid = document.createElement('div');
      skeletonGrid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
      for (let i = 0; i < 3; i++) {
        const sk = document.createElement('div');
        sk.className = 'card p-4 space-y-3';
        sk.innerHTML = `
          <div class="h-6 w-1/2 bg-surface-2 rounded animate-pulse"></div>
          <div class="h-16 w-full bg-surface-2 rounded animate-pulse"></div>
          <div class="h-8 w-full bg-surface-2 rounded animate-pulse"></div>
        `;
        skeletonGrid.appendChild(sk);
      }
      contentArea.appendChild(skeletonGrid);
      return;
    }

    if (activeTab === 'active') {
      const activeCards = cards.filter((c) => c.is_active);
      if (activeCards.length === 0) {
        contentArea.appendChild(
          EmptyState({
            title: t('warranty.no_active_warranties'),
            description: t('warranty.no_active_warranties_desc'),
          })
        );
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6';
      activeCards.forEach((card) => {
        grid.appendChild(
          WarrantyCard({
            card,
            onClaimClick: handleClaimClick,
            onTransferClick: handleTransferClick,
            onViewClaimsClick: handleViewClaimsClick,
          })
        );
      });
      contentArea.appendChild(grid);
    } else if (activeTab === 'expired') {
      const expiredCards = cards.filter((c) => !c.is_active);
      if (expiredCards.length === 0) {
        contentArea.appendChild(
          EmptyState({
            title: t('warranty.no_expired_warranties'),
            description: t('warranty.no_expired_warranties_desc'),
          })
        );
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6';
      expiredCards.forEach((card) => {
        grid.appendChild(
          WarrantyCard({
            card,
            onClaimClick: handleClaimClick,
            onTransferClick: handleTransferClick,
            onViewClaimsClick: handleViewClaimsClick,
          })
        );
      });
      contentArea.appendChild(grid);
    } else if (activeTab === 'claims') {
      const allClaims = cards.flatMap((c) =>
        (c.claims || []).map((cl) => ({
          ...cl,
          card_ref: c.ref,
          serial_number: c.serial_number,
          product_title_en: c.product_title_en || c.title_en,
          product_title_bn: c.product_title_bn || c.title_bn,
          product_image: c.product_image,
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
    }
  }

  function handleClaimClick(card) {
    openClaimModal({
      card,
      onSuccess: () => {
        loadData();
      },
    });
  }

  function handleTransferClick(card) {
    const targetPhoneOrEmail = window.prompt(t('warranty.enter_recipient_prompt'));
    if (!targetPhoneOrEmail || !targetPhoneOrEmail.trim()) return;

    api.post(`/api/v1/warranties/${card.id}/transfer`, {
      target_phone_or_email: targetPhoneOrEmail.trim(),
    })
      .then((res) => {
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
    navTabs.querySelectorAll('.tab-btn').forEach((btn) => {
      const isCurrent = btn.dataset.tab === activeTab;
      btn.className = `tab-btn px-4 py-2 text-sm font-medium border-b-2 ${
        isCurrent ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-primary'
      }`;
    });
  }

  navTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    updateTabsUI();
    renderContent();
  });

  root.appendChild(container);
  loadData();

  return () => {
    container.remove();
  };
}
