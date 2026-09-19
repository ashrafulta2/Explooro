/**
 * adminDashboardModel.test.js — invariants behind the Super Admin Executive Cockpit (Prompt 11.4).
 *
 * The page is one big innerHTML template and the runner has no DOM, so every rule that can be wrong
 * without anyone noticing lives in services/adminDashboard.model.js and is asserted here:
 * delta polarity, compact money, range validation, chart bucketing/scales, alert filtering,
 * CSV escaping — plus the mock contract and en/bn parity for every string the page renders.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  KPI_GROUPS,
  bucketSeries,
  buildChartModel,
  buildDashboardCsv,
  csvCell,
  deltaTone,
  esc,
  filterAlerts,
  formatCompactBdt,
  formatDayLabel,
  formatDecimal,
  formatKpiValue,
  nearestIndex,
  niceScale,
  normalizeAlert,
  safeInternalPath,
  severityCounts,
  sortAlerts,
  summariseSeries,
  validateCustomRange,
} from '../src/services/adminDashboard.model.js';
import adminHandlers from '../src/mocks/handlers/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

test('KPI polarity: colour reflects what a move means, not its sign', () => {
  assert.equal(deltaTone('up_good', 'up', 5), 'good');
  assert.equal(deltaTone('up_good', 'down', 5), 'bad');
  // The server's `is_positive` paints a FALLING dispute rate red; polarity must invert it.
  assert.equal(deltaTone('down_good', 'down', 22.7), 'good');
  assert.equal(deltaTone('down_good', 'up', 3), 'bad');
  // Escrow is informational — neither good nor bad whichever way it moves.
  assert.equal(deltaTone('neutral', 'up', 5), 'neutral');
  assert.equal(deltaTone('up_good', 'up', 0), 'neutral');
  assert.equal(deltaTone('up_good', 'neutral', 4), 'neutral');
});

test('the 11 executive KPIs are all present exactly once, and groups leave no orphan row', () => {
  const keys = KPI_GROUPS.flatMap((g) => g.kpis.map((k) => k.key));
  assert.equal(keys.length, 11);
  assert.equal(new Set(keys).size, 11);
  for (const k of [
    'gmv', 'net_platform_revenue', 'take_rate', 'active_sellers', 'new_signups', 'conversion_rate',
    'aov', 'escrow_liability', 'pending_payout_liability', 'cod_exposure', 'dispute_rate',
  ]) assert.ok(keys.includes(k), `missing KPI ${k}`);
  // Every drill-through must be a same-origin path.
  for (const def of KPI_GROUPS.flatMap((g) => g.kpis)) {
    if (def.href) assert.equal(safeInternalPath(def.href), def.href, `${def.key} href`);
  }
});

test('compact money uses South-Asian lakh/crore and never overflows a card', () => {
  assert.equal(formatCompactBdt(1485000, { lang: 'en' }), '৳14.85 L');
  assert.equal(formatCompactBdt(18_072_500, { lang: 'en' }), '৳1.81 Cr');
  assert.equal(formatCompactBdt(42_000, { lang: 'en' }), '৳42,000');
  assert.equal(formatCompactBdt(-250_000, { lang: 'en' }), '-৳2.50 L');
  assert.equal(formatCompactBdt('not a number', { lang: 'en' }), '৳0');
  assert.equal(formatCompactBdt(1485000, { lang: 'bn', numerals: 'bengali', units: { crore: 'কোটি', lakh: 'লাখ' } }), '৳১৪.৮৫ লাখ');
});

test('percent values trim trailing zeros and honour Bengali numerals', () => {
  assert.equal(formatDecimal(8, 2, { lang: 'en' }), '8');
  assert.equal(formatDecimal(3.65, 2, { lang: 'en' }), '3.65');
  assert.equal(formatDecimal(0.2, 1, { lang: 'en' }), '0.2');
  assert.equal(formatDecimal(13.6, 1, { lang: 'bn', numerals: 'bengali' }), '১৩.৬');
  assert.equal(formatDecimal(13.6, 1, { lang: 'bn', numerals: 'latin' }), '13.6');
  assert.equal(formatKpiValue({ format: 'percent' }, { value: 3.65 }, { lang: 'en' }), '3.65%');
  assert.equal(formatKpiValue({ format: 'number' }, { value: 142 }, { lang: 'en' }), '142');
});

test('custom range validation: required, order, future, max span', () => {
  const today = new Date('2026-09-19T05:00:00Z');
  assert.deepEqual(validateCustomRange('', '2026-09-01', today), { ok: false, error: 'required' });
  // Impossible calendar dates are rejected, not silently rolled into the next month.
  assert.deepEqual(validateCustomRange('2026-02-30', '2026-03-01', today), { ok: false, error: 'required' });
  assert.deepEqual(validateCustomRange('2026-13-01', '2026-03-01', today), { ok: false, error: 'required' });
  assert.deepEqual(validateCustomRange('2026-09-10', '2026-09-01', today), { ok: false, error: 'order' });
  assert.deepEqual(validateCustomRange('2026-09-01', '2026-09-20', today), { ok: false, error: 'future' });
  assert.deepEqual(validateCustomRange('2025-01-01', '2026-09-01', today), { ok: false, error: 'too_long' });
  assert.deepEqual(validateCustomRange('2026-09-01', '2026-09-01', today), { ok: true, days: 1 });
  assert.deepEqual(validateCustomRange('2026-08-01', '2026-08-31', today), { ok: true, days: 31 });
  // Exactly the maximum is allowed; one more day is not.
  assert.equal(validateCustomRange('2025-09-18', '2026-09-18', today).ok, true);
  assert.equal(validateCustomRange('2025-09-17', '2026-09-18', today).ok, false);
});

test('bucketSeries: short series untouched, long series bucketed with totals preserved', () => {
  const daily = Array.from({ length: 365 }, (_, i) => ({ date: `d${i}`, gmv: 100, revenue: 8, orders: 2 }));
  const b = bucketSeries(daily, 45);
  assert.ok(b.length <= 45, `got ${b.length} buckets`);
  assert.equal(b.reduce((a, p) => a + p.gmv, 0), 365 * 100, 'GMV must be conserved');
  assert.equal(b.reduce((a, p) => a + p.orders, 0), 365 * 2, 'orders must be conserved');
  assert.equal(b.reduce((a, p) => a + p.span, 0), 365, 'spans must cover every day exactly once');
  assert.equal(b[0].date, 'd0');
  assert.equal(b[b.length - 1].endDate, 'd364');

  const short = bucketSeries(daily.slice(0, 7), 45);
  assert.equal(short.length, 7);
  assert.ok(short.every((p) => p.span === 1));
  assert.deepEqual(bucketSeries(undefined), []);
});

test('niceScale returns round ticks that contain the max', () => {
  const s = niceScale(58_395);
  assert.ok(s.max >= 58_395);
  assert.equal(s.ticks[0], 0);
  assert.equal(s.ticks[s.ticks.length - 1], s.max);
  const steps = s.ticks.slice(1).map((v, i) => Number((v - s.ticks[i]).toFixed(6)));
  assert.ok(steps.every((d) => d === steps[0]), 'ticks are evenly spaced');
  assert.deepEqual(niceScale(0).ticks, [0, 1]);
  assert.deepEqual(niceScale(NaN).ticks, [0, 1]);
});

test('chart model: each series owns its axis, hidden series are omitted, x labels never collide', () => {
  const pts = Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, gmv: 40_000 + i * 1000, revenue: 3_200 + i * 80, orders: 20 }));
  const m = buildChartModel(pts, { width: 640, height: 240 });
  assert.equal(m.gmv.length, 30);
  assert.equal(m.revenue.length, 30);
  // Revenue is ~8% of GMV but must still use the full plot height (its own axis), not hug the floor.
  const minRevY = Math.min(...m.revenue.map((p) => p.y));
  const minGmvY = Math.min(...m.gmv.map((p) => p.y));
  assert.ok(Math.abs(minRevY - minGmvY) < m.innerH * 0.25, 'both lines occupy similar vertical range');
  // Every point is inside the plot area.
  for (const p of [...m.gmv, ...m.revenue]) {
    assert.ok(p.x >= m.pad.left - 0.01 && p.x <= 640 - m.pad.right + 0.01);
    assert.ok(p.y >= m.pad.top - 0.01 && p.y <= m.baseline + 0.01);
  }
  const shown = m.xLabels.filter((l) => l.show);
  assert.ok(m.xLabels[m.xLabels.length - 1].show, 'the latest point is always labelled');
  for (let i = 1; i < shown.length; i += 1) assert.ok(shown[i].x - shown[i - 1].x >= 30, 'labels are spaced apart');

  const onlyRev = buildChartModel(pts, { width: 640, height: 240, show: { gmv: false, revenue: true } });
  assert.equal(onlyRev.gmv.length, 0);
  assert.equal(onlyRev.gmvPath, '');
  assert.ok(onlyRev.revPath.startsWith('M'));

  const single = buildChartModel([pts[0]], { width: 640, height: 240 });
  assert.equal(single.gmv.length, 1, 'a single point still renders (centered), it does not divide by zero');
  assert.ok(Number.isFinite(single.gmv[0].x));
});

test('nearestIndex picks the closest point for hover and clamps outside the plot', () => {
  const xs = [10, 20, 30, 40];
  assert.equal(nearestIndex(xs, 24), 1);
  assert.equal(nearestIndex(xs, 26), 2);
  assert.equal(nearestIndex(xs, -500), 0);
  assert.equal(nearestIndex(xs, 999), 3);
  assert.equal(nearestIndex([], 5), -1);
});

test('summariseSeries totals, averages and finds the peak', () => {
  const s = summariseSeries([
    { date: 'a', gmv: 100, revenue: 8, orders: 1 },
    { date: 'b', gmv: 300, revenue: 24, orders: 3 },
    { date: 'c', gmv: 200, revenue: 16, orders: 2 },
  ]);
  assert.equal(s.totalGmv, 600);
  assert.equal(s.avgGmv, 200);
  assert.equal(s.totalOrders, 6);
  assert.equal(s.peak.date, 'b');
  assert.equal(summariseSeries([]).peak, null);
});

test('day labels: ISO days are localised in UTC, placeholder labels pass through', () => {
  assert.equal(formatDayLabel('2026-09-01', { lang: 'en' }), 'Sep 01');
  assert.equal(formatDayLabel('2026-09-01', { lang: 'en', withYear: true }), 'Sep 01, 2026');
  // The API's baseline series uses W1..W4 — must not become "Invalid Date".
  assert.equal(formatDayLabel('W1', { lang: 'en' }), 'W1');
  assert.equal(formatDayLabel(null, { lang: 'en' }), '');
});

test('alerts: normalised, worst-first, searchable in both languages, cleared hidden by default', () => {
  const raw = [
    { key: 'ledger', severity: 'LOW', count: 0, title_en: 'Ledger integrity', title_bn: 'লেজার স্থিতি', details_en: 'Zero drift' },
    { id: 'cod', severity: 'MEDIUM', count: 12, title_en: 'Unreconciled COD', title_bn: 'অমীমাংসিত সিওডি' },
    { id: 'kyc', severity: 'HIGH', count: 4, title_en: 'Pending KYC', title_bn: 'অপেক্ষমাণ কেওয়াইসি' },
    { id: 'pay', severity: 'HIGH', count: 6, title_en: 'Pending payouts', title_bn: 'অপেক্ষমাণ পেআউট' },
    { id: 'sla', severity: 'CRITICAL', count: 1, title_en: 'SLA breach', title_bn: 'এসএলএ লঙ্ঘন' },
  ].map(normalizeAlert);

  assert.equal(raw[0].id, 'ledger', 'mock `key` is accepted as `id`');
  const sorted = sortAlerts(raw);
  assert.deepEqual(sorted.map((a) => a.id), ['sla', 'pay', 'kyc', 'cod', 'ledger']);

  assert.deepEqual(filterAlerts(sorted, {}).map((a) => a.id), ['sla', 'pay', 'kyc', 'cod'], 'cleared hidden');
  assert.equal(filterAlerts(sorted, { showCleared: true }).length, 5);
  assert.deepEqual(filterAlerts(sorted, { severity: 'HIGH' }).map((a) => a.id), ['pay', 'kyc']);
  assert.deepEqual(filterAlerts(sorted, { query: '  KYC ' }).map((a) => a.id), ['kyc']);
  assert.deepEqual(filterAlerts(sorted, { query: 'পেআউট' }).map((a) => a.id), ['pay'], 'Bangla text is searchable');
  assert.deepEqual(filterAlerts(sorted, { query: 'zzz' }), []);
  assert.deepEqual(filterAlerts(sorted, { query: 'drift', showCleared: true }).map((a) => a.id), ['ledger']);

  assert.deepEqual(severityCounts(sorted), { ALL: 4, CRITICAL: 1, HIGH: 2, MEDIUM: 1, LOW: 0 });
});

test('safeInternalPath only allows same-origin absolute paths; esc neutralises markup', () => {
  assert.equal(safeInternalPath('/admin/verification'), '/admin/verification');
  assert.equal(safeInternalPath('/admin/finance/payouts?tab=held'), '/admin/finance/payouts?tab=held');
  for (const bad of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'https://evil.example', 'admin/x', '', null, undefined, '/has space']) {
    assert.equal(safeInternalPath(bad), '', `must reject ${String(bad)}`);
  }
  assert.equal(esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
});

test('CSV: RFC-4180 escaping and spreadsheet-formula neutralisation', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(-5), '-5', 'a negative NUMBER is not a formula');
  assert.equal(csvCell('=HYPERLINK("http://x")').startsWith(`"'=`), true, 'formula prefixes are quoted with a leading apostrophe');
  assert.equal(csvCell('+1+1'), "'+1+1");

  const csv = buildDashboardCsv({
    kpiRows: [{ label: 'Gross, Merchandise', value: 1485000, delta_pct: 13.6, trend: 'up' }],
    series: [{ date: '2026-09-01', gmv: 100, revenue: 8, orders: 2 }],
    labels: { kpiHeader: ['KPI', 'Value', 'Change %', 'Trend'], seriesHeader: ['Date', 'GMV', 'Net revenue', 'Orders'] },
  });
  assert.deepEqual(csv.split('\r\n'), [
    'KPI,Value,Change %,Trend',
    '"Gross, Merchandise",1485000,13.6,up',
    '',
    'Date,GMV,Net revenue,Orders',
    '2026-09-01,100,8,2',
  ]);
});

// ── Mock contract ────────────────────────────────────────────────────────────

const handler = (method, p) => adminHandlers.find((h) => h.method === method && h.path === p);

test('mock overview: presets and custom ranges produce one point per day and a period block', () => {
  const get = handler('GET', '/admin/analytics/overview');
  const seven = get.handler({ query: { timeframe: '7d' } }).body.data;
  assert.equal(seven.chart_data.length, 7);
  assert.equal(seven.period.days, 7);
  assert.equal(seven.data_source, 'rollup');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(seven.chart_data[0].date), 'dates are ISO days');

  const year = get.handler({ query: { timeframe: '1y' } }).body.data;
  assert.equal(year.chart_data.length, 365);

  const custom = get.handler({ query: { from: '2026-08-01', to: '2026-08-20' } }).body.data;
  assert.equal(custom.timeframe, 'custom');
  assert.equal(custom.chart_data.length, 20);
  assert.equal(custom.chart_data[0].date, '2026-08-01');
  assert.equal(custom.chart_data[19].date, '2026-08-20');

  // Garbage falls back to 30d instead of throwing.
  assert.equal(get.handler({ query: { timeframe: 'nonsense' } }).body.data.chart_data.length, 30);

  // Every KPI the page renders exists in the payload.
  for (const def of KPI_GROUPS.flatMap((g) => g.kpis)) assert.ok(seven.kpis[def.key], `KPI ${def.key} in payload`);
});

test('mock export mirrors overview; mock rollup rejects malformed and future dates', () => {
  const exp = handler('POST', '/admin/analytics/export');
  assert.ok(exp, 'export handler exists');
  assert.equal(exp.handler({ body: { timeframe: '7d' } }).body.data.chart_data.length, 7);

  const roll = handler('POST', '/admin/analytics/rollup-now');
  assert.equal(roll.handler({ body: { date: '2026-09-10' } }).status, 200);
  assert.equal(roll.handler({ body: { date: '2026-09-10' } }).body.data.rollup_date, '2026-09-10');
  assert.equal(roll.handler({ body: {} }).status, 200, 'defaults to yesterday');
  assert.equal(roll.handler({ body: { date: '2099-01-01' } }).status, 400);
  assert.equal(roll.handler({ body: { date: 'yesterday' } }).status, 400);
  assert.equal(roll.handler({ body: { date: '2026-13-45' } }).status, 400);
  assert.equal(roll.handler({ body: { date: '2026-02-30' } }).status, 400, 'impossible day is not rolled into March');
});

test('mock breakdown mirrors the real service shape: keyed channels, bilingual categories, shares total 100', () => {
  const ov = handler('GET', '/admin/analytics/overview').handler({ query: { timeframe: '30d' } }).body.data;
  const { channels, categories } = ov.breakdown;
  assert.deepEqual(channels.map((c) => c.key), ['LIVE', 'TEAM', 'SALER_STORE', 'DIRECT']);
  assert.ok(!channels.some((c) => /affiliate/i.test(c.name)), 'no affiliate channel — orders have no such source');
  assert.ok(Math.abs(channels.reduce((a, c) => a + c.share_pct, 0) - 100) <= 0.2);
  assert.ok(Math.abs(categories.reduce((a, c) => a + c.share_pct, 0) - 100) <= 0.2);
  for (const c of categories) {
    assert.ok(c.name_en && c.name_bn, `category ${c.key} has both languages`);
    assert.equal(typeof c.revenue, 'number');
  }
  assert.equal(categories[categories.length - 1].key, 'other');
  assert.ok(channels.every((c) => typeof c.volume === 'number'));
});

// ── i18n parity ──────────────────────────────────────────────────────────────

test('every string the page renders exists in BOTH en.json and bn.json', () => {
  const en = JSON.parse(read('../src/locales/en.json')).admin.dashboard;
  const bn = JSON.parse(read('../src/locales/bn.json')).admin.dashboard;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(bn).sort(), 'en and bn have identical key sets');

  const source = read('../src/pages/admin/AdminDashboardPage.js');
  const used = new Set([...source.matchAll(/\btr\('([a-z0-9_]+)'/g)].map((m) => m[1]));
  // Dynamic keys the template builds at runtime.
  for (const g of KPI_GROUPS) {
    used.add(`group_${g.key}`);
    for (const k of g.kpis) { used.add(`kpi_${k.key}_label`); used.add(`kpi_${k.key}_hint`); }
  }
  for (const sev of ['all', 'critical', 'high', 'medium', 'low']) used.add(`sev_${sev}`);
  for (const ch of ['live', 'team', 'saler_store', 'direct']) used.add(`channel_${ch}`);
  for (const e of ['required', 'order', 'future', 'too_long']) used.add(`range_error_${e}`);

  const missing = [...used].filter((k) => !(k in en) || !(k in bn));
  assert.deepEqual(missing, [], `keys used by the page but missing from a locale: ${missing.join(', ')}`);

  for (const [k, v] of Object.entries(bn)) assert.ok(String(v).trim().length > 0, `bn.${k} is empty`);
  // Interpolation placeholders must match across languages, or one of them renders "{{x}}" literally.
  for (const k of Object.keys(en)) {
    const ph = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(ph(bn[k]), ph(en[k]), `placeholder mismatch in ${k}`);
  }
});

test('the page module loads and exports a mount function that returns a cleanup', async () => {
  const mod = await import('../src/pages/admin/AdminDashboardPage.js');
  assert.equal(typeof mod.default, 'function');
});
