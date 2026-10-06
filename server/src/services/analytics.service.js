/**
 * analytics.service.js — Super Admin Executive Analytics & Health Service (Prompt 11.4 / Master Spec §AL.4).
 *
 * Implements:
 * 1. Nightly rollup worker saving pre-aggregated daily summaries into daily_analytics_rollups.
 * 2. 11 Executive KPIs with period-over-period delta calculation.
 * 3. Operational Action Alert cards with 1-click deep-link mapping to remedy pages.
 * 4. System Health Hub (API Latency percentiles, Error rates, Cache/DB pool status, Webhook DLQ, Job runs).
 * 5. Verifiable Backup Snapshot Engine with SHA-256 state checksums.
 */

import { createHash } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.js';

// ---------------------------------------------------------------------------
// Sales breakdowns (categories + channels) — derived from real orders
// ---------------------------------------------------------------------------

/** Shape marker inside `breakdown_json`. Rows written before v2 held invented percentages. */
export const BREAKDOWN_VERSION = 2;

/**
 * The channels an order can be attributed to, in display order. Only channels the schema can
 * actually distinguish are listed: there is no affiliate/referral attribution on `orders`, so an
 * "Affiliate Links" bar would be invented — it stays out until an order-level source exists.
 */
export const SALES_CHANNELS = [
  { key: 'LIVE', name: 'Live Stream' },
  { key: 'TEAM', name: 'Team Social Buying' },
  { key: 'SALER_STORE', name: 'Saler Storefronts' },
  { key: 'DIRECT', name: 'Direct (Supplier Listing)' },
];

/**
 * One row per channel for the day. An order lands in exactly ONE channel, first match wins:
 * a live-stream purchase made through a saler's store is a LIVE sale, so the shares add up to
 * 100% of orders instead of double-counting. Sales = orders.total_amount, the same basis the
 * rollup's GMV uses, so the bars reconcile with the GMV KPI.
 */
export const CHANNEL_BREAKDOWN_SQL = `
  SELECT
    CASE
      WHEN o.live_stream_id IS NOT NULL THEN 'LIVE'
      WHEN o.team_purchase_id IS NOT NULL THEN 'TEAM'
      WHEN EXISTS (SELECT 1 FROM sub_orders so WHERE so.order_id = o.id AND so.saler_id IS NOT NULL) THEN 'SALER_STORE'
      ELSE 'DIRECT'
    END AS channel,
    COUNT(*)::int AS orders,
    COALESCE(SUM(o.total_amount), 0) AS sales
  FROM orders o
  WHERE DATE(o.created_at) = $1
  GROUP BY 1`;

/**
 * Sales per TOP-LEVEL category for the day. Leaf categories ("Men's Clothing") roll up to their
 * root ("Fashion & Apparel") through the materialised `path`, so the chart shows a handful of
 * meaningful buckets instead of dozens of sub-categories. Sales = order_items.line_total.
 */
export const CATEGORY_BREAKDOWN_SQL = `
  SELECT
    rc.id, rc.slug, rc.name_en, rc.name_bn,
    COALESCE(SUM(oi.line_total), 0) AS sales,
    COALESCE(SUM(oi.qty), 0)::int AS units
  FROM order_items oi
  JOIN sub_orders so ON so.id = oi.sub_order_id
  JOIN orders o ON o.id = so.order_id
  JOIN products p ON p.id = oi.product_id
  JOIN categories c ON c.id = p.category_id
  JOIN categories rc ON rc.path = split_part(c.path, '.', 1) AND rc.parent_id IS NULL
  WHERE DATE(o.created_at) = $1
  GROUP BY rc.id, rc.slug, rc.name_en, rc.name_bn
  ORDER BY sales DESC`;

const money = (v) => Number(parseFloat(v || 0).toFixed(2));

/**
 * The stored per-day breakdown that the overview later sums.
 *
 * WHY these queries are NOT wrapped in `.catch(() => fallback)` like the KPI queries above: that
 * pattern is how `platform_fee` (a column that was never created) silently turned Net Revenue into
 * `gmv * 0.08` forever. A broken breakdown query should fail the rollup loudly, not paint
 * plausible-looking made-up bars.
 */
export async function computeDailyBreakdown(db, day) {
  const { rows: channelRows } = await db.query(CHANNEL_BREAKDOWN_SQL, [day]);
  const { rows: categoryRows } = await db.query(CATEGORY_BREAKDOWN_SQL, [day]);
  return {
    version: BREAKDOWN_VERSION,
    channels: channelRows.map((r) => ({ key: r.channel, orders: Number(r.orders) || 0, sales: money(r.sales) })),
    categories: categoryRows.map((r) => ({
      id: Number(r.id),
      slug: r.slug,
      name_en: r.name_en,
      name_bn: r.name_bn,
      sales: money(r.sales),
      units: Number(r.units) || 0,
    })),
  };
}

function parseBreakdown(raw) {
  if (!raw) return null;
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return value && value.version === BREAKDOWN_VERSION ? value : null;
}

const pctOf = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

/**
 * Sums the stored daily breakdowns across the requested window into ranked shares.
 *
 * Days whose row predates v2 (or has no breakdown) contribute nothing rather than fake numbers —
 * re-running the rollup for a date backfills it. With no real data at all both lists are empty and
 * the UI says so. Categories beyond the top N fold into "Other" so the shares still total 100%.
 */
export function aggregateBreakdown(rollupRows = [], { topCategories = 5 } = {}) {
  const categories = new Map();
  const channels = new Map();

  for (const row of rollupRows) {
    const b = parseBreakdown(row.breakdown_json);
    if (!b) continue;
    for (const c of b.categories || []) {
      const acc = categories.get(c.id) || { id: c.id, slug: c.slug, name_en: c.name_en, name_bn: c.name_bn, sales: 0, units: 0 };
      acc.sales += Number(c.sales) || 0;
      acc.units += Number(c.units) || 0;
      categories.set(c.id, acc);
    }
    for (const c of b.channels || []) {
      const acc = channels.get(c.key) || { sales: 0, orders: 0 };
      acc.sales += Number(c.sales) || 0;
      acc.orders += Number(c.orders) || 0;
      channels.set(c.key, acc);
    }
  }

  const ranked = [...categories.values()].sort((a, b) => b.sales - a.sales);
  const categoryTotal = ranked.reduce((a, c) => a + c.sales, 0);
  const head = ranked.slice(0, topCategories);
  const tail = ranked.slice(topCategories);
  const categoryOut = categoryTotal > 0
    ? head.map((c) => ({
        id: c.id,
        key: c.slug,
        name: c.name_en,
        name_en: c.name_en,
        name_bn: c.name_bn,
        share_pct: pctOf(c.sales, categoryTotal),
        revenue: money(c.sales),
        units: c.units,
      }))
    : [];
  if (categoryTotal > 0 && tail.length > 0) {
    const otherSales = tail.reduce((a, c) => a + c.sales, 0);
    categoryOut.push({
      id: null,
      key: 'other',
      name: 'Other',
      name_en: 'Other',
      name_bn: 'অন্যান্য',
      share_pct: pctOf(otherSales, categoryTotal),
      revenue: money(otherSales),
      units: tail.reduce((a, c) => a + c.units, 0),
    });
  }

  const channelTotal = [...channels.values()].reduce((a, c) => a + c.sales, 0);
  const channelOut = channelTotal > 0
    ? SALES_CHANNELS.map(({ key, name }) => {
        const c = channels.get(key) || { sales: 0, orders: 0 };
        return { key, name, share_pct: pctOf(c.sales, channelTotal), volume: money(c.sales), orders: c.orders };
      })
    : [];

  return { categories: categoryOut, channels: channelOut };
}

/**
 * Executes or re-calculates the daily analytics summary for a specific date (defaults to yesterday or given date).
 */
export async function runDailyRollup(db, targetDate = null) {
  const dateStr = targetDate || new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // 1. Aggregate (WHY sub_orders: `orders` has no status column — fulfilment status lives on
  // sub_orders, so an order counts as delivered/cancelled/returned if any of its parts is) Orders & GMV for the date
  const { rows: orderAgg } = await db.query(
    `SELECT
       COALESCE(SUM(total_amount), 0) as gmv,
       COUNT(*) as total_orders,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM sub_orders so WHERE so.order_id = orders.id AND so.status = 'DELIVERED')) as delivered_orders,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM sub_orders so WHERE so.order_id = orders.id AND so.status = 'CANCELLED')) as cancelled_orders,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM sub_orders so WHERE so.order_id = orders.id AND so.status = 'RETURNED')) as returned_orders,
       COALESCE(AVG(total_amount), 0) as aov
     FROM orders
     WHERE DATE(created_at) = $1`,
    [dateStr]
  );

  const gmv = parseFloat(orderAgg[0]?.gmv || 0);
  const totalOrders = parseInt(orderAgg[0]?.total_orders || 0, 10);
  const deliveredOrders = parseInt(orderAgg[0]?.delivered_orders || 0, 10);
  const cancelledOrders = parseInt(orderAgg[0]?.cancelled_orders || 0, 10);
  const returnedOrders = parseInt(orderAgg[0]?.returned_orders || 0, 10);
  const aov = parseFloat(orderAgg[0]?.aov || 0);

  // 2. Aggregate Platform Net Revenue (platform's share of the retail margin).
  // WHY no .catch fallback: this used to read a non-existent `platform_fee` column and swallow
  // the error, so Net Revenue was silently `gmv * 0.08`. A broken query must fail loudly.
  const { rows: revAgg } = await db.query(
    `SELECT COALESCE(SUM(platform_margin), 0) as net_revenue
     FROM sub_orders
     WHERE DATE(created_at) = $1 AND status != 'CANCELLED'`,
    [dateStr]
  );

  const platformNetRevenue = parseFloat(revAgg[0]?.net_revenue || 0);
  const takeRatePct = gmv > 0 ? parseFloat(((platformNetRevenue / gmv) * 100).toFixed(2)) : 8.00;

  // 3. User signups on the target date
  // WHY the roles join + no .catch: user_roles has role_id (not a role text column), and the old
  // query's error was swallowed, so signups read 0 forever. Fail loudly instead.
  const { rows: userAgg } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE r.key = 'customer' OR r.key IS NULL) as new_customers,
       COUNT(*) FILTER (WHERE r.key = 'saler') as new_salers,
       COUNT(*) FILTER (WHERE r.key = 'supplier') as new_suppliers
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE DATE(u.created_at) = $1`,
    [dateStr]
  );

  const newCustomers = parseInt(userAgg[0]?.new_customers || 0, 10);
  const newSalers = parseInt(userAgg[0]?.new_salers || 0, 10);
  const newSuppliers = parseInt(userAgg[0]?.new_suppliers || 0, 10);

  // 4. Active sellers count
  const { rows: sellerAgg } = await db.query(
    `SELECT COUNT(DISTINCT ur.user_id) as active_sellers
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     JOIN users u ON u.id = ur.user_id
     WHERE r.key IN ('saler', 'supplier') AND u.status = 'ACTIVE'`
  );
  const activeSellersCount = parseInt(sellerAgg[0]?.active_sellers || 0, 10);

  // 5. Escrow and Payout liabilities
  // WHY no .catch: both tables exist; a swallowed error would store 0 liability for the day.
  const { rows: escrowAgg } = await db.query(
    `SELECT COALESCE(SUM(held_balance), 0) as escrow_liability FROM wallets`
  );
  const escrowLiability = parseFloat(escrowAgg[0]?.escrow_liability || 0);

  const { rows: payoutAgg } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) as pending_payouts
     FROM payout_requests
     WHERE status IN ('PENDING', 'PROCESSING')`
  );
  const pendingPayoutLiability = parseFloat(payoutAgg[0]?.pending_payouts || 0);

  // 6. COD Exposure: cash still to be collected on COD sub-orders that are packed or on the road.
  // WHY these statuses / no .catch: 'DISPATCHED' is not a sub_orders status (the real ones are
  // PACKED, SHIPPED, IN_TRANSIT), so the old filter matched at most PACKED and the swallowed error
  // path hid any breakage.
  const { rows: codAgg } = await db.query(
    `SELECT COALESCE(SUM(so.total_amount), 0) as cod_exposure
     FROM sub_orders so
     JOIN orders o ON o.id = so.order_id
     WHERE o.payment_method = 'COD' AND so.status IN ('PACKED', 'SHIPPED', 'IN_TRANSIT')`
  );
  const codExposure = parseFloat(codAgg[0]?.cod_exposure || 0);

  // 7. Disputes
  const { rows: disputeAgg } = await db.query(
    `SELECT COUNT(*) as dispute_count
     FROM dispute_threads
     WHERE DATE(created_at) = $1`,
    [dateStr]
  );
  const disputeCount = parseInt(disputeAgg[0]?.dispute_count || 0, 10);
  const disputeRatePct = totalOrders > 0 ? parseFloat(((disputeCount / totalOrders) * 100).toFixed(2)) : 0.00;

  // 8. Conversion rate = orders / tracked visits that day.
  // WHY short_link_clicks: it is the only visit signal the platform records (no site-wide page-view
  // table exists), so this is conversion of tracked traffic, not of all visitors. It used to be the
  // literal 3.42 for every day. No clicks -> 0, never an invented figure; capped at 100 because
  // orders can also arrive without a tracked click.
  const { rows: visitAgg } = await db.query(
    `SELECT COUNT(*) as visits FROM short_link_clicks WHERE DATE(clicked_at) = $1`,
    [dateStr]
  );
  const visits = parseInt(visitAgg[0]?.visits || 0, 10);
  const conversionRatePct = visits > 0
    ? Math.min(100, parseFloat(((totalOrders / visits) * 100).toFixed(2)))
    : 0.00;

  const breakdown = await computeDailyBreakdown(db, dateStr);

  // 9. Persist into daily_analytics_rollups
  const { rows: inserted } = await db.query(
    `INSERT INTO daily_analytics_rollups (
       rollup_date, gmv, platform_net_revenue, total_orders, delivered_orders,
       cancelled_orders, returned_orders, aov, take_rate_pct, active_sellers_count,
       new_customers_count, new_salers_count, new_suppliers_count,
       escrow_liability, pending_payout_liability, cod_exposure,
       dispute_count, dispute_rate_pct, conversion_rate_pct, breakdown_json, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW())
     ON CONFLICT (rollup_date) DO UPDATE
     SET gmv = EXCLUDED.gmv,
         platform_net_revenue = EXCLUDED.platform_net_revenue,
         total_orders = EXCLUDED.total_orders,
         delivered_orders = EXCLUDED.delivered_orders,
         cancelled_orders = EXCLUDED.cancelled_orders,
         returned_orders = EXCLUDED.returned_orders,
         aov = EXCLUDED.aov,
         take_rate_pct = EXCLUDED.take_rate_pct,
         active_sellers_count = EXCLUDED.active_sellers_count,
         new_customers_count = EXCLUDED.new_customers_count,
         new_salers_count = EXCLUDED.new_salers_count,
         new_suppliers_count = EXCLUDED.new_suppliers_count,
         escrow_liability = EXCLUDED.escrow_liability,
         pending_payout_liability = EXCLUDED.pending_payout_liability,
         cod_exposure = EXCLUDED.cod_exposure,
         dispute_count = EXCLUDED.dispute_count,
         dispute_rate_pct = EXCLUDED.dispute_rate_pct,
         conversion_rate_pct = EXCLUDED.conversion_rate_pct,
         breakdown_json = EXCLUDED.breakdown_json
     RETURNING *`,
    [
      dateStr, gmv, platformNetRevenue, totalOrders, deliveredOrders,
      cancelledOrders, returnedOrders, aov, takeRatePct, activeSellersCount,
      newCustomers, newSalers, newSuppliers,
      escrowLiability, pendingPayoutLiability, codExposure,
      disputeCount, disputeRatePct, conversionRatePct, JSON.stringify(breakdown),
    ]
  );

  return inserted[0];
}

const DAY_MS = 86_400_000;
export const MAX_OVERVIEW_RANGE_DAYS = 366;
const PRESET_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Formats a Date in UTC as YYYY-MM-DD. */
function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Normalises a DATE column to `YYYY-MM-DD`. node-postgres hands DATE back as a JS Date at *local*
 * midnight, so `toISOString()` would shift it a day back east of UTC (Bangladesh is UTC+6) and
 * `String(date).slice(5, 10)` — what this used to do — yields "ep 01" from "Tue Sep 01 2026".
 */
export function toDayString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${m}-${d}`;
  }
  return '';
}

function assertIsoDay(value, field) {
  // Round-trip, because Date.parse('2026-02-30') is accepted by V8 and quietly means 2 March.
  // (toISOString() throws on an Invalid Date, so check the timestamp before formatting it.)
  const parsed = typeof value === 'string' && ISO_DAY.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  const isRealDay = parsed !== null && !Number.isNaN(parsed.getTime()) && utcDay(parsed) === value;
  if (!isRealDay) {
    throw new AppError(
      'VALIDATION_FAILED',
      `${field} must be a valid YYYY-MM-DD date.`,
      `${field} অবশ্যই বৈধ YYYY-MM-DD তারিখ হতে হবে।`,
      { field }
    );
  }
  return value;
}

/**
 * Resolves the requested window into concrete dates.
 *
 * A custom `from`/`to` pair wins over the preset. Both bounds are bound as query parameters — the
 * old code interpolated a computed `days` into the SQL string, which was safe only because it was
 * a number; parameters keep it safe by construction.
 *
 * The comparison window is the same length immediately before `from`, so every delta compares
 * like with like.
 */
export function resolveOverviewRange({ timeframe = '30d', from = null, to = null } = {}, today = new Date()) {
  const todayStr = utcDay(today);

  if (from || to) {
    if (!from || !to) {
      throw new AppError('VALIDATION_FAILED', 'Both from and to are required for a custom range.', 'কাস্টম রেঞ্জের জন্য from ও to উভয়ই প্রয়োজন।', { field: from ? 'to' : 'from' });
    }
    assertIsoDay(from, 'from');
    assertIsoDay(to, 'to');
    if (from > to) {
      throw new AppError('VALIDATION_FAILED', 'from must not be after to.', 'from তারিখ to তারিখের পরে হতে পারবে না।', { field: 'from' });
    }
    if (to > todayStr) {
      throw new AppError('VALIDATION_FAILED', 'to must not be in the future.', 'to তারিখ ভবিষ্যতের হতে পারবে না।', { field: 'to' });
    }
    const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
    if (days > MAX_OVERVIEW_RANGE_DAYS) {
      throw new AppError('VALIDATION_FAILED', `A custom range may span at most ${MAX_OVERVIEW_RANGE_DAYS} days.`, `কাস্টম রেঞ্জ সর্বোচ্চ ${MAX_OVERVIEW_RANGE_DAYS} দিনের হতে পারবে।`, { field: 'to' });
    }
    return { timeframe: 'custom', days, from, to, prevFrom: utcDay(new Date(Date.parse(from) - days * DAY_MS)) };
  }

  const key = PRESET_DAYS[timeframe] ? timeframe : '30d';
  const days = PRESET_DAYS[key];
  // Same window the SQL used before (CURRENT_DATE - N days .. today), so preset numbers are unchanged.
  const start = utcDay(new Date(today.getTime() - days * DAY_MS));
  return { timeframe: key, days, from: start, to: todayStr, prevFrom: utcDay(new Date(today.getTime() - days * 2 * DAY_MS)) };
}

/** A rollup may only be (re)computed for a real day that has started. Defaults to yesterday. */
export function assertRollupDate(date, today = new Date()) {
  if (date == null || date === '') return utcDay(new Date(today.getTime() - DAY_MS));
  assertIsoDay(date, 'date');
  if (date > utcDay(today)) {
    throw new AppError('VALIDATION_FAILED', 'Rollup date must not be in the future.', 'রোলআপের তারিখ ভবিষ্যতের হতে পারবে না।', { field: 'date' });
  }
  return date;
}

/** The stored rollup for one day, or null — used as the audit row's `before` snapshot. */
export async function getRollupForDate(db, day) {
  const { rows } = await db.query(`SELECT * FROM daily_analytics_rollups WHERE rollup_date = $1`, [day]);
  return rows[0] || null;
}

/**
 * Returns Executive Overview with 11 KPIs and Period-over-Period comparisons.
 */
export async function getExecutiveOverview(db, { timeframe = '30d', from = null, to = null } = {}) {
  const range = resolveOverviewRange({ timeframe, from, to });

  // Current period rollups
  const { rows: currentRows } = await db.query(
    `SELECT * FROM daily_analytics_rollups
     WHERE rollup_date >= $1 AND rollup_date <= $2
     ORDER BY rollup_date ASC`,
    [range.from, range.to]
  );

  // Previous comparison period rollups (same length, immediately before `from`)
  const { rows: prevRows } = await db.query(
    `SELECT * FROM daily_analytics_rollups
     WHERE rollup_date >= $1 AND rollup_date < $2
     ORDER BY rollup_date ASC`,
    [range.prevFrom, range.from]
  );

  // When the rollups were last actually computed — the UI shows this so an admin can tell a stale
  // dashboard from a live one. (This used to report `new Date()`, i.e. always "just now".)
  const { rows: lastRows } = await db.query(`SELECT MAX(created_at) AS last_rollup_at FROM daily_analytics_rollups`);
  const lastRollupRaw = lastRows[0]?.last_rollup_at ?? null;
  const lastRollupAt = lastRollupRaw ? new Date(lastRollupRaw).toISOString() : null;

  // Helper to aggregate rows
  const sumField = (arr, field) => arr.reduce((acc, r) => acc + parseFloat(r[field] || 0), 0);
  const avgField = (arr, field) => arr.length > 0 ? sumField(arr, field) / arr.length : 0;
  const latestField = (arr, field) => arr.length > 0 ? parseFloat(arr[arr.length - 1][field] || 0) : 0;

  // Compute Current Metrics
  const curGmv = sumField(currentRows, 'gmv');
  const curRev = sumField(currentRows, 'platform_net_revenue');
  const curOrders = sumField(currentRows, 'total_orders');
  const curAov = curOrders > 0 ? curGmv / curOrders : avgField(currentRows, 'aov');
  const curTakeRate = curGmv > 0 ? (curRev / curGmv) * 100 : avgField(currentRows, 'take_rate_pct');
  const curActiveSellers = latestField(currentRows, 'active_sellers_count');
  const curNewSignups = sumField(currentRows, 'new_customers_count') + sumField(currentRows, 'new_salers_count') + sumField(currentRows, 'new_suppliers_count');
  const curEscrow = latestField(currentRows, 'escrow_liability');
  const curPayout = latestField(currentRows, 'pending_payout_liability');
  const curCod = latestField(currentRows, 'cod_exposure');
  const curDisputeRate = avgField(currentRows, 'dispute_rate_pct');
  const curConversionRate = avgField(currentRows, 'conversion_rate_pct');

  // WHY no placeholder block: with no rollups this used to substitute invented KPIs (GMV 1,485,000,
  // 142 sellers, ...) and invented "previous period" multipliers (x0.88, x0.92, ...), so the deltas
  // were fabricated too. Now every figure is the real sum (0 with no rows) and a missing comparison
  // period yields a neutral delta; `data_source: 'baseline'` tells the UI no rollup exists yet.

  // Previous Metrics (0 when the comparison window has no rollups -> calcDelta reports neutral)
  const prevGmv = sumField(prevRows, 'gmv');
  const prevRev = sumField(prevRows, 'platform_net_revenue');
  const prevOrders = sumField(prevRows, 'total_orders');
  const prevAov = prevOrders > 0 ? prevGmv / prevOrders : 0;
  const prevTakeRate = prevGmv > 0 ? (prevRev / prevGmv) * 100 : 0;
  const prevActiveSellers = latestField(prevRows, 'active_sellers_count');
  const prevNewSignups = sumField(prevRows, 'new_customers_count') + sumField(prevRows, 'new_salers_count') + sumField(prevRows, 'new_suppliers_count');
  const prevEscrow = latestField(prevRows, 'escrow_liability');
  const prevPayout = latestField(prevRows, 'pending_payout_liability');
  const prevCod = latestField(prevRows, 'cod_exposure');
  const prevDisputeRate = avgField(prevRows, 'dispute_rate_pct');
  const prevConversionRate = avgField(prevRows, 'conversion_rate_pct');

  // Compute Delta Helper
  const calcDelta = (curr, prev) => {
    if (!prev || prev === 0) return { delta_pct: 0, trend: 'neutral' };
    const pct = parseFloat((((curr - prev) / prev) * 100).toFixed(1));
    return {
      delta_pct: Math.abs(pct),
      trend: pct >= 0 ? 'up' : 'down',
      is_positive: pct >= 0,
    };
  };

  // Build Time-Series Chart Data for SVG Rendering
  const timeSeries = currentRows.map(r => ({
    date: toDayString(r.rollup_date),
    gmv: parseFloat(r.gmv || 0),
    revenue: parseFloat(r.platform_net_revenue || 0),
    orders: parseInt(r.total_orders || 0, 10),
  }));

  return {
    timeframe: range.timeframe,
    period: { from: range.from, to: range.to, days: range.days },
    // 'baseline' = no rollup exists yet, so every figure below is 0 and the chart is empty. The UI
    // says so rather than presenting zeros as measured telemetry.
    data_source: currentRows.length > 0 ? 'rollup' : 'baseline',
    kpis: {
      gmv: { value: curGmv, ...calcDelta(curGmv, prevGmv), format: 'currency' },
      net_platform_revenue: { value: curRev, ...calcDelta(curRev, prevRev), format: 'currency' },
      take_rate: { value: parseFloat(curTakeRate.toFixed(2)), ...calcDelta(curTakeRate, prevTakeRate), format: 'percent' },
      active_sellers: { value: Math.round(curActiveSellers), ...calcDelta(curActiveSellers, prevActiveSellers), format: 'number' },
      new_signups: { value: Math.round(curNewSignups), ...calcDelta(curNewSignups, prevNewSignups), format: 'number' },
      conversion_rate: { value: parseFloat(curConversionRate.toFixed(2)), ...calcDelta(curConversionRate, prevConversionRate), format: 'percent' },
      aov: { value: parseFloat(curAov.toFixed(2)), ...calcDelta(curAov, prevAov), format: 'currency' },
      escrow_liability: { value: curEscrow, ...calcDelta(curEscrow, prevEscrow), format: 'currency' },
      pending_payout_liability: { value: curPayout, ...calcDelta(curPayout, prevPayout), format: 'currency' },
      cod_exposure: { value: curCod, ...calcDelta(curCod, prevCod), format: 'currency' },
      dispute_rate: { value: parseFloat(curDisputeRate.toFixed(2)), ...calcDelta(curDisputeRate, prevDisputeRate), format: 'percent' },
    },
    chart_data: timeSeries,
    // Summed from the stored per-day breakdowns. Empty (not invented) when there is no rollup data.
    breakdown: aggregateBreakdown(currentRows),
    last_rollup_at: lastRollupAt,
  };
}

/**
 * Evaluates live operational action items and alert badges.
 * Every alert item includes a 1-click deep-link URL to the operational remedy page.
 */
export async function getOperationalAlerts(db) {
  // WHY no .catch on the queries below: each one used to fall back to 0 on any error, so a wrong
  // table/column/status silently pinned its alert at "all clear". A failing query now surfaces.
  // 1. Approval queue depth (KYC + Catalog moderation)
  const { rows: kycRows } = await db.query(
    `SELECT COUNT(*) as pending_kyc FROM kyc_verifications WHERE status = 'PENDING'`
  );
  const pendingKyc = parseInt(kycRows[0]?.pending_kyc || 0, 10);

  const { rows: modRows } = await db.query(
    `SELECT COUNT(*) as pending_products FROM products WHERE status = 'PENDING_APPROVAL'`
  );
  const pendingProducts = parseInt(modRows[0]?.pending_products || 0, 10);

  // 2. SLA breaches: warranty claims and disputes past their own stored sla_due_at.
  // WHY sla_due_at + UNDER_REVIEW: the claim status was spelled 'IN_REVIEW' (not a valid value), and
  // a hardcoded 72h ignored the deadline each row already carries. Disputes were promised by the
  // alert title but never counted.
  const { rows: slaRows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM warranty_claims
         WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'ESCALATED')
           AND sla_due_at IS NOT NULL AND sla_due_at < NOW()) as breached_claims,
       (SELECT COUNT(*) FROM dispute_threads
         WHERE status IN ('OPEN', 'UNDER_ARBITRATION', 'AWAITING_CUSTOMER', 'AWAITING_SELLER')
           AND sla_due_at IS NOT NULL AND sla_due_at < NOW()) as breached_disputes`
  );
  const breachedClaims = parseInt(slaRows[0]?.breached_claims || 0, 10)
    + parseInt(slaRows[0]?.breached_disputes || 0, 10);

  // 3. Double-entry ledger integrity
  // WHY ledger_transactions: `ledger_entries` / debit_amount / credit_amount never existed, so the
  // swallowed error made this report "zero drift" forever. Entries carry entry_type + amount.
  const { rows: driftRows } = await db.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE entry_type = 'DEBIT'), 0) as total_debits,
       COALESCE(SUM(amount) FILTER (WHERE entry_type = 'CREDIT'), 0) as total_credits
     FROM ledger_transactions`
  );
  const debits = parseFloat(driftRows[0]?.total_debits || 0);
  const credits = parseFloat(driftRows[0]?.total_credits || 0);
  const ledgerDifference = Math.abs(debits - credits);
  const ledgerDrift = ledgerDifference > 0.01;

  // 4. Failed or stuck payouts
  const { rows: failPayoutRows } = await db.query(
    `SELECT COUNT(*) as failed_payouts
     FROM payout_requests
     WHERE status = 'FAILED'`
  );
  const failedPayouts = parseInt(failPayoutRows[0]?.failed_payouts || 0, 10);

  // 5. Unreconciled COD orders
  // WHY cod_reconciliation + no .catch: `sub_orders.cod_settled_at` never existed — settlement is
  // tracked in cod_reconciliation (same MATCHED/RESOLVED definition as the finance dashboard), and
  // the swallowed error pinned this alert at 0. A delivered COD sub-order with no reconciliation
  // row yet is unreconciled too.
  const { rows: unrecCodRows } = await db.query(
    `SELECT COUNT(*) as unreconciled_cod
     FROM sub_orders so
     JOIN orders o ON o.id = so.order_id
     LEFT JOIN cod_reconciliation cr ON cr.sub_order_id = so.id
     WHERE o.payment_method = 'COD' AND so.status = 'DELIVERED'
       AND (cr.id IS NULL OR cr.status NOT IN ('MATCHED', 'RESOLVED'))`
  );
  const unreconciledCod = parseInt(unrecCodRows[0]?.unreconciled_cod || 0, 10);

  // 6. Dead-Letter Queue (DLQ) webhooks or stuck events
  const { rows: dlqRows } = await db.query(
    `SELECT COUNT(*) as dlq_count
     FROM webhook_deliveries
     WHERE status = 'DEAD_LETTER'`
  );
  const dlqCount = parseInt(dlqRows[0]?.dlq_count || 0, 10);

  const alerts = [
    {
      id: 'approval_queue',
      severity: (pendingKyc + pendingProducts) > 10 ? 'HIGH' : ((pendingKyc + pendingProducts) > 0 ? 'MEDIUM' : 'LOW'),
      title_en: 'Pending Verifications & Product Approvals',
      title_bn: 'অপেক্ষারত কেওয়াইসি ও পণ্য অনুমোদন',
      count: pendingKyc + pendingProducts,
      details_en: `${pendingKyc} KYC submissions and ${pendingProducts} products awaiting review.`,
      details_bn: `${pendingKyc}টি কেওয়াইসি এবং ${pendingProducts}টি পণ্য রিভিউ এর জন্য অপেক্ষারত।`,
      action_url: pendingKyc > 0 ? '/admin/verification' : '/admin/catalog/moderation',
      action_label_en: 'Review Queue',
      action_label_bn: 'রিভিউ করুন',
    },
    {
      id: 'sla_breaches',
      severity: breachedClaims > 0 ? 'CRITICAL' : 'LOW',
      title_en: 'Warranty & Dispute SLA Breaches',
      title_bn: 'ওয়ারেন্টি ও ডিসপুট এসএলএ লঙ্ঘন',
      count: breachedClaims,
      details_en: `${breachedClaims} claims breached the 72-hour resolution SLA window.`,
      details_bn: `${breachedClaims}টি দাবির ৭২ ঘণ্টার সময়সীমা পার হয়ে গেছে।`,
      action_url: '/moderator/disputes',
      action_label_en: 'Arbitrate Cases',
      action_label_bn: 'মীমাংসা করুন',
    },
    {
      id: 'ledger_drift',
      severity: ledgerDrift ? 'CRITICAL' : 'LOW',
      title_en: 'Double-Entry Ledger Integrity',
      title_bn: 'ডাবল-এন্ট্রি লেজার সমতা',
      count: ledgerDrift ? 1 : 0,
      details_en: ledgerDrift ? `Ledger drift detected: ৳${ledgerDifference.toFixed(2)} mismatch.` : 'Zero drift. All debits exactly match credits.',
      details_bn: ledgerDrift ? `লেজারে অমিল পাওয়া গেছে: ৳${ledgerDifference.toFixed(2)}।` : 'কোনো গরমিল নেই। ডেবিট ও ক্রেডিট সম্পূর্ণ সমান।',
      action_url: '/admin/finance/ledger',
      action_label_en: 'Inspect Ledger',
      action_label_bn: 'লেজার দেখুন',
    },
    {
      id: 'failed_payouts',
      severity: failedPayouts > 0 ? 'HIGH' : 'LOW',
      title_en: 'Failed Payout Disbursements',
      title_bn: 'ব্যর্থ পেআউট উত্তোলন',
      count: failedPayouts,
      details_en: `${failedPayouts} payout requests failed via bKash/Nagad/Bank API.`,
      details_bn: `${failedPayouts}টি উত্তোলন অনুরোধ ব্যর্থ হয়েছে।`,
      action_url: '/admin/finance/payouts',
      action_label_en: 'Resolve Payouts',
      action_label_bn: 'পেআউট দেখুন',
    },
    {
      id: 'unreconciled_cod',
      severity: unreconciledCod > 20 ? 'HIGH' : (unreconciledCod > 0 ? 'MEDIUM' : 'LOW'),
      title_en: 'Unreconciled Courier COD Backlog',
      title_bn: 'কুরিয়ার সিওডি বকেয়া নিষ্পত্তি',
      count: unreconciledCod,
      details_en: `${unreconciledCod} delivered COD shipments pending courier fund settlement.`,
      details_bn: `${unreconciledCod}টি ডেলিভার্ড অর্ডারের কুরিয়ার পেমেন্ট জমা হওয়া বাকি।`,
      action_url: '/admin/cod-reconciliation',
      action_label_en: 'Reconcile Remittance',
      action_label_bn: 'রিম্যিট্যান্স মেলান',
    },
    {
      id: 'dlq_webhooks',
      severity: dlqCount > 0 ? 'MEDIUM' : 'LOW',
      title_en: 'Dead-Letter Webhook Failures',
      title_bn: 'ব্যর্থ ওয়েবহুক ডেলিভারি (DLQ)',
      count: dlqCount,
      details_en: `${dlqCount} webhook events reached max retry limit in DLQ.`,
      details_bn: `${dlqCount}টি ওয়েবহুক সর্বোচ্চ চেষ্টার পর ব্যর্থ হয়েছে।`,
      action_url: '/admin/platform/api-keys',
      action_label_en: 'Inspect DLQ',
      action_label_bn: 'ওয়েবহুক দেখুন',
    },
  ];

  const criticalCount = alerts.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH').length;

  return {
    alerts,
    total_alerts: alerts.reduce((acc, a) => acc + (a.count > 0 ? 1 : 0), 0),
    critical_count: criticalCount,
    evaluated_at: new Date().toISOString(),
  };
}

/**
 * Returns System Health Vitals (API Latencies, Error Rate, DB Pool, Cache, Webhooks, Scheduler Job History).
 */
export async function getSystemHealth(db, cache = null, { metrics = null, config = null } = {}) {
  // 1. Scheduler Job Runs
  const { rows: jobRuns } = await db.query(
    `SELECT id, job_name, status, started_at, ended_at, duration_ms, error_count, processed_count
     FROM job_runs
     ORDER BY started_at DESC
     LIMIT 15`
  );

  // 2. Webhook deliveries health
  // WHY 'DELIVERED' / no .catch: 'SUCCESS' is not a webhook_deliveries status (PENDING, DELIVERED,
  // FAILED, DEAD_LETTER), so the success rate was computed from a status that never occurs, and a
  // swallowed error would have reported an empty queue as healthy.
  const { rows: webhookStats } = await db.query(
    `SELECT
       COUNT(*) as total_deliveries,
       COUNT(*) FILTER (WHERE status = 'DELIVERED') as successful_deliveries,
       COUNT(*) FILTER (WHERE status = 'DEAD_LETTER') as dlq_count,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as total_24h,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND status = 'DELIVERED') as delivered_24h,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND status IN ('FAILED', 'DEAD_LETTER')) as failed_24h
     FROM webhook_deliveries`
  );

  const totalWebhooks = parseInt(webhookStats[0]?.total_deliveries || 0, 10);
  const successWebhooks = parseInt(webhookStats[0]?.successful_deliveries || 0, 10);
  const dlqWebhooks = parseInt(webhookStats[0]?.dlq_count || 0, 10);

  // 3. Database: live pool counters plus a timed round trip.
  // WHY measured: this block used to be literals (4 active / 16 idle of 20). The pool counters are
  // pg's own; they are null when `db` is not a pg Pool (e.g. a test double) rather than invented.
  const queryStart = process.hrtime.bigint();
  const { rows: sizeRows } = await db.query(`SELECT pg_database_size(current_database()) AS size_bytes`);
  const dbLatencyMs = Math.round(Number(process.hrtime.bigint() - queryStart) / 1e4) / 100;
  const poolMax = db.options?.max ?? config?.database?.poolMax ?? null;
  const poolTotal = Number.isFinite(db.totalCount) ? db.totalCount : null;
  const poolIdle = Number.isFinite(db.idleCount) ? db.idleCount : null;
  const poolWaiting = Number.isFinite(db.waitingCount) ? db.waitingCount : null;
  const dbHealth = {
    // Clients are queueing for a connection => the pool is the bottleneck.
    status: poolWaiting > 0 ? 'DEGRADED' : 'HEALTHY',
    active_connections: poolTotal !== null && poolIdle !== null ? poolTotal - poolIdle : null,
    idle_connections: poolIdle,
    waiting_clients: poolWaiting,
    max_pool_size: poolMax,
    max_connections: poolMax,
    statement_timeout_ms: config?.database?.statementTimeoutMs ?? null,
    ssl_enabled: Boolean(db.options?.ssl),
    query_latency_ms: dbLatencyMs,
    database_size_bytes: sizeRows[0]?.size_bytes != null ? Number(sizeRows[0].size_bytes) : null,
  };

  // 4. Cache: real driver counters. Hit rate stays null until the cache has served a lookup.
  const cacheStats = typeof cache?.stats === 'function' ? await cache.stats() : null;
  const lookups = cacheStats ? cacheStats.hits + cacheStats.misses : 0;
  const cacheHealth = {
    status: cache ? 'HEALTHY' : 'UNAVAILABLE',
    driver: cache?.driver ?? null,
    keys_count: cacheStats?.keys ?? null,
    key_count: cacheStats?.keys ?? null,
    hit_rate_pct: lookups > 0 ? parseFloat(((cacheStats.hits / lookups) * 100).toFixed(1)) : null,
    memory_used_bytes: cacheStats?.memory_used_bytes ?? null,
  };

  // 5. API vitals from the requests this process actually served (see lib/requestMetrics.js).
  const m = metrics ? metrics.snapshot() : { sample_size: 0, p50_ms: null, p95_ms: null, p99_ms: null, error_rate_pct: null };
  const uptimeSeconds = Math.floor(process.uptime());
  const apiVitals = {
    p50_latency_ms: m.p50_ms,
    p95_latency_ms: m.p95_ms,
    p99_latency_ms: m.p99_ms,
    p50_ms: m.p50_ms,
    p95_ms: m.p95_ms,
    p99_ms: m.p99_ms,
    error_rate_pct: m.error_rate_pct,
    sample_size: m.sample_size,
    uptime_seconds: uptimeSeconds,
    uptime_human: `${Math.floor(uptimeSeconds / 86400)}d ${Math.floor((uptimeSeconds % 86400) / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
    node_version: process.version,
    platform: process.platform,
    heap_used_mb: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)} MB`,
  };

  // WHY derived: this was the literal 'OPERATIONAL'. 5% 5xx is the line where the API is failing
  // users rather than hiccuping.
  const degraded = dbHealth.status === 'DEGRADED' || (m.error_rate_pct !== null && m.error_rate_pct >= 5);

  return {
    overall_status: degraded ? 'DEGRADED' : 'OPERATIONAL',
    api_vitals: apiVitals,
    db_health: dbHealth,
    cache_health: cacheHealth,
    webhooks: {
      total: totalWebhooks,
      success_rate_pct: totalWebhooks > 0 ? parseFloat(((successWebhooks / totalWebhooks) * 100).toFixed(2)) : 100.00,
      dlq_depth: dlqWebhooks,
      total_24h: parseInt(webhookStats[0]?.total_24h || 0, 10),
      delivered_24h: parseInt(webhookStats[0]?.delivered_24h || 0, 10),
      failed_24h: parseInt(webhookStats[0]?.failed_24h || 0, 10),
    },
    job_runs: jobRuns,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Triggers a manual system backup snapshot.
 * Creates a deterministic SHA-256 state fingerprint across core tables. This records row counts and a
 * hash only; it does not copy any data, so it cannot be used to roll the database back.
 */
export async function triggerManualBackup(db, { userId = null, type = 'MANUAL' } = {}) {
  // 1. Gather table row counts
  const tables = ['users', 'orders', 'sub_orders', 'products', 'wallets', 'ledger_transactions', 'virtual_stores'];
  const tableCounts = {};
  let totalRows = 0;

  for (const tbl of tables) {
    // WHY no try/catch: a missing table used to be recorded as 0 rows, so a snapshot's checksum
    // looked valid while covering nothing (`ledger_entries` never existed). `tbl` is from the
    // fixed list above, never user input.
    const { rows } = await db.query(`SELECT COUNT(*) as count FROM ${tbl}`);
    const count = parseInt(rows[0]?.count || 0, 10);
    tableCounts[tbl] = count;
    totalRows += count;
  }

  // 2. Generate deterministic SHA-256 fingerprint
  const timestamp = Date.now();
  const rawFingerprint = JSON.stringify({
    counts: tableCounts,
    timestamp,
    salt: 'explooro-backup-integrity',
  });
  const checksum = createHash('sha256').update(rawFingerprint).digest('hex');

  const ref = `BAK-${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}-${Math.floor(100 + Math.random() * 900)}`;
  // WHY pg_database_size: this was `totalRows * 1024 + 65536`, an invented "snapshot size". No data is
  // copied, so there is no snapshot size; the honest measurable figure is the database's size at the
  // moment the fingerprint was taken.
  const { rows: sizeRows } = await db.query(`SELECT pg_database_size(current_database()) AS size_bytes`);
  const databaseSizeBytes = Number(sizeRows[0]?.size_bytes ?? 0);

  // 3. Persist record into system_backups
  const { rows: inserted } = await db.query(
    `INSERT INTO system_backups (
       ref, snapshot_type, sha256_checksum, table_counts_json, size_bytes,
       status, created_by, created_at
     )
     VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6, NOW())
     RETURNING *`,
    [ref, type, checksum, JSON.stringify(tableCounts), databaseSizeBytes, userId]
  );

  return inserted[0];
}

/**
 * Returns snapshot backup history.
 */
export async function getBackupHistory(db, { limit = 20 } = {}) {
  const { rows } = await db.query(
    `SELECT b.*,
            COALESCE(up.display_name, up.full_name) as created_by_name,
            COALESCE(rbp.display_name, rbp.full_name) as restored_by_name
     FROM system_backups b
     LEFT JOIN users u ON u.id = b.created_by
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN users rb ON rb.id = b.restored_by
     LEFT JOIN user_profiles rbp ON rbp.user_id = rb.id
     ORDER BY b.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return {
    backups: rows,
    total_count: rows.length,
  };
}

/**
 * Restores a backup snapshot (CRITICAL tier audited action).
 */
export async function restoreBackup(db, backupId, { userId = null } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM system_backups WHERE id = $1`,
    [backupId]
  );

  if (rows.length === 0) {
    throw new AppError('BACKUP_NOT_FOUND', 'The requested backup snapshot does not exist.', 404);
  }

  const backup = rows[0];

  // Audit and update status to RESTORED
  const { rows: updated } = await db.query(
    `UPDATE system_backups
     SET status = 'RESTORED',
         restored_at = NOW(),
         restored_by = $2
     WHERE id = $1
     RETURNING *`,
    [backupId, userId]
  );

  return {
    success: true,
    // WHY: this only flips the record's status. It does not roll any data back, so it must not say so.
    message_en: `Snapshot #${backup.ref} marked as restored. This records the action only; no data was rolled back.`,
    message_bn: `স্ন্যাপশট #${backup.ref} রিস্টোরড হিসেবে চিহ্নিত হয়েছে। এটি শুধু রেকর্ড; কোনো ডেটা ফিরিয়ে আনা হয়নি।`,
    backup: updated[0],
  };
}
