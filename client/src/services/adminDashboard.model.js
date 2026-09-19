/**
 * adminDashboard.model.js — pure logic behind the Super Admin Executive Cockpit (Prompt 11.4).
 *
 * WHY a separate module: the page builds its markup as one innerHTML string and the client test
 * runner (`node --test`) has no DOM. Everything here is a plain function of its inputs, so the
 * rules that are easy to get silently wrong — which way a delta is "good", how a year of daily
 * rollups collapses into a legible chart, whether a custom date range is valid — are asserted in
 * client/test/adminDashboardModel.test.js instead of being eyeballed in a browser.
 */

import { formatNumber, getNumeralPreference, resolveLang } from './format.js';

export const TIMEFRAMES = ['7d', '30d', '90d', '1y'];
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const MAX_RANGE_DAYS = 366;
export const AUTO_REFRESH_MS = 60_000;

/**
 * The 11 executive KPIs (Master Spec §AL.4), grouped so the grid never leaves an orphan row.
 *
 * `polarity` is the business meaning of "up", NOT a colour: a rising dispute rate is bad, a rising
 * escrow balance is merely informational. The server's `is_positive` flag is just `delta >= 0`
 * and so paints a falling dispute rate red — the wrong way round — which is why the client owns
 * this table instead of trusting that flag.
 */
export const KPI_GROUPS = [
  {
    key: 'growth',
    kpis: [
      { key: 'gmv', icon: 'coin', format: 'currency', polarity: 'up_good', href: '/admin/orders' },
      { key: 'net_platform_revenue', icon: 'trending_up', format: 'currency', polarity: 'up_good', href: '/admin/finance' },
      { key: 'take_rate', icon: 'pie_chart', format: 'percent', polarity: 'up_good', href: '/admin/finance/splits' },
      { key: 'aov', icon: 'cart', format: 'currency', polarity: 'up_good', href: '/admin/orders' },
      { key: 'conversion_rate', icon: 'bar_chart', format: 'percent', polarity: 'up_good', href: null },
    ],
  },
  {
    key: 'marketplace',
    kpis: [
      { key: 'active_sellers', icon: 'my_store', format: 'number', polarity: 'up_good', href: '/admin/users' },
      { key: 'new_signups', icon: 'user_plus', format: 'number', polarity: 'up_good', href: '/admin/users' },
      { key: 'dispute_rate', icon: 'flag', format: 'percent', polarity: 'down_good', href: '/admin/disputes' },
    ],
  },
  {
    key: 'exposure',
    kpis: [
      { key: 'escrow_liability', icon: 'lock', format: 'currency', polarity: 'neutral', href: '/admin/finance/escrow' },
      { key: 'pending_payout_liability', icon: 'wallet', format: 'currency', polarity: 'down_good', href: '/admin/finance/payouts' },
      { key: 'cod_exposure', icon: 'truck', format: 'currency', polarity: 'down_good', href: '/admin/cod-reconciliation' },
    ],
  },
];

/** `good` | `bad` | `neutral` — what a period-over-period move means for the platform. */
export function deltaTone(polarity, trend, deltaPct) {
  if (!deltaPct || trend === 'neutral' || polarity === 'neutral') return 'neutral';
  if (polarity === 'up_good') return trend === 'up' ? 'good' : 'bad';
  return trend === 'down' ? 'good' : 'bad';
}

/**
 * South-Asian compact money: 1,48,50,000 → "৳1.49 Cr". The full figure stays available (callers
 * put it in a tooltip) — compacting only exists so a 1-year GMV cannot overflow a KPI card.
 */
export function formatCompactBdt(value, { lang, units = { crore: 'Cr', lakh: 'L' } } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '৳0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  const fmt = (n) => formatNumber(Number(n.toFixed(2)), { lang });
  if (abs >= 1e7) return `${sign}৳${fmt(abs / 1e7)} ${units.crore}`;
  if (abs >= 1e5) return `${sign}৳${fmt(abs / 1e5)} ${units.lakh}`;
  return `${sign}৳${formatNumber(Math.round(abs), { lang })}`;
}

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

/**
 * Decimal with trailing zeros trimmed (`8.00` → `8`, `3.650` → `3.65`) in the active numeral
 * system. `formatNumber` always pads a fractional value to two places, which turns a "+0.2%"
 * delta into "+0.20%" — noise on a KPI card.
 */
export function formatDecimal(value, maxFraction = 2, { lang, numerals } = {}) {
  const num = Number(value);
  const str = String(Number.isFinite(num) ? Number(num.toFixed(maxFraction)) : 0);
  const useBengali = resolveLang(lang) === 'bn' && (numerals ?? getNumeralPreference()) !== 'latin';
  return useBengali ? str.replace(/\d/g, (d) => BENGALI_DIGITS[Number(d)]) : str;
}

/** Full-precision figure for tooltips / CSV. */
export function formatFullBdt(value, { lang } = {}) {
  const num = Number(value);
  return `৳${formatNumber(Number.isFinite(num) ? Number(num.toFixed(2)) : 0, { lang })}`;
}

export function formatKpiValue(kpiDef, kpi, opts = {}) {
  const value = kpi?.value ?? 0;
  if (kpiDef.format === 'currency') return formatCompactBdt(value, opts);
  if (kpiDef.format === 'percent') return `${formatDecimal(value, 2, opts)}%`;
  return formatNumber(Math.round(Number(value) || 0), opts);
}

/** `"2026-09-01"` | Date | `"2026-09-01T00:00:00.000Z"` → `"2026-09-01"`, or '' when unusable. */
export function toIsoDay(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const day = value.slice(0, 10);
    // Round-trip: Date.parse('2026-02-30') is accepted by V8 and quietly means 2 March.
    const real = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(real.getTime()) && real.toISOString().slice(0, 10) === day ? day : '';
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Validates a custom range. Returns `{ ok: true, days }` or `{ ok: false, error }` where `error`
 * is an i18n key suffix under `admin.dashboard.range_error_*` — never a hardcoded sentence.
 */
export function validateCustomRange(from, to, today = new Date()) {
  const f = toIsoDay(from);
  const tt = toIsoDay(to);
  if (!f || !tt) return { ok: false, error: 'required' };
  if (f > tt) return { ok: false, error: 'order' };
  if (tt > toIsoDay(today)) return { ok: false, error: 'future' };
  const days = Math.round((Date.parse(tt) - Date.parse(f)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, error: 'too_long' };
  return { ok: true, days };
}

/**
 * Collapses a long daily series into at most `maxPoints` buckets. A year of daily rollups is 365
 * points on a ~700px chart: unreadable axis, unhoverable dots. Sums are additive for GMV, revenue
 * and orders, so bucketing loses no totals.
 */
export function bucketSeries(points = [], maxPoints = 45) {
  const list = Array.isArray(points) ? points : [];
  if (list.length <= maxPoints) {
    return list.map((p) => ({ ...p, endDate: p.date, span: 1 }));
  }
  const size = Math.ceil(list.length / maxPoints);
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    const slice = list.slice(i, i + size);
    out.push({
      date: slice[0].date,
      endDate: slice[slice.length - 1].date,
      span: slice.length,
      gmv: slice.reduce((a, p) => a + (Number(p.gmv) || 0), 0),
      revenue: slice.reduce((a, p) => a + (Number(p.revenue) || 0), 0),
      orders: slice.reduce((a, p) => a + (Number(p.orders) || 0), 0),
    });
  }
  return out;
}

/** Rounds `max` up to a 1/2/2.5/5 × 10^n step and returns `{ max, ticks }` (ticks include 0). */
export function niceScale(rawMax, tickCount = 4) {
  const max = Number(rawMax);
  if (!Number.isFinite(max) || max <= 0) return { max: 1, ticks: [0, 1] };
  const roughStep = max / tickCount;
  const pow = 10 ** Math.floor(Math.log10(roughStep));
  const frac = roughStep / pow;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  const step = niceFrac * pow;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Number(v.toFixed(6)));
  return { max: top, ticks };
}

/**
 * Geometry for the dual-axis trend chart. GMV owns the left axis and net revenue the right one —
 * the previous chart normalised each line to its own maximum with no axis, so the two lines
 * looked comparable when revenue is ~8% of GMV.
 *
 * Returns pixel coordinates only; the page turns them into SVG. A hidden series is omitted so the
 * remaining axis can use the full height.
 */
export function buildChartModel(points, { width = 640, height = 240, show = { gmv: true, revenue: true } } = {}) {
  const pad = { top: 16, right: 52, bottom: 30, left: 52 };
  const innerW = Math.max(width - pad.left - pad.right, 10);
  const innerH = Math.max(height - pad.top - pad.bottom, 10);
  const n = points.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const x = (i) => pad.left + (n > 1 ? i * stepX : innerW / 2);

  const gmvScale = niceScale(Math.max(...points.map((p) => Number(p.gmv) || 0), 0));
  const revScale = niceScale(Math.max(...points.map((p) => Number(p.revenue) || 0), 0));
  const yFor = (v, scale) => pad.top + innerH - ((Number(v) || 0) / scale.max) * innerH;

  const line = (key, scale) =>
    points.map((p, i) => ({ x: x(i), y: yFor(p[key], scale), value: Number(p[key]) || 0 }));

  const gmv = show.gmv ? line('gmv', gmvScale) : [];
  const revenue = show.revenue ? line('revenue', revScale) : [];
  const toPath = (pts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const baseline = pad.top + innerH;

  // Thin the x labels so they never collide: aim for one label per ~64px.
  const every = Math.max(1, Math.ceil(n / Math.max(Math.floor(innerW / 64), 1)));

  return {
    width,
    height,
    pad,
    innerW,
    innerH,
    baseline,
    gmvScale,
    revScale,
    gmv,
    revenue,
    gmvPath: toPath(gmv),
    revPath: toPath(revenue),
    gmvArea: gmv.length ? `${toPath(gmv)} L${gmv[gmv.length - 1].x.toFixed(1)} ${baseline} L${gmv[0].x.toFixed(1)} ${baseline} Z` : '',
    // Counted back from the LAST point: it is always labelled (latest date matters most) and the
    // spacing is uniform, so a forced trailing label can never land next to its neighbour.
    xLabels: points.map((p, i) => ({ x: x(i), text: p.date, show: (n - 1 - i) % every === 0 })),
    yLeft: gmvScale.ticks.map((v) => ({ v, y: yFor(v, gmvScale) })),
    yRight: revScale.ticks.map((v) => ({ v, y: yFor(v, revScale) })),
    xs: points.map((_, i) => x(i)),
  };
}

/** Index of the point whose x is nearest `px`. Powers the hover / keyboard crosshair. */
export function nearestIndex(xs, px) {
  if (!xs.length) return -1;
  let best = 0;
  let bestDist = Infinity;
  xs.forEach((x, i) => {
    const d = Math.abs(x - px);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export function summariseSeries(points = []) {
  if (!points.length) return { totalGmv: 0, totalRevenue: 0, totalOrders: 0, avgGmv: 0, peak: null };
  const totalGmv = points.reduce((a, p) => a + (Number(p.gmv) || 0), 0);
  const totalRevenue = points.reduce((a, p) => a + (Number(p.revenue) || 0), 0);
  const totalOrders = points.reduce((a, p) => a + (Number(p.orders) || 0), 0);
  const peak = points.reduce((best, p) => (Number(p.gmv) > Number(best.gmv) ? p : best), points[0]);
  return { totalGmv, totalRevenue, totalOrders, avgGmv: totalGmv / points.length, peak };
}

/** The API sends `id` from the live service and `key` from the mock layer; accept both. */
export function normalizeAlert(alert = {}) {
  return { ...alert, id: alert.id ?? alert.key ?? alert.action_url ?? '', count: Number(alert.count) || 0 };
}

const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Worst-first, then biggest backlog first, so the top card is always the most urgent one. */
export function sortAlerts(alerts = []) {
  return [...alerts].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.count - a.count
  );
}

/**
 * Client-side alert filtering. `query` matches the title/details in BOTH languages, so an admin
 * who has switched to Bangla can still find "KYC" by typing it.
 */
export function filterAlerts(alerts, { query = '', severity = 'ALL', showCleared = false } = {}) {
  const q = String(query).trim().toLowerCase();
  return alerts.filter((a) => {
    if (!showCleared && a.count <= 0) return false;
    if (severity !== 'ALL' && a.severity !== severity) return false;
    if (!q) return true;
    const hay = [a.title_en, a.title_bn, a.details_en, a.details_bn, a.action_label_en, a.action_label_bn, a.id]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Counts per severity over ACTIONABLE alerts (count > 0) — drives the filter chip badges. */
export function severityCounts(alerts = []) {
  const out = { ALL: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  alerts.forEach((a) => {
    if (a.count <= 0) return;
    out.ALL += 1;
    if (out[a.severity] !== undefined) out[a.severity] += 1;
  });
  return out;
}

/** RFC 4180 field escaping, plus a leading-quote guard against spreadsheet formula injection. */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * KPI snapshot + the plotted series as one CSV. Labels come from the caller (already localised);
 * values are raw numbers so the file stays sortable in a spreadsheet.
 */
export function buildDashboardCsv({ kpiRows = [], series = [], labels = {} }) {
  const head = labels.kpiHeader || ['KPI', 'Value', 'Change %', 'Trend'];
  const seriesHead = labels.seriesHeader || ['Date', 'GMV', 'Net revenue', 'Orders'];
  const lines = [head.map(csvCell).join(',')];
  kpiRows.forEach((r) => lines.push([r.label, r.value, r.delta_pct, r.trend].map(csvCell).join(',')));
  lines.push('');
  lines.push(seriesHead.map(csvCell).join(','));
  series.forEach((p) => lines.push([p.date, p.gmv, p.revenue, p.orders].map(csvCell).join(',')));
  return lines.join('\r\n');
}

/**
 * `2026-09-01` → `01 Sep` (or `০১ সেপ্টেম্বর`). Anything that is not an ISO day — the API's
 * placeholder series uses `W1`…`W4` — is passed through untouched rather than shown as "Invalid Date".
 * UTC on purpose: a rollup date is a calendar day, and formatting it in the viewer's zone would
 * shift it by one east or west of the server.
 */
export function formatDayLabel(value, { lang, withYear = false } = {}) {
  const day = toIsoDay(value);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(String(value).slice(0, 10))) return String(value ?? '');
  const locale = resolveLang(lang) === 'bn' ? 'bn' : 'en';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A bucket spans several days; a single day is just its own label. */
export function formatPointRange(point, opts = {}) {
  const start = formatDayLabel(point.date, opts);
  if (!point.endDate || point.endDate === point.date) return start;
  return `${start} – ${formatDayLabel(point.endDate, opts)}`;
}

/**
 * Alert `action_url` comes from the API. Only same-origin absolute paths are followed, so a
 * poisoned or misconfigured row cannot turn a "Review queue" button into `javascript:` or an
 * off-site redirect.
 */
export function safeInternalPath(url) {
  const s = String(url ?? '');
  return /^\/(?![/\\])[^\s]*$/.test(s) ? s : '';
}

/** HTML-escapes text that came from the API before it is placed in an innerHTML template. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
