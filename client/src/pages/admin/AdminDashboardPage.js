/**
 * AdminDashboardPage.js — Super Admin Executive Cockpit & Analytics (Prompt 11.4 / Master Spec §AL.4).
 *
 * Implements:
 * 1. 11 Executive KPIs with period-over-period delta badges and formatted figures.
 * 2. Operational Action Alert Cards with direct 1-click deep links to remedy pages.
 * 3. Pure inline SVG GMV vs Platform Net Revenue trajectory chart.
 * 4. Category share & Channel volume distribution breakdown.
 * 5. Time-range selector (7d, 30d, 90d, 1y) with instant pre-aggregated loading.
 * 6. Quick action toolbar (Trigger Rollup, Health Hub, Backup Controls).
 * 7. Zero-CLS Skeleton placeholders and full bilingual i18n support.
 */

import { adminApi } from '../../services/admin.api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';

export default function AdminDashboardPage(root, { navigate } = {}) {
  // WHY: the alert cards below used to hardcode `alert.title_en` / `details_en` /
  // `action_label_en`, so this page's "full bilingual i18n support" stopped at the chrome — every
  // alert stayed in English under a Bangla UI even though the API sends both variants. Same
  // `isBn()` shape the other admin pages use (AccessGrantsPage, ApprovalInboxPage, AuditLogPage).
  const isBn = () => getLanguage() === 'bn';
  /** Picks `<field>_bn` or `<field>_en` for the active locale, falling back to the other. */
  const loc = (obj, field) =>
    (isBn() ? obj?.[`${field}_bn`] || obj?.[`${field}_en`] : obj?.[`${field}_en`] || obj?.[`${field}_bn`]) ?? '';

  let currentTimeframe = '30d';
  let overviewData = null;
  let alertsData = null;
  let isLoading = true;

  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  async function loadData() {
    isLoading = true;
    render();

    try {
      const [ovRes, alRes] = await Promise.all([
        adminApi.getOverview(currentTimeframe),
        adminApi.getAlerts(),
      ]);

      overviewData = ovRes.data || {};
      alertsData = alRes.data || {};
    } catch {
      toast.error(t('admin.dashboard.load_failed', 'Failed to load executive analytics.'));
    } finally {
      isLoading = false;
      render();
    }
  }

  function formatBdt(val) {
    const num = parseFloat(val || 0);
    return `৳${num.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function renderChart(data = []) {
    if (!data || data.length === 0) {
      return `<div style="height: 180px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--text-muted);">No historical data available.</div>`;
    }

    const width = 640;
    const height = 180;
    const padding = 30;

    const maxGmv = Math.max(...data.map((d) => d.gmv), 1000);
    const maxRev = Math.max(...data.map((d) => d.revenue), 100);

    const stepX = (width - padding * 2) / (data.length - 1 || 1);

    // Build GMV Path (Primary area + stroke)
    const gmvPoints = data.map((d, i) => {
      const x = padding + i * stepX;
      const y = height - padding - (d.gmv / maxGmv) * (height - padding * 2);
      return { x, y };
    });

    const gmvPathD = gmvPoints.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, '');
    const gmvAreaD = `${gmvPathD} L ${gmvPoints[gmvPoints.length - 1].x.toFixed(1)} ${(height - padding).toFixed(1)} L ${gmvPoints[0].x.toFixed(1)} ${(height - padding).toFixed(1)} Z`;

    // Build Revenue Path (Emerald stroke)
    const revPoints = data.map((d, i) => {
      const x = padding + i * stepX;
      const y = height - padding - (d.revenue / maxRev) * (height - padding * 2);
      return { x, y };
    });
    const revPathD = revPoints.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, '');

    return `
      <div class="admin-chart-panel__svg-wrap">
        <svg viewBox="0 0 ${width} ${height}" class="admin-chart-panel__svg" preserveAspectRatio="none" role="img" aria-label="${t('admin.dashboard.chart_title', 'Revenue & GMV Trajectory')}">
          <defs>
            <linearGradient id="gmvAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--brand, #6366f1)" stop-opacity="0.3" />
              <stop offset="100%" stop-color="var(--brand, #6366f1)" stop-opacity="0.0" />
            </linearGradient>
          </defs>

          <!-- Grid Lines -->
          <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="currentColor" stroke-opacity="0.08" stroke-dasharray="3 3" />
          <line x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}" stroke="currentColor" stroke-opacity="0.08" stroke-dasharray="3 3" />
          <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="currentColor" stroke-opacity="0.15" />

          <!-- GMV Area & Line -->
          <path d="${gmvAreaD}" fill="url(#gmvAreaGrad)" />
          <path d="${gmvPathD}" fill="none" stroke="var(--brand, #6366f1)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />

          <!-- Net Revenue Line -->
          <path d="${revPathD}" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 2" />

          <!-- Data Points -->
          ${gmvPoints.map((p, i) => `
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--surface-0, #ffffff)" stroke="var(--brand, #6366f1)" stroke-width="2" tabindex="0">
              <title>${data[i].date}: GMV ৳${data[i].gmv.toLocaleString()} | Rev ৳${data[i].revenue.toLocaleString()}</title>
            </circle>
          `).join('')}

          <!-- X-Axis Labels -->
          ${data.map((d, i) => {
            const x = padding + i * stepX;
            return `<text x="${x.toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">${d.date}</text>`;
          }).join('')}
        </svg>

        <div class="admin-chart-panel__legend">
          <div class="admin-chart-panel__legend-item">
            <span class="admin-chart-panel__dot-primary"></span>
            <span>${t('admin.dashboard.legend_gmv', 'GMV (Gross Merchandise Value)')}</span>
          </div>
          <div class="admin-chart-panel__legend-item">
            <span class="admin-chart-panel__line-secondary"></span>
            <span>${t('admin.dashboard.legend_rev', 'Platform Net Revenue (Take Rate)')}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderSkeleton() {
    return `
      <div class="admin-dashboard-page" aria-busy="true" aria-live="polite">
        <!-- Header Skeleton -->
        <div class="admin-dashboard__header">
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="width: 180px; height: 16px; background: var(--surface-2); border-radius: var(--radius-sm);"></div>
            <div style="width: 320px; height: 28px; background: var(--surface-2); border-radius: var(--radius-md);"></div>
            <div style="width: 240px; height: 14px; background: var(--surface-2); border-radius: var(--radius-sm);"></div>
          </div>
          <div style="display: flex; gap: 8px;">
            <div style="width: 140px; height: 32px; background: var(--surface-2); border-radius: var(--radius-md);"></div>
            <div style="width: 120px; height: 32px; background: var(--surface-2); border-radius: var(--radius-md);"></div>
          </div>
        </div>

        <!-- KPIs Skeleton Grid -->
        <div class="admin-kpis__grid">
          ${Array.from({ length: 8 }).map(() => `
            <div class="admin-kpi-card" style="min-height: 105px; opacity: 0.7;">
              <div style="display: flex; justify-content: space-between;">
                <div style="width: 90px; height: 12px; background: var(--surface-2); border-radius: 4px;"></div>
                <div style="width: 16px; height: 16px; background: var(--surface-2); border-radius: 50%;"></div>
              </div>
              <div style="width: 120px; height: 24px; background: var(--surface-2); border-radius: 4px; margin-top: 8px;"></div>
              <div style="width: 60px; height: 12px; background: var(--surface-2); border-radius: 4px; margin-top: 4px;"></div>
            </div>
          `).join('')}
        </div>

        <!-- Chart Skeleton -->
        <div class="admin-analytics-row">
          <div class="admin-chart-panel" style="min-height: 280px; opacity: 0.7;">
            <div style="width: 180px; height: 18px; background: var(--surface-2); border-radius: 4px;"></div>
            <div style="width: 100%; height: 180px; background: var(--surface-2); border-radius: var(--radius-lg); margin-top: 12px;"></div>
          </div>
          <div class="admin-breakdowns" style="opacity: 0.7;">
            <div class="admin-breakdown-card" style="min-height: 130px;">
              <div style="width: 120px; height: 16px; background: var(--surface-2); border-radius: 4px;"></div>
              <div style="width: 100%; height: 40px; background: var(--surface-2); border-radius: var(--radius-md); margin-top: 8px;"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    root.innerHTML = '';

    if (isLoading && !overviewData) {
      root.innerHTML = renderSkeleton();
      return;
    }

    const container = document.createElement('div');
    container.className = 'admin-dashboard-page';

    const kpis = overviewData?.kpis || {};
    const alerts = alertsData?.alerts || [];
    const criticalAlertsCount = alertsData?.critical_count || 0;

    container.innerHTML = `
      <!-- Executive Header -->
      <div class="admin-dashboard__header">
        <div>
          <div class="admin-dashboard__eyebrow">
            <span class="admin-dashboard__badge">
              ${t('admin.dashboard.cockpit_eyebrow', 'Super Admin Executive Cockpit')}
            </span>
            <span class="admin-dashboard__pulse-dot"></span>
            <span class="admin-dashboard__subtitle" style="margin: 0; font-size: 11px;">
              ${t('admin.dashboard.precomputed_note', 'Pre-computed Nightly Rollups')}
            </span>
          </div>
          <h1 class="admin-dashboard__title">
            ${t('admin.dashboard.title', 'Executive Analytics & Command Center')}
          </h1>
          <p class="admin-dashboard__subtitle">
            ${t('admin.dashboard.subtitle', 'Live platform telemetry, liability exposure, and operational risk mitigation.')}
          </p>
        </div>

        <!-- Controls Toolbar -->
        <div class="admin-dashboard__controls">
          <!-- Timeframe Selector -->
          <div class="admin-dashboard__timeframe-selector" role="group" aria-label="Timeframe filter">
            ${['7d', '30d', '90d', '1y'].map((tf) => `
              <button data-tf="${tf}" class="admin-dashboard__tf-btn ${currentTimeframe === tf ? 'admin-dashboard__tf-btn--active' : ''}" aria-pressed="${currentTimeframe === tf}">
                ${tf.toUpperCase()}
              </button>
            `).join('')}
          </div>

          <div id="rollup-btn-slot"></div>
          <div id="health-btn-slot"></div>
        </div>
      </div>

      <!-- Critical Operational Alerts Banner -->
      ${alerts.length > 0 ? `
        <div class="admin-alerts">
          <div class="admin-alerts__header">
            <h2 class="admin-alerts__heading">
              <span>⚠️ ${t('admin.alerts.title', 'Action Required Today')}</span>
              <span class="admin-alerts__count-badge ${criticalAlertsCount > 0 ? 'admin-alerts__count-badge--critical' : ''}">
                ${alerts.filter(a => a.count > 0).length} ${t('admin.dashboard.action_items', 'Action Items')}
              </span>
            </h2>
            <span class="admin-dashboard__subtitle" style="margin: 0; font-size: 12px;">
              ${t('admin.dashboard.deep_link_sub', 'Every alert deep-links directly to its remedy page')}
            </span>
          </div>

          <div class="admin-alerts__grid">
            ${alerts.map((alert) => {
              const sev = alert.severity || 'MEDIUM';
              const cardClass = sev === 'CRITICAL' ? 'admin-alert-card--critical' : (sev === 'HIGH' ? 'admin-alert-card--high' : '');
              return `
                <div class="admin-alert-card ${cardClass}">
                  <div>
                    <div class="admin-alert-card__top">
                      <span class="admin-alert-card__severity">${sev}</span>
                      <span class="admin-alert-card__count">${alert.count}</span>
                    </div>
                    <h3 class="admin-alert-card__title">${loc(alert, 'title')}</h3>
                    <p class="admin-alert-card__details">${loc(alert, 'details')}</p>
                  </div>

                  <div class="admin-alert-card__footer">
                    <button data-url="${alert.action_url}" class="admin-alert-card__link-btn deep-link-btn" aria-label="${loc(alert, 'action_label')}">
                      <span>${loc(alert, 'action_label')}</span>
                      <span aria-hidden="true">→</span>
                    </button>
                    <span class="admin-alert-card__url">${alert.action_url}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : `
        <div class="admin-alert-card" style="padding: var(--space-4); text-align: center;">
          <h3 class="admin-alert-card__title" style="margin: 0;">✨ ${t('admin.dashboard.no_alerts_title', 'All operational queues are clear')}</h3>
          <p class="admin-alert-card__details" style="margin-top: 4px;">${t('admin.dashboard.no_alerts_desc', 'No critical SLA breaches, pending disputes, or anomalous ledger drifts detected today.')}</p>
        </div>
      `}

      <!-- 11 Executive KPIs Grid -->
      <div class="admin-kpis">
        <h2 class="admin-kpis__title">
          ${t('admin.dashboard.kpis_title', 'Executive Financials & Growth Telemetry')}
        </h2>

        <div class="admin-kpis__grid">
          <!-- 1. GMV -->
          ${renderKpiCard('Gross Merchandise Value (GMV)', formatBdt(kpis.gmv?.value), kpis.gmv, '💰', 'Total platform order volume')}

          <!-- 2. Net Revenue -->
          ${renderKpiCard('Net Platform Revenue', formatBdt(kpis.net_platform_revenue?.value), kpis.net_platform_revenue, '📈', 'Platform commission & fee cut')}

          <!-- 3. Take Rate -->
          ${renderKpiCard('Take Rate (%)', `${kpis.take_rate?.value ?? 0}%`, kpis.take_rate, '⚡', 'Net Revenue / GMV')}

          <!-- 4. Active Sellers -->
          ${renderKpiCard('Active Sellers', kpis.active_sellers?.value, kpis.active_sellers, '🏪', 'Salers & Verified Suppliers')}

          <!-- 5. New Signups -->
          ${renderKpiCard('New Signups', kpis.new_signups?.value, kpis.new_signups, '👥', 'Total user registrations')}

          <!-- 6. Conversion Rate -->
          ${renderKpiCard('Conversion Rate', `${kpis.conversion_rate?.value ?? 0}%`, kpis.conversion_rate, '🎯', 'Visitors to paid orders')}

          <!-- 7. AOV -->
          ${renderKpiCard('Average Order Value (AOV)', formatBdt(kpis.aov?.value), kpis.aov, '🛒', 'Mean basket size')}

          <!-- 8. Escrow Liability -->
          ${renderKpiCard('Escrow Liability', formatBdt(kpis.escrow_liability?.value), kpis.escrow_liability, '🔒', 'Unreleased buyer funds')}

          <!-- 9. Pending Payouts -->
          ${renderKpiCard('Pending Payouts', formatBdt(kpis.pending_payout_liability?.value), kpis.pending_payout_liability, '💸', 'Requested seller cashouts')}

          <!-- 10. COD Exposure -->
          ${renderKpiCard('COD In-Transit Exposure', formatBdt(kpis.cod_exposure?.value), kpis.cod_exposure, '🚚', 'Courier cash remittance pipeline')}

          <!-- 11. Dispute Rate -->
          ${renderKpiCard('Dispute Rate', `${kpis.dispute_rate?.value ?? 0}%`, kpis.dispute_rate, '⚖️', 'Disputed orders / Total')}
        </div>
      </div>

      <!-- Charts & Channel Breakdown Section -->
      <div class="admin-analytics-row">
        <!-- SVG Trajectory Area Chart -->
        <div class="admin-chart-panel">
          <div class="admin-chart-panel__header">
            <div>
              <h3 class="admin-chart-panel__title">
                ${t('admin.dashboard.chart_title', 'Revenue & GMV Trajectory')}
              </h3>
              <p class="admin-chart-panel__subtitle">
                ${t('admin.dashboard.historical_trend', `Historical volume trends across selected ${currentTimeframe} period`, { timeframe: currentTimeframe })}
              </p>
            </div>
            <span class="admin-dashboard__badge">
              ${t('admin.dashboard.svg_badge', 'SVG Vector Chart')}
            </span>
          </div>

          ${renderChart(overviewData?.chart_data)}
        </div>

        <!-- Channel & Category Share Funnels -->
        <div class="admin-breakdowns">
          <!-- Sales Channel Share -->
          <div class="admin-breakdown-card">
            <div class="admin-breakdown-card__header">
              <h3 class="admin-breakdown-card__title">${t('admin.dashboard.channels_title', 'Sales Channels')}</h3>
              <span class="admin-breakdown-card__sub">${t('admin.dashboard.by_volume', 'By Volume')}</span>
            </div>

            <div class="admin-breakdown-card__list">
              ${(overviewData?.breakdown?.channels || []).map((ch) => `
                <div class="admin-breakdown-item">
                  <div class="admin-breakdown-item__row">
                    <span class="admin-breakdown-item__name">${ch.name}</span>
                    <span class="admin-breakdown-item__share">${ch.share_pct}%</span>
                  </div>
                  <div class="admin-breakdown-item__track">
                    <div class="admin-breakdown-item__bar" style="width: ${ch.share_pct}%;"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Top Categories Share -->
          <div class="admin-breakdown-card">
            <div class="admin-breakdown-card__header">
              <h3 class="admin-breakdown-card__title">${t('admin.dashboard.categories_title', 'Top Categories')}</h3>
              <span class="admin-breakdown-card__sub">${t('admin.dashboard.by_revenue', 'By Revenue')}</span>
            </div>

            <div class="admin-breakdown-card__list">
              ${(overviewData?.breakdown?.categories || []).map((cat) => `
                <div class="admin-breakdown-item">
                  <div class="admin-breakdown-item__row">
                    <span class="admin-breakdown-item__name">${cat.name}</span>
                    <span class="admin-breakdown-item__share" style="color: var(--success);">${cat.share_pct}%</span>
                  </div>
                  <div class="admin-breakdown-item__track">
                    <div class="admin-breakdown-item__bar admin-breakdown-item__bar--emerald" style="width: ${cat.share_pct}%;"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    // Render Action Buttons
    const rollupSlot = container.querySelector('#rollup-btn-slot');
    const healthSlot = container.querySelector('#health-btn-slot');

    if (rollupSlot) {
      const rollupBtn = Button({
        label: t('admin.dashboard.btn_rollup', '🔄 Nightly Rollup'),
        variant: 'secondary',
        size: 'sm',
        onClick: async () => {
          rollupBtn.disabled = true;
          rollupBtn.textContent = t('admin.dashboard.btn_rollup_loading', '⏳ Computing...');
          try {
            await adminApi.triggerRollup();
            toast.success('Calculated daily analytics summary!');
            await loadData();
          } catch {
            toast.error('Failed to trigger daily rollup.');
          } finally {
            rollupBtn.disabled = false;
            rollupBtn.textContent = t('admin.dashboard.btn_rollup', '🔄 Nightly Rollup');
          }
        },
      });
      rollupSlot.append(rollupBtn);
    }

    if (healthSlot) {
      const healthBtn = Button({
        label: t('admin.dashboard.btn_health', '🩺 System Health'),
        variant: 'primary',
        size: 'sm',
        onClick: () => nav('/admin/health'),
      });
      healthSlot.append(healthBtn);
    }

    // Bind timeframe buttons
    container.querySelectorAll('.admin-dashboard__tf-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tf = btn.getAttribute('data-tf');
        if (tf && tf !== currentTimeframe) {
          currentTimeframe = tf;
          loadData();
        }
      });
    });

    // Bind alert deep links
    container.querySelectorAll('.deep-link-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url');
        if (url) nav(url);
      });
    });

    root.appendChild(container);
  }

  function renderKpiCard(label, formattedVal, deltaObj = {}, icon = '📊', subtext = '') {
    const trend = deltaObj?.trend || 'neutral';
    const deltaPct = deltaObj?.delta_pct ?? 0;
    const isPos = trend === 'up';

    let badgeModifier = '';
    let symbol = '• ';
    if (isPos) {
      badgeModifier = 'admin-kpi-card__badge--up';
      symbol = '▲ +';
    } else if (trend === 'down') {
      badgeModifier = 'admin-kpi-card__badge--down';
      symbol = '▼ -';
    }

    return `
      <div class="admin-kpi-card">
        <div class="admin-kpi-card__top">
          <span class="admin-kpi-card__label">${label}</span>
          <span class="admin-kpi-card__icon" aria-hidden="true">${icon}</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div class="admin-kpi-card__value">
            ${formattedVal || '0'}
          </div>

          <div class="admin-kpi-card__delta">
            <span class="admin-kpi-card__badge ${badgeModifier}">
              ${symbol}${deltaPct}%
            </span>
            <span style="color: var(--text-muted); font-weight: 400;">${t('admin.dashboard.vs_prev', 'vs prev')}</span>
          </div>
        </div>

        ${subtext ? `<p class="admin-kpi-card__subtext">${subtext}</p>` : ''}
      </div>
    `;
  }

  loadData();
}
