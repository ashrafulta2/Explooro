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
  container.className = 'supplier-page-container';
  container.setAttribute('data-module', 'digital_warranty');

  if (!isFeatureEnabled('digital_warranty')) {
    container.append(
      EmptyState({
        title: t('warranty.supplier_hub_title', 'Supplier Warranty & Claims Hub'),
        description: t('warranty.module_disabled', 'The Digital Warranty module is currently disabled.'),
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
  header.className = 'supplier-header';
  header.innerHTML = `
    <div class="supplier-header__titles">
      <div class="supplier-header__badge-row">
        <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
        <span class="text-muted">/</span>
        <span class="text-xs text-muted font-mono">Warranty & Aftercare</span>
      </div>
      <h1 class="supplier-header__title">
        <span>🛡️</span> ${t('warranty.supplier_hub_title', 'Supplier Warranty & Claims Hub')}
      </h1>
      <p class="supplier-header__subtitle">
        ${t('warranty.supplier_hub_subtitle', 'Review customer warranty claims, manage 72-hour SLA resolutions, and audit product quality metrics.')}
      </p>
    </div>
    <div class="supplier-header__actions">
      <button class="btn btn--sm btn--secondary" id="refresh-claims-btn">
        🔄 ${t('common.refresh', 'Refresh')}
      </button>
    </div>
  `;
  container.appendChild(header);

  // KPI Metrics Summary
  const kpiSection = document.createElement('div');
  kpiSection.className = 'supplier-kpi-grid';
  container.appendChild(kpiSection);

  // Nav Switcher Toolbar
  const navTabs = document.createElement('div');
  navTabs.className = 'supplier-toolbar';
  navTabs.style.borderBottom = 'none';
  navTabs.innerHTML = `
    <div class="supplier-toolbar__filters">
      <button class="supplier-chip supplier-chip--active" data-tab="claims" id="tab-claims-btn">
        📋 ${t('warranty.tab_claim_queue', 'Claims Review Queue')} (<span id="queue-count">0</span>)
      </button>
      <button class="supplier-chip" data-tab="analytics" id="tab-analytics-btn">
        📊 ${t('warranty.tab_quality_analytics', 'Product Quality Analytics')}
      </button>
    </div>
  `;
  container.appendChild(navTabs);

  // Filter Toolbar (for Claims Queue)
  const filterBar = document.createElement('div');
  filterBar.className = 'supplier-toolbar';
  filterBar.innerHTML = `
    <div class="supplier-toolbar__filters">
      <button class="supplier-chip ${filterStatus === 'all' ? 'supplier-chip--active' : ''}" data-status="all">${t('common.all', 'All')}</button>
      <button class="supplier-chip ${filterStatus === 'SUBMITTED' ? 'supplier-chip--active' : ''}" data-status="SUBMITTED">${t('warranty.status_submitted', 'Submitted')}</button>
      <button class="supplier-chip ${filterStatus === 'APPROVED' ? 'supplier-chip--active' : ''}" data-status="APPROVED">${t('warranty.status_approved', 'Approved')}</button>
      <button class="supplier-chip ${filterStatus === 'IN_PROGRESS' ? 'supplier-chip--active' : ''}" data-status="IN_PROGRESS">${t('warranty.status_in_progress', 'In Progress')}</button>
      <button class="supplier-chip ${filterStatus === 'COMPLETED' ? 'supplier-chip--active' : ''}" data-status="COMPLETED">${t('warranty.status_completed', 'Completed')}</button>
      <button class="supplier-chip supplier-chip--danger ${filterStatus === 'ESCALATED' ? 'supplier-chip--active' : ''}" data-status="ESCALATED">🚨 ${t('warranty.status_escalated', 'Escalated')}</button>
    </div>
  `;
  container.appendChild(filterBar);

  // Content Root
  const contentRoot = document.createElement('div');
  contentRoot.className = 'supplier-claims-content';
  container.appendChild(contentRoot);

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
      toast.error(err.message || t('warranty.load_error', 'Failed to load claims.'));
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
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('warranty.kpi_active_warranties', 'Active Warranties Issued')}</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">${totalWarranties}</div>
        <span class="text-xs text-muted">${analytics.length} products with warranty</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('warranty.kpi_pending_review', 'Pending SLA Review')}</span>
        <div class="supplier-kpi-card__value ${pendingClaims > 0 ? 'supplier-kpi-card__value--warning' : 'supplier-kpi-card__value--success'}" style="font-size: 1.5rem; margin: 4px 0;">
          ${pendingClaims}
        </div>
        <span class="text-xs text-muted">72h SLA commitment</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('warranty.kpi_sla_breaches', 'SLA Breaches')}</span>
        <div class="supplier-kpi-card__value ${breachedClaims > 0 ? 'supplier-kpi-card__value--danger' : 'supplier-kpi-card__value--success'}" style="font-size: 1.5rem; margin: 4px 0;">
          ${breachedClaims}
        </div>
        <span class="text-xs ${breachedClaims > 0 ? 'text-danger font-bold' : 'text-muted'}">
          ${breachedClaims > 0 ? 'Escalated to Admin' : '100% on-time resolution'}
        </span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">${t('warranty.kpi_overall_claim_rate', 'Overall Quality Claim Rate')}</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 4px 0;">${avgClaimRate}%</div>
        <span class="text-xs text-muted">Quality benchmark &lt; 3.0%</span>
      </div>
    `;
  }

  function renderContent() {
    contentRoot.innerHTML = '';

    if (loading) {
      contentRoot.innerHTML = `
        <div class="p-12 text-center text-muted">
          <div class="spinner" style="margin: 0 auto 16px auto;"></div>
          <p>${t('common.loading', 'Loading claims data...')}</p>
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
    const filtered = claims.filter((c) => {
      if (filterStatus === 'all') return true;
      return c.status === filterStatus;
    });

    if (filtered.length === 0) {
      contentRoot.appendChild(
        EmptyState({
          icon: '🛡️',
          title: t('warranty.no_claims_title', 'No warranty claims match your filter'),
          description: t('warranty.no_claims_desc', 'All customer claims are resolved or no claims have been submitted under this filter.'),
        })
      );
      return;
    }

    const tableCard = document.createElement('div');
    tableCard.className = 'supplier-table-card';

    let tableHtml = `
      <div style="overflow-x: auto;">
        <table class="supplier-table">
          <thead>
            <tr>
              <th>Claim Ref</th>
              <th>Product / Category</th>
              <th>Customer Issue</th>
              <th>SLA Status</th>
              <th>Status</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
    `;

    filtered.forEach((claim) => {
      const isBreached = claim.is_sla_breached;
      tableHtml += `
        <tr data-id="${claim.id}">
          <td>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span class="supplier-order-card__ref">${claim.claim_ref || 'CLM-' + claim.id}</span>
              <span class="text-xs text-muted">${claim.created_at ? claim.created_at.slice(0, 10) : 'Recent'}</span>
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-weight: 700; color: var(--text-primary);">${claim.product_title || 'Warranty Product'}</span>
              <span class="text-xs text-muted">Card: #${claim.warranty_card_id}</span>
            </div>
          </td>
          <td>
            <div style="font-size: var(--text-xs); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <strong>${claim.issue_category || 'Defect'}:</strong> ${claim.issue_description || 'Customer reported issue.'}
            </div>
          </td>
          <td>
            ${isBreached ? `
              <span class="badge badge--danger text-xs font-bold">🚨 Breached (&gt;72h)</span>
            ` : `
              <span class="badge badge--info text-xs font-mono">⏰ 48h Remaining</span>
            `}
          </td>
          <td>
            <span class="badge ${claim.status === 'APPROVED' || claim.status === 'COMPLETED' ? 'badge--success' : claim.status === 'REJECTED' ? 'badge--danger' : 'badge--warning'} text-xs uppercase font-mono">
              ${claim.status}
            </span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn--xs btn--primary review-claim-btn" data-id="${claim.id}">
              🔍 Review & Resolve
            </button>
          </td>
        </tr>
      `;
    });

    tableHtml += `
          </tbody>
        </table>
      </div>
    `;

    tableCard.innerHTML = tableHtml;

    tableCard.querySelectorAll('.review-claim-btn').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const claim = claims.find((c) => String(c.id) === String(id));
        if (claim) openClaimResolutionModal(claim);
      };
    });

    contentRoot.appendChild(tableCard);
  }

  function renderAnalyticsTable() {
    if (analytics.length === 0) {
      contentRoot.appendChild(
        EmptyState({
          icon: '📊',
          title: 'No quality defect data available',
          description: 'Defect rate statistics will calculate automatically as warranty claims are filed.',
        })
      );
      return;
    }

    const tableCard = document.createElement('div');
    tableCard.className = 'supplier-table-card';

    let tableHtml = `
      <div style="overflow-x: auto;">
        <table class="supplier-table">
          <thead>
            <tr>
              <th>Product SKU</th>
              <th>Warranties Issued</th>
              <th>Claims Filed</th>
              <th>Defect Claim Rate</th>
              <th>Quality Status</th>
            </tr>
          </thead>
          <tbody>
    `;

    analytics.forEach((prod) => {
      const claimRate = prod.total_warranties_issued > 0 ? ((prod.total_claims / prod.total_warranties_issued) * 100).toFixed(1) : '0.0';
      const isHighDefect = parseFloat(claimRate) > 5.0;

      tableHtml += `
        <tr>
          <td>
            <strong style="color: var(--text-primary);">${prod.product_title}</strong>
          </td>
          <td>${prod.total_warranties_issued} units</td>
          <td>${prod.total_claims} claims</td>
          <td>
            <strong style="font-family: var(--font-mono); color: ${isHighDefect ? 'var(--danger)' : 'var(--success)'};">
              ${claimRate}%
            </strong>
          </td>
          <td>
            ${isHighDefect ? `
              <span class="badge badge--danger text-xs font-bold">⚠️ High Return Risk</span>
            ` : `
              <span class="badge badge--success text-xs font-bold">✅ Excellent Quality</span>
            `}
          </td>
        </tr>
      `;
    });

    tableHtml += `
          </tbody>
        </table>
      </div>
    `;

    tableCard.innerHTML = tableHtml;
    contentRoot.appendChild(tableCard);
  }

  function openClaimResolutionModal(claim) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'supplier-modal-scrim';
    modalBackdrop.innerHTML = `
      <div class="supplier-modal" style="max-width: 540px;">
        <div class="supplier-modal__header">
          <h3 class="supplier-modal__title">🛡️ Resolve Warranty Claim #${claim.claim_ref || claim.id}</h3>
          <button class="supplier-modal__close close-modal-btn">&times;</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: var(--space-3, 12px); font-size: var(--text-xs);">
          <div style="background: var(--surface-1); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            <div><strong>Product:</strong> ${claim.product_title || 'Item'}</div>
            <div style="margin-top: 4px;"><strong>Reported Issue:</strong> ${claim.issue_description || 'N/A'}</div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-weight: 700;">Resolution Action</label>
            <select class="input input--sm" id="resolution-action-select">
              <option value="APPROVE_REPLACE">🔄 Approve Brand New Replacement</option>
              <option value="APPROVE_REPAIR">🔧 Approve Factory Repair (Reverse Courier)</option>
              <option value="REJECT">🚫 Reject Claim (Out of Policy / Customer Damage)</option>
            </select>
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="label" style="font-weight: 700;">Technician Notes / Instructions</label>
            <textarea id="technician-notes" class="input input--sm" style="height: 70px; resize: vertical;" placeholder="Add notes for customer notification..."></textarea>
          </div>
        </div>

        <div class="supplier-modal__footer">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.cancel', 'Cancel')}</button>
          <button class="btn btn--sm btn--primary" id="confirm-resolution-btn">
            💾 Submit Resolution
          </button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));

    modalBackdrop.querySelector('#confirm-resolution-btn').onclick = async () => {
      const action = modalBackdrop.querySelector('#resolution-action-select').value;
      const notes = modalBackdrop.querySelector('#technician-notes').value.trim();

      try {
        await api.post(`/supplier/claims/${claim.id}/resolve`, { action, notes });
        toast.success('Warranty claim resolved successfully.');
        close();
        loadData();
      } catch (err) {
        toast.error(err.message || 'Failed to submit resolution.');
      }
    };

    document.body.appendChild(modalBackdrop);
  }

  // Setup tab listeners
  navTabs.querySelector('#tab-claims-btn').onclick = () => {
    activeTab = 'claims';
    navTabs.querySelector('#tab-claims-btn').classList.add('supplier-chip--active');
    navTabs.querySelector('#tab-analytics-btn').classList.remove('supplier-chip--active');
    renderContent();
  };

  navTabs.querySelector('#tab-analytics-btn').onclick = () => {
    activeTab = 'analytics';
    navTabs.querySelector('#tab-analytics-btn').classList.add('supplier-chip--active');
    navTabs.querySelector('#tab-claims-btn').classList.remove('supplier-chip--active');
    renderContent();
  };

  filterBar.querySelectorAll('.supplier-chip').forEach((chip) => {
    chip.onclick = () => {
      filterStatus = chip.dataset.status;
      filterBar.querySelectorAll('.supplier-chip').forEach((c) => c.classList.remove('supplier-chip--active'));
      chip.classList.add('supplier-chip--active');
      renderClaimsQueue();
    };
  });

  header.querySelector('#refresh-claims-btn').onclick = loadData;

  loadData();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
