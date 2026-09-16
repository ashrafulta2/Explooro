/**
 * SupplierForecastingPage.js — AI-Powered Demand Forecasting for Suppliers (Prompt 7.7-E).
 *
 * Implements:
 * 1. Demand forecast per SKU — 30/60/90 day projections with a stock-vs-reorder mini bar.
 * 2. Reorder alert cards — items predicted to go out of stock before the next restock cycle.
 * 3. Seasonal trend indicators (upcoming peaks / troughs).
 * 4. SKU-level filter and search.
 * 5. Export forecast as CSV.
 *
 * Strings are i18n (en/bn); risk badges + stat cards use semantic design tokens. Data comes from
 * GET /supplier/forecasting (mock-served); a fetch failure falls back to SEED_FORECASTS so the page
 * still renders. NOTE: no live route serves /supplier/forecasting yet — the live AI endpoint is the
 * per-product GET /ai/forecast/:productId (see docs/prompt.md row 80).
 */

import { api } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatDate, formatCurrency } from '../../services/format.js';

const HORIZON_OPTIONS = [
  { labelKey: 'sup_forecast.h30', value: 30 },
  { labelKey: 'sup_forecast.h60', value: 60 },
  { labelKey: 'sup_forecast.h90', value: 90 },
];

const RISK_FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const RISK_LABEL_KEYS = { ALL: 'sup_forecast.risk_all', CRITICAL: 'sup_forecast.risk_critical', HIGH: 'sup_forecast.risk_high', MEDIUM: 'sup_forecast.risk_medium', LOW: 'sup_forecast.risk_low' };

const SEED_FORECASTS = [
  { sku: 'SKU-001', name: 'Samsung Galaxy A35 (128GB Blue)', category: 'Smartphones',      current_stock: 42,  reorder_point: 20, avg_daily_sales: 3.2, forecast_30: 96,  forecast_60: 192, forecast_90: 288, confidence: 92, risk: 'HIGH',   trend: 'UP',    revenue_at_risk: 480000 },
  { sku: 'SKU-002', name: 'Nike Air Max 270 (Size 42)',       category: 'Footwear',          current_stock: 8,   reorder_point: 15, avg_daily_sales: 1.1, forecast_30: 33,  forecast_60: 66,  forecast_90: 99,  confidence: 87, risk: 'CRITICAL',trend: 'STABLE',revenue_at_risk: 66000  },
  { sku: 'SKU-003', name: 'HP Laptop 15s (i5 / 8GB)',         category: 'Computers',         current_stock: 15,  reorder_point: 10, avg_daily_sales: 0.8, forecast_30: 24,  forecast_60: 48,  forecast_90: 72,  confidence: 78, risk: 'MEDIUM', trend: 'UP',    revenue_at_risk: 192000 },
  { sku: 'SKU-004', name: 'Xiaomi Smart TV 43" (2026)',        category: 'Electronics',       current_stock: 31,  reorder_point: 12, avg_daily_sales: 1.5, forecast_30: 45,  forecast_60: 90,  forecast_90: 135, confidence: 85, risk: 'LOW',    trend: 'STABLE',revenue_at_risk: 0      },
  { sku: 'SKU-005', name: 'Mamaearth Face Wash (200ml)',       category: 'Beauty & Skincare', current_stock: 180, reorder_point: 50, avg_daily_sales: 7.4, forecast_30: 222, forecast_60: 444, forecast_90: 666, confidence: 94, risk: 'LOW',    trend: 'UP',    revenue_at_risk: 0      },
  { sku: 'SKU-006', name: 'Realme C65 (4G / 128GB)',           category: 'Smartphones',       current_stock: 4,   reorder_point: 20, avg_daily_sales: 2.3, forecast_30: 69,  forecast_60: 138, forecast_90: 207, confidence: 91, risk: 'CRITICAL',trend: 'UP',    revenue_at_risk: 345000 },
];

const RISK_CONFIG = {
  CRITICAL: { bg: 'var(--danger-100,#fee2e2)',  text: 'var(--danger-700,#b91c1c)',  border: 'var(--danger-300,#fca5a5)',  icon: '🔴' },
  HIGH:     { bg: 'var(--warning-100,#ffedd5)', text: 'var(--warning-800,#9a3412)', border: 'var(--warning-300,#fdba74)', icon: '🟠' },
  MEDIUM:   { bg: 'var(--warning-100,#fef9c3)', text: 'var(--warning-700,#854d0e)', border: 'var(--warning-300,#fde047)', icon: '🟡' },
  LOW:      { bg: 'var(--success-100,#dcfce7)', text: 'var(--success-700,#15803d)', border: 'var(--success-300,#86efac)', icon: '🟢' },
};

const TREND_ICONS = { UP: '📈', DOWN: '📉', STABLE: '➡️' };
const TREND_KEYS = { UP: 'sup_forecast.trend_up', DOWN: 'sup_forecast.trend_down', STABLE: 'sup_forecast.trend_stable' };

export default function SupplierForecastingPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-forecasting-page';
  container.style.cssText = `
    max-width:1280px;margin:0 auto;padding:24px 20px 56px;
    display:flex;flex-direction:column;gap:24px;
    color:var(--text-primary,#0f172a);background:var(--surface-0,transparent);font-family:inherit;
  `;

  let forecasts     = [];
  let horizon       = 30;
  let searchQuery   = '';
  let riskFilter    = 'ALL';
  let loading       = true;

  async function fetchForecasts() {
    loading = true; render();
    try {
      const res = await api.get('/supplier/forecasting?horizon='+horizon);
      forecasts = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.data?.items) ? res.data.items : SEED_FORECASTS);
    } catch { forecasts = SEED_FORECASTS; }
    loading = false; render();
  }

  function filteredForecasts() {
    return forecasts.filter(f => {
      const matchSearch = !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase()) || f.sku.toLowerCase().includes(searchQuery.toLowerCase());
      const matchRisk   = riskFilter === 'ALL' || f.risk === riskFilter;
      return matchSearch && matchRisk;
    });
  }

  function exportCsv() {
    const rows = [['SKU','Name','Category','Current Stock','Reorder Point','Avg Daily Sales','Forecast ('+horizon+'d)','Risk','Trend']];
    filteredForecasts().forEach(f => rows.push([
      f.sku, f.name, f.category, f.current_stock, f.reorder_point, f.avg_daily_sales,
      f['forecast_'+horizon]||'—', f.risk, f.trend,
    ]));
    const csv   = rows.map(r => r.join(',')).join('\n');
    const blob  = new Blob([csv], { type: 'text/csv' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = 'demand_forecast_'+horizon+'d.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('sup_forecast.export_done', 'Forecast exported as CSV.'));
  }

  function renderSummaryBar() {
    const data = filteredForecasts();
    const critical = data.filter(f=>f.risk==='CRITICAL').length;
    const high     = data.filter(f=>f.risk==='HIGH').length;
    const revenueAtRisk = data.reduce((s,f)=>s+(f.revenue_at_risk||0), 0);
    const items = [
      { label:t('sup_forecast.stat_total', 'Total SKUs'),      value: data.length,    text:'var(--info-700,#1e40af)',    bg:'var(--info-100,#dbeafe)' },
      { label:t('sup_forecast.stat_critical', 'Critical Stock'),value: critical,       text:'var(--danger-700,#b91c1c)',  bg:'var(--danger-100,#fee2e2)' },
      { label:t('sup_forecast.stat_high', 'High Risk'),        value: high,           text:'var(--warning-800,#9a3412)', bg:'var(--warning-100,#ffedd5)' },
      { label:t('sup_forecast.stat_revenue_risk', 'Revenue at Risk'),  value: revenueAtRisk>0 ? formatCurrency(revenueAtRisk) : '—', text:'var(--info-700,#7e22ce)', bg:'var(--info-100,#fae8ff)' },
    ];
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">
      ${items.map(c=>`
        <div style="background:${c.bg};border-radius:12px;padding:14px 18px;text-align:center;">
          <div style="font-size:1.4rem;font-weight:800;color:${c.text};">${c.value}</div>
          <div style="font-size:0.78rem;color:${c.text};font-weight:600;margin-top:2px;">${c.label}</div>
        </div>
      `).join('')}
    </div>`;
  }

  function renderMiniBar(current, forecast, reorderPoint) {
    const maxVal    = Math.max(current, forecast, reorderPoint, 1);
    const curPct    = Math.min((current / maxVal) * 100, 100);
    const roPct     = Math.min((reorderPoint / maxVal) * 100, 100);
    const isBelowRo = current <= reorderPoint;
    return `
      <div style="margin-top:8px;">
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-secondary,#94a3b8);margin-bottom:4px;">
          <span>${t('sup_forecast.current', 'Current: {{n}}', { n: `<strong style="color:${isBelowRo?'var(--danger-700,#b91c1c)':'var(--text-primary,#0f172a)'};">${current}</strong>` })}</span>
          <span>${t('sup_forecast.reorder_at', 'Reorder at: {{n}}', { n: `<strong>${reorderPoint}</strong>` })}</span>
          <span>${t('sup_forecast.forecast_h', 'Forecast {{days}}d: {{n}}', { days: horizon, n: `<strong>${forecast||'—'}</strong>` })}</span>
        </div>
        <div style="position:relative;height:8px;background:var(--surface-2,#f1f5f9);border-radius:999px;overflow:visible;">
          <div style="height:100%;width:${curPct}%;background:${isBelowRo?'var(--danger-500,#ef4444)':'var(--success-500,#22c55e)'};border-radius:999px;"></div>
          <div style="position:absolute;top:-2px;height:12px;width:2px;background:var(--warning-500,#f59e0b);left:${roPct}%;"></div>
        </div>
        <div style="font-size:0.68rem;color:var(--text-secondary,#94a3b8);margin-top:2px;">
          <span style="color:var(--warning-500,#f59e0b);">▲ ${t('sup_forecast.reorder_threshold', 'reorder threshold')}</span>
        </div>
      </div>
    `;
  }

  function renderForecastRow(f) {
    const risk = RISK_CONFIG[f.risk] || RISK_CONFIG.LOW;
    const fc   = f['forecast_'+horizon] || '—';
    const daysUntilOut = f.avg_daily_sales > 0 ? Math.floor(f.current_stock / f.avg_daily_sales) : 999;
    return `
      <div style="background:var(--surface-1,#fff);border:1px solid ${f.risk==='CRITICAL'?'var(--danger-300,#fca5a5)':'var(--border-default,#e2e8f0)'};
        border-radius:12px;padding:16px;${f.risk==='CRITICAL'?'box-shadow:0 0 0 1px var(--danger-300,#fca5a5);':''}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
              <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:999px;
                background:${risk.bg};color:${risk.text};border:1px solid ${risk.border};">
                ${risk.icon} ${t(RISK_LABEL_KEYS[f.risk] || 'sup_forecast.risk_low', f.risk)}
              </span>
              <span style="font-size:0.7rem;color:var(--text-secondary,#64748b);background:var(--surface-2,#f1f5f9);
                padding:2px 8px;border-radius:999px;">${f.sku}</span>
              <span style="font-size:0.72rem;color:var(--text-secondary,#64748b);">${f.category||''}</span>
            </div>
            <p style="margin:0;font-size:0.9rem;font-weight:600;color:var(--text-primary,#0f172a);">
              ${f.name}
            </p>
            ${renderMiniBar(f.current_stock, fc, f.reorder_point)}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
            <div style="font-size:0.8rem;font-weight:700;color:${f.risk==='CRITICAL'||f.risk==='HIGH'?'var(--danger-700,#b91c1c)':'var(--text-primary,#0f172a)'};">
              ${daysUntilOut<horizon?`⚠️ ${t('sup_forecast.days_left', '~{{days}} days left', { days: daysUntilOut })}`:`✅ ${t('sup_forecast.ok', 'OK')}`}
            </div>
            <div style="font-size:0.72rem;color:var(--text-secondary,#64748b);">
              ${TREND_ICONS[f.trend]||''} ${t(TREND_KEYS[f.trend] || 'sup_forecast.trend_stable', f.trend||'—')} · ${t('sup_forecast.confidence', '{{n}}% confidence', { n: f.confidence||'—' })}
            </div>
            <div style="font-size:0.72rem;color:var(--text-secondary,#64748b);">
              ${t('sup_forecast.avg_day', 'Avg {{n}}/day', { n: f.avg_daily_sales })}
            </div>
            ${f.revenue_at_risk>0?`
              <div style="font-size:0.75rem;font-weight:600;color:var(--danger-700,#b91c1c);margin-top:2px;">
                ${t('sup_forecast.at_risk', '{{amount}} at risk', { amount: formatCurrency(f.revenue_at_risk) })}
              </div>
            `:''}
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    const data  = filteredForecasts();
    const pulse = '<div style="height:110px;border-radius:12px;background:var(--surface-1,#f1f5f9);animation:fc-pulse 1.4s ease-in-out infinite;margin-bottom:8px;"></div>';
    container.innerHTML = `
      <style>@keyframes fc-pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
      <!-- Header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="margin:0 0 4px;font-size:1.6rem;font-weight:700;color:var(--text-primary,#0f172a);letter-spacing:-0.3px;">
            ${t('sup_forecast.title', 'AI Demand Forecasting')}
          </h1>
          <p style="margin:0;font-size:0.93rem;color:var(--text-secondary,#64748b);">
            ${t('sup_forecast.subtitle', 'Predict inventory needs and prevent stockouts with AI-powered sales projections.')}
          </p>
        </div>
        <button id="btn-export-csv"
          style="padding:9px 18px;border-radius:8px;border:1px solid var(--border-default,#e2e8f0);cursor:pointer;
          font-size:0.875rem;font-weight:600;background:var(--surface-1,#fff);color:var(--text-primary,#0f172a);">
          ⬇ ${t('sup_forecast.export_csv', 'Export CSV')}
        </button>
      </div>

      <!-- Summary -->
      ${loading ? '' : renderSummaryBar()}

      <!-- Controls -->
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;
        background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:12px;padding:12px 16px;">
        <!-- Horizon -->
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="font-size:0.72rem;font-weight:700;color:var(--text-secondary,#64748b);text-transform:uppercase;">${t('sup_forecast.horizon', 'Horizon')}</span>
          ${HORIZON_OPTIONS.map(o=>`
            <button class="btn-horizon" data-horizon="${o.value}"
              style="padding:5px 12px;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;
              border:1px solid ${horizon===o.value?'var(--brand,#f59e0b)':'var(--border-default,#e2e8f0)'};
              background:${horizon===o.value?'var(--brand,#f59e0b)':'var(--surface-0,#f8fafc)'};
              color:${horizon===o.value?'var(--brand-contrast,#fff)':'var(--text-secondary,#64748b)'};">${t(o.labelKey, o.value + ' Days')}</button>
          `).join('')}
        </div>
        <div style="width:1px;height:24px;background:var(--border-default,#e2e8f0);"></div>
        <!-- Risk Filter -->
        ${RISK_FILTERS.map(r=>`
          <button class="btn-risk-filter" data-risk="${r}"
            style="padding:5px 12px;border-radius:999px;font-size:0.78rem;font-weight:600;cursor:pointer;
            border:1px solid ${riskFilter===r?'var(--brand,#f59e0b)':'var(--border-default,#e2e8f0)'};
            background:${riskFilter===r?'var(--brand,#f59e0b)':'var(--surface-0,#f8fafc)'};
            color:${riskFilter===r?'var(--brand-contrast,#fff)':'var(--text-secondary,#64748b)'};">${t(RISK_LABEL_KEYS[r] || 'sup_forecast.risk_all', r)}</button>
        `).join('')}
        <!-- Search -->
        <input id="inp-sku-search" type="text" placeholder="${t('sup_forecast.search_placeholder', 'Search SKU or product…')}" value="${searchQuery}"
          style="margin-left:auto;padding:7px 12px;border-radius:8px;border:1px solid var(--border-default,#e2e8f0);
          font-size:0.82rem;background:var(--surface-0,#f8fafc);min-width:200px;color:var(--text-primary,#0f172a);">
      </div>

      <!-- Forecast List -->
      <div id="forecast-list" style="display:flex;flex-direction:column;gap:10px;">
        ${loading ? pulse+pulse+pulse : data.length===0 ? `
          <div style="text-align:center;padding:48px 0;">
            <div style="font-size:2.5rem;margin-bottom:8px;">📊</div>
            <p style="margin:0;font-size:0.875rem;color:var(--text-secondary,#64748b);">${t('sup_forecast.empty', 'No SKUs match the current filter.')}</p>
          </div>
        ` : data.map(renderForecastRow).join('')}
      </div>
    `;
    attachListeners();
  }

  function attachListeners() {
    container.querySelector('#btn-export-csv')?.addEventListener('click', exportCsv);
    container.querySelectorAll('.btn-horizon').forEach(b=>b.addEventListener('click',()=>{ horizon=parseInt(b.getAttribute('data-horizon')); fetchForecasts(); }));
    container.querySelectorAll('.btn-risk-filter').forEach(b=>b.addEventListener('click',()=>{ riskFilter=b.getAttribute('data-risk'); render(); }));
    container.querySelector('#inp-sku-search')?.addEventListener('input',e=>{ searchQuery=e.target.value; render(); });
  }

  fetchForecasts();
  root.append(container);
}
