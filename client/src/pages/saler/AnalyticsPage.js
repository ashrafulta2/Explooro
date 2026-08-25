/**
 * AnalyticsPage.js — Saler Sales, Profit, Traffic & Conversion Analytics (Prompt 11.2 / idea §AL.2).
 *
 * Implements:
 * 1. Time-range selector (7d, 30d, 90d).
 * 2. Pure inline SVG charts with zero external charting dependencies (Area/Line trends, Donut breakdown, Funnel).
 * 3. Exact reconciliation with sub-orders and double-entry wallet ledger.
 * 4. Top performing products and regional Bangladesh district distribution.
 *
 * Route: /saler/analytics
 */

import { salerApi } from '../../services/saler.api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function AnalyticsPage(root) {
  const container = document.createElement('div');
  container.className = 'saler-analytics-page container mx-auto p-4 md:p-6 space-y-6 max-w-7xl';

  let currentRange = '30d';

  // 1. Header & Time Range Controls
  const header = document.createElement('div');
  header.className = 'flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-subtle pb-5';

  const titleBox = document.createElement('div');
  titleBox.innerHTML = `
    <div class="flex items-center gap-2 mb-1">
      <a href="/saler" class="text-xs text-muted hover:text-primary transition-colors flex items-center gap-1 font-mono">
        ← ${t('saler.analytics.back_to_dashboard', 'Dashboard')}
      </a>
      <span class="text-xs text-muted">/</span>
      <span class="text-xs font-bold text-primary">${t('saler.analytics.title', 'Sales & Profit Analytics')}</span>
    </div>
    <h1 class="text-2xl font-bold tracking-tight text-foreground">${t('saler.analytics.title', 'Sales & Profit Analytics')}</h1>
    <p class="text-xs text-muted mt-1">
      ${t('saler.analytics.subtitle', 'Live revenue reconciliation, profit margins, conversion funnels, and traffic source attribution.')}
    </p>
  `;

  const controlsBox = document.createElement('div');
  controlsBox.className = 'flex items-center gap-2 bg-surface p-1 rounded-xl border border-subtle';

  ['7d', '30d', '90d'].forEach((range) => {
    const btn = document.createElement('button');
    btn.className = `px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
      currentRange === range ? 'bg-primary text-white shadow-xs' : 'text-muted hover:text-foreground'
    }`;
    btn.textContent = range === '7d' ? 'Last 7 Days' : range === '30d' ? 'Last 30 Days' : 'Last 90 Days';
    btn.onclick = () => {
      currentRange = range;
      Array.from(controlsBox.children).forEach((c) => {
        c.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all text-muted hover:text-foreground';
      });
      btn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all bg-primary text-white shadow-xs';
      fetchAndRender();
    };
    controlsBox.append(btn);
  });

  header.append(titleBox, controlsBox);
  container.append(header);

  // Content Slots
  const kpiSlot = document.createElement('div');
  kpiSlot.className = 'grid grid-cols-2 lg:grid-cols-4 gap-4';

  const chartsSlot = document.createElement('div');
  chartsSlot.className = 'grid grid-cols-1 lg:grid-cols-3 gap-6';

  const tablesSlot = document.createElement('div');
  tablesSlot.className = 'grid grid-cols-1 lg:grid-cols-3 gap-6';

  container.append(kpiSlot, chartsSlot, tablesSlot);
  root.append(container);

  async function fetchAndRender() {
    kpiSlot.innerHTML = '';
    chartsSlot.innerHTML = '';
    tablesSlot.innerHTML = '';

    // Skeletons
    for (let i = 0; i < 4; i++) {
      kpiSlot.append(Skeleton({ width: '100%', height: '90px' }));
    }
    chartsSlot.append(Skeleton({ width: '100%', height: '320px' }), Skeleton({ width: '100%', height: '320px' }));

    try {
      const res = await salerApi.getAnalytics({ range: currentRange });
      const data = res.data || {};

      kpiSlot.innerHTML = '';
      chartsSlot.innerHTML = '';
      tablesSlot.innerHTML = '';

      renderKpiCards(kpiSlot, data.summary);
      renderRevenueTrendChart(chartsSlot, data.trends, data.summary);
      renderTrafficDonutChart(chartsSlot, data.traffic_sources, data.summary);
      renderTopProductsTable(tablesSlot, data.top_products);
      renderRegionalDemandChart(tablesSlot, data.district_distribution);
    } catch (err) {
      kpiSlot.innerHTML = '';
      chartsSlot.innerHTML = '';
      tablesSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'col-span-full py-8 text-center text-danger';
      errBox.textContent = t('saler.analytics.load_failed', 'Failed to load analytics data.');
      container.append(errBox);
    }
  }

  fetchAndRender();

  return () => {
    container.remove();
  };
}

/**
 * 1. 4-Card Executive KPI Summary
 */
function renderKpiCards(container, summary = {}) {
  const gmv = Number(summary.total_gross_sales || 0);
  const profit = Number(summary.total_net_profit || 0);
  const orders = Number(summary.total_orders || 0);
  const conversionRate = Number(summary.conversion_rate_pct || 0);

  const kpis = [
    {
      title: t('saler.analytics.gross_sales', 'Total Gross Sales (GMV)'),
      value: formatCurrency(gmv),
      subtext: t('saler.analytics.gross_desc', 'Customer payments across all store orders'),
      icon: '🛍️',
      color: 'primary',
    },
    {
      title: t('saler.analytics.net_profit', 'Net Profit Margin'),
      value: formatCurrency(profit),
      subtext: t('saler.analytics.profit_desc', '100% reconciled with wallet ledger balance'),
      icon: '💎',
      color: 'success',
    },
    {
      title: t('saler.analytics.orders_completed', 'Orders Converted'),
      value: formatNumber(orders),
      subtext: t('saler.analytics.orders_desc', 'Completed wholesale dropship orders'),
      icon: '📦',
      color: 'neutral',
    },
    {
      title: t('saler.analytics.conversion_rate', 'Traffic Conversion Rate'),
      value: `${conversionRate}%`,
      subtext: `${formatNumber(summary.total_visitors || 0)} unique link & store visitors`,
      icon: '🎯',
      color: 'warning',
    },
  ];

  kpis.forEach((k) => {
    const card = document.createElement('div');
    card.className = 'p-4 rounded-2xl border border-subtle bg-surface shadow-xs space-y-2';
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-muted">${k.title}</span>
        <span class="text-base">${k.icon}</span>
      </div>
      <div class="text-xl font-extrabold text-foreground tracking-tight">${k.value}</div>
      <div class="text-[11px] text-muted leading-tight">${k.subtext}</div>
    `;
    container.append(card);
  });
}

/**
 * 2. Pure Inline SVG Multi-Line / Area Chart (Gross Sales vs. Net Profit)
 */
function renderRevenueTrendChart(container, trends = [], summary = {}) {
  const card = document.createElement('div');
  card.className = 'col-span-1 lg:col-span-2 rounded-2xl border border-subtle bg-surface p-5 shadow-xs space-y-4';

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between';
  header.innerHTML = `
    <div>
      <h3 class="text-sm font-bold text-foreground flex items-center gap-2">
        📈 ${t('saler.analytics.trend_title', 'Revenue & Profit Trajectory')}
      </h3>
      <p class="text-xs text-muted">${t('saler.analytics.trend_desc', 'Daily performance trend line with dual margin breakdown.')}</p>
    </div>
    <div class="flex items-center gap-3 text-xs">
      <span class="flex items-center gap-1.5 text-muted font-medium">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Gross GMV
      </span>
      <span class="flex items-center gap-1.5 text-muted font-medium">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-blue-600"></span> Net Profit
      </span>
    </div>
  `;
  card.append(header);

  if (trends.length === 0) {
    card.append(EmptyState({ title: 'No trend data yet', description: 'Trends will appear after your first sales.' }));
    container.append(card);
    return;
  }

  // Pure SVG Line Graph Construction
  const width = 600;
  const height = 240;
  const padLeft = 45;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxVal = Math.max(...trends.map((t) => Math.max(Number(t.gross_sales), Number(t.net_profit))), 500);

  const getX = (idx) => padLeft + (idx / Math.max(trends.length - 1, 1)) * chartW;
  const getY = (val) => padTop + chartH - (val / maxVal) * chartH;

  // Build SVG Paths
  let grossPoints = trends.map((t, idx) => `${getX(idx)},${getY(Number(t.gross_sales))}`).join(' ');
  let profitPoints = trends.map((t, idx) => `${getX(idx)},${getY(Number(t.net_profit))}`).join(' ');

  let grossArea = `M ${getX(0)},${padTop + chartH} L ${grossPoints} L ${getX(trends.length - 1)},${padTop + chartH} Z`;
  let profitArea = `M ${getX(0)},${padTop + chartH} L ${profitPoints} L ${getX(trends.length - 1)},${padTop + chartH} Z`;

  // Grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
    const y = padTop + chartH * (1 - frac);
    const val = Math.round(maxVal * frac);
    return `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="currentColor" stroke-opacity="0.08" stroke-dasharray="3,3" />
      <text x="${padLeft - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="currentColor" opacity="0.4" font-family="monospace">৳${val}</text>
    `;
  }).join('');

  // X Axis Dates
  const step = Math.ceil(trends.length / 6);
  const xLabels = trends.filter((_, i) => i % step === 0 || i === trends.length - 1).map((t) => {
    const idx = trends.indexOf(t);
    const x = getX(idx);
    return `<text x="${x}" y="${height - 10}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5" font-family="monospace">${t.label}</text>`;
  }).join('');

  // Dots
  const grossDots = trends.map((t, idx) => `
    <circle cx="${getX(idx)}" cy="${getY(Number(t.gross_sales))}" r="3" fill="#10B981" stroke="#fff" stroke-width="1.5">
      <title>${t.label}: Gross ৳${t.gross_sales}</title>
    </circle>
  `).join('');

  const profitDots = trends.map((t, idx) => `
    <circle cx="${getX(idx)}" cy="${getY(Number(t.net_profit))}" r="3" fill="#2563EB" stroke="#fff" stroke-width="1.5">
      <title>${t.label}: Net Profit ৳${t.net_profit}</title>
    </circle>
  `).join('');

  const svgWrap = document.createElement('div');
  svgWrap.className = 'w-full overflow-x-auto';
  svgWrap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto text-foreground" preserveAspectRatio="none">
      <defs>
        <linearGradient id="grossGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10B981" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#10B981" stop-opacity="0.0" />
        </linearGradient>
        <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2563EB" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#2563EB" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${grossArea}" fill="url(#grossGrad)" />
      <path d="${profitArea}" fill="url(#profitGrad)" />
      <polyline fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${grossPoints}" />
      <polyline fill="none" stroke="#2563EB" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${profitPoints}" />
      ${grossDots}
      ${profitDots}
      ${xLabels}
    </svg>
  `;

  card.append(svgWrap);
  container.append(card);
}

/**
 * 3. Pure Inline SVG Donut Chart (Traffic Sources)
 */
function renderTrafficDonutChart(container, sources = [], summary = {}) {
  const card = document.createElement('div');
  card.className = 'col-span-1 rounded-2xl border border-subtle bg-surface p-5 shadow-xs flex flex-col justify-between space-y-4';

  card.innerHTML = `
    <div>
      <h3 class="text-sm font-bold text-foreground flex items-center gap-2">
        🍩 ${t('saler.analytics.traffic_sources', 'Traffic Attribution')}
      </h3>
      <p class="text-xs text-muted">${t('saler.analytics.traffic_desc', 'Where your storefront visitors & orders originate.')}</p>
    </div>
  `;

  // WHY `?? 0` and not `|| 100`: the fallback made a saler with no tracked traffic read
  // "Total Clicks 100" in the middle of a donut whose slices were all 0% — a number with no source.
  const totalVisitors = summary.total_visitors ?? 0;

  // Donut SVG Math
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let accumulatedPercent = 0;

  const circles = sources.map((s) => {
    const strokeDasharray = `${(s.percentage / 100) * circumference} ${circumference}`;
    const strokeDashoffset = -((accumulatedPercent / 100) * circumference);
    accumulatedPercent += s.percentage;

    return `
      <circle cx="60" cy="60" r="${radius}" fill="none" stroke="${s.color}" stroke-width="15"
        stroke-dasharray="${strokeDasharray}" stroke-dashoffset="${strokeDashoffset}" stroke-linecap="round" class="transition-all duration-500">
        <title>${s.source}: ${s.percentage}%</title>
      </circle>
    `;
  }).join('');

  const donutWrap = document.createElement('div');
  donutWrap.className = 'flex flex-col items-center justify-center py-2';
  donutWrap.innerHTML = `
    <div class="relative w-36 h-36 flex items-center justify-center">
      <svg viewBox="0 0 120 120" class="w-full h-full transform -rotate-90">
        <circle cx="60" cy="60" r="${radius}" fill="none" stroke="currentColor" stroke-opacity="0.05" stroke-width="15" />
        ${circles}
      </svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span class="text-xs text-muted font-mono">Total Clicks</span>
        <span class="text-base font-extrabold text-foreground">${formatNumber(totalVisitors)}</span>
      </div>
    </div>
  `;

  // Legend
  const legend = document.createElement('div');
  legend.className = 'space-y-2 pt-2 border-t border-subtle';
  sources.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between text-xs';
    item.innerHTML = `
      <span class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${s.color};"></span>
        <span class="font-medium text-foreground">${s.source}</span>
      </span>
      <span class="font-mono font-bold text-muted">${s.percentage}%</span>
    `;
    legend.append(item);
  });

  card.append(donutWrap, legend);
  container.append(card);
}

/**
 * 4. Top Performing Products Leaderboard Table
 */
function renderTopProductsTable(container, products = []) {
  const card = document.createElement('div');
  card.className = 'col-span-1 lg:col-span-2 rounded-2xl border border-subtle bg-surface p-5 shadow-xs space-y-4';

  card.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-sm font-bold text-foreground flex items-center gap-2">
          🏆 ${t('saler.analytics.top_products', 'Top Performing Products')}
        </h3>
        <p class="text-xs text-muted">${t('saler.analytics.top_products_desc', 'Ranked by customer sales volume and total margin earned.')}</p>
      </div>
      <a href="/saler/sourcing" class="text-xs text-primary font-bold hover:underline">
        + ${t('saler.analytics.source_more', 'Source More')}
      </a>
    </div>
  `;

  if (products.length === 0) {
    card.append(EmptyState({
      title: 'No sold products in this period',
      description: 'Your top curated products will be ranked here as customer orders arrive.',
    }));
    container.append(card);
    return;
  }

  const tableWrap = document.createElement('div');
  tableWrap.className = 'overflow-x-auto';
  tableWrap.innerHTML = `
    <table class="w-full text-left text-xs">
      <thead>
        <tr class="border-b border-subtle text-muted uppercase tracking-wider font-mono text-[10px]">
          <th class="pb-2">Product Title</th>
          <th class="pb-2 text-right">Units Sold</th>
          <th class="pb-2 text-right">Retail Price</th>
          <th class="pb-2 text-right">Profit Earned</th>
          <th class="pb-2 text-right">Stock</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-subtle">
        ${products.map((p) => `
          <tr class="hover:bg-subtle/20 transition-colors">
            <td class="py-2.5 pr-2 font-bold text-foreground line-clamp-1 max-w-[220px]">
              ${p.title_en}
            </td>
            <td class="py-2.5 text-right font-mono font-bold text-foreground">
              ${p.units_sold}
            </td>
            <td class="py-2.5 text-right font-mono text-muted">
              ${formatCurrency(p.custom_retail_price || p.default_retail_price)}
            </td>
            <td class="py-2.5 text-right font-mono font-extrabold text-emerald-600">
              +${formatCurrency(p.total_margin_earned)}
            </td>
            <td class="py-2.5 text-right">
              <span class="badge badge--${p.stock_qty > 10 ? 'success' : p.stock_qty > 0 ? 'warning' : 'danger'} text-[10px]">
                ${p.stock_qty} left
              </span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  card.append(tableWrap);
  container.append(card);
}

/**
 * 5. Regional Bangladesh District Distribution Bar Breakdown
 */
function renderRegionalDemandChart(container, districts = []) {
  const card = document.createElement('div');
  card.className = 'col-span-1 rounded-2xl border border-subtle bg-surface p-5 shadow-xs space-y-4';

  card.innerHTML = `
    <div>
      <h3 class="text-sm font-bold text-foreground flex items-center gap-2">
        📍 ${t('saler.analytics.regional_demand', 'Geographic Distribution')}
      </h3>
      <p class="text-xs text-muted">${t('saler.analytics.regional_desc', 'Top Bangladesh customer delivery districts.')}</p>
    </div>
  `;

  if (districts.length === 0) {
    card.append(EmptyState({
      title: 'No regional sales yet',
      description: 'District delivery breakdown will populate after completed orders.',
    }));
    container.append(card);
    return;
  }

  const maxOrders = Math.max(...districts.map((d) => d.order_count), 1);

  const list = document.createElement('div');
  list.className = 'space-y-3 pt-1';

  districts.forEach((d) => {
    const pct = Math.round((d.order_count / maxOrders) * 100);
    const row = document.createElement('div');
    row.className = 'space-y-1';
    row.innerHTML = `
      <div class="flex items-center justify-between text-xs">
        <span class="font-bold text-foreground">${d.district}</span>
        <span class="font-mono text-muted">${d.order_count} orders (${formatCurrency(d.gmv)})</span>
      </div>
      <div class="w-full bg-subtle/40 h-2 rounded-full overflow-hidden">
        <div class="bg-primary h-full rounded-full transition-all duration-500" style="width: ${pct}%;"></div>
      </div>
    `;
    list.append(row);
  });

  card.append(list);
  container.append(card);
}
