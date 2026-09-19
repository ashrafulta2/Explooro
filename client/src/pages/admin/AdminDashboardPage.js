/**
 * AdminDashboardPage.js — Super Admin Executive Cockpit & Analytics (Prompt 11.4 / Master Spec §AL.4).
 *
 * What this page does:
 *  1. 11 executive KPIs in three groups, each a drill-through link, with a period-over-period delta
 *     whose colour reflects what the move MEANS (a falling dispute rate is green), not just its sign.
 *  2. Operational alert cards — searchable, filterable by severity, worst-first, each with a
 *     one-click CTA into its remedy page.
 *  3. A dual-axis GMV / net-revenue chart in plain inline SVG: hover or arrow-key a point for a
 *     tooltip, toggle either series, long ranges are bucketed so a year stays legible.
 *  4. Timeframe presets plus a validated custom date range.
 *  5. Refresh, optional 60s auto-refresh, audited CSV export and an audited "recompute rollup
 *     for date X" dialog — the last two hidden unless the viewer holds the permission.
 *  6. Loading skeletons, per-region error states with retry, and an explicit banner when the
 *     numbers are placeholders because no rollup has ever run.
 *
 * Structure: the shell is built once per language (so the search box keeps focus while typing) and
 * each region — meta, alerts, KPIs, chart, breakdowns — re-renders on its own. Every rule that can
 * be wrong without anyone noticing (delta polarity, bucketing, range validation, CSV escaping)
 * lives in services/adminDashboard.model.js where it is unit-tested.
 */

import { adminApi } from '../../services/admin.api.js';
import { pickMessage } from '../../core/api.js';
import { t, getLanguage, subscribe as subscribeLanguage } from '../../services/i18n.js';
import { formatNumber, formatDate, formatRelativeTime } from '../../services/format.js';
import { can } from '../../services/permissions.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Switch } from '../../components/ui/Switch.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { ICONS } from '../../components/ui/icons.js';
import { loadAdminCockpitStyles } from '../../styles/loadAdminCockpitStyles.js';
import {
  AUTO_REFRESH_MS,
  KPI_GROUPS,
  SEVERITIES,
  TIMEFRAMES,
  bucketSeries,
  buildChartModel,
  buildDashboardCsv,
  deltaTone,
  esc,
  filterAlerts,
  formatCompactBdt,
  formatDayLabel,
  formatDecimal,
  formatFullBdt,
  formatKpiValue,
  formatPointRange,
  nearestIndex,
  normalizeAlert,
  safeInternalPath,
  severityCounts,
  sortAlerts,
  summariseSeries,
  validateCustomRange,
} from '../../services/adminDashboard.model.js';

const AUTO_REFRESH_KEY = 'explooro:admin-dashboard:auto-refresh';
const PERM_ROLLUP = 'admin.analytics.rollup';
const PERM_EXPORT = 'admin.analytics.export';

const readAutoRefresh = () => {
  try {
    return localStorage.getItem(AUTO_REFRESH_KEY) === '1';
  } catch {
    return false; // storage blocked — the toggle still works for this visit
  }
};
const writeAutoRefresh = (on) => {
  try {
    localStorage.setItem(AUTO_REFRESH_KEY, on ? '1' : '0');
  } catch {
    // A remembered toggle is a convenience, not a guarantee.
  }
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Icon as a DOM node, for the Button component's `iconLeft` / `iconRight` slots. */
function iconEl(name) {
  const span = document.createElement('span');
  span.innerHTML = ICONS[name] || '';
  return span;
}

export default function AdminDashboardPage(root, { navigate } = {}) {
  loadAdminCockpitStyles();
  const isBn = () => getLanguage() === 'bn';
  // Picks `<field>_bn` or `<field>_en` for the active locale, falling back to the other one.
  const loc = (obj, field) =>
    (isBn() ? obj?.[`${field}_bn`] || obj?.[`${field}_en`] : obj?.[`${field}_en`] || obj?.[`${field}_bn`]) ?? '';
  const tr = (key, params) => t(`admin.dashboard.${key}`, params);
  const num = (n) => formatNumber(Number(n) || 0);

  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    timeframe: '30d', // '7d' | '30d' | '90d' | '1y' | 'custom'
    custom: { from: isoDaysAgo(29), to: isoToday() },
    rangeOpen: false,
    rangeError: '',
    overview: null,
    overviewStatus: 'loading', // 'loading' | 'ready' | 'error'
    alerts: [],
    alertsLoaded: false,
    alertsStatus: 'loading',
    query: '',
    severity: 'ALL',
    showCleared: false,
    show: { gmv: true, revenue: true },
    autoRefresh: readAutoRefresh(),
    refreshing: false,
  };

  let els = {};
  let overviewSeq = 0; // a slow reply for an old timeframe must never overwrite a newer one
  let alertsSeq = 0;
  let autoTimer = null;
  let resizeObserver = null;
  let searchTimer = null;
  let chartModel = null;
  let chartPoints = [];
  let lastChartWidth = 0;
  let disposed = false;

  const currentRange = () =>
    state.timeframe === 'custom' ? { from: state.custom.from, to: state.custom.to } : state.timeframe;

  // ── Data ─────────────────────────────────────────────────────────────────
  async function loadOverview() {
    const seq = ++overviewSeq;
    // 'loading' with data already on screen is a soft refresh: the regions dim instead of blanking.
    state.overviewStatus = 'loading';
    renderKpis();
    renderChart();
    try {
      const res = await adminApi.getOverview(currentRange());
      if (disposed || seq !== overviewSeq) return;
      state.overview = res?.data || {};
      state.overviewStatus = 'ready';
    } catch (err) {
      if (disposed || seq !== overviewSeq) return;
      // Keep the last good figures on screen if we have them; only a cold failure blanks the region.
      state.overviewStatus = state.overview ? 'ready' : 'error';
      toast.error(err?.message_en || err?.message_bn ? pickMessage(err) : tr('load_failed'));
    }
    renderMeta();
    renderKpis();
    renderChart();
    renderBreakdowns();
  }

  async function loadAlerts() {
    const seq = ++alertsSeq;
    if (!state.alertsLoaded) state.alertsStatus = 'loading';
    renderAlerts();
    try {
      const res = await adminApi.getAlerts();
      if (disposed || seq !== alertsSeq) return;
      state.alerts = sortAlerts((res?.data?.alerts || []).map(normalizeAlert));
      state.alertsLoaded = true;
      state.alertsStatus = 'ready';
    } catch (err) {
      if (disposed || seq !== alertsSeq) return;
      state.alertsStatus = state.alertsLoaded ? 'ready' : 'error';
      toast.error(err?.message_en || err?.message_bn ? pickMessage(err) : tr('load_failed'));
    }
    renderAlerts();
  }

  async function refreshAll({ announce = false } = {}) {
    if (state.refreshing) return;
    state.refreshing = true;
    els.refreshBtn?.setLoading(true);
    await Promise.all([loadOverview(), loadAlerts()]);
    state.refreshing = false;
    els.refreshBtn?.setLoading(false);
    if (announce && !disposed) toast.success(tr('refreshed'));
  }

  function syncAutoRefresh() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    if (!state.autoRefresh) return;
    autoTimer = setInterval(() => {
      // Skip while the tab is hidden or a dialog is open — no point re-fetching under a modal.
      if (document.hidden || document.querySelector('dialog[open]')) return;
      refreshAll();
    }, AUTO_REFRESH_MS);
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  function selectTimeframe(tf) {
    if (tf === 'custom') {
      state.rangeOpen = !state.rangeOpen;
      renderToolbarState();
      if (state.rangeOpen) els.fromInput?.focus();
      return;
    }
    state.rangeOpen = false;
    state.rangeError = '';
    if (tf === state.timeframe) {
      renderToolbarState();
      return;
    }
    state.timeframe = tf;
    renderToolbarState();
    loadOverview();
  }

  function applyCustomRange() {
    const from = els.fromInput?.value || '';
    const to = els.toInput?.value || '';
    const check = validateCustomRange(from, to);
    if (!check.ok) {
      state.rangeError = check.error;
      renderToolbarState();
      return;
    }
    state.rangeError = '';
    state.custom = { from, to };
    state.timeframe = 'custom';
    renderToolbarState();
    loadOverview();
  }

  async function exportCsv() {
    els.exportBtn?.setLoading(true);
    try {
      const res = await adminApi.exportOverview(currentRange());
      const data = res?.data || {};
      const lang = getLanguage();
      const kpiRows = KPI_GROUPS.flatMap((g) => g.kpis).map((def) => {
        const k = data.kpis?.[def.key] || {};
        return { label: tr(`kpi_${def.key}_label`), value: k.value ?? 0, delta_pct: k.delta_pct ?? 0, trend: k.trend || 'neutral' };
      });
      const csv = buildDashboardCsv({
        kpiRows,
        series: data.chart_data || [],
        labels: {
          kpiHeader: [tr('csv_kpi'), tr('csv_value'), tr('csv_change'), tr('csv_trend')],
          seriesHeader: [tr('csv_date'), tr('csv_gmv'), tr('csv_revenue'), tr('csv_orders')],
        },
      });
      // BOM so Excel opens the Bangla labels as UTF-8 instead of mojibake.
      const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `explooro-executive-${data.period?.from || 'from'}_${data.period?.to || 'to'}-${lang}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(tr('export_done', { count: num(kpiRows.length + (data.chart_data?.length || 0)) }));
    } catch (err) {
      toast.error(err?.message_en || err?.message_bn ? pickMessage(err) : tr('export_failed'));
    } finally {
      els.exportBtn?.setLoading(false);
    }
  }

  function openRollupDialog(trigger = null) {
    const content = document.createElement('div');
    content.className = 'admin-rollup-dialog';
    const desc = document.createElement('p');
    desc.className = 'admin-rollup-dialog__desc';
    desc.textContent = tr('rollup_desc');
    const dateField = Input({
      label: tr('rollup_date_label'),
      hint: tr('rollup_date_hint'),
      type: 'date',
      value: isoDaysAgo(1),
    });
    dateField.input.max = isoToday();
    const err = document.createElement('p');
    err.className = 'admin-range__error';
    err.setAttribute('role', 'alert');
    err.hidden = true;
    content.append(desc, dateField, err);

    const footer = document.createElement('div');
    footer.className = 'admin-rollup-dialog__footer';
    const cancelBtn = Button({ label: tr('rollup_cancel'), variant: 'secondary', onClick: () => modal.closeModal() });
    const runBtn = Button({
      label: tr('rollup_run'),
      variant: 'primary',
      onClick: async () => {
        const value = dateField.input.value;
        if (!value || value > isoToday() || Number.isNaN(Date.parse(value))) {
          err.textContent = tr('rollup_date_invalid');
          err.hidden = false;
          dateField.input.focus();
          return;
        }
        err.hidden = true;
        runBtn.setLoading(true);
        try {
          const res = await adminApi.triggerRollup(value);
          toast.success(tr('rollup_success', { date: res?.data?.rollup_date || value }));
          modal.closeModal();
          await refreshAll();
        } catch (e) {
          err.textContent = e?.message_en || e?.message_bn ? pickMessage(e) : tr('rollup_failed');
          err.hidden = false;
        } finally {
          runBtn.setLoading(false);
        }
      },
    });
    footer.append(cancelBtn, runBtn);

    const modal = Modal({
      title: tr('rollup_title'),
      content,
      footer,
      size: 'sm',
      important: true,
      closeLabel: tr('rollup_cancel'),
      onClose: () => modal.remove(),
    });
    modal.openModal(trigger);
  }

  /** Redraws only when the container really changed width, so the panel's own height change cannot loop. */
  function redrawIfWidthChanged() {
    const stage = els.chart?.querySelector('[data-stage]');
    if (stage && Math.abs(stage.clientWidth - lastChartWidth) > 8) drawChart();
  }

  // ── Shell (built once per language) ──────────────────────────────────────
  function mount() {
    root.innerHTML = '';
    els = {};

    const page = document.createElement('div');
    page.className = 'admin-dashboard-page admin-cockpit';
    page.innerHTML = `
      <header class="admin-dashboard__header">
        <div class="admin-dashboard__intro">
          <div class="admin-dashboard__eyebrow">
            <span class="admin-dashboard__badge">${esc(tr('cockpit_eyebrow'))}</span>
            <span class="admin-dashboard__pulse-dot" aria-hidden="true"></span>
            <span class="admin-dashboard__note">${esc(tr('precomputed_note'))}</span>
          </div>
          <h1 class="admin-dashboard__title">${esc(tr('title'))}</h1>
          <p class="admin-dashboard__subtitle">${esc(tr('subtitle'))}</p>
          <p class="admin-dashboard__meta" data-region="meta"></p>
        </div>
        <div class="admin-dashboard__controls">
          <div class="admin-dashboard__controls-row">
            <div class="admin-dashboard__timeframe-selector" role="group" aria-label="${esc(tr('timeframe_label'))}" data-region="timeframes"></div>
            <span data-slot="refresh"></span>
            <span data-slot="auto"></span>
          </div>
          <div class="admin-dashboard__controls-row">
            <span data-slot="export"></span>
            <span data-slot="rollup"></span>
            <span data-slot="health"></span>
          </div>
        </div>
      </header>

      <form class="admin-range" data-region="range" hidden novalidate aria-label="${esc(tr('range_label'))}">
        <div class="admin-range__fields" data-slot="range-fields"></div>
        <div class="admin-range__actions" data-slot="range-actions"></div>
        <p class="admin-range__error" role="alert" data-region="range-error" hidden></p>
      </form>

      <div data-region="banner"></div>

      <section class="admin-alerts" aria-labelledby="admin-alerts-heading">
        <div class="admin-alerts__header">
          <h2 class="admin-alerts__heading" id="admin-alerts-heading">
            <span class="admin-alerts__icon" aria-hidden="true">${ICONS.enforcement}</span>
            <span>${esc(t('admin.alerts.title'))}</span>
            <span class="admin-alerts__count-badge" data-region="alert-badge"></span>
          </h2>
          <span class="admin-dashboard__note">${esc(tr('deep_link_sub'))}</span>
        </div>
        <div class="admin-alerts__tools">
          <div class="admin-alerts__search" data-slot="search"></div>
          <div class="admin-chips" role="group" aria-label="${esc(tr('alerts_filter_label'))}" data-region="chips"></div>
          <span data-slot="cleared"></span>
        </div>
        <div data-region="alerts"></div>
      </section>

      <section class="admin-kpis" aria-labelledby="admin-kpis-heading">
        <h2 class="admin-kpis__title" id="admin-kpis-heading">${esc(tr('kpis_title'))}</h2>
        <div data-region="kpis"></div>
      </section>

      <div class="admin-analytics-row">
        <section class="admin-chart-panel" aria-labelledby="admin-chart-heading" data-region="chart"></section>
        <div class="admin-breakdowns" data-region="breakdowns"></div>
      </div>
    `;
    root.append(page);

    const q = (sel) => page.querySelector(sel);
    els.meta = q('[data-region="meta"]');
    els.timeframes = q('[data-region="timeframes"]');
    els.range = q('[data-region="range"]');
    els.rangeError = q('[data-region="range-error"]');
    els.banner = q('[data-region="banner"]');
    els.alertBadge = q('[data-region="alert-badge"]');
    els.chips = q('[data-region="chips"]');
    els.alerts = q('[data-region="alerts"]');
    els.kpis = q('[data-region="kpis"]');
    els.chart = q('[data-region="chart"]');
    els.breakdowns = q('[data-region="breakdowns"]');

    // Toolbar controls
    els.refreshBtn = Button({
      label: tr('btn_refresh'),
      variant: 'secondary',
      size: 'sm',
      iconLeft: iconEl('refresh'),
      onClick: () => refreshAll({ announce: true }),
    });
    q('[data-slot="refresh"]').append(els.refreshBtn);

    const autoSwitch = Switch({
      label: tr('auto_refresh'),
      checked: state.autoRefresh,
      onChange: (on) => {
        state.autoRefresh = on;
        writeAutoRefresh(on);
        syncAutoRefresh();
      },
    });
    q('[data-slot="auto"]').append(autoSwitch);

    if (can(PERM_EXPORT)) {
      els.exportBtn = Button({
        label: tr('btn_export'),
        variant: 'secondary',
        size: 'sm',
        iconLeft: iconEl('download'),
        onClick: exportCsv,
      });
      q('[data-slot="export"]').append(els.exportBtn);
    }
    if (can(PERM_ROLLUP)) {
      els.rollupBtn = Button({
        label: tr('btn_rollup'),
        variant: 'secondary',
        size: 'sm',
        iconLeft: iconEl('database'),
        onClick: (e) => openRollupDialog(e.currentTarget),
      });
      q('[data-slot="rollup"]').append(els.rollupBtn);
    }
    q('[data-slot="health"]').append(
      Button({
        label: tr('btn_health'),
        variant: 'primary',
        size: 'sm',
        iconLeft: iconEl('pulse'),
        onClick: () => nav('/admin/health'),
      })
    );

    // Custom range form
    const fromField = Input({ label: tr('range_from'), type: 'date', value: state.custom.from });
    const toField = Input({ label: tr('range_to'), type: 'date', value: state.custom.to });
    els.fromInput = fromField.input;
    els.toInput = toField.input;
    els.fromInput.max = els.toInput.max = isoToday();
    q('[data-slot="range-fields"]').append(fromField, toField);
    q('[data-slot="range-actions"]').append(
      Button({ label: tr('range_apply'), variant: 'primary', size: 'sm', type: 'submit' })
    );
    els.range.addEventListener('submit', (e) => {
      e.preventDefault();
      applyCustomRange();
    });

    // Alert search (kept in the shell so typing never rebuilds — and so never blurs — the input)
    const search = Input({
      type: 'search',
      value: state.query,
      placeholder: tr('alerts_search_placeholder'),
      ariaLabel: tr('alerts_search_label'),
      onInput: (e) => {
        clearTimeout(searchTimer);
        const value = e.target.value;
        searchTimer = setTimeout(() => {
          state.query = value;
          renderAlerts();
        }, 120);
      },
    });
    q('[data-slot="search"]').append(search);

    els.clearedSwitch = Switch({
      label: tr('show_cleared'),
      checked: state.showCleared,
      onChange: (on) => {
        state.showCleared = on;
        renderAlerts();
      },
    });
    q('[data-slot="cleared"]').append(els.clearedSwitch);

    // Delegated: timeframe presets + severity chips
    els.timeframes.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tf]');
      if (btn) selectTimeframe(btn.dataset.tf);
    });
    els.chips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sev]');
      if (!btn) return;
      state.severity = btn.dataset.sev;
      renderAlerts();
    });

    // Chart resize (a fixed viewBox would scale the axis text to unreadable on phones)
    resizeObserver?.disconnect();
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(redrawIfWidthChanged);
      resizeObserver.observe(els.chart);
    }

    renderToolbarState();
    renderMeta();
    renderAlerts();
    renderKpis();
    renderChart();
    renderBreakdowns();
  }

  // ── Regions ──────────────────────────────────────────────────────────────
  function periodLabel() {
    const p = state.overview?.period;
    if (state.timeframe !== 'custom') return state.timeframe.toUpperCase();
    const from = p?.from || state.custom.from;
    const to = p?.to || state.custom.to;
    return `${formatDayLabel(from, { withYear: true })} – ${formatDayLabel(to, { withYear: true })}`;
  }

  function renderToolbarState() {
    els.timeframes.innerHTML = [...TIMEFRAMES, 'custom']
      .map((tf) => {
        const active = state.timeframe === tf;
        const label = tf === 'custom' ? esc(tr('tf_custom')) : tf.toUpperCase();
        const extra = tf === 'custom' ? ` aria-expanded="${state.rangeOpen}"` : '';
        return `<button type="button" data-tf="${tf}" class="admin-dashboard__tf-btn${active ? ' admin-dashboard__tf-btn--active' : ''}" aria-pressed="${active}"${extra}>${label}</button>`;
      })
      .join('');
    els.range.hidden = !state.rangeOpen;
    els.rangeError.hidden = !state.rangeError;
    els.rangeError.textContent = state.rangeError ? tr(`range_error_${state.rangeError}`) : '';
  }

  function renderMeta() {
    const ov = state.overview;
    if (!ov) {
      els.meta.textContent = '';
      els.banner.innerHTML = '';
      return;
    }
    const at = ov.last_rollup_at;
    const isBaseline = ov.data_source === 'baseline';
    const when = at
      ? `<time datetime="${esc(at)}" title="${esc(formatDate(at, { dateStyle: 'medium', timeStyle: 'short' }))}">${esc(tr('last_rollup', { when: formatRelativeTime(at) }))}</time>`
      : esc(tr('last_rollup_never'));
    els.meta.innerHTML = `${when}${isBaseline ? ` <span class="admin-pill admin-pill--warn">${esc(tr('source_baseline'))}</span>` : ''}`;

    if (isBaseline) {
      els.banner.innerHTML = `<div class="admin-banner" role="status"><span class="admin-banner__icon" aria-hidden="true">${ICONS.help_circle}</span><p class="admin-banner__text">${esc(tr('source_baseline_note'))}</p><span data-slot="banner-action"></span></div>`;
      if (can(PERM_ROLLUP)) {
        els.banner.querySelector('[data-slot="banner-action"]').append(
          Button({ label: tr('rollup_run'), variant: 'secondary', size: 'sm', onClick: (e) => openRollupDialog(e.currentTarget) })
        );
      }
    } else {
      els.banner.innerHTML = '';
    }
  }

  function renderAlerts() {
    const counts = severityCounts(state.alerts);
    const actionable = counts.ALL;

    // Heading badge
    const hasCritical = state.alerts.some((a) => a.count > 0 && a.severity === 'CRITICAL');
    els.alertBadge.hidden = state.alertsStatus !== 'ready' || actionable === 0;
    els.alertBadge.className = `admin-alerts__count-badge${hasCritical ? ' admin-alerts__count-badge--critical' : ''}`;
    els.alertBadge.textContent = `${num(actionable)} ${tr('action_items')}`;

    // Severity chips
    els.chips.innerHTML = ['ALL', ...SEVERITIES]
      .map((sev) => {
        const active = state.severity === sev;
        const label = tr(`sev_${sev.toLowerCase()}`);
        return `<button type="button" class="admin-chip${active ? ' admin-chip--active' : ''}" data-sev="${sev}" aria-pressed="${active}">${esc(label)}<span class="admin-chip__count">${num(counts[sev])}</span></button>`;
      })
      .join('');

    if (state.alertsStatus === 'loading') {
      els.alerts.innerHTML = `<div class="admin-alerts__grid" aria-busy="true">${Array.from({ length: 3 }, () => '<div class="admin-alert-card admin-skel-card"><span class="admin-skel admin-skel--sm"></span><span class="admin-skel admin-skel--lg"></span><span class="admin-skel"></span><span class="admin-skel admin-skel--btn"></span></div>').join('')}</div>`;
      return;
    }
    if (state.alertsStatus === 'error') {
      els.alerts.replaceChildren(
        EmptyState({
          variant: 'error',
          compact: true,
          title: tr('error_title'),
          description: tr('error_desc'),
          action: Button({ label: tr('error_retry'), variant: 'secondary', size: 'sm', onClick: loadAlerts }),
        })
      );
      return;
    }

    const visible = filterAlerts(state.alerts, { query: state.query, severity: state.severity, showCleared: state.showCleared });
    const filtering = Boolean(state.query.trim()) || state.severity !== 'ALL';

    if (visible.length === 0) {
      if (actionable === 0 && !filtering) {
        els.alerts.replaceChildren(
          EmptyState({
            variant: 'empty',
            compact: true,
            icon: iconEl('check_circle'),
            title: tr('no_alerts_title'),
            description: tr('no_alerts_desc'),
          })
        );
      } else {
        els.alerts.replaceChildren(
          EmptyState({
            variant: 'empty',
            compact: true,
            icon: iconEl('search'),
            title: tr('alerts_no_match_title'),
            description: tr('alerts_no_match_desc'),
            action: Button({
              label: tr('alerts_clear_filters'),
              variant: 'secondary',
              size: 'sm',
              onClick: () => {
                state.query = '';
                state.severity = 'ALL';
                const box = document.querySelector('[data-slot="search"] input');
                if (box) box.value = '';
                renderAlerts();
              },
            }),
          })
        );
      }
      return;
    }

    const hiddenCleared = state.showCleared ? 0 : state.alerts.filter((a) => a.count <= 0).length;
    els.alerts.innerHTML = `
      <div class="admin-alerts__grid">${visible.map(renderAlertCard).join('')}</div>
      ${hiddenCleared > 0 ? `<p class="admin-alerts__hidden-note">${esc(tr('alerts_cleared_hidden', { count: num(hiddenCleared) }))}</p>` : ''}
    `;
  }

  function renderAlertCard(alert) {
    const sev = SEVERITIES.includes(alert.severity) ? alert.severity : 'MEDIUM';
    const cleared = alert.count <= 0;
    const href = safeInternalPath(alert.action_url);
    const label = loc(alert, 'action_label');
    const cta = href
      ? `<a class="btn btn--secondary btn--sm admin-alert-card__cta" href="${esc(href)}"><span>${esc(label)}</span><span class="admin-alert-card__cta-icon" aria-hidden="true">${ICONS.arrow_right}</span></a>`
      : '';
    return `
      <article class="admin-alert-card admin-alert-card--${sev.toLowerCase()}${cleared ? ' admin-alert-card--cleared' : ''}">
        <div>
          <div class="admin-alert-card__top">
            <span class="admin-alert-card__severity">${esc(tr(`sev_${sev.toLowerCase()}`))}</span>
            <span class="admin-alert-card__count">${num(alert.count)}</span>
          </div>
          <h3 class="admin-alert-card__title">${esc(loc(alert, 'title'))}</h3>
          <p class="admin-alert-card__details">${esc(loc(alert, 'details'))}</p>
        </div>
        <div class="admin-alert-card__footer">${cta}</div>
      </article>`;
  }

  function renderKpis() {
    if (state.overviewStatus === 'error') {
      els.kpis.replaceChildren(errorPanel(loadOverview));
      return;
    }
    if (state.overviewStatus === 'loading' && !state.overview) {
      els.kpis.innerHTML = `<div class="admin-kpis__grid" aria-busy="true">${Array.from({ length: 8 }, () => '<div class="admin-kpi-card admin-skel-card"><span class="admin-skel admin-skel--sm"></span><span class="admin-skel admin-skel--lg"></span><span class="admin-skel admin-skel--xs"></span></div>').join('')}</div>`;
      return;
    }
    const kpis = state.overview?.kpis || {};
    const lang = getLanguage();
    const units = { crore: tr('unit_crore'), lakh: tr('unit_lakh') };
    els.kpis.classList.toggle('admin-region--stale', state.overviewStatus === 'loading');
    els.kpis.innerHTML = KPI_GROUPS.map(
      (group) => `
        <div class="admin-kpi-group">
          <h3 class="admin-kpi-group__title">${esc(tr(`group_${group.key}`))}</h3>
          <div class="admin-kpis__grid">${group.kpis.map((def) => renderKpiCard(def, kpis[def.key], { lang, units })).join('')}</div>
        </div>`
    ).join('');
  }

  function renderKpiCard(def, kpi = {}, { lang, units }) {
    const label = tr(`kpi_${def.key}_label`);
    const hint = tr(`kpi_${def.key}_hint`);
    const value = formatKpiValue(def, kpi, { lang, units });
    const full = def.format === 'currency' ? formatFullBdt(kpi?.value, { lang }) : value;
    const pct = Number(kpi?.delta_pct) || 0;
    const trend = kpi?.trend || 'neutral';
    const tone = deltaTone(def.polarity, trend, pct);
    const arrow = pct === 0 || trend === 'neutral' ? '•' : trend === 'up' ? '▲' : '▼';
    const sr = pct === 0 || trend === 'neutral' ? tr('delta_flat') : tr(trend === 'up' ? 'delta_up' : 'delta_down', { pct: formatDecimal(pct, 1) });
    const body = `
      <div class="admin-kpi-card__top">
        <span class="admin-kpi-card__label" title="${esc(label)}">${esc(label)}</span>
        <span class="admin-kpi-card__icon" aria-hidden="true">${ICONS[def.icon] || ''}</span>
      </div>
      <div class="admin-kpi-card__value" title="${esc(full)}">${esc(value)}</div>
      <div class="admin-kpi-card__delta">
        <span class="admin-kpi-card__badge admin-kpi-card__badge--${tone}"><span aria-hidden="true">${arrow} ${esc(formatDecimal(pct, 1))}%</span><span class="sr-only">${esc(sr)}</span></span>
        <span class="admin-kpi-card__vs">${esc(tr('vs_prev'))}</span>
      </div>
      <p class="admin-kpi-card__subtext">${esc(hint)}</p>`;
    return def.href
      ? `<a class="admin-kpi-card admin-kpi-card--link" href="${esc(def.href)}" aria-label="${esc(tr('kpi_open', { name: label }))}">${body}</a>`
      : `<div class="admin-kpi-card">${body}</div>`;
  }

  function errorPanel(onRetry) {
    return EmptyState({
      variant: 'error',
      compact: true,
      title: tr('error_title'),
      description: tr('error_desc'),
      action: Button({ label: tr('error_retry'), variant: 'secondary', size: 'sm', onClick: onRetry }),
    });
  }

  // ── Chart ────────────────────────────────────────────────────────────────
  function renderChart() {
    if (state.overviewStatus === 'error') {
      els.chart.replaceChildren(errorPanel(loadOverview));
      return;
    }
    if (state.overviewStatus === 'loading' && !state.overview) {
      els.chart.innerHTML = '<div class="admin-skel admin-skel--title"></div><div class="admin-skel admin-skel--chart" aria-busy="true"></div>';
      return;
    }

    const raw = state.overview?.chart_data || [];
    chartPoints = bucketSeries(raw, 45);
    const summary = summariseSeries(raw);
    const lang = getLanguage();
    const units = { crore: tr('unit_crore'), lakh: tr('unit_lakh') };
    const bucketed = chartPoints.length > 0 && chartPoints[0].span > 1;

    els.chart.innerHTML = `
      <div class="admin-chart-panel__header">
        <div>
          <h3 class="admin-chart-panel__title" id="admin-chart-heading">${esc(tr('chart_title'))}</h3>
          <p class="admin-chart-panel__subtitle">${esc(tr('historical_trend', { timeframe: periodLabel() }))}</p>
        </div>
        <div class="admin-chart-panel__legend" role="group" aria-label="${esc(tr('chart_title'))}">
          <button type="button" class="admin-legend-btn" data-series="gmv" aria-pressed="${state.show.gmv}" title="${esc(tr('legend_toggle', { name: tr('tt_gmv') }))}">
            <span class="admin-chart-panel__dot-primary" aria-hidden="true"></span><span>${esc(tr('legend_gmv'))}</span>
          </button>
          <button type="button" class="admin-legend-btn" data-series="revenue" aria-pressed="${state.show.revenue}" title="${esc(tr('legend_toggle', { name: tr('tt_revenue') }))}">
            <span class="admin-chart-panel__line-secondary" aria-hidden="true"></span><span>${esc(tr('legend_rev'))}</span>
          </button>
        </div>
      </div>
      ${
        chartPoints.length === 0
          ? `<p class="admin-chart-panel__empty">${esc(tr('chart_empty'))}</p>`
          : `<div class="admin-chart__stage" data-stage></div>
             <p class="admin-chart-panel__hint">${esc(tr('chart_hint'))}${bucketed ? ` ${esc(tr('chart_bucketed', { days: num(chartPoints[0].span) }))}` : ''}</p>
             <dl class="admin-chart-summary">
               <div><dt>${esc(tr('sum_total_gmv'))}</dt><dd title="${esc(formatFullBdt(summary.totalGmv, { lang }))}">${esc(formatCompactBdt(summary.totalGmv, { lang, units }))}</dd></div>
               <div><dt>${esc(tr('sum_avg'))}</dt><dd title="${esc(formatFullBdt(summary.avgGmv, { lang }))}">${esc(formatCompactBdt(summary.avgGmv, { lang, units }))}</dd></div>
               <div><dt>${esc(tr('sum_peak'))}</dt><dd>${esc(summary.peak ? formatDayLabel(summary.peak.date, { lang }) : '—')}</dd></div>
               <div><dt>${esc(tr('sum_orders'))}</dt><dd>${esc(num(summary.totalOrders))}</dd></div>
             </dl>`
      }
    `;

    els.chart.querySelectorAll('[data-series]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.series;
        const other = key === 'gmv' ? 'revenue' : 'gmv';
        // Keep at least one series visible — an empty chart teaches nothing.
        if (state.show[key] && !state.show[other]) return;
        state.show[key] = !state.show[key];
        btn.setAttribute('aria-pressed', String(state.show[key]));
        drawChart();
      });
    });

    if (chartPoints.length) drawChart();
  }

  function drawChart() {
    const stage = els.chart?.querySelector('[data-stage]');
    if (!stage || !chartPoints.length) return;
    const lang = getLanguage();
    const units = { crore: tr('unit_crore'), lakh: tr('unit_lakh') };
    const width = Math.max(Math.round(stage.clientWidth) || 640, 280);
    lastChartWidth = width;
    const height = width < 480 ? 220 : 260;
    const m = buildChartModel(chartPoints, { width, height, show: state.show });
    chartModel = m;

    const axisText = (v) => formatCompactBdt(v, { lang, units }).replace('৳', '');
    const grid = m.yLeft
      .map((tk) => `<line x1="${m.pad.left}" x2="${width - m.pad.right}" y1="${tk.y.toFixed(1)}" y2="${tk.y.toFixed(1)}" class="admin-chart__grid${tk.v === 0 ? ' admin-chart__grid--base' : ''}" />`)
      .join('');
    const yLeft = state.show.gmv
      ? m.yLeft.map((tk) => `<text x="${m.pad.left - 8}" y="${(tk.y + 3.5).toFixed(1)}" text-anchor="end" class="admin-chart__tick admin-chart__tick--gmv">${esc(axisText(tk.v))}</text>`).join('')
      : '';
    const yRight = state.show.revenue
      ? m.yRight.map((tk) => `<text x="${width - m.pad.right + 8}" y="${(tk.y + 3.5).toFixed(1)}" text-anchor="start" class="admin-chart__tick admin-chart__tick--rev">${esc(axisText(tk.v))}</text>`).join('')
      : '';
    const xLabels = m.xLabels
      .filter((l) => l.show)
      .map((l) => `<text x="${l.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="admin-chart__tick">${esc(formatDayLabel(l.text, { lang }))}</text>`)
      .join('');
    const dots = chartPoints.length <= 45
      ? (state.show.gmv ? m.gmv : []).map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" class="admin-chart__dot" />`).join('')
      : '';

    const summaryLabel = `${esc(tr('chart_title'))}: ${esc(formatPointRange(chartPoints[0], { lang }))} – ${esc(formatPointRange(chartPoints[chartPoints.length - 1], { lang }))}`;
    stage.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="admin-chart-panel__svg" role="group" tabindex="0" aria-label="${summaryLabel}">
        ${grid}${yLeft}${yRight}${xLabels}
        ${state.show.gmv ? `<path d="${m.gmvArea}" class="admin-chart__area" /><path d="${m.gmvPath}" class="admin-chart__line admin-chart__line--gmv" />` : ''}
        ${state.show.revenue ? `<path d="${m.revPath}" class="admin-chart__line admin-chart__line--rev" />` : ''}
        ${dots}
        <g class="admin-chart__hover" visibility="hidden">
          <line class="admin-chart__cursor" y1="${m.pad.top}" y2="${m.baseline}" />
          <circle class="admin-chart__focus admin-chart__focus--gmv" r="5" />
          <circle class="admin-chart__focus admin-chart__focus--rev" r="5" />
        </g>
      </svg>
      <div class="admin-chart__tip" role="status" aria-live="off" hidden></div>`;

    const svg = stage.querySelector('svg');
    const hover = stage.querySelector('.admin-chart__hover');
    const cursor = stage.querySelector('.admin-chart__cursor');
    const fGmv = stage.querySelector('.admin-chart__focus--gmv');
    const fRev = stage.querySelector('.admin-chart__focus--rev');
    const tip = stage.querySelector('.admin-chart__tip');
    let activeIdx = chartPoints.length - 1;

    function show(idx) {
      if (idx < 0 || idx >= chartPoints.length) return;
      activeIdx = idx;
      const p = chartPoints[idx];
      const x = chartModel.xs[idx];
      hover.setAttribute('visibility', 'visible');
      cursor.setAttribute('x1', x);
      cursor.setAttribute('x2', x);
      const g = chartModel.gmv[idx];
      const r = chartModel.revenue[idx];
      fGmv.style.display = g ? '' : 'none';
      fRev.style.display = r ? '' : 'none';
      if (g) { fGmv.setAttribute('cx', g.x); fGmv.setAttribute('cy', g.y); }
      if (r) { fRev.setAttribute('cx', r.x); fRev.setAttribute('cy', r.y); }
      tip.innerHTML = `
        <strong class="admin-chart__tip-date">${esc(formatPointRange(p, { lang, withYear: true }))}</strong>
        <span class="admin-chart__tip-row"><i class="admin-chart__tip-swatch admin-chart__tip-swatch--gmv" aria-hidden="true"></i>${esc(tr('tt_gmv'))}<b>${esc(formatFullBdt(p.gmv, { lang }))}</b></span>
        <span class="admin-chart__tip-row"><i class="admin-chart__tip-swatch admin-chart__tip-swatch--rev" aria-hidden="true"></i>${esc(tr('tt_revenue'))}<b>${esc(formatFullBdt(p.revenue, { lang }))}</b></span>
        <span class="admin-chart__tip-row">${esc(tr('tt_orders'))}<b>${esc(num(p.orders))}</b></span>`;
      tip.hidden = false;
      const rect = svg.getBoundingClientRect();
      const px = x * (rect.width / width);
      tip.style.left = `${px}px`;
      tip.classList.toggle('admin-chart__tip--left', px > rect.width * 0.6);
    }
    function hide() {
      hover.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    }

    svg.addEventListener('pointermove', (e) => {
      tip.setAttribute('aria-live', 'off');
      const rect = svg.getBoundingClientRect();
      show(nearestIndex(chartModel.xs, (e.clientX - rect.left) * (width / rect.width)));
    });
    svg.addEventListener('pointerleave', () => { if (document.activeElement !== svg) hide(); });
    svg.addEventListener('focus', () => show(activeIdx));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      const last = chartPoints.length - 1;
      const next = { ArrowLeft: activeIdx - 1, ArrowRight: activeIdx + 1, Home: 0, End: last }[e.key];
      if (e.key === 'Escape') { hide(); return; }
      if (next === undefined) return;
      e.preventDefault();
      tip.setAttribute('aria-live', 'polite');
      show(Math.min(Math.max(next, 0), last));
    });
  }

  // ── Breakdowns ───────────────────────────────────────────────────────────
  function renderBreakdowns() {
    if (state.overviewStatus === 'loading' && !state.overview) {
      els.breakdowns.innerHTML = '<div class="admin-breakdown-card admin-skel-card"><span class="admin-skel admin-skel--sm"></span><span class="admin-skel admin-skel--lg"></span></div>';
      return;
    }
    const lang = getLanguage();
    const units = { crore: tr('unit_crore'), lakh: tr('unit_lakh') };
    const card = (title, sub, items, amountKey, barClass) => `
      <section class="admin-breakdown-card">
        <div class="admin-breakdown-card__header">
          <h3 class="admin-breakdown-card__title">${esc(title)}</h3>
          <span class="admin-breakdown-card__sub">${esc(sub)}</span>
        </div>
        ${
          items.length === 0
            ? `<p class="admin-breakdown-card__empty">${esc(tr('breakdown_empty'))}</p>`
            : `<ul class="admin-breakdown-card__list">${items
                .map((it) => {
                  const pct = Math.min(Math.max(Number(it.share_pct) || 0, 0), 100);
                  return `<li class="admin-breakdown-item">
                    <div class="admin-breakdown-item__row">
                      <span class="admin-breakdown-item__name">${esc(it.name)}</span>
                      <span class="admin-breakdown-item__amount" title="${esc(formatFullBdt(it[amountKey], { lang }))}">${esc(formatCompactBdt(it[amountKey], { lang, units }))}</span>
                      <span class="admin-breakdown-item__share">${esc(formatDecimal(pct, 1))}%</span>
                    </div>
                    <div class="admin-breakdown-item__track" role="presentation"><div class="admin-breakdown-item__bar ${barClass}" style="width: ${pct}%;"></div></div>
                  </li>`;
                })
                .join('')}</ul>`
        }
      </section>`;
    const bd = state.overview?.breakdown || {};
    els.breakdowns.innerHTML =
      card(tr('channels_title'), tr('by_volume'), bd.channels || [], 'volume', '') +
      card(tr('categories_title'), tr('by_revenue'), bd.categories || [], 'revenue', 'admin-breakdown-item__bar--emerald');
  }

  // ── Boot / teardown ──────────────────────────────────────────────────────
  mount();
  // ResizeObserver covers container-only changes; window resize is the belt-and-braces fallback.
  window.addEventListener('resize', redrawIfWidthChanged);
  syncAutoRefresh();
  loadOverview();
  loadAlerts();

  // A language switch rebuilds the shell (labels are baked into it) but keeps all state and data.
  const offLanguage = subscribeLanguage(() => {
    if (!disposed) mount();
  });

  return () => {
    disposed = true;
    offLanguage?.();
    window.removeEventListener('resize', redrawIfWidthChanged);
    if (autoTimer) clearInterval(autoTimer);
    clearTimeout(searchTimer);
    resizeObserver?.disconnect();
  };
}
