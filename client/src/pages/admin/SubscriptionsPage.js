/**
 * SubscriptionsPage.js — Super Admin Merchant Subscriptions & Fee Governance Engine.
 *
 * Implements:
 * 1. Module status banner linking to Module Control (Dormant Free Launch Mode vs Active Fee Engine).
 * 2. Executive recurring revenue & quota utilization metrics (MRR, Paid Subscribers, Free Merchants, Overages).
 * 3. Subscription tier plans manager (Free Starter, Saler Pro, Supplier Growth, Enterprise Wholesale).
 * 4. Merchant subscriber directory with deep search, role/status filtering, and quota tracking.
 * 5. 1-Click Fee Waiver & Exemption grants with immutable audit trail.
 * 6. Global listing quota and billing grace period parameters.
 * 7. Integrated FinanceSubnav tab strip connecting the entire finance suite.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';
import { FinanceSubnav } from '../../components/admin/FinanceSubnav.js';
import { adminApi } from '../../services/admin.api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency, formatDate } from '../../services/format.js';

export default function SubscriptionsPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page subscriptions-page';

  let subData = null;
  let isLoading = true;

  // Filters State
  let searchQuery = '';
  let roleFilter = 'ALL';
  let statusFilter = 'ALL';

  // Fee Settings State
  let freeQuota = 100;
  let defaultOverage = 5.0;
  let graceDays = 5;
  let isSavingSettings = false;

  // Active Modals State
  let activeWaiverSubscriber = null;
  let waiverDuration = '3_MONTHS';
  let waiverReason = '';

  let activeEditingPlan = null;
  let planNameEn = '';
  let planNameBn = '';
  let planMonthlyFee = 0;
  let planFreeListings = 100;
  let planExtraFee = 2;
  let planRebatePct = 0;

  async function loadData() {
    isLoading = true;
    render();

    try {
      const res = await adminApi.getSubscriptions();
      subData = res.data || res || {};
      if (subData.module) {
        freeQuota = subData.module.free_listing_quota ?? 100;
        defaultOverage = subData.module.default_overage_fee ?? 5.0;
        graceDays = subData.module.grace_period_days ?? 5;
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load subscription governance data.');
      subData = {
        module: { is_enabled: false, free_listing_quota: 100 },
        metrics: { mrr_bdt: 0, paid_subscribers_count: 0, free_tier_count: 0, overage_fees_bdt: 0 },
        plans: [],
        subscribers: [],
      };
    } finally {
      isLoading = false;
      render();
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    isSavingSettings = true;
    render();

    try {
      await adminApi.updateSubscriptionSettings({
        free_listing_quota: freeQuota,
        default_overage_fee: defaultOverage,
        grace_period_days: graceDays,
      });
      toast.success(t('admin_subscriptions.toast_settings_saved'));
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to update fee parameters.');
    } finally {
      isSavingSettings = false;
      render();
    }
  }

  async function handleGrantWaiver() {
    if (!activeWaiverSubscriber) return;
    try {
      await adminApi.updateSubscriberStatus(activeWaiverSubscriber.id, {
        waived: true,
        waiver_duration: waiverDuration,
        waiver_reason: waiverReason.trim() || 'Startup promotional fee waiver',
      });
      toast.success(t('admin_subscriptions.toast_waiver_granted'));
      activeWaiverSubscriber = null;
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to grant fee waiver.');
    }
  }

  async function handleSavePlan() {
    if (!planNameEn.trim()) {
      toast.warning('Plan name is required.');
      return;
    }

    const payload = {
      name_en: planNameEn.trim(),
      name_bn: planNameBn.trim() || planNameEn.trim(),
      monthly_fee: planMonthlyFee,
      free_listings: planFreeListings,
      extra_listing_fee: planExtraFee,
      commission_rebate_pct: planRebatePct,
    };

    try {
      if (activeEditingPlan?.id) {
        await adminApi.updateSubscriptionPlan(activeEditingPlan.id, payload);
      } else {
        await adminApi.createSubscriptionPlan(payload);
      }
      toast.success(t('admin_subscriptions.toast_plan_saved'));
      activeEditingPlan = null;
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to save subscription plan.');
    }
  }

  function render() {
    container.innerHTML = '';

    // 1. Header
    const header = document.createElement('div');
    header.className = 'admin-page-header';

    const infoCol = document.createElement('div');
    infoCol.innerHTML = `
      <div class="admin-page-eyebrow">
        <span class="badge badge--brand font-bold text-xs">COMMERCE & MONETIZATION</span>
        <span class="text-xs text-secondary font-mono">${subData?.metrics?.mrr_bdt ? formatCurrency(subData.metrics.mrr_bdt) : '৳0'} MRR</span>
      </div>
      <h1 class="admin-page-title">${t('admin_subscriptions.page_title')}</h1>
      <p class="admin-page-subtitle">${t('admin_subscriptions.page_subtitle')}</p>
    `;

    const actionsCol = document.createElement('div');
    actionsCol.className = 'admin-page-actions';

    const newPlanBtn = Button({
      label: `➕ ${t('admin_subscriptions.btn_create_plan')}`,
      variant: 'primary',
      onClick: () => {
        activeEditingPlan = {};
        planNameEn = '';
        planNameBn = '';
        planMonthlyFee = 999;
        planFreeListings = 1000;
        planExtraFee = 2.0;
        planRebatePct = 1.0;
        renderPlanModal();
      },
    });

    const refreshBtn = Button({
      label: `🔄 ${t('common.refresh', 'Refresh')}`,
      variant: 'secondary',
      onClick: loadData,
    });

    actionsCol.append(newPlanBtn, refreshBtn);
    header.append(infoCol, actionsCol);
    container.append(header);

    // 2. Shared Finance Subnav
    container.append(FinanceSubnav({ activeKey: 'subscriptions' }));

    if (isLoading) {
      const loader = document.createElement('div');
      loader.className = 'card p-8 text-center text-secondary';
      loader.innerHTML = `<div class="spinner"></div><p class="mt-2">${t('common.loading', 'Loading')}...</p>`;
      container.append(loader);
      root.replaceChildren(container);
      return;
    }

    const mod = subData?.module || { is_enabled: false };
    const m = subData?.metrics || {};
    const plans = subData?.plans || [];
    const subscribers = subData?.subscribers || [];

    // 3. Module Status Banner
    const banner = document.createElement('div');
    banner.className = `module-status-banner ${mod.is_enabled ? 'module-status-banner--active' : 'module-status-banner--dormant'}`;
    banner.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-2xl">${mod.is_enabled ? '🟢' : '⏸️'}</span>
        <div>
          <h3 class="font-bold text-base m-0">
            ${mod.is_enabled ? t('admin_subscriptions.banner_active_title') : t('admin_subscriptions.banner_dormant_title')}
          </h3>
          <p class="text-xs mt-1 mb-0 max-w-3xl">
            ${mod.is_enabled ? t('admin_subscriptions.banner_active_desc') : t('admin_subscriptions.banner_dormant_desc')}
          </p>
        </div>
      </div>
      <a href="#/admin/platform/modules" class="btn btn--secondary btn--sm whitespace-nowrap">
        ⚙️ ${t('admin_subscriptions.btn_toggle_module')}
      </a>
    `;
    container.append(banner);

    // 4. KPI Metrics Strip
    const kpiStrip = document.createElement('div');
    kpiStrip.className = 'admin-kpi-grid';
    kpiStrip.innerHTML = `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${t('admin_subscriptions.kpi_mrr')}</div>
        <div class="admin-kpi-card__val text-brand font-bold">${formatCurrency(m.mrr_bdt || 0)}</div>
        <div class="admin-kpi-card__hint">${t('admin_subscriptions.kpi_mrr_hint')}</div>
      </div>

      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${t('admin_subscriptions.kpi_subscribers')}</div>
        <div class="admin-kpi-card__val text-primary font-bold">${m.paid_subscribers_count || 0}</div>
        <div class="admin-kpi-card__hint">${t('admin_subscriptions.kpi_subscribers_hint')}</div>
      </div>

      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${t('admin_subscriptions.kpi_free_tier')}</div>
        <div class="admin-kpi-card__val text-success font-bold">${m.free_tier_count || 0}</div>
        <div class="admin-kpi-card__hint">${t('admin_subscriptions.kpi_free_hint')}</div>
      </div>

      <div class="admin-kpi-card">
        <div class="admin-kpi-card__label">${t('admin_subscriptions.kpi_overage_rev')}</div>
        <div class="admin-kpi-card__val text-primary font-bold">${formatCurrency(m.overage_fees_bdt || 0)}</div>
        <div class="admin-kpi-card__hint">${t('admin_subscriptions.kpi_overage_hint')}</div>
      </div>
    `;
    container.append(kpiStrip);

    // 5. Subscription Plans Grid
    const plansPanel = document.createElement('div');
    plansPanel.className = 'admin-panel';
    plansPanel.innerHTML = `
      <div class="admin-panel__header">
        <div>
          <h2 class="admin-panel__title">💳 ${t('admin_subscriptions.plans_title')}</h2>
          <p class="admin-panel__subtitle">Configured membership tiers with listing limits and take-rate rebates.</p>
        </div>
      </div>

      <div class="plans-grid">
        ${plans
          .map((plan) => {
            const features = isBn ? plan.features_bn || plan.features_en : plan.features_en || plan.features_bn || [];
            return `
            <div class="subscription-plan-card" data-plan-id="${plan.id}">
              <div>
                <div class="subscription-plan-card__header">
                  <div>
                    <h3 class="font-bold text-base m-0">${isBn ? plan.name_bn || plan.name_en : plan.name_en}</h3>
                    <span class="badge badge--neutral text-2xs mt-1 uppercase font-mono">${plan.role || 'ALL'}</span>
                  </div>
                  <span class="badge badge--brand font-bold text-xs">
                    ${plan.active_subscribers || 0} ${t('admin_subscriptions.active_subscribers_count')}
                  </span>
                </div>

                <div class="subscription-plan-card__price">
                  ${formatCurrency(plan.monthly_fee)}
                  <span class="text-xs font-normal text-secondary">${t('admin_subscriptions.per_month')}</span>
                </div>

                <div class="subscription-plan-card__meta">
                  <div class="flex justify-between">
                    <span>${t('admin_subscriptions.listings_quota')}:</span>
                    <strong class="text-primary">${plan.free_listings > 99999 ? 'Unlimited' : `${plan.free_listings} items`}</strong>
                  </div>
                  <div class="flex justify-between">
                    <span>${t('admin_subscriptions.extra_listing_fee')}:</span>
                    <strong class="text-primary">৳${plan.extra_listing_fee}/item</strong>
                  </div>
                  ${
                    plan.commission_rebate_pct > 0
                      ? `<div class="flex justify-between text-success">
                          <span>${t('admin_subscriptions.commission_rebate')}:</span>
                          <strong>+${plan.commission_rebate_pct}% boost</strong>
                        </div>`
                      : ''
                  }
                </div>

                <ul class="subscription-plan-card__features">
                  ${features.map((f) => `<li class="subscription-plan-card__feature-item"><span>✓</span> <span>${f}</span></li>`).join('')}
                </ul>
              </div>

              <div class="subscription-plan-card__footer">
                <button type="button" class="btn btn--secondary btn--sm w-full btn-plan-edit" data-plan-id="${plan.id}">
                  ✏️ ${t('admin_subscriptions.btn_edit_plan')}
                </button>
              </div>
            </div>
          `;
          })
          .join('')}
      </div>
    `;

    plansPanel.querySelectorAll('.btn-plan-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pId = btn.getAttribute('data-plan-id');
        const p = plans.find((pl) => pl.id === pId);
        if (p) {
          activeEditingPlan = p;
          planNameEn = p.name_en;
          planNameBn = p.name_bn || p.name_en;
          planMonthlyFee = p.monthly_fee;
          planFreeListings = p.free_listings;
          planExtraFee = p.extra_listing_fee;
          planRebatePct = p.commission_rebate_pct || 0;
          renderPlanModal();
        }
      });
    });

    container.append(plansPanel);

    // 6. Merchant Subscriber Roster & Search
    const rosterPanel = document.createElement('div');
    rosterPanel.className = 'admin-panel';

    // Filter subscribers in memory
    const filteredSubs = subscribers.filter((s) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !s.merchant_name?.toLowerCase().includes(q) &&
          !s.store_name?.toLowerCase().includes(q) &&
          !s.phone?.includes(q) &&
          !s.ref?.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (roleFilter !== 'ALL' && s.role !== roleFilter) return false;
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      return true;
    });

    rosterPanel.innerHTML = `
      <div class="admin-panel__header">
        <div>
          <h2 class="admin-panel__title">📋 ${t('admin_subscriptions.subscribers_title')}</h2>
          <p class="admin-panel__subtitle">${t('admin_subscriptions.subscribers_subtitle')}</p>
        </div>
      </div>

      <div class="admin-toolbar">
        <div class="admin-toolbar__search">
          <input
            type="search"
            class="form-input roster-search-input"
            placeholder="${t('admin_subscriptions.search_placeholder')}"
            value="${searchQuery}"
          />
        </div>
        <div class="admin-toolbar__filters">
          <select class="form-select roster-role-select">
            <option value="ALL" ${roleFilter === 'ALL' ? 'selected' : ''}>${t('admin_subscriptions.filter_role_all')}</option>
            <option value="saler" ${roleFilter === 'saler' ? 'selected' : ''}>Saler</option>
            <option value="supplier" ${roleFilter === 'supplier' ? 'selected' : ''}>Supplier</option>
          </select>
          <select class="form-select roster-status-select">
            <option value="ALL" ${statusFilter === 'ALL' ? 'selected' : ''}>${t('admin_subscriptions.filter_status_all')}</option>
            <option value="ACTIVE" ${statusFilter === 'ACTIVE' ? 'selected' : ''}>${t('admin_subscriptions.status_active')}</option>
            <option value="PAST_DUE" ${statusFilter === 'PAST_DUE' ? 'selected' : ''}>${t('admin_subscriptions.status_past_due')}</option>
            <option value="WAIVED" ${statusFilter === 'WAIVED' ? 'selected' : ''}>${t('admin_subscriptions.status_waived')}</option>
          </select>
        </div>
      </div>

      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>${t('admin_subscriptions.th_merchant')}</th>
              <th>${t('admin_subscriptions.th_role')}</th>
              <th>${t('admin_subscriptions.th_plan')}</th>
              <th>${t('admin_subscriptions.th_fee')}</th>
              <th style="min-width: 140px;">${t('admin_subscriptions.th_quota_usage')}</th>
              <th>${t('admin_subscriptions.th_next_renewal')}</th>
              <th>${t('admin_subscriptions.th_status')}</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              filteredSubs.length === 0
                ? `<tr><td colspan="8" class="admin-table__empty">${t('common.no_records_found', 'No merchant subscribers found.')}</td></tr>`
                : filteredSubs
                    .map((sub) => {
                      const quotaPct = Math.min(100, Math.round((sub.quota_used / (sub.quota_total || 1)) * 100));
                      const isNearLimit = quotaPct >= 90;
                      return `
                      <tr>
                        <td>
                          <div class="category-cell">
                            <div class="category-icon-box" style="border-radius: var(--radius-full);" title="${sub.role}">
                              ${sub.role === 'supplier' ? '🏭' : '🏪'}
                            </div>
                            <div class="category-info">
                              <a href="#/admin/users/${sub.id}" class="category-name text-primary hover:underline">
                                ${sub.merchant_name}
                              </a>
                              <span class="text-xs text-muted">${sub.store_name} · <span class="font-mono">${sub.phone}</span></span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span class="badge ${sub.role === 'supplier' ? 'badge--info' : 'badge--brand'} badge--sm uppercase font-mono">
                            ${sub.role}
                          </span>
                        </td>
                        <td class="font-semibold text-primary">${sub.plan_name}</td>
                        <td class="font-bold font-mono">${formatCurrency(sub.monthly_fee)}</td>
                        <td>
                          <div class="text-xs text-secondary flex justify-between">
                            <span>${sub.quota_used} / ${sub.quota_total > 99999 ? '∞' : sub.quota_total}</span>
                            <span class="${isNearLimit ? 'text-danger font-bold' : ''}">${quotaPct}%</span>
                          </div>
                          <div class="quota-progress-track">
                            <div class="quota-progress-fill ${isNearLimit ? 'quota-progress-fill--danger' : ''}" style="width: ${quotaPct}%;"></div>
                          </div>
                        </td>
                        <td class="font-mono text-xs text-secondary">${formatDate(sub.next_renewal)}</td>
                        <td>
                          ${
                            sub.status === 'ACTIVE'
                              ? `<span class="badge badge--success badge--sm">${t('admin_subscriptions.status_active')}</span>`
                              : sub.status === 'WAIVED'
                                ? `<span class="badge badge--brand badge--sm">${t('admin_subscriptions.status_waived')}</span>`
                                : `<span class="badge badge--warning badge--sm">${t('admin_subscriptions.status_past_due')}</span>`
                          }
                        </td>
                        <td class="text-right">
                          <div class="table-actions">
                            ${
                              sub.status !== 'WAIVED'
                                ? `<button type="button" class="btn btn--sm btn--secondary btn-sub-waiver" data-sub-id="${sub.id}">
                                    🎁 ${t('admin_subscriptions.btn_grant_waiver')}
                                  </button>`
                                : `<span class="badge badge--neutral badge--sm">${t('admin_subscriptions.status_waived')}</span>`
                            }
                          </div>
                        </td>
                      </tr>
                    `;
                    })
                    .join('')
            }
          </tbody>
        </table>
      </div>
    `;

    // Filter listeners
    const searchInput = rosterPanel.querySelector('.roster-search-input');
    const roleSelect = rosterPanel.querySelector('.roster-role-select');
    const statusSelect = rosterPanel.querySelector('.roster-status-select');

    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      render();
    });
    roleSelect?.addEventListener('change', (e) => {
      roleFilter = e.target.value;
      render();
    });
    statusSelect?.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      render();
    });

    rosterPanel.querySelectorAll('.btn-sub-waiver').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sId = btn.getAttribute('data-sub-id');
        const sub = subscribers.find((s) => String(s.id) === String(sId));
        if (sub) {
          activeWaiverSubscriber = sub;
          waiverDuration = '3_MONTHS';
          waiverReason = '';
          renderWaiverModal();
        }
      });
    });

    container.append(rosterPanel);

    // 7. Policy Settings Form
    const policyPanel = document.createElement('div');
    policyPanel.className = 'admin-panel';
    policyPanel.innerHTML = `
      <div class="admin-panel__header">
        <div>
          <h2 class="admin-panel__title">⚙️ ${t('admin_subscriptions.policy_title')}</h2>
          <p class="admin-panel__subtitle">Configure default listing allowance ceilings and failed transaction grace limits.</p>
        </div>
      </div>

      <form class="fee-settings-form flex flex-col gap-4">
        <div class="form-grid form-grid--3col">
          <div class="form-group">
            <label class="form-label">${t('admin_subscriptions.default_quota_label')}</label>
            <input type="number" class="form-input quota-input" min="10" max="500" value="${freeQuota}" />
          </div>

          <div class="form-group">
            <label class="form-label">${t('admin_subscriptions.default_overage_label')}</label>
            <input type="number" class="form-input overage-input" min="0" max="50" step="0.5" value="${defaultOverage}" />
          </div>

          <div class="form-group">
            <label class="form-label">${t('admin_subscriptions.grace_period_label')}</label>
            <input type="number" class="form-input grace-input" min="1" max="30" value="${graceDays}" />
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn--primary" ${isSavingSettings ? 'disabled' : ''}>
            💾 ${isSavingSettings ? t('common.saving', 'Saving...') : t('admin_subscriptions.btn_save_settings')}
          </button>
        </div>
      </form>
    `;

    const qInput = policyPanel.querySelector('.quota-input');
    const oInput = policyPanel.querySelector('.overage-input');
    const gInput = policyPanel.querySelector('.grace-input');

    qInput?.addEventListener('input', (e) => (freeQuota = parseInt(e.target.value, 10) || 100));
    oInput?.addEventListener('input', (e) => (defaultOverage = parseFloat(e.target.value) || 5.0));
    gInput?.addEventListener('input', (e) => (graceDays = parseInt(e.target.value, 10) || 5));

    policyPanel.querySelector('.fee-settings-form')?.addEventListener('submit', handleSaveSettings);
    container.append(policyPanel);

    root.replaceChildren(container);
  }

  function renderWaiverModal() {
    if (!activeWaiverSubscriber) return;

    const wrap = document.createElement('div');
    wrap.className = 'admin-modal-form';
    wrap.innerHTML = `
      <p class="text-xs text-secondary">${t('admin_subscriptions.modal_waiver_desc')}</p>

      <div class="form-group">
        <label class="form-label">Merchant</label>
        <input type="text" class="form-input" readonly value="${activeWaiverSubscriber.merchant_name} (${activeWaiverSubscriber.store_name})" />
      </div>

      <div class="form-group">
        <label class="form-label">${t('admin_subscriptions.waiver_duration_label')}</label>
        <select class="form-select waiver-duration-select">
          <option value="1_MONTH">1 Month Free Exemption</option>
          <option value="3_MONTHS" selected>3 Months (Quarterly Grant)</option>
          <option value="6_MONTHS">6 Months (Incubator Sponsorship)</option>
          <option value="PERMANENT">Indefinite Exemption (Founding Merchant)</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">${t('admin_subscriptions.waiver_reason_label')} <span class="text-danger">*</span></label>
        <input type="text" class="form-input waiver-reason-input" placeholder="e.g., National SME accelerator grant approved by Compliance" value="${waiverReason}" />
      </div>
    `;

    const durSelect = wrap.querySelector('.waiver-duration-select');
    const rInput = wrap.querySelector('.waiver-reason-input');

    durSelect?.addEventListener('change', (e) => (waiverDuration = e.target.value));
    rInput?.addEventListener('input', (e) => (waiverReason = e.target.value));

    const footer = document.createElement('div');
    footer.className = 'flex items-center justify-end gap-2 w-full';
    footer.innerHTML = `
      <button type="button" class="btn btn--secondary btn--sm modal-cancel-btn">
        ${t('common.cancel', 'Cancel')}
      </button>
      <button type="button" class="btn btn--primary btn--sm modal-save-btn">
        🎁 ${isBn ? 'মওকুফ অনুমোদন করুন' : 'Grant Fee Waiver'}
      </button>
    `;

    const modal = Modal({
      title: t('admin_subscriptions.modal_waiver_title'),
      content: wrap,
      footer,
      size: 'md',
    });

    footer.querySelector('.modal-cancel-btn').addEventListener('click', () => {
      activeWaiverSubscriber = null;
      modal.close();
    });

    footer.querySelector('.modal-save-btn').addEventListener('click', async () => {
      await handleGrantWaiver();
      modal.close();
    });

    document.body.appendChild(modal);
    modal.open();
  }

  function renderPlanModal() {
    if (!activeEditingPlan) return;

    const wrap = document.createElement('div');
    wrap.className = 'admin-modal-form';
    wrap.innerHTML = `
      <div class="form-grid form-grid--2col">
        <div class="form-group">
          <label class="form-label">Plan Title (EN) <span class="text-danger">*</span></label>
          <input type="text" class="form-input plan-name-en" value="${planNameEn}" placeholder="e.g., Artisan Premium" />
        </div>
        <div class="form-group">
          <label class="form-label">Plan Title (BN)</label>
          <input type="text" class="form-input plan-name-bn" value="${planNameBn}" placeholder="যেমন: কারুশিল্প প্রিমিয়াম" />
        </div>
      </div>

      <div class="form-grid form-grid--3col">
        <div class="form-group">
          <label class="form-label">Monthly Price (৳)</label>
          <input type="number" class="form-input plan-fee" value="${planMonthlyFee}" min="0" step="50" />
        </div>
        <div class="form-group">
          <label class="form-label">Free Listing Quota</label>
          <input type="number" class="form-input plan-listings" value="${planFreeListings}" min="10" />
        </div>
        <div class="form-group">
          <label class="form-label">Extra Fee / Item (৳)</label>
          <input type="number" class="form-input plan-extra-fee" value="${planExtraFee}" min="0" step="0.5" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Commission Rebate (%)</label>
        <input type="number" class="form-input plan-rebate" value="${planRebatePct}" min="0" max="10" step="0.5" />
      </div>
    `;

    const nameEnInput = wrap.querySelector('.plan-name-en');
    const nameBnInput = wrap.querySelector('.plan-name-bn');
    const feeInput = wrap.querySelector('.plan-fee');
    const listInput = wrap.querySelector('.plan-listings');
    const extraInput = wrap.querySelector('.plan-extra-fee');
    const rebateInput = wrap.querySelector('.plan-rebate');

    nameEnInput?.addEventListener('input', (e) => (planNameEn = e.target.value));
    nameBnInput?.addEventListener('input', (e) => (planNameBn = e.target.value));
    feeInput?.addEventListener('input', (e) => (planMonthlyFee = parseFloat(e.target.value) || 0));
    listInput?.addEventListener('input', (e) => (planFreeListings = parseInt(e.target.value, 10) || 100));
    extraInput?.addEventListener('input', (e) => (planExtraFee = parseFloat(e.target.value) || 0));
    rebateInput?.addEventListener('input', (e) => (planRebatePct = parseFloat(e.target.value) || 0));

    const footer = document.createElement('div');
    footer.className = 'flex items-center justify-end gap-2 w-full';
    footer.innerHTML = `
      <button type="button" class="btn btn--secondary btn--sm modal-cancel-btn">
        ${t('common.cancel', 'Cancel')}
      </button>
      <button type="button" class="btn btn--primary btn--sm modal-save-btn">
        💾 ${isBn ? 'সংরক্ষণ করুন' : 'Save Plan'}
      </button>
    `;

    const modal = Modal({
      title: activeEditingPlan.id ? (isBn ? 'প্ল্যান সম্পাদনা' : 'Edit Subscription Plan') : (isBn ? 'নতুন প্ল্যান তৈরি' : 'Create New Subscription Plan'),
      content: wrap,
      footer,
      size: 'md',
    });

    footer.querySelector('.modal-cancel-btn').addEventListener('click', () => {
      activeEditingPlan = null;
      modal.close();
    });

    footer.querySelector('.modal-save-btn').addEventListener('click', async () => {
      await handleSavePlan();
      modal.close();
    });

    document.body.appendChild(modal);
    modal.open();
  }

  loadData();
}
