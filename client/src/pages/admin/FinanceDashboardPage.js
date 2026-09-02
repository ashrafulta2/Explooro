/**
 * FinanceDashboardPage.js — Platform Executive Finance Command Center (Prompt 6.5).
 *
 * Implements:
 * 1. Financial Liability Metrics: GMV, Net Revenue, Escrow Liability, Pending Payouts, COD Exposure.
 * 2. Real-Time Double-Entry Ledger Integrity Status indicator (All-Clean vs Drift-Detected).
 * 3. Zero-dependency Inline SVG Visualizations:
 *    - 7-Day Revenue Trend SVG Line/Area Graph
 *    - Courier COD Distribution SVG Bar Graph
 * 4. Direct Operational Action buttons (Escrow Release Sweep, Payout Queue, COD Reconciliation).
 */

import { api } from '../../core/api.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { t } from '../../services/i18n.js';

export default function FinanceDashboardPage(root) {
  const container = document.createElement('div');
  container.className = 'page finance-dashboard-page';

  let overviewData = null;
  let isLoading = true;
  let isSweeping = false;

  async function loadDashboard() {
    isLoading = true;
    render();

    try {
      const res = await api.get('/admin/finance/overview');
      overviewData = res.data || null;
    } catch (err) {
      toast.error(err.message || 'Failed to load financial metrics');
    } finally {
      isLoading = false;
      render();
    }
  }

  async function handleSweep() {
    isSweeping = true;
    render();

    try {
      const res = await api.post('/admin/finance/escrow/sweep');
      const { releasedCount, totalReleasedAmount } = res.data;
      toast.success(
        t('finance_admin.sweep_success', {
          count: releasedCount,
          amount: formatCurrency(totalReleasedAmount),
        })
      );
      await loadDashboard();
    } catch (err) {
      toast.error(err.message || 'Escrow sweep failed');
    } finally {
      isSweeping = false;
      render();
    }
  }

  function renderTrendSvg(dailyTrend = []) {
    if (!dailyTrend || dailyTrend.length === 0) return '';
    const width = 600;
    const height = 180;
    const padding = 30;

    const maxVal = Math.max(...dailyTrend.map((d) => d.amount), 100);
    const stepX = (width - 2 * padding) / (dailyTrend.length - 1 || 1);

    const points = dailyTrend.map((d, i) => {
      const x = padding + i * stepX;
      const y = height - padding - (d.amount / maxVal) * (height - 2 * padding);
      return { x, y, ...d };
    });

    const pathD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`, '');
    const areaD = `${pathD} L ${points[points.length - 1].x},${height - padding} L ${points[0].x},${height - padding} Z`;

    return `
      <svg viewBox="0 0 ${width} ${height}" class="finance-svg-chart" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--brand)" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="var(--brand)" stop-opacity="0.0"/>
          </linearGradient>
        </defs>

        <!-- Grid Lines -->
        <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="var(--border-strong)" stroke-dasharray="3 3"/>
        <line x1="${padding}" y1="${(height - padding) / 2}" x2="${width - padding}" y2="${(height - padding) / 2}" stroke="var(--border-strong)" stroke-dasharray="3 3"/>
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="var(--border-strong)"/>

        <!-- Area Fill & Stroke Line -->
        <path d="${areaD}" fill="url(#trendGrad)" />
        <path d="${pathD}" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" />

        <!-- Data Point Circles & Text -->
        ${points.map((p) => `
          <circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--brand)" />
          <text x="${p.x}" y="${height - 10}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">${p.label}</text>
          <text x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="10" font-weight="bold" fill="var(--text-primary)">৳${p.amount}</text>
        `).join('')}
      </svg>
    `;
  }

  function renderCourierDistributionSvg(couriers = []) {
    if (!couriers || couriers.length === 0) return `<div class="text-sm text-secondary p-4">${t('finance_admin.no_cod_exposure')}</div>`;
    const total = couriers.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0) || 1;

    return `
      <div class="courier-distribution-bars">
        ${couriers.map((c) => {
          const amt = parseFloat(c.amount || 0);
          const pct = Math.round((amt / total) * 100);
          return `
            <div class="courier-bar-row">
              <div class="courier-bar-label">
                <span class="font-bold">${c.courier}</span>
                <span class="text-xs text-secondary font-mono">${formatCurrency(amt)} (${pct}%)</span>
              </div>
              <div class="courier-bar-track">
                <div class="courier-bar-fill" style="width: ${pct}%;"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function render() {
    const m = overviewData?.metrics || {};
    const isLedgerClean = m.ledger_health === 'HEALTHY' && (m.ledger_drifts === 0 || !m.ledger_drifts);

    container.innerHTML = `
      <div class="finance-dashboard-page__header">
        <div>
          <h1 class="page-title">${t('finance_admin.page_title')}</h1>
          <p class="text-secondary">${t('finance_admin.page_subtitle')}</p>
        </div>

        <div class="finance-dashboard-page__header-actions">
          <button type="button" class="btn btn--secondary finance-dashboard-page__sweep-btn" ${isSweeping ? 'disabled' : ''}>
            ⚡ ${isSweeping ? t('common.processing') : t('finance_admin.btn_sweep_escrow')}
          </button>
          <button type="button" class="btn btn--secondary finance-dashboard-page__refresh-btn">
            🔄 ${t('common.refresh')}
          </button>
        </div>
      </div>

      ${isLoading ? `
        <div class="finance-dashboard-page__loading">
          <div class="spinner"></div>
          <span>${t('common.loading')}...</span>
        </div>
      ` : `
        <!-- Top Metrics KPI Cards -->
        <div class="finance-dashboard-page__kpis">
          <!-- GMV -->
          <div class="card finance-kpi-card">
            <div class="finance-kpi-card__label">${t('finance_admin.kpi_gmv')}</div>
            <div class="finance-kpi-card__val text-primary font-bold">${formatCurrency(m.gmv)}</div>
            <div class="finance-kpi-card__hint">${t('finance_admin.kpi_gmv_hint')}</div>
          </div>

          <!-- Net Platform Revenue -->
          <div class="card finance-kpi-card">
            <div class="finance-kpi-card__label">${t('finance_admin.kpi_revenue')}</div>
            <div class="finance-kpi-card__val text-success font-bold">${formatCurrency(m.net_revenue)}</div>
            <div class="finance-kpi-card__hint">${t('finance_admin.kpi_revenue_hint')}</div>
          </div>

          <!-- Escrow Liability -->
          <div class="card finance-kpi-card">
            <div class="finance-kpi-card__label">${t('finance_admin.kpi_escrow_liability')}</div>
            <div class="finance-kpi-card__val text-warning font-bold">${formatCurrency(m.total_escrow_liability)}</div>
            <div class="finance-kpi-card__hint">${t('finance_admin.kpi_escrow_hint')}</div>
          </div>

          <!-- Pending Payout Liability -->
          <div class="card finance-kpi-card">
            <div class="finance-kpi-card__label">${t('finance_admin.kpi_payout_liability')}</div>
            <div class="finance-kpi-card__val text-purple font-bold">${formatCurrency(m.pending_payout_liability)}</div>
            <div class="finance-kpi-card__hint">${t('finance_admin.kpi_payout_hint')}</div>
          </div>

          <!-- COD Cash In-Transit Exposure -->
          <div class="card finance-kpi-card">
            <div class="finance-kpi-card__label">${t('finance_admin.kpi_cod_exposure')}</div>
            <div class="finance-kpi-card__val text-danger font-bold">${formatCurrency(m.cod_exposure)}</div>
            <div class="finance-kpi-card__hint">${m.cod_unreconciled_count || 0} ${t('finance_admin.unreconciled_records')}</div>
          </div>

          <!-- Real-Time Ledger Integrity -->
          <div class="card finance-kpi-card finance-kpi-card--integrity">
            <div class="finance-kpi-card__label">${t('finance_admin.ledger_integrity_label')}</div>
            <div class="finance-kpi-card__status">
              ${isLedgerClean ? `
                <span class="badge badge--success font-bold text-sm">✓ ${t('finance_admin.ledger_healthy')}</span>
              ` : `
                <span class="badge badge--danger font-bold text-sm">⚠️ ${t('finance_admin.ledger_drift_detected')}</span>
              `}
            </div>
            <div class="finance-kpi-card__hint font-mono text-xs">
              ${t('finance_admin.zero_drift_rule')}
            </div>
          </div>
        </div>

        <!-- Charts Grid -->
        <div class="finance-dashboard-page__charts-grid">
          <!-- 7-Day Trend Chart -->
          <div class="card finance-chart-card">
            <div class="finance-chart-card__header">
              <h3>📈 ${t('finance_admin.chart_trend_title')}</h3>
              <span class="badge badge--neutral">${t('finance_admin.last_7_days')}</span>
            </div>
            <div class="finance-chart-card__body">
              ${renderTrendSvg(overviewData?.daily_trend)}
            </div>
          </div>

          <!-- Courier COD Distribution Chart -->
          <div class="card finance-chart-card">
            <div class="finance-chart-card__header">
              <h3>🚚 ${t('finance_admin.chart_courier_title')}</h3>
              <span class="text-xs text-secondary font-mono">${formatCurrency(m.cod_exposure)} total</span>
            </div>
            <div class="finance-chart-card__body">
              ${renderCourierDistributionSvg(overviewData?.courier_breakdown)}
            </div>
          </div>
        </div>

        <!-- Operational Action Shortcuts -->
        <div class="card finance-shortcuts-card">
          <h3>⚡ ${t('finance_admin.shortcuts_title')}</h3>
          <div class="finance-shortcuts-grid">
            <a href="#/admin/finance/payouts" class="btn btn--secondary">
              💸 ${t('finance_admin.goto_payouts')}
            </a>
            <a href="#/admin/cod-reconciliation" class="btn btn--secondary">
              📦 ${t('finance_admin.goto_cod')}
            </a>
            <a href="#/admin/finance/escrow" class="btn btn--secondary">
              ⏳ ${t('finance_admin.goto_escrow')}
            </a>
          </div>
        </div>
      `}
    `;

    container.querySelector('.finance-dashboard-page__refresh-btn')?.addEventListener('click', loadDashboard);
    container.querySelector('.finance-dashboard-page__sweep-btn')?.addEventListener('click', handleSweep);
  }

  loadDashboard();
  root.append(container);
}
