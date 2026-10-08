/**
 * supplierScorecard.repository.js — Raw SQL for the supplier scorecard snapshot. No scoring rules
 * here: the service decides what the numbers mean, this file only measures and stores them.
 */

/** The scorecard rules row, or null when the row (or the table) is not there. */
export async function getRulesRow(db) {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = 'supplier.scorecard'`);
  return rows[0] ? rows[0].value_json : null;
}

/** The Sponsored Sourcing Slot rules row, or null when the row (or the table) is not there. */
export async function getSponsoredRulesRow(db) {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = 'supplier.sponsored_sourcing'`);
  return rows[0] ? rows[0].value_json : null;
}

/**
 * Measures every supplier that had orders in the window, one row each.
 *
 * Which sub-orders count (the sample): created inside the window, not CANCELLED, and either already
 * shipped or old enough that the SLA has passed. WHY: a cancelled order cannot be blamed on the
 * supplier (the table does not record who cancelled), and an order placed an hour ago is not "late"
 * yet. An order past the SLA with no shipment IS late, so it stays in the sample as a miss.
 *
 * Percentages are NULL, not 0, when their denominator is empty - "no data" must not read as "perfect"
 * or "terrible".
 */
export async function measureSuppliers(db, { windowDays, slaHours }) {
  const { rows } = await db.query(
    `WITH sample AS (
       SELECT so.id, so.supplier_id, so.status, so.created_at,
              first_ship.created_at AS shipped_at
         FROM sub_orders so
         LEFT JOIN LATERAL (
           SELECT MIN(s.created_at) AS created_at FROM shipments s WHERE s.sub_order_id = so.id
         ) first_ship ON true
        WHERE so.created_at >= now() - make_interval(days => $1::int)
          AND so.status <> 'CANCELLED'
          AND (first_ship.created_at IS NOT NULL
               OR so.created_at < now() - make_interval(hours => $2::int))
     ),
     per_order AS (
       SELECT sample.*,
              EXTRACT(EPOCH FROM (shipped_at - created_at)) / 3600.0 AS dispatch_hours,
              EXISTS (SELECT 1 FROM return_requests r WHERE r.sub_order_id = sample.id) AS has_return,
              EXISTS (SELECT 1 FROM dispute_threads d WHERE d.sub_order_id = sample.id) AS has_dispute,
              (SELECT s.status FROM shipments s WHERE s.sub_order_id = sample.id
                ORDER BY s.created_at DESC LIMIT 1) AS ship_status
         FROM sample
     )
     SELECT supplier_id,
            COUNT(*)::int AS sample_orders,
            ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dispatch_hours))::numeric, 2) AS median_dispatch_hours,
            ROUND(100.0 * COUNT(*) FILTER (WHERE dispatch_hours IS NOT NULL AND dispatch_hours <= $2::int)
                  / NULLIF(COUNT(*), 0), 2) AS on_time_dispatch_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE ship_status = 'DELIVERED')
                  / NULLIF(COUNT(*) FILTER (WHERE ship_status IN ('DELIVERED','RETURNED','FAILED')), 0), 2) AS delivery_success_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE has_return)
                  / NULLIF(COUNT(*) FILTER (WHERE ship_status = 'DELIVERED' OR status = 'DELIVERED'), 0), 2) AS return_rate_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE has_dispute) / NULLIF(COUNT(*), 0), 2) AS dispute_rate_pct
       FROM per_order
      GROUP BY supplier_id`,
    [windowDays, slaHours]
  );
  return rows;
}

/** Upserts one supplier's snapshot. */
export async function upsertScorecard(db, c) {
  await db.query(
    `INSERT INTO supplier_scorecards
       (supplier_id, window_days, sample_orders, median_dispatch_hours, on_time_dispatch_pct,
        delivery_success_pct, return_rate_pct, dispute_rate_pct, grade, score, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (supplier_id) DO UPDATE SET
       window_days = EXCLUDED.window_days, sample_orders = EXCLUDED.sample_orders,
       median_dispatch_hours = EXCLUDED.median_dispatch_hours,
       on_time_dispatch_pct = EXCLUDED.on_time_dispatch_pct,
       delivery_success_pct = EXCLUDED.delivery_success_pct,
       return_rate_pct = EXCLUDED.return_rate_pct, dispute_rate_pct = EXCLUDED.dispute_rate_pct,
       grade = EXCLUDED.grade, score = EXCLUDED.score, computed_at = now()`,
    [
      c.supplier_id, c.window_days, c.sample_orders, c.median_dispatch_hours, c.on_time_dispatch_pct,
      c.delivery_success_pct, c.return_rate_pct, c.dispute_rate_pct, c.grade, c.score,
    ]
  );
}

/** Snapshots for a set of suppliers (the catalog page's suppliers). */
export async function findByIds(db, supplierIds) {
  if (!supplierIds.length) return [];
  const { rows } = await db.query(`SELECT * FROM supplier_scorecards WHERE supplier_id = ANY($1::bigint[])`, [supplierIds]);
  return rows;
}

export async function findOne(db, supplierId) {
  const { rows } = await db.query(`SELECT * FROM supplier_scorecards WHERE supplier_id = $1`, [supplierId]);
  return rows[0] || null;
}

/** Suppliers that have a snapshot but no orders left in the window - their numbers are stale. */
export async function deleteExcept(db, supplierIds) {
  const { rowCount } = await db.query(
    `DELETE FROM supplier_scorecards WHERE NOT (supplier_id = ANY($1::bigint[]))`,
    [supplierIds]
  );
  return rowCount;
}
