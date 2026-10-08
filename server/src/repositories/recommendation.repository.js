/**
 * recommendation.repository.js — Raw SQL for the blended ranking (Phase B).
 *
 * Two jobs: (1) buildBlendedRank turns a ranking spec into the SQL pieces listProducts splices into
 * the catalog query, so the score is computed across the whole filtered set BEFORE the LIMIT;
 * (2) three small reads that fetch the per-actor inputs the spec needs. No ORM — parameterized SQL.
 *
 * Every signal is normalised to 0..1 and multiplied by an admin-set weight, so the weights are
 * directly comparable. Penalties are subtracted. A weight of 0 omits the signal (and its join).
 */

/** Weights and tuning arrive sanitised by recommendation.service.js, but inlining is guarded anyway. */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const int = (v) => Math.max(0, Math.floor(num(v)));

/**
 * @param {object} spec
 * @param {object} spec.weights         sanitised weights (see recommendation.service.js)
 * @param {object} spec.tuning          sanitised tuning
 * @param {number[]} [spec.categoryIds] affinity sets
 * @param {string[]} [spec.brands]
 * @param {number[]} [spec.supplierIds]
 * @param {number[]} [spec.viewedIds]   recently opened, not bought
 * @param {number[]} [spec.purchasedIds] already bought
 * @param {string|null} [spec.district] the actor's district
 * @param {string} [spec.audience]
 * @param {any[]} params                the query's bound params; this pushes onto it
 * @returns {{joins: string, select: string, orderBy: string}}
 */
export function buildBlendedRank(spec, params) {
  const w = spec.weights;
  const t = spec.tuning;
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const joins = [];
  /** name -> already-weighted SQL expression (penalties negative) */
  const parts = {};
  // WHY unitSql is a thunk: bind() pushes a param, and a bound param the SQL never mentions makes
  // Postgres reject the whole statement. A signal switched off (weight 0) must bind nothing.
  const add = (name, weight, unitSql) => {
    if (num(weight) > 0) parts[name] = `(${num(weight)} * (${unitSql()}))`;
  };
  const subtract = (name, weight, unitSql) => {
    if (num(weight) > 0) parts[name] = `(-${num(weight)} * (${unitSql()}))`;
  };

  // ── Personal affinity ─────────────────────────────────────────────────────
  if (spec.categoryIds?.length) {
    add('affinity_category', w.affinity_category, () => `CASE WHEN p.category_id = ANY(${bind(spec.categoryIds)}::bigint[]) THEN 1 ELSE 0 END`);
  }
  if (spec.brands?.length) {
    add('affinity_brand', w.affinity_brand, () => `CASE WHEN lower(p.brand) = ANY(${bind(spec.brands.map((b) => String(b).toLowerCase()))}::text[]) THEN 1 ELSE 0 END`);
  }
  if (spec.supplierIds?.length) {
    add('affinity_supplier', w.affinity_supplier, () => `CASE WHEN p.supplier_id = ANY(${bind(spec.supplierIds)}::bigint[]) THEN 1 ELSE 0 END`);
  }
  if (spec.viewedIds?.length) {
    add('recently_viewed', w.recently_viewed, () => `CASE WHEN p.id = ANY(${bind(spec.viewedIds)}::bigint[]) THEN 1 ELSE 0 END`);
  }
  if (spec.district) {
    add('locality', w.locality, () => `CASE WHEN lower(up.district) = lower(${bind(spec.district)}::text) THEN 1 ELSE 0 END`);
  }

  // ── Trending: how far the last N hours exceed what the previous days predict ────────────────
  // A Poisson-style z-score, (observed − expected) / √(expected + 1), not a raw count: a raw count
  // can only ever rank what was already popular, while this lets a new product with 5 add-to-carts
  // today outrank an old one with 50 spread over a week. Squashed with z/(z+3) into 0..1.
  // WHY VIEW is excluded: impressions are VIEW events, so counting them measures what WE chose to
  // show, and the feed would trend whatever it showed last (a feedback loop). Intent events only.
  if (num(w.trending) > 0) {
    const recentH = Math.max(1, int(t.trend_recent_hours));
    const baseD = Math.max(1, int(t.trend_baseline_days));
    const baselineHours = Math.max(1, baseD * 24 - recentH);
    joins.push(`LEFT JOIN (
         SELECT product_id,
                SUM(weight) FILTER (WHERE created_at > now() - interval '${recentH} hours') AS recent_w,
                SUM(weight) AS window_w
         FROM product_interaction_events
         WHERE created_at > now() - interval '${baseD} days'
           AND event_type <> 'VIEW'
           AND audience = ${bind(spec.audience || 'customer')}
         GROUP BY product_id
       ) tr ON tr.product_id = p.id`);
    const expected = `(GREATEST(0, COALESCE(tr.window_w, 0) - COALESCE(tr.recent_w, 0)) / ${baselineHours} * ${recentH})`;
    const z = `(GREATEST(0, COALESCE(tr.recent_w, 0) - ${expected}) / SQRT(${expected} + 1))`;
    add('trending', w.trending, () => `${z} / (${z} + 3)`);
  }

  // ── Best seller: all-time and recent, both log-scaled so one hit does not drown the catalog ───
  add('bestseller', w.bestseller, () => `LEAST(1, LN(1 + p.sold_count) / LN(1 + ${Math.max(2, int(t.bestseller_cap))}))`);
  if (num(w.recent_sales) > 0) {
    const days = Math.max(1, int(t.recent_sales_days));
    joins.push(`LEFT JOIN (
         SELECT oi.product_id, SUM(oi.qty) AS qty
         FROM order_items oi
         JOIN sub_orders so ON so.id = oi.sub_order_id
         WHERE oi.created_at > now() - interval '${days} days'
           AND so.status NOT IN ('CANCELLED', 'RETURNED', 'REFUNDED')
         GROUP BY oi.product_id
       ) rs ON rs.product_id = p.id`);
    add('recent_sales', w.recent_sales, () => `LEAST(1, LN(1 + COALESCE(rs.qty, 0)) / LN(1 + ${Math.max(2, int(t.recent_sales_cap))}))`);
  }

  // ── Quality: Bayesian-smoothed rating ─────────────────────────────────────────────────────
  // (n·avg + m·prior) / (n + m): with few reviews the score stays near the prior, so a 2-review 5.0
  // does not beat a 400-review 4.7, and an unrated product is neutral rather than zero.
  const m = Math.max(1, num(t.quality_prior_count));
  add(
    'quality',
    w.quality,
    () => `((p.rating_count * COALESCE(p.rating_avg, 0) + ${m} * ${num(t.quality_prior_mean)}) / (p.rating_count + ${m})) / 5`
  );

  // ── Freshness: halves every `freshness_halflife_days`, so a new listing gets exposure ─────────
  add(
    'freshness',
    w.freshness,
    () => `POWER(0.5, GREATEST(0, EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400) / ${Math.max(1, num(t.freshness_halflife_days))})`
  );

  // ── Supplier trust ────────────────────────────────────────────────────────────────────────
  add('trust_tier', w.trust_tier, () => `CASE ts.tier WHEN 'ELITE_PARTNER' THEN 1 WHEN 'VERIFIED_TRADER' THEN 0.5 ELSE 0 END`);

  // ── Penalties ─────────────────────────────────────────────────────────────────────────────
  subtract('out_of_stock_penalty', w.out_of_stock_penalty, () => `CASE WHEN p.stock_qty <= 0 THEN 1 ELSE 0 END`);
  subtract('return_rate_penalty', w.return_rate_penalty, () => `COALESCE(ts.return_rate, 0) / 100`);
  if (spec.purchasedIds?.length) {
    subtract('already_bought_penalty', w.already_bought_penalty, () => `CASE WHEN p.id = ANY(${bind(spec.purchasedIds)}::bigint[]) THEN 1 ELSE 0 END`);
  }

  const names = Object.keys(parts);
  const scoreSql = names.length ? names.map((n) => parts[n]).join(' + ') : '0';
  const componentsSql = names.length
    ? `json_build_object(${names.map((n) => `'${n}', (${parts[n]})::float8`).join(', ')})`
    : `'{}'::json`;

  return {
    joins: joins.join('\n     '),
    select: `,\n            (${scoreSql})::float8 AS rank_score,\n            ${componentsSql} AS rank_components`,
    // WHY the alias: Postgres allows a bare output alias in ORDER BY, so the expression (and its
    // bound params) is written once. It also can never be read as a column position.
    orderBy: 'rank_score DESC',
  };
}

/**
 * Products the actor opened (tap or search-click, or lingered on) recently and has not bought.
 * WHY not VIEW: a card impression is a VIEW event, so VIEW cannot tell "looked at" from "was shown".
 */
export async function getRecentlyViewedIds(db, { userId, sessionId, audience = 'customer', windowDays = 14, limit = 12 }) {
  if (!userId && !sessionId) return [];
  const params = [userId || sessionId, audience, windowDays, limit];
  const { rows } = await db.query(
    `SELECT e.product_id, MAX(e.created_at) AS last_at
     FROM product_interaction_events e
     WHERE ${userId ? 'e.user_id' : 'e.session_id'} = $1
       AND e.audience = $2
       AND e.event_type IN ('CLICK', 'SEARCH_CLICK', 'DWELL')
       AND e.created_at > now() - ($3 || ' days')::interval
       AND NOT EXISTS (
         SELECT 1 FROM product_interaction_events b
         WHERE b.product_id = e.product_id AND b.event_type = 'PURCHASE'
           AND ${userId ? 'b.user_id' : 'b.session_id'} = $1
           AND b.created_at > e.created_at
       )
     GROUP BY e.product_id
     ORDER BY last_at DESC
     LIMIT $4`,
    params
  );
  return rows.map((r) => Number(r.product_id)).filter(Number.isFinite);
}

/**
 * Products the actor already bought. Real orders for a signed-in customer (the PURCHASE event is
 * client-reported, so it is not trusted for this), plus PURCHASE events for the actor, which is all
 * a guest has.
 */
export async function getPurchasedIds(db, { userId, sessionId, audience = 'customer', windowDays = 60 }) {
  if (!userId && !sessionId) return [];
  const ids = new Set();

  if (userId) {
    const { rows } = await db.query(
      `SELECT DISTINCT oi.product_id
       FROM order_items oi
       JOIN sub_orders so ON so.id = oi.sub_order_id
       JOIN orders o ON o.id = so.order_id
       WHERE o.customer_id = $1
         AND so.status NOT IN ('CANCELLED', 'RETURNED', 'REFUNDED')
         AND oi.created_at > now() - ($2 || ' days')::interval`,
      [userId, windowDays]
    );
    rows.forEach((r) => ids.add(Number(r.product_id)));
  }

  const { rows } = await db.query(
    `SELECT DISTINCT product_id FROM product_interaction_events
     WHERE ${userId ? 'user_id' : 'session_id'} = $1
       AND audience = $2 AND event_type = 'PURCHASE'
       AND created_at > now() - ($3 || ' days')::interval`,
    [userId || sessionId, audience, windowDays]
  );
  rows.forEach((r) => ids.add(Number(r.product_id)));

  return [...ids].filter(Number.isFinite);
}

/** The signed-in user's district, for the locality signal. Null for guests or an unset profile. */
export async function getActorDistrict(db, { userId }) {
  if (!userId) return null;
  const { rows } = await db.query(`SELECT district FROM user_profiles WHERE user_id = $1`, [userId]);
  const d = rows[0]?.district;
  return d && String(d).trim() ? String(d).trim() : null;
}
