/**
 * partnerScore.repository.ts — Raw SQL for the Partner Score snapshot. No scoring rules here: the
 * service decides what the numbers mean, this file only measures and stores them.
 */

export async function getRulesRow(db) {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = 'partner.score_rules'`);
  return rows[0] ? rows[0].value_json : null;
}

/**
 * Measures every shop partner credited with a parcel in the window, one row each.
 *
 * The sample is every sub-order attributed to the partner (sub_orders.saler_id, set by
 * attribution.service.ts) and created inside the window, cancelled ones included, because how often
 * a partner's buyers cancel is one of the things measured. A partner selling their own supplier
 * stock (saler_id = supplier_id) is not promoting anyone, so those parcels are left out.
 *
 * Percentages are NULL, not 0, when their denominator is empty.
 *   return_rate_pct      returned or refunded (or a return was requested) / parcels that reached the buyer
 *   cancel_rate_pct      cancelled / all parcels
 *   repeat_customer_pct  buyers with 2+ orders through this partner / buyers through this partner
 *   new_customer_pct     buyers whose first ever Explooro order came through this partner / buyers
 *   link_conversion_pct  orders that came through one of the partner's links / clicks on those links
 */
export async function measurePartners(db, { windowDays }) {
  const { rows } = await db.query(
    `WITH so AS (
       SELECT s.id, s.order_id, s.saler_id, s.status, s.total_amount, s.shipping_amount, s.short_link_id,
              o.customer_id
         FROM sub_orders s
         JOIN orders o ON o.id = s.order_id
        WHERE s.saler_id IS NOT NULL
          AND s.saler_id <> s.supplier_id
          AND s.created_at >= now() - make_interval(days => $1::int)
     ),
     flagged AS (
       SELECT so.*,
              (so.status IN ('RETURNED','REFUNDED')
               OR EXISTS (SELECT 1 FROM return_requests r WHERE r.sub_order_id = so.id)) AS returned
         FROM so
     ),
     buyers AS (
       SELECT saler_id, customer_id, COUNT(DISTINCT order_id) AS orders
         FROM so
        WHERE status <> 'CANCELLED'
        GROUP BY saler_id, customer_id
     ),
     -- WHY only these buyers: "first ever order" needs each buyer's whole history, but only for the
     -- buyers in the window, not for every customer on the platform.
     firsts AS (
       SELECT DISTINCT ON (customer_id) customer_id, id AS order_id
         FROM orders
        WHERE customer_id IN (SELECT customer_id FROM buyers)
        ORDER BY customer_id, placed_at, id
     ),
     buyer_stats AS (
       SELECT b.saler_id,
              ROUND(100.0 * COUNT(*) FILTER (WHERE b.orders >= 2) / NULLIF(COUNT(*), 0), 2) AS repeat_customer_pct,
              ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM so s2 JOIN firsts f ON f.order_id = s2.order_id
                 WHERE s2.saler_id = b.saler_id AND s2.customer_id = b.customer_id
              )) / NULLIF(COUNT(*), 0), 2) AS new_customer_pct
         FROM buyers b
        GROUP BY b.saler_id
     ),
     clicks AS (
       SELECT sl.saler_id, COUNT(*) AS clicks
         FROM short_link_clicks c
         JOIN short_links sl ON sl.id = c.short_link_id
        WHERE c.clicked_at >= now() - make_interval(days => $1::int)
        GROUP BY sl.saler_id
     )
     SELECT f.saler_id,
            COUNT(*)::int AS sample_orders,
            COALESCE(SUM(f.total_amount - f.shipping_amount) FILTER (WHERE f.status = 'DELIVERED'), 0)::numeric(14,2)
              AS delivered_volume,
            ROUND(100.0 * COUNT(*) FILTER (WHERE f.returned AND f.status IN ('DELIVERED','RETURNED','REFUNDED'))
                  / NULLIF(COUNT(*) FILTER (WHERE f.status IN ('DELIVERED','RETURNED','REFUNDED')), 0), 2) AS return_rate_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE f.status = 'CANCELLED') / NULLIF(COUNT(*), 0), 2) AS cancel_rate_pct,
            MAX(bs.repeat_customer_pct) AS repeat_customer_pct,
            MAX(bs.new_customer_pct) AS new_customer_pct,
            -- LEAST(orders, clicks): a link can be clicked on one device and bought on another, so orders
            -- may outnumber the clicks recorded; the rate still caps at 100. WHY not LEAST(100, rate):
            -- Postgres LEAST skips NULLs, so a partner with no clicks read as 100% instead of "no data".
            ROUND(100.0 * LEAST(COUNT(DISTINCT f.order_id) FILTER (WHERE f.short_link_id IS NOT NULL AND f.status <> 'CANCELLED'),
                                MAX(cl.clicks))
                  / NULLIF(MAX(cl.clicks), 0), 2) AS link_conversion_pct
       FROM flagged f
       LEFT JOIN buyer_stats bs ON bs.saler_id = f.saler_id
       LEFT JOIN clicks cl ON cl.saler_id = f.saler_id
      GROUP BY f.saler_id`,
    [windowDays]
  );
  return rows;
}

export async function upsertScore(db, s) {
  await db.query(
    `INSERT INTO partner_scores
       (saler_id, window_days, sample_orders, delivered_volume, return_rate_pct, cancel_rate_pct,
        repeat_customer_pct, new_customer_pct, link_conversion_pct, score, band, multiplier, components_json, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb, now())
     ON CONFLICT (saler_id) DO UPDATE SET
       window_days = EXCLUDED.window_days, sample_orders = EXCLUDED.sample_orders,
       delivered_volume = EXCLUDED.delivered_volume, return_rate_pct = EXCLUDED.return_rate_pct,
       cancel_rate_pct = EXCLUDED.cancel_rate_pct, repeat_customer_pct = EXCLUDED.repeat_customer_pct,
       new_customer_pct = EXCLUDED.new_customer_pct, link_conversion_pct = EXCLUDED.link_conversion_pct,
       score = EXCLUDED.score, band = EXCLUDED.band, multiplier = EXCLUDED.multiplier,
       components_json = EXCLUDED.components_json, computed_at = now()`,
    [
      s.saler_id, s.window_days, s.sample_orders, s.delivered_volume, s.return_rate_pct, s.cancel_rate_pct,
      s.repeat_customer_pct, s.new_customer_pct, s.link_conversion_pct, s.score, s.band, s.multiplier,
      JSON.stringify(s.components || {}),
    ]
  );
}

export async function findOne(db, salerId) {
  const { rows } = await db.query(`SELECT * FROM partner_scores WHERE saler_id = $1`, [salerId]);
  return rows[0] || null;
}

/** Partners with a snapshot but no parcels left in the window: their numbers are stale. */
export async function deleteExcept(db, salerIds) {
  const { rowCount } = await db.query(
    `DELETE FROM partner_scores WHERE NOT (saler_id = ANY($1::bigint[]))`,
    [salerIds]
  );
  return rowCount;
}
