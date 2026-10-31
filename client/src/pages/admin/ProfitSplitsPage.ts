/**
 * ProfitSplitsPage.ts — Super Admin Profit Split Governance & Margin Simulation Engine.
 *
 * Implements:
 * 1. Global Platform Margin Sharing Governor (CRITICAL tier audited policy).
 * 2. Real-Time Interactive Margin & Profit Split Simulator with exact paisa arithmetic.
 * 3. Category-Level Split Overrides table with instant add/edit/reset workflows.
 * 4. Shop Partner Trust Tier Incentive Bonus Matrix (Bronze through Platinum/Elite boosts).
 * 5. Full audit log history tracking who changed split policies and why.
 * 6. Shared FinanceSubnav bar interconnecting all 7 financial control surfaces.
 */

import { Button } from '../../components/ui/Button.ts';
import { Badge } from '../../components/ui/Badge.ts';
import { Modal } from '../../components/ui/Modal.ts';
import { confirmDialog } from '../../components/ui/ConfirmDialog.ts';
import { FinanceSubnav } from '../../components/admin/FinanceSubnav.ts';
import { adminApi } from '../../services/admin.api.ts';
import { toast } from '../../services/toast.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { formatCurrency, formatDate } from '../../services/format.ts';
import { simulateSplit } from './splitSimulator.ts';
import type { PageContext } from '../types.ts';

export default function ProfitSplitsPage(root: HTMLElement, { navigate }: PageContext = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page profit-splits-page';

  let splitsData = null;
  let isLoading = true;
  let isSavingGlobal = false;

  // Simulator State
  let simRetailPrice = 1500;
  let simMarginPct = 20;

  // Global Split Form State
  // WHY min margin, partner default profit and extra markup have no inputs any more: no sale reads them
  // since partner prices were locked (migration 085). They are still sent back unchanged on save, so
  // the stored row keeps its shape for the older readers (pricing preview, finance controller).
  let formSalerSplit = 40;
  let formMinMargin = 5;
  let formPlatformDefaultProfit = 10;
  let formSalerDefaultProfit = 20;
  let formExtraMarkupPlatform = 20;
  let formReason = '';

  // Shop Partner commission tier form (bonuses + the volume ladder, saved together)
  let tierEnabled = false;
  let tierWindow: number | string = 30;
  let tierMin = { SILVER: 0, GOLD: 0, PLATINUM: 0 };
  let tierBonus = { BRONZE: 0, SILVER: 0, GOLD: 0, PLATINUM: 0 };
  let tierReason = '';
  let isSavingTiers = false;

  // Modal State for Category Override Edit
  let activeModalCategory = null;
  let modalSalerSplit = 40;
  let modalReason = '';
  let isCreatingOverride = false;

  // Category Search & Filter State
  let categoryFilter = 'ALL';
  let categorySearch = '';

  function getCategoryIcon(slug) {
    const map = {
      fashion: '👗',
      electronics: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>',
      beauty: '💄',
      home: '🏠',
      grocery: '🥦',
      books: '📚',
    };
    return map[slug] || '🏷️';
  }

  // WHY a copy: the inputs edit this form state, so an unsaved edit never mutates what the server sent.
  function syncTierForm() {
    const rules = splitsData?.tier_rules;
    tierEnabled = rules?.enabled === true;
    tierWindow = rules?.window_days ?? 30;
    for (const k of ['SILVER', 'GOLD', 'PLATINUM']) tierMin[k] = rules?.thresholds?.[k] ?? 0;
    for (const row of splitsData?.tiers || []) tierBonus[row.tier] = parseFloat(row.bonus_pct) || 0;
  }

  async function handleSaveTiers(e) {
    e.preventDefault();
    if (!tierReason.trim()) {
      toast.warning(t('admin_splits.policy_reason_label') + ' is required.');
      return;
    }
    const confirmed = await confirmDialog({
      title: t('admin_splits.tier_confirm_title'),
      description: t(tierEnabled ? 'admin_splits.tier_confirm_on' : 'admin_splits.tier_confirm_off'),
      confirmLabel: t('admin_splits.tier_confirm_btn'),
      cancelLabel: t('common.cancel', 'Cancel'),
      variant: tierEnabled ? 'danger' : 'primary',
    });
    if (!confirmed) return;

    isSavingTiers = true;
    render();
    try {
      await adminApi.updateTierBonuses(
        ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'].map((k) => ({ tier: k, bonus_pct: Number(tierBonus[k]) })),
        tierReason.trim(),
        { enabled: tierEnabled, window_days: Number(tierWindow), thresholds: { SILVER: Number(tierMin.SILVER), GOLD: Number(tierMin.GOLD), PLATINUM: Number(tierMin.PLATINUM) } }
      );
      toast.success(t('admin_splits.toast_tiers_saved'));
      tierReason = '';
      await loadData();
    } catch (err) {
      // The server's message names the rule that failed (a ladder that does not rise, a window out of range).
      toast.error(err.message || t('admin_splits.toast_tiers_failed'));
    } finally {
      isSavingTiers = false;
      render();
    }
  }

  async function loadData() {
    isLoading = true;
    render();

    try {
      const res = await adminApi.getProfitSplits();
      splitsData = res.data || res || {};
      if (splitsData.global) {
        formSalerSplit = splitsData.global.saler_split_pct ?? 40;
        formMinMargin = splitsData.global.min_margin_pct ?? 5;
        formPlatformDefaultProfit = splitsData.global.platform_default_profit_pct ?? 10;
        formSalerDefaultProfit = splitsData.global.saler_default_profit_pct ?? 20;
        formExtraMarkupPlatform = splitsData.global.extra_markup_platform_pct ?? 20;
      }
      syncTierForm();
    } catch (err) {
      toast.error(err.message || 'Failed to load profit split policies.');
      splitsData = {
        global: {
          saler_split_pct: 40,
          platform_split_pct: 60,
          min_margin_pct: 5,
          platform_default_profit_pct: 10,
          saler_default_profit_pct: 20,
          extra_markup_platform_pct: 20,
        },
        categories: [],
        tiers: [],
        audit_log: [],
        metrics: { default_saler_split: 40, default_platform_split: 60, active_overrides_count: 0 },
      };
    } finally {
      isLoading = false;
      render();
    }
  }

  // WHY the policy form's values, not the saved ones: an admin sees what an unsaved edit would do
  // before applying it. The arithmetic itself lives in splitSimulator.ts.
  function renderSimResults(): string {
    const r = simulateSplit({
      price: simRetailPrice,
      marginPct: simMarginPct,
      partnerSharePct: formSalerSplit,
      platformFloorPct: formPlatformDefaultProfit,
    });
    if (!r) return `<p class="text-sm text-secondary">${t('admin_splits.sim_prompt')}</p>`;
    const notes = [`<p class="split-sim-note">${t('admin_splits.sim_note_pool')}</p>`];
    if (r.marginBelowFloor) {
      notes.push(`<p class="split-sim-note split-sim-note--warn">${t('admin_splits.sim_note_below_floor', { floor: formatCurrency(r.platformFloor) })}</p>`);
    } else if (r.partnerCapped) {
      notes.push(`<p class="split-sim-note split-sim-note--warn">${t('admin_splits.sim_note_capped', { floor: formatCurrency(r.platformFloor) })}</p>`);
    }
    return `
      <div>
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span class="text-xs font-bold uppercase tracking-wider text-secondary">${t('admin_splits.sim_distribution')}</span>
          <span class="badge badge--neutral text-2xs font-mono">${t('admin_splits.sim_policy_badge', { share: formSalerSplit, floor: formPlatformDefaultProfit })}</span>
        </div>
        <div class="split-visual-bar" title="${t('admin_splits.sim_supplier_payout')}: ${r.pct.supplier}% | ${t('admin_splits.sim_partner_pool')}: ${r.pct.partnerPool}% | ${t('admin_splits.sim_platform_take')}: ${r.pct.platform}%">
          <div class="split-visual-bar__supplier" style="width: ${r.pct.supplier}%;">${r.pct.supplier > 15 ? `${t('admin_splits.sim_bar_supplier')} (${r.pct.supplier}%)` : ''}</div>
          <div class="split-visual-bar__saler" style="width: ${r.pct.partnerPool}%;">${r.pct.partnerPool > 15 ? `${t('admin_splits.sim_bar_pool')} (${r.pct.partnerPool}%)` : ''}</div>
          <div class="split-visual-bar__platform" style="width: ${r.pct.platform}%;">${r.pct.platform > 15 ? `${t('admin_splits.sim_bar_platform')} (${r.pct.platform}%)` : ''}</div>
        </div>
      </div>

      <div class="split-breakdown-chips">
        <div class="split-breakdown-chip">
          <span class="split-breakdown-chip__title">${t('admin_splits.sim_supplier_payout')}</span>
          <span class="split-breakdown-chip__amount">${formatCurrency(r.supplier)}</span>
          <span class="split-breakdown-chip__pct">${t('admin_splits.sim_supplier_hint', { pct: 100 - simMarginPct })}</span>
        </div>
        <div class="split-breakdown-chip">
          <span class="split-breakdown-chip__title">${t('admin_splits.sim_partner_pool')}</span>
          <span class="split-breakdown-chip__amount text-success">${formatCurrency(r.partnerPool)}</span>
          <span class="split-breakdown-chip__pct">${t('admin_splits.sim_pool_hint', { share: formSalerSplit, margin: formatCurrency(r.margin) })}</span>
        </div>
        <div class="split-breakdown-chip">
          <span class="split-breakdown-chip__title">${t('admin_splits.sim_platform_take')}</span>
          <span class="split-breakdown-chip__amount text-primary">${formatCurrency(r.platform)}</span>
          <span class="split-breakdown-chip__pct">${t('admin_splits.sim_platform_hint', { floor: formatCurrency(r.platformFloor) })}</span>
        </div>
      </div>

      ${notes.join('')}
    `;
  }

  function refreshSim() {
    const slot = container.querySelector<HTMLElement>('[data-slot="sim-results"]');
    if (slot) slot.innerHTML = renderSimResults();
  }

  async function handleSaveGlobal(e) {
    e.preventDefault();
    if (!formReason.trim()) {
      toast.warning(t('admin_splits.policy_reason_label') + ' is required.');
      return;
    }

    const platformPct = 100 - formSalerSplit;

    const confirmed = await confirmDialog({
      title: t('admin_splits.modal_confirm_title'),
      description: t('admin_splits.modal_confirm_warn'),
      confirmLabel: isBn ? 'নীতি প্রয়োগ করুন' : 'Apply Split Policy',
      cancelLabel: t('common.cancel', 'Cancel'),
      variant: 'danger',
    });

    if (!confirmed) return;

    isSavingGlobal = true;
    render();

    try {
      await adminApi.updateGlobalSplit({
        saler_split_pct: formSalerSplit,
        platform_split_pct: platformPct,
        min_margin_pct: formMinMargin,
        platform_default_profit_pct: formPlatformDefaultProfit,
        saler_default_profit_pct: formSalerDefaultProfit,
        extra_markup_platform_pct: formExtraMarkupPlatform,
        reason: formReason.trim(),
      });
      toast.success(t('admin_splits.toast_global_saved'));
      formReason = '';
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to update global split.');
    } finally {
      isSavingGlobal = false;
      render();
    }
  }

  async function handleSaveCategoryOverride() {
    if (!activeModalCategory) return;
    try {
      await adminApi.updateCategorySplit(activeModalCategory.id, {
        saler_split_pct: modalSalerSplit,
        platform_split_pct: 100 - modalSalerSplit,
        reason: modalReason.trim() || 'Category commission override updated',
      });
      toast.success(t('admin_splits.toast_category_saved'));
      activeModalCategory = null;
      isCreatingOverride = false;
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to save category override.');
    }
  }

  async function handleResetCategory(category) {
    const confirmed = await confirmDialog({
      title: isBn ? 'ক্যাটাগরি ওভাররাইড রিসেট' : 'Reset Category Override',
      description: isBn
        ? `আপনি কি "${category.name_bn || category.name_en}" ক্যাটাগরির কাস্টম স্প্লিট মুছে গ্লোবাল ডিফল্টে ফেরত নিতে চান?`
        : `Are you sure you want to reset "${category.name_en}" to the global baseline split?`,
      confirmLabel: isBn ? 'রিসেট করুন' : 'Reset to Default',
      cancelLabel: t('common.cancel', 'Cancel'),
      variant: 'warning',
    });

    if (!confirmed) return;

    try {
      await adminApi.deleteCategorySplit(category.id);
      toast.success(t('admin_splits.toast_category_reset'));
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to reset category.');
    }
  }

  function render() {
    container.innerHTML = '';

    // 1. Page Header
    const header = document.createElement('div');
    header.className = 'admin-page-header';

    const infoCol = document.createElement('div');
    infoCol.innerHTML = `
      <div class="admin-page-eyebrow">
        <span class="badge badge--danger font-bold text-xs">CRITICAL GOVERNANCE</span>
        <span class="text-xs text-secondary font-mono">${splitsData?.global?.updated_at ? formatDate(splitsData.global.updated_at) : 'Active'}</span>
      </div>
      <h1 class="admin-page-title">${t('admin_splits.page_title')}</h1>
      <p class="admin-page-subtitle">${t('admin_splits.page_subtitle')}</p>
    `;

    const actionsCol = document.createElement('div');
    actionsCol.className = 'admin-page-actions';

    const simScrollBtn = Button({
      label: `🧮 ${isBn ? 'সিমুলেটর' : 'Simulator'}`,
      variant: 'secondary',
      onClick: () => {
        container.querySelector('.split-simulator-card')?.scrollIntoView({ behavior: 'smooth' });
      },
    });

    const refreshBtn = Button({
      label: `🔄 ${t('common.refresh', 'Refresh')}`,
      variant: 'secondary',
      onClick: loadData,
    });

    actionsCol.append(simScrollBtn, refreshBtn);
    header.append(infoCol, actionsCol);
    container.append(header);

    // 2. Shared Finance Subnav
    container.append(FinanceSubnav({ activeKey: 'splits', navigate }));

    if (isLoading) {
      const loader = document.createElement('div');
      loader.className = 'card p-8 text-center text-secondary';
      loader.innerHTML = `<div class="spinner"></div><p class="mt-2">${t('common.loading', 'Loading')}...</p>`;
      container.append(loader);
      root.replaceChildren(container);
      return;
    }

    const g = splitsData?.global || { saler_split_pct: 40, platform_split_pct: 60 };
    const m = splitsData?.metrics || {};
    const categories = splitsData?.categories || [];
    const tiers = splitsData?.tiers || [];
    const auditLog = splitsData?.audit_log || [];

    // 3. KPI Strip (4 Cards)
    const kpiStrip = document.createElement('div');
    kpiStrip.className = 'admin-kpi-grid';
    kpiStrip.innerHTML = `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${t('admin_splits.kpi_default_split')}</div>
        <div class="admin-kpi-card__val text-primary font-bold">${g.saler_split_pct}% / ${g.platform_split_pct}%</div>
        <div class="admin-kpi-card__hint">${t('admin_splits.kpi_default_hint')}</div>
      </div>

      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${t('admin_splits.kpi_category_overrides')}</div>
        <div class="admin-kpi-card__val text-brand font-bold">${m.active_overrides_count || 0}</div>
        <div class="admin-kpi-card__hint">${categories.length} ${t('admin_splits.kpi_overrides_hint')}</div>
      </div>

      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${t('admin_splits.kpi_tier_incentives')}</div>
        <div class="admin-kpi-card__val text-success font-bold">+5.0%</div>
        <div class="admin-kpi-card__hint">${t('admin_splits.kpi_tier_hint')}</div>
      </div>

      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${t('admin_splits.kpi_retention_rate')}</div>
        <div class="admin-kpi-card__val text-primary font-bold">${m.effective_platform_retention_pct || 58.2}%</div>
        <div class="admin-kpi-card__hint">${t('admin_splits.kpi_retention_hint')}</div>
      </div>
    `;
    container.append(kpiStrip);

    // 4. Interactive Simulator
    const simulatorCard = document.createElement('div');
    simulatorCard.className = 'split-simulator-card';
    simulatorCard.innerHTML = `
      <div class="admin-panel__header">
        <div>
          <h2 class="admin-panel__title">🧮 ${t('admin_splits.simulator_title')}</h2>
          <p class="admin-panel__subtitle">${t('admin_splits.simulator_subtitle')}</p>
        </div>
      </div>

      <div class="split-simulator-grid">
        <div class="split-simulator-form">
          <div class="form-group">
            <label for="split-sim-retail" class="form-label">${t('admin_splits.sim_retail_price')}</label>
            <input id="split-sim-retail" type="number" class="form-input" name="sim_price" min="1" max="10000000" step="10" value="${simRetailPrice}" />
          </div>

          <div class="form-group">
            <label for="split-sim-margin" class="form-label">${t('admin_splits.sim_margin_pct')}</label>
            <input id="split-sim-margin" type="number" class="form-input" name="sim_margin" min="0" max="99" step="1" value="${simMarginPct}" />
            <span class="text-2xs text-secondary mt-1 block">${t('admin_splits.sim_margin_hint')}</span>
          </div>
        </div>

        <div class="split-simulator-results" data-slot="sim-results" aria-live="polite">${renderSimResults()}</div>
      </div>
    `;

    // WHY in place, not render(): rebuilding the page on every keystroke threw away the input's focus.
    simulatorCard.querySelector('.split-simulator-form')?.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const value = parseFloat(input.value);
      if (input.name === 'sim_price') simRetailPrice = value;
      if (input.name === 'sim_margin') simMarginPct = value;
      refreshSim();
    });

    container.append(simulatorCard);

    // 5. Global Policy Configuration Form (CRITICAL tier)
    const globalPanel = document.createElement('div');
    globalPanel.className = 'admin-panel';
    globalPanel.innerHTML = `
      <div class="admin-panel__header">
        <div>
          <h2 class="admin-panel__title">
            🏛️ ${t('admin_splits.global_policy_title')}
          </h2>
          <p class="admin-panel__subtitle">${t('admin_splits.global_policy_desc')}</p>
        </div>
        <span class="badge badge--danger font-bold text-xs">MAKER-CHECKER CRITICAL</span>
      </div>

      <form class="global-split-form flex flex-col gap-4">
        <div class="form-grid form-grid--3col">
          <!-- Partner pool's share of the margin: the default partner_profit on new products and price edits -->
          <div class="form-group">
            <label for="split-global-saler" class="form-label">${t('admin_splits.saler_split_label')}</label>
            <div class="form-range-wrap">
              <input id="split-global-saler" type="range" class="form-range global-saler-range" min="10" max="90" step="1" value="${formSalerSplit}" />
              <span class="font-bold text-lg font-mono text-brand global-saler-display">${formSalerSplit}%</span>
            </div>
            <span class="text-2xs text-secondary mt-1 block">${t('admin_splits.saler_split_hint')}</span>
          </div>

          <!-- Platform Share (Locked complement) -->
          <div class="form-group">
            <label for="split-global-platform" class="form-label">${t('admin_splits.platform_split_label')}</label>
            <input id="split-global-platform" type="text" class="form-input font-mono font-bold text-lg global-platform-display" readonly value="${100 - formSalerSplit}%" />
          </div>

          <!-- Platform minimum: platform_default_profit_pct of the supplier payout -->
          <div class="form-group">
            <label for="split-global-plat-profit" class="form-label">${t('admin_splits.platform_default_profit_label')}</label>
            <input id="split-global-plat-profit" type="number" class="form-input global-plat-profit-input" min="1" max="50" step="0.5" value="${formPlatformDefaultProfit}" />
            <span class="text-2xs text-secondary mt-1 block">${t('admin_splits.platform_default_profit_hint')}</span>
          </div>
        </div>

        <div class="form-group">
          <label for="split-global-reason" class="form-label">${t('admin_splits.policy_reason_label')} <span class="text-danger">*</span></label>
          <input id="split-global-reason"
            type="text"
            class="form-input global-reason-input"
            placeholder="${t('admin_splits.policy_reason_placeholder')}"
            value="${formReason}"
            required
          />
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn--primary" ${isSavingGlobal ? 'disabled' : ''}>
            💾 ${isSavingGlobal ? t('common.saving', 'Saving...') : t('admin_splits.btn_save_global')}
          </button>
        </div>
      </form>
    `;

    const rangeInput = globalPanel.querySelector('.global-saler-range');
    const salerDisplay = globalPanel.querySelector('.global-saler-display');
    const platformDisplay = globalPanel.querySelector<HTMLInputElement>('.global-platform-display');
    const platProfitInput = globalPanel.querySelector('.global-plat-profit-input');
    const reasonInput = globalPanel.querySelector('.global-reason-input');

    rangeInput?.addEventListener('input', (e) => {
      formSalerSplit = parseInt((e.target as HTMLInputElement).value, 10);
      if (salerDisplay) salerDisplay.textContent = `${formSalerSplit}%`;
      if (platformDisplay) platformDisplay.value = `${100 - formSalerSplit}%`;
      refreshSim();
    });

    platProfitInput?.addEventListener('input', (e) => {
      formPlatformDefaultProfit = parseFloat((e.target as HTMLInputElement).value) || 10;
      refreshSim();
    });

    reasonInput?.addEventListener('input', (e) => {
      formReason = (e.target as HTMLInputElement).value;
    });

    globalPanel.querySelector('.global-split-form')?.addEventListener('submit', handleSaveGlobal);
    container.append(globalPanel);

    // 6. Category-Specific Overrides Table
    const catPanel = document.createElement('div');
    catPanel.className = 'admin-panel';

    const activeOverrides = categories.filter((c) => c.is_override);
    const defaultsCount = categories.length - activeOverrides.length;

    const filteredCategories = categories.filter((cat) => {
      if (categoryFilter === 'OVERRIDES' && !cat.is_override) return false;
      if (categoryFilter === 'DEFAULTS' && cat.is_override) return false;
      if (categorySearch) {
        const q = categorySearch.toLowerCase();
        const match =
          cat.name_en?.toLowerCase().includes(q) ||
          cat.name_bn?.toLowerCase().includes(q) ||
          cat.slug?.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    catPanel.innerHTML = `
      <div class="admin-panel__header">
        <div>
          <h2 class="admin-panel__title">📁 ${t('admin_splits.categories_title')}</h2>
          <p class="admin-panel__subtitle">${t('admin_splits.categories_subtitle')}</p>
          <p class="split-sim-note split-sim-note--warn mt-2">${t('admin_splits.no_effect_note')}</p>
          <div class="admin-panel__stats mt-2">
            <span class="badge badge--brand badge--sm font-semibold">${activeOverrides.length} ${isBn ? 'কাস্টম ওভাররাইড' : 'Custom Overrides'}</span>
            <span class="badge badge--neutral badge--sm font-mono">${defaultsCount} ${isBn ? 'গ্লোবাল ডিফল্ট' : 'Global Defaults'}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <input
            type="search"
            class="form-input cat-search-input"
            aria-label="${isBn ? 'ক্যাটাগরি খুঁজুন' : 'Search category'}"
            placeholder="${isBn ? 'ক্যাটাগরি খুঁজুন...' : 'Search category...'}"
            value="${categorySearch}"
            style="width: 190px;"
          />
          <select class="form-select cat-filter-select" aria-label="${isBn ? 'ক্যাটাগরি ফিল্টার' : 'Filter categories'}" style="width: 160px;">
            <option value="ALL" ${categoryFilter === 'ALL' ? 'selected' : ''}>${isBn ? 'সকল ক্যাটাগরি' : 'All Categories'}</option>
            <option value="OVERRIDES" ${categoryFilter === 'OVERRIDES' ? 'selected' : ''}>${isBn ? 'শুধু ওভাররাইড' : 'Overrides Only'}</option>
            <option value="DEFAULTS" ${categoryFilter === 'DEFAULTS' ? 'selected' : ''}>${isBn ? 'শুধু ডিফল্ট' : 'Defaults Only'}</option>
          </select>
          <button type="button" class="btn btn--sm btn--primary btn-add-cat-override">
            ➕ ${t('admin_splits.btn_add_override')}
          </button>
        </div>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th style="min-width: 170px;">${t('admin_splits.th_category')}</th>
              <th style="min-width: 130px;">${t('admin_splits.th_rule_status')}</th>
              <th style="min-width: 90px;">${t('admin_splits.th_saler_split')}</th>
              <th style="min-width: 90px;">${t('admin_splits.th_platform_split')}</th>
              <th style="min-width: 105px;">${t('admin_splits.th_effective_date')}</th>
              <th class="text-right" style="min-width: 140px;">${t('admin_splits.th_actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${
              filteredCategories.length === 0
                ? `<tr><td colspan="6" class="admin-table__empty">${isBn ? 'কোনো ক্যাটাগরি পাওয়া যায়নি।' : 'No matching categories found.'}</td></tr>`
                : filteredCategories
                    .map(
                      (cat) => `
                    <tr class="cat-row" data-cat-id="${cat.id}">
                      <td>
                        <div class="category-cell">
                          <div class="category-icon-box" title="${cat.slug}">${getCategoryIcon(cat.slug)}</div>
                          <div class="category-info">
                            <span class="category-name">${isBn ? cat.name_bn : cat.name_en}</span>
                            <span class="category-slug">/${cat.slug}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        ${
                          cat.is_override
                            ? `<span class="badge badge--brand badge--sm font-semibold">⚡ ${t('admin_splits.status_custom')}</span>`
                            : `<span class="badge badge--neutral badge--sm font-medium">🌐 ${t('admin_splits.status_default')}</span>`
                        }
                      </td>
                      <td>
                        <div class="split-pill split-pill--saler">
                          <span class="split-pill__val font-mono">${cat.saler_split_pct}%</span>
                          <span class="split-pill__lbl">${isBn ? 'শপ পার্টনার' : 'Shop Partner'}</span>
                        </div>
                        <div class="split-ratio-bar" title="Shop Partner: ${cat.saler_split_pct}% | Platform: ${cat.platform_split_pct}%">
                          <div class="split-ratio-bar__saler" style="width: ${cat.saler_split_pct}%;"></div>
                          <div class="split-ratio-bar__platform" style="width: ${cat.platform_split_pct}%;"></div>
                        </div>
                      </td>
                      <td>
                        <div class="split-pill split-pill--platform">
                          <span class="split-pill__val font-mono">${cat.platform_split_pct}%</span>
                          <span class="split-pill__lbl">${isBn ? 'প্ল্যাটফর্ম' : 'Platform'}</span>
                        </div>
                      </td>
                      <td>
                        <span class="text-xs text-secondary font-mono">${cat.updated_at ? formatDate(cat.updated_at) : (isBn ? 'ডিফল্ট' : 'Baseline')}</span>
                      </td>
                      <td class="text-right">
                        <div class="table-actions">
                          <button type="button" class="btn btn--sm btn--secondary btn-cat-edit" data-cat-id="${cat.id}">
                            ✏️ ${t('admin_splits.btn_edit')}
                          </button>
                          ${
                            cat.is_override
                              ? `<button type="button" class="btn btn--sm btn--danger-outline btn-cat-reset" data-cat-id="${cat.id}" title="${isBn ? 'গ্লোবাল ডিফল্টে রিসেট করুন' : 'Reset to global default'}">
                                  ↺ ${t('admin_splits.btn_reset_default')}
                                </button>`
                              : ''
                          }
                        </div>
                      </td>
                    </tr>
                  `
                    )
                    .join('')
            }
          </tbody>
        </table>
      </div>
    `;

    catPanel.querySelector('.cat-search-input')?.addEventListener('input', (e) => {
      categorySearch = (e.target as HTMLInputElement).value;
      render();
    });

    catPanel.querySelector('.cat-filter-select')?.addEventListener('change', (e) => {
      categoryFilter = (e.target as HTMLInputElement).value;
      render();
    });

    catPanel.querySelector('.btn-add-cat-override')?.addEventListener('click', () => {
      isCreatingOverride = true;
      activeModalCategory = categories[0] || null;
      modalSalerSplit = activeModalCategory ? activeModalCategory.saler_split_pct : 40;
      modalReason = '';
      renderCategoryEditModal();
    });

    catPanel.querySelectorAll<HTMLElement>('.btn-cat-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const catId = btn.getAttribute('data-cat-id');
        const cat = categories.find((c) => String(c.id) === String(catId));
        if (cat) {
          isCreatingOverride = false;
          activeModalCategory = cat;
          modalSalerSplit = cat.saler_split_pct;
          modalReason = '';
          renderCategoryEditModal();
        }
      });
    });

    catPanel.querySelectorAll<HTMLElement>('.btn-cat-reset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const catId = btn.getAttribute('data-cat-id');
        const cat = categories.find((c) => String(c.id) === String(catId));
        if (cat) handleResetCategory(cat);
      });
    });

    container.append(catPanel);

    // 7. Trust Tier Incentive Matrix (editable: the volume ladder and the bonus each tier pays)
    const tierPanel = document.createElement('div');
    tierPanel.className = 'admin-panel';
    const ladderKeys = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
    tierPanel.innerHTML = `
      <div class="admin-panel__header">
        <div>
          <h2 class="admin-panel__title">⭐ ${t('admin_splits.tiers_title')}</h2>
          <p class="admin-panel__subtitle">${t('admin_splits.tiers_subtitle')}</p>
          <p class="split-sim-note split-sim-note--warn mt-2">${t('admin_splits.no_effect_note')}</p>
        </div>
        <span class="badge ${tierEnabled ? 'badge--success' : 'badge--neutral'} font-bold text-xs">${t(tierEnabled ? 'admin_splits.tier_state_on' : 'admin_splits.tier_state_off')}</span>
      </div>

      <form class="tier-rules-form flex flex-col gap-4">
        <div class="form-grid form-grid--3col">
          <div class="form-group">
            <label class="form-label" for="tier-enabled">${t('admin_splits.tier_enabled_label')}</label>
            <select id="tier-enabled" class="form-select tier-enabled-input">
              <option value="off" ${tierEnabled ? '' : 'selected'}>${t('admin_splits.tier_state_off')}</option>
              <option value="on" ${tierEnabled ? 'selected' : ''}>${t('admin_splits.tier_state_on')}</option>
            </select>
            <span class="text-2xs text-secondary mt-1 block">${t('admin_splits.tier_enabled_hint')}</span>
          </div>
          <div class="form-group">
            <label class="form-label" for="tier-window">${t('admin_splits.tier_window_label')}</label>
            <input id="tier-window" type="number" class="form-input tier-window-input" min="7" max="365" step="1" value="${tierWindow}" />
            <span class="text-2xs text-secondary mt-1 block">${t('admin_splits.tier_window_hint')}</span>
          </div>
        </div>

        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>${t('admin_splits.th_tier')}</th>
                <th>${t('admin_splits.th_min_volume')}</th>
                <th>${t('admin_splits.th_bonus_pct')}</th>
                <th>${t('admin_splits.th_effective_split')}</th>
              </tr>
            </thead>
            <tbody>
              ${ladderKeys
                .map((k) => {
                  const row = tiers.find((x) => x.tier === k) || { tier: k, name_en: k, name_bn: k };
                  const exampleSaler = parseFloat((g.saler_split_pct + (Number(tierBonus[k]) || 0)).toFixed(2));
                  const examplePlatform = parseFloat((100 - exampleSaler).toFixed(2));
                  const tierBadgeClass =
                    k === 'PLATINUM' ? 'badge--success' : k === 'GOLD' ? 'badge--brand' : k === 'SILVER' ? 'badge--info' : 'badge--neutral';
                  return `
                  <tr>
                    <td>
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-primary">${isBn ? row.name_bn : row.name_en}</span>
                        <span class="badge ${tierBadgeClass} badge--sm font-mono">${k.charAt(0)}${k.slice(1).toLowerCase()}</span>
                      </div>
                    </td>
                    <td>
                      ${k === 'BRONZE'
                        ? `<span class="text-xs text-secondary">${t('admin_splits.tier_entry')}</span>`
                        : `<input type="number" class="form-input tier-min-input" data-tier="${k}" aria-label="${t('admin_splits.th_min_volume')} ${k}" min="1" step="1" value="${tierMin[k]}" />`}
                    </td>
                    <td>
                      <input type="number" class="form-input tier-bonus-input" data-tier="${k}" aria-label="${t('admin_splits.th_bonus_pct')} ${k}" min="0" max="50" step="0.5" value="${tierBonus[k]}" />
                    </td>
                    <td>
                      <div class="split-pill split-pill--saler">
                        <span class="split-pill__val font-mono">${exampleSaler}%</span>
                        <span class="split-pill__lbl">${isBn ? 'শপ পার্টনার' : 'Shop Partner'}</span>
                      </div>
                      <span class="text-xs text-muted font-mono"> / </span>
                      <div class="split-pill split-pill--platform">
                        <span class="split-pill__val font-mono">${examplePlatform}%</span>
                        <span class="split-pill__lbl">${isBn ? 'প্ল্যাটফর্ম' : 'Platform'}</span>
                      </div>
                    </td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        </div>

        <div class="form-group">
          <label class="form-label" for="tier-reason">${t('admin_splits.policy_reason_label')}</label>
          <input id="tier-reason" type="text" class="form-input tier-reason-input" maxlength="200" />
        </div>
        <div class="flex justify-end">
          <button type="submit" class="btn btn--primary" ${isSavingTiers ? 'disabled' : ''}>${t('admin_splits.tier_save_btn')}</button>
        </div>
      </form>
    `;
    container.append(tierPanel);

    // Inputs write to form state without re-rendering, so typing never loses focus.
    const tierReasonInput = tierPanel.querySelector<HTMLInputElement>('.tier-reason-input');
    if (tierReasonInput) tierReasonInput.value = tierReason; // set as a property, never spliced into markup
    tierReasonInput?.addEventListener('input', (e) => { tierReason = (e.target as HTMLInputElement).value; });
    tierPanel.querySelector('.tier-enabled-input')?.addEventListener('change', (e) => { tierEnabled = (e.target as HTMLInputElement).value === 'on'; });
    tierPanel.querySelector('.tier-window-input')?.addEventListener('input', (e) => { tierWindow = (e.target as HTMLInputElement).value; });
    tierPanel.querySelectorAll<HTMLElement>('.tier-min-input').forEach((el) => {
      el.addEventListener('input', (e) => { tierMin[el.dataset.tier] = (e.target as HTMLInputElement).value; });
    });
    tierPanel.querySelectorAll<HTMLElement>('.tier-bonus-input').forEach((el) => {
      el.addEventListener('input', (e) => { tierBonus[el.dataset.tier] = (e.target as HTMLInputElement).value; });
    });
    tierPanel.querySelector('.tier-rules-form')?.addEventListener('submit', handleSaveTiers);

    // 8. Audit Log Viewer
    const auditPanel = document.createElement('div');
    auditPanel.className = 'admin-panel';
    auditPanel.innerHTML = `
      <div class="admin-panel__header">
        <div>
          <h2 class="admin-panel__title">📜 ${t('admin_splits.audit_title')}</h2>
          <p class="admin-panel__subtitle">Chronological record of platform split modifications, overrides, and tier changes.</p>
        </div>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>${t('admin_splits.th_actor')}</th>
              <th>${t('admin_splits.th_scope')}</th>
              <th>${t('admin_splits.th_before_after')}</th>
              <th>${t('admin_splits.th_reason')}</th>
            </tr>
          </thead>
          <tbody>
            ${auditLog
              .map(
                (log) => `
              <tr>
                <td class="font-mono text-xs text-secondary">${log.created_at ? formatDate(log.created_at) : 'Recent'}</td>
                <td class="font-bold">${log.actor}</td>
                <td><span class="badge badge--neutral font-mono text-2xs">${log.scope}</span></td>
                <td class="font-mono text-xs">${log.before} ➔ <strong class="text-brand">${log.after}</strong></td>
                <td class="text-secondary text-xs italic">${log.reason || '—'}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
    container.append(auditPanel);

    root.replaceChildren(container);
  }

  function renderCategoryEditModal() {
    if (!activeModalCategory && !isCreatingOverride) return;
    // WHY declared here: this function used `categories` (the override picker and its change handler) but
    // only the render function has one in scope, so opening *Add override* threw a ReferenceError.
    const categories = splitsData?.categories || [];

    const modalWrap = document.createElement('div');
    modalWrap.className = 'admin-modal-form';
    modalWrap.innerHTML = `
      <div class="form-group">
        <label class="form-label">${t('admin_splits.th_category')}</label>
        ${
          isCreatingOverride
            ? `<select class="form-select modal-category-select">
                ${categories
                  .map(
                    (c) =>
                      `<option value="${c.id}" ${c.id === activeModalCategory?.id ? 'selected' : ''}>
                        ${c.name_en} (${isBn ? c.name_bn : c.slug}) ${c.is_override ? '⚡ Override' : '🌐 Default'}
                      </option>`
                  )
                  .join('')}
              </select>`
            : `<input type="text" class="form-input font-bold" readonly value="${activeModalCategory.name_en} (${isBn ? activeModalCategory.name_bn : activeModalCategory.slug})" />`
        }
      </div>

      <div class="form-group">
        <label class="form-label">${t('admin_splits.saler_split_label')}</label>
        <div class="form-range-wrap">
          <input type="range" class="form-range modal-saler-range" min="10" max="90" step="1" value="${modalSalerSplit}" />
          <span class="font-bold text-lg font-mono text-brand modal-saler-display">${modalSalerSplit}%</span>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">${t('admin_splits.platform_split_label')}</label>
        <input type="text" class="form-input font-mono font-bold modal-platform-display" readonly value="${100 - modalSalerSplit}%" />
      </div>

      <div class="form-group">
        <label class="form-label">${t('admin_splits.policy_reason_label')} <span class="text-danger">*</span></label>
        <input type="text" class="form-input modal-reason-input" aria-label="e.g., Seasonal apparel promotion adjustment" placeholder="e.g., Seasonal apparel promotion adjustment" value="${modalReason}" />
      </div>
    `;

    const catSelect = modalWrap.querySelector('.modal-category-select');
    const range = modalWrap.querySelector<HTMLInputElement>('.modal-saler-range');
    const salerDisp = modalWrap.querySelector('.modal-saler-display');
    const platDisp = modalWrap.querySelector<HTMLInputElement>('.modal-platform-display');
    const reasonInput = modalWrap.querySelector('.modal-reason-input');

    catSelect?.addEventListener('change', (e) => {
      const selectedId = (e.target as HTMLInputElement).value;
      const c = categories.find((cat) => String(cat.id) === String(selectedId));
      if (c) {
        activeModalCategory = c;
        modalSalerSplit = c.saler_split_pct;
        if (range) range.value = String(modalSalerSplit);
        if (salerDisp) salerDisp.textContent = `${modalSalerSplit}%`;
        if (platDisp) platDisp.value = `${100 - modalSalerSplit}%`;
      }
    });

    range?.addEventListener('input', (e) => {
      modalSalerSplit = parseInt((e.target as HTMLInputElement).value, 10);
      if (salerDisp) salerDisp.textContent = `${modalSalerSplit}%`;
      if (platDisp) platDisp.value = `${100 - modalSalerSplit}%`;
    });

    reasonInput?.addEventListener('input', (e) => {
      modalReason = (e.target as HTMLInputElement).value;
    });

    const footer = document.createElement('div');
    footer.className = 'flex items-center justify-end gap-2 w-full';
    footer.innerHTML = `
      <button type="button" class="btn btn--secondary btn--sm modal-cancel-btn">
        ${t('common.cancel', 'Cancel')}
      </button>
      <button type="button" class="btn btn--primary btn--sm modal-save-btn">
        💾 ${isBn ? 'সংরক্ষণ করুন' : 'Save Override'}
      </button>
    `;

    const modal = Modal({
      title: isCreatingOverride ? t('admin_splits.btn_add_override') : t('admin_splits.modal_edit_category_title'),
      content: modalWrap,
      footer,
      size: 'md',
    });

    footer.querySelector('.modal-cancel-btn').addEventListener('click', () => {
      activeModalCategory = null;
      isCreatingOverride = false;
      modal.close();
    });

    footer.querySelector('.modal-save-btn').addEventListener('click', async () => {
      await handleSaveCategoryOverride();
      modal.close();
    });

    document.body.appendChild(modal);
    modal.open();
  }

  loadData();
}
