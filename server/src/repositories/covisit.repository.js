/**
 * covisit.repository.js — Raw SQL for co-visitation (Phase E).
 *
 * One job: replace product_covisits with a fresh aggregate computed from product_interaction_events.
 * The request path never runs this — it only reads the table (see buildBlendedRank). No ORM.
 */

/**
 * Rebuilds product_covisits in place. Call inside a transaction: the DELETE and the INSERT must
 * commit together, or a failed rebuild would leave the signal with an empty table.
 *
 * @param {{query: Function}} client
 * @param {object} cfg sanitised covisit config (services/covisit.service.js)
 * @returns {Promise<{pairs: number, products: number}>}
 */
export async function replaceCovisits(client, cfg) {
  await client.query('DELETE FROM product_covisits');
  const { rowCount } = await client.query(
    `WITH touched AS (
       -- One row per (actor, product). The actor is the signed-in user, else the guest session.
       -- WHY VIEW is excluded: it is an impression, so it measures what WE showed, not what the shopper
       -- chose to open - co-visiting would then relate whatever the feed put side by side.
       -- WHY FOLLOW_STORE is excluded: it is about a store, not a product.
       SELECT CASE WHEN e.user_id IS NOT NULL THEN 'u' || e.user_id::text ELSE 's' || e.session_id END AS actor,
              e.product_id,
              SUM(e.weight) AS strength,
              MAX(e.created_at) AS last_at
       FROM product_interaction_events e
       JOIN products pr ON pr.id = e.product_id AND pr.status = 'ACTIVE' AND pr.deleted_at IS NULL
       WHERE e.audience = 'customer'
         AND e.event_type IN ('CLICK', 'SEARCH_CLICK', 'DWELL', 'ADD_CART', 'WISHLIST', 'SHARE', 'PURCHASE')
         AND e.created_at > now() - ($1::int * interval '1 day')
       GROUP BY 1, 2
     ),
     basket AS (
       -- An actor's strongest N products. The self-join below is quadratic in basket size, so this is
       -- also what keeps one crawler from relating every product to every other.
       SELECT actor, product_id
       FROM (
         SELECT actor, product_id,
                ROW_NUMBER() OVER (PARTITION BY actor ORDER BY strength DESC, last_at DESC, product_id) AS rn
         FROM touched
       ) ranked
       WHERE rn <= $2
     ),
     audience AS (
       SELECT product_id, COUNT(*)::float8 AS n FROM basket GROUP BY product_id
     ),
     pairs AS (
       SELECT a.product_id AS p, b.product_id AS q, COUNT(*)::float8 AS together
       FROM basket a
       JOIN basket b ON b.actor = a.actor AND b.product_id <> a.product_id
       GROUP BY a.product_id, b.product_id
       HAVING COUNT(*) >= $3
     ),
     scored AS (
       SELECT pairs.p, pairs.q, pairs.together,
              pairs.together / SQRT(ap.n * aq.n) AS score
       FROM pairs
       JOIN audience ap ON ap.product_id = pairs.p
       JOIN audience aq ON aq.product_id = pairs.q
     ),
     kept AS (
       SELECT p, q, together, score,
              ROW_NUMBER() OVER (PARTITION BY p ORDER BY score DESC, together DESC, q) AS rk
       FROM scored
     )
     INSERT INTO product_covisits (product_id, related_product_id, actors, score)
     SELECT p, q, together::int, LEAST(1, score)::real
     FROM kept
     WHERE rk <= $4 AND score > 0`,
    [cfg.window_days, cfg.max_products_per_actor, cfg.min_actors, cfg.max_related]
  );
  const { rows } = await client.query('SELECT COUNT(DISTINCT product_id)::int AS products FROM product_covisits');
  return { pairs: rowCount || 0, products: Number(rows[0]?.products) || 0 };
}
