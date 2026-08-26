/**
 * WarrantyClaimsPage.js — Supplier Digital Warranty & Claims Hub (Prompt 10.4).
 *
 * Route: /supplier/claims, /supplier/warranty-claims
 * Gated by: `digital_warranty` module flag, `support.warranty.manage` permission.
 */

import { api } from '../../core/api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { ClaimTimeline } from '../../components/warranty/ClaimTimeline.js';

export default function WarrantyClaimsPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-claims-page container py-6 space-y-6';
  container.setAttribute('data-module', 'digital_warranty');

  if (!isFeatureEnabled('digital_warranty')) {
    container.append(
      EmptyState({
        title: t('warranty.supplier_hub_title'),
        description: t('warranty.module_disabled'),
      })
    );
    root.append(container);
    return () => {};
  }

  let activeTab = 'claims'; // 'claims' | 'analytics'
  let claims = [];
  let analytics = [];
  let filterStatus = 'all';
  let loading = true;
  let selectedClaim = null;

  // Header
  const header = document.createElement('header');
  header.className = 'page-header flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-subtle';
  header.innerHTML = `
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <span>🛡️</span> ${t('warranty.supplier_hub_title')}
      </h1>
      <p class="text-sm text-muted mt-1">
        ${t('warranty.supplier_hub_subtitle')}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button class="btn btn--sm btn--secondary" id="refresh-btn">
        🔄 ${t('common.refresh')}
      </button>
    </div>
  `;
  container.appendChild(header);

  // KPI Metrics Summary
  const kpiSection = document.createElement('div');
  kpiSection.className = 'kpi-grid grid grid-cols-2 lg:grid-cols-4 gap-4';
  container.appendChild(kpiSection);

  // Nav Switcher
  const navTabs = document.createElement('div');
  navTabs.className = 'flex border-b border-subtle gap-2';
  navTabs.innerHTML = `
    <button class="nav-tab-btn px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary" data-tab="claims">
      📋 ${t('warranty.tab_claim_queue')} (<span id="queue-count">0</span>)
    </button>
    <button class="nav-tab-btn px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted hover:text-primary" data-tab="analytics">
      📊 ${t('warranty.tab_quality_analytics')}
    </button>
  `;
  container.appendChild(navTabs);

  // Filter Toolbar (for Claims Queue)
  const filterBar = document.createElement('div');
  filterBar.className = 'claim-filters flex flex-wrap items-center justify-between gap-3 p-3 bg-surface-2 rounded';
  filterBar.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted font-medium">${t('warranty.filter_status')}:</span>
      <button class="filter-chip px-2.5 py-1 rounded bg-primary text-white" data-status="all">${t('common.all')}</button>
      <button class="filter-chip px-2.5 py-1 rounded bg-surface border border-subtle text-secondary" data-status="SUBMITTED">${t('warranty.status_submitted')}</button>
      <button class="filter-chip px-2.5 py-1 rounded bg-surface border border-subtle text-secondary" data-status="APPROVED">${t('warranty.status_approved')}</button>
      <button class="filter-chip px-2.5 py-1 rounded bg-surface border border-subtle text-secondary" data-status="IN_PROGRESS">${t('warranty.status_in_progress')}</button>
      <button class="filter-chip px-2.5 py-1 rounded bg-surface border border-subtle text-secondary" data-status="COMPLETED">${t('warranty.status_completed')}</button>
      <button class="filter-chip px-2.5 py-1 rounded bg-surface border border-subtle text-secondary" data-status="REJECTED">${t('warranty.status_rejected')}</button>
      <button class="filter-chip px-2.5 py-1 rounded bg-surface border border-subtle text-secondary" data-status="ESCALATED">🚨 ${t('warranty.status_escalated')}</button>
    </div>
  `;
  container.appendChild(filterBar);

  // Content Root
  const contentRoot = document.createElement('div');
  contentRoot.className = 'supplier-claims-content min-h-[300px]';
  container.appendChild(contentRoot);

  // Drawer Container
  const drawerRoot = document.createElement('div');
  container.appendChild(drawerRoot);

  async function loadData() {
    loading = true;
    renderContent();

    try {
      const [claimsRes, analyticsRes] = await Promise.all([
        api.get('/supplier/claims'),
        api.get('/supplier/claims/analytics'),
      ]);

      claims = claimsRes.data?.claims || [];
      analytics = analyticsRes.data?.products || [];
    } catch (err) {
      toast.error(err.message || t('warranty.load_error'));
      claims = [];
      analytics = [];
    } finally {
      loading = false;
      renderKPIs();
      renderContent();
    }
  }

  function renderKPIs() {
    const totalClaims = claims.length;
    const pendingClaims = claims.filter((c) => ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(c.status)).length;
    const breachedClaims = claims.filter((c) => c.is_sla_breached).length;
    const totalWarranties = analytics.reduce((acc, p) => acc + (p.total_warranties_issued || 0), 0);
    const avgClaimRate = totalWarranties > 0 ? ((totalClaims / totalWarranties) * 100).toFixed(1) : '0.0';

    const queueCountEl = navTabs.querySelector('#queue-count');
    if (queueCountEl) queueCountEl.textContent = String(pendingClaims);

    kpiSection.innerHTML = `
      <div class="kpi-card card p-4 bg-surface">
        <span class="text-xs text-muted block">${t('warranty.kpi_active_warranties')}</span>
        <span class="text-2xl font-bold text-primary mt-1 block">${totalWarranties}</span>
        <span class="text-xs text-muted mt-0.5 block">${analytics.length} ${t('warranty.products_with_warranty')}</span>
      </div>
      <div class="kpi-card card p-4 bg-surface">
        <span class="text-xs text-muted block">${t('warranty.kpi_pending_review')}</span>
        <span class="text-2xl font-bold ${pendingClaims > 0 ? 'text-amber-500' : 'text-success'} mt-1 block">${pendingClaims}</span>
        <span class="text-xs text-muted mt-0.5 block">72h ${t('warranty.sla_commitment')}</span>
      </div>
      <div class="kpi-card card p-4 bg-surface">
        <span class="text-xs text-muted block">${t('warranty.kpi_sla_breaches')}</span>
        <span class="text-2xl font-bold ${breachedClaims > 0 ? 'text-danger' : 'text-success'} mt-1 block">${breachedClaims}</span>
        <span class="text-xs ${breachedClaims > 0 ? 'text-danger' : 'text-success'} mt-0.5 block">
          ${breachedClaims > 0 ? t('warranty.escalated_to_admin') : t('warranty.perfect_sla')}
        </span>
      </div>
      <div class="kpi-card card p-4 bg-surface">
        <span class="text-xs text-muted block">${t('warranty.kpi_overall_claim_rate')}</span>
        <span class="text-2xl font-bold ${parseFloat(avgClaimRate) > 5 ? 'text-rose-500' : 'text-primary'} mt-1 block">${avgClaimRate}%</span>
        <span class="text-xs text-muted mt-0.5 block">${t('warranty.quality_benchmark')} &lt; 3.0%</span>
      </div>
    `;
  }

  function renderContent() {
    contentRoot.innerHTML = '';

    if (loading) {
      contentRoot.innerHTML = `
        <div class="card p-6 text-center text-muted animate-pulse">
          ${t('common.loading')}...
        </div>
      `;
      return;
    }

    if (activeTab === 'claims') {
      filterBar.style.display = 'flex';
      renderClaimsQueue();
    } else {
      filterBar.style.display = 'none';
      renderAnalyticsTable();
    }
  }

  function renderClaimsQueue() {
    let filtered = claims;
    if (filterStatus !== 'all') {
      filtered = claims.filter((c) => c.status === filterStatus);
    }

    if (filtered.length === 0) {
      contentRoot.appendChild(
        EmptyState({
          title: t('warranty.no_claims_found'),
          description: t('warranty.no_claims_filter_desc'),
        })
      );
      return;
    }

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-container card overflow-x-auto';

    const table = document.createElement('table');
    table.className = 'table w-full text-left text-sm';
    table.innerHTML = `
      <thead>
        <tr class="border-b border-subtle bg-surface-2 text-xs text-muted">
          <th class="p-3">${t('warranty.claim_ref')}</th>
          <th class="p-3">${t('warranty.product')}</th>
          <th class="p-3">${t('warranty.customer')}</th>
          <th class="p-3">${t('warranty.resolution')}</th>
          <th class="p-3">${t('warranty.sla_status')}</th>
          <th class="p-3">${t('warranty.status')}</th>
          <th class="p-3 text-right">${t('common.actions')}</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((c) => `
          <tr class="border-b border-subtle hover:bg-surface-2/50 cursor-pointer claim-row" data-id="${c.id}">
            <td class="p-3">
              <span class="font-mono font-semibold text-primary">#${c.ref}</span>
              <div class="text-xs text-muted">Card: ${c.warranty_card_ref || 'N/A'}</div>
            </td>
            <td class="p-3">
              <div class="font-medium text-xs max-w-[200px] truncate">${c.product_title_en || 'Product'}</div>
              <div class="font-mono text-xs text-muted">SN: ${c.serial_number || 'N/A'}</div>
            </td>
            <td class="p-3">
              <div class="text-xs font-medium">${c.customer_name || 'Customer'}</div>
              <div class="text-xs text-muted">${c.customer_phone || ''}</div>
            </td>
            <td class="p-3">
              <span class="badge badge--info text-xs">${c.resolution || c.preferred_resolution || 'REPAIR'}</span>
            </td>
            <td class="p-3">
              ${c.sla_due_at ? `
                <div class="text-xs ${c.is_sla_breached ? 'text-danger font-bold' : 'text-secondary'}">
                  ${c.is_sla_breached ? `🚨 ${t('warranty.sla_breached')}` : `⏱️ ${c.sla_remaining_hours}h left`}
                </div>
              ` : '<span class="text-xs text-muted">—</span>'}
            </td>
            <td class="p-3">
              <span class="badge ${getStatusBadge(c.status)} text-xs">${c.status}</span>
            </td>
            <td class="p-3 text-right">
              <button class="btn btn--sm btn--primary review-btn" data-id="${c.id}">
                ${t('warranty.review_btn')}
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;

    tableWrap.appendChild(table);
    contentRoot.appendChild(tableWrap);

    table.querySelectorAll('.claim-row, .review-btn').forEach((el) => {
      el.addEventListener('click', (e) => {
        const id = parseInt(el.dataset.id || el.closest('.claim-row')?.dataset.id, 10);
        const claim = claims.find((c) => c.id === id);
        if (claim) openClaimDrawer(claim);
      });
    });
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'APPROVED': return 'badge--success';
      case 'IN_PROGRESS': return 'badge--info';
      case 'COMPLETED': return 'badge--emerald';
      case 'REJECTED': return 'badge--rose';
      case 'ESCALATED': return 'badge--danger';
      case 'UNDER_REVIEW': return 'badge--amber';
      case 'SUBMITTED':
      default: return 'badge--primary';
    }
  }

  function renderAnalyticsTable() {
    if (analytics.length === 0) {
      contentRoot.appendChild(
        EmptyState({
          title: t('warranty.no_analytics_data'),
          description: t('warranty.no_analytics_desc'),
        })
      );
      return;
    }

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-container card overflow-x-auto';

    const table = document.createElement('table');
    table.className = 'table w-full text-left text-sm';
    table.innerHTML = `
      <thead>
        <tr class="border-b border-subtle bg-surface-2 text-xs text-muted">
          <th class="p-3">${t('warranty.product')}</th>
          <th class="p-3 text-center">${t('warranty.coverage_months')}</th>
          <th class="p-3 text-center">${t('warranty.total_issued')}</th>
          <th class="p-3 text-center">${t('warranty.claims_count')}</th>
          <th class="p-3 text-center">${t('warranty.claim_rate')}</th>
          <th class="p-3 text-center">${t('warranty.quality_signal')}</th>
        </tr>
      </thead>
      <tbody>
        ${analytics.map((p) => {
          let signalClass = 'badge--success';
          let signalLabel = t('warranty.quality_normal');
          if (p.quality_signal === 'HIGH_RISK') {
            signalClass = 'badge--danger';
            signalLabel = t('warranty.quality_high_risk');
          } else if (p.quality_signal === 'ELEVATED') {
            signalClass = 'badge--amber';
            signalLabel = t('warranty.quality_elevated');
          }

          return `
            <tr class="border-b border-subtle hover:bg-surface-2/50">
              <td class="p-3">
                <div class="font-semibold text-sm">${p.title_en}</div>
                <div class="text-xs text-muted">${p.brand || 'Explooro Certified'}</div>
              </td>
              <td class="p-3 text-center">${p.warranty_months}m</td>
              <td class="p-3 text-center font-mono font-medium">${p.total_warranties_issued}</td>
              <td class="p-3 text-center font-mono font-medium">${p.total_claims_count}</td>
              <td class="p-3 text-center">
                <span class="font-mono font-bold ${p.claim_rate_pct > 5 ? 'text-danger' : 'text-primary'}">
                  ${p.claim_rate_pct}%
                </span>
              </td>
              <td class="p-3 text-center">
                <span class="badge ${signalClass} text-xs">${signalLabel}</span>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    `;

    tableWrap.appendChild(table);
    contentRoot.appendChild(tableWrap);
  }

  function openClaimDrawer(claim) {
    selectedClaim = claim;
    drawerRoot.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const drawer = document.createElement('div');
    drawer.className = 'drawer drawer--right w-full max-w-lg bg-surface p-6 space-y-4 overflow-y-auto';

    const isPending = ['SUBMITTED', 'UNDER_REVIEW', 'ESCALATED'].includes(claim.status);
    const isApproved = claim.status === 'APPROVED';
    const isInProgress = claim.status === 'IN_PROGRESS';

    drawer.innerHTML = `
      <div class="drawer-header flex justify-between items-center pb-3 border-b border-subtle">
        <div>
          <h3 class="font-bold text-lg">🛡️ ${t('warranty.review_claim_title')} #${claim.ref}</h3>
          <span class="text-xs text-muted">Order: ${claim.sub_order_ref || 'N/A'} • Serial: ${claim.serial_number || 'N/A'}</span>
        </div>
        <button class="btn-close text-lg" type="button">✕</button>
      </div>

      <div class="drawer-body space-y-4">
        <!-- Visual Stepper Timeline -->
        ${ClaimTimeline({ claim, isSupplier: true }).outerHTML}

        ${isPending ? `
          <div class="review-actions-card card p-4 bg-surface-2 space-y-3">
            <h4 class="font-semibold text-sm">⚖️ ${t('warranty.take_action')}</h4>

            <div class="form-group">
              <label class="text-xs font-medium block mb-1">${t('warranty.select_resolution')}:</label>
              <select id="action-resolution" class="form-control text-xs w-full p-2 rounded bg-surface border border-subtle">
                <option value="REPAIR" selected>🔧 ${t('warranty.resolution_repair')} (Auto Reverse Courier)</option>
                <option value="REPLACE">📦 ${t('warranty.resolution_replace')} (Auto Reverse Courier)</option>
                <option value="REFUND">💰 ${t('warranty.resolution_refund')} (Wallet Refund)</option>
              </select>
            </div>

            <div class="form-group">
              <label class="text-xs font-medium block mb-1">${t('warranty.supplier_notes')}:</label>
              <textarea id="action-notes" rows="2" class="form-control text-xs w-full p-2 rounded bg-surface border border-subtle" placeholder="${t('warranty.notes_placeholder')}"></textarea>
            </div>

            <div class="flex gap-2 pt-2">
              <button class="btn btn--sm btn--primary flex-1 approve-btn" type="button">
                ✅ ${t('warranty.approve_btn')}
              </button>
              <button class="btn btn--sm btn--danger flex-1 reject-btn" type="button">
                ❌ ${t('warranty.reject_btn')}
              </button>
            </div>
          </div>
        ` : ''}

        ${isApproved || isInProgress ? `
          <div class="progress-actions-card card p-4 bg-surface-2 space-y-3">
            <h4 class="font-semibold text-sm">🔧 ${t('warranty.update_service_status')}</h4>
            <div class="flex gap-2">
              ${isApproved ? `
                <button class="btn btn--sm btn--secondary in-progress-btn" type="button">
                  🔧 ${t('warranty.mark_in_progress')}
                </button>
              ` : ''}
              <button class="btn btn--sm btn--primary complete-btn" type="button">
                🎉 ${t('warranty.mark_completed')}
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    backdrop.appendChild(drawer);
    drawerRoot.appendChild(backdrop);

    const close = () => {
      drawerRoot.innerHTML = '';
    };

    drawer.querySelector('.btn-close').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    const approveBtn = drawer.querySelector('.approve-btn');
    if (approveBtn) {
      approveBtn.addEventListener('click', async () => {
        const resolution = drawer.querySelector('#action-resolution').value;
        const notes = drawer.querySelector('#action-notes').value;

        approveBtn.disabled = true;
        try {
          await api.post(`/supplier/claims/${claim.id}/review`, {
            action: 'APPROVE',
            resolution,
            supplier_notes: notes,
          });
          toast.success(t('warranty.claim_approved_success'));
          close();
          loadData();
        } catch (err) {
          toast.error(err.message || t('warranty.action_failed'));
          approveBtn.disabled = false;
        }
      });
    }

    const rejectBtn = drawer.querySelector('.reject-btn');
    if (rejectBtn) {
      rejectBtn.addEventListener('click', async () => {
        const reason = window.prompt(t('warranty.rejection_prompt'));
        if (!reason || !reason.trim()) {
          toast.error(t('warranty.rejection_reason_mandatory'));
          return;
        }

        rejectBtn.disabled = true;
        try {
          await api.post(`/supplier/claims/${claim.id}/review`, {
            action: 'REJECT',
            rejection_reason: reason.trim(),
          });
          toast.success(t('warranty.claim_rejected_success'));
          close();
          loadData();
        } catch (err) {
          toast.error(err.message || t('warranty.action_failed'));
          rejectBtn.disabled = false;
        }
      });
    }

    const inProgressBtn = drawer.querySelector('.in-progress-btn');
    if (inProgressBtn) {
      inProgressBtn.addEventListener('click', async () => {
        try {
          await api.post(`/supplier/claims/${claim.id}/progress`, {
            status: 'IN_PROGRESS',
          });
          toast.success(t('warranty.status_updated'));
          close();
          loadData();
        } catch (err) {
          toast.error(err.message || t('warranty.action_failed'));
        }
      });
    }

    const completeBtn = drawer.querySelector('.complete-btn');
    if (completeBtn) {
      completeBtn.addEventListener('click', async () => {
        try {
          await api.post(`/supplier/claims/${claim.id}/progress`, {
            status: 'COMPLETED',
          });
          toast.success(t('warranty.claim_completed_success'));
          close();
          loadData();
        } catch (err) {
          toast.error(err.message || t('warranty.action_failed'));
        }
      });
    }
  }

  // Filter chips event listener
  filterBar.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    filterStatus = chip.dataset.status;

    filterBar.querySelectorAll('.filter-chip').forEach((c) => {
      if (c === chip) {
        c.className = 'filter-chip px-2.5 py-1 rounded bg-primary text-white';
      } else {
        c.className = 'filter-chip px-2.5 py-1 rounded bg-surface border border-subtle text-secondary';
      }
    });

    renderClaimsQueue();
  });

  // Tab switcher
  navTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-tab-btn');
    if (!btn) return;
    activeTab = btn.dataset.tab;

    navTabs.querySelectorAll('.nav-tab-btn').forEach((b) => {
      const isCurrent = b === btn;
      b.className = `nav-tab-btn px-4 py-2 text-sm font-medium border-b-2 ${
        isCurrent ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-primary'
      }`;
    });

    renderContent();
  });

  header.querySelector('#refresh-btn').addEventListener('click', loadData);

  root.appendChild(container);
  loadData();

  return () => {
    container.remove();
  };
}
