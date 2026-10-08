/**
 * recoFunnel.repository.js — Raw SQL for the per-surface funnel (Phase F).
 *
 * One read over product_interaction_events, restricted to events that carry a `source` tag (migration
 * 060). Impressions and clicks are counted straight from the tagged events; "added to cart" and
 * "purchased" are ATTRIBUTED: a tagged click counts as converting when the same actor added / bought
 * that same product within `attributionDays` after it. No ORM.
 */

/**
 * @param {{query: Function}} db
 * @param {{audience?: string, days: number, attributionDays: number}} opts
 * @returns {Promise<object[]>} one row per source, busiest first
 */
export async function getFunnelBySource(db, { audience = 'customer', days, attributionDays }) {
  const { rows } = await db.query(
    `WITH tagged AS (
       SELECT source, event_type, product_id, user_id, session_id, created_at,
              CASE WHEN user_id IS NOT NULL THEN 'u' || user_id::text ELSE 's' || session_id END AS actor
       FROM product_interaction_events
       WHERE source IS NOT NULL
         AND audience = $1
         AND created_at > now() - ($2::int * interval '1 day')
     )
     SELECT t.source,
            COUNT(*) FILTER (WHERE t.event_type = 'VIEW')::int AS impressions,
            COUNT(*) FILTER (WHERE t.event_type IN ('CLICK', 'SEARCH_CLICK'))::int AS clicks,
            COUNT(DISTINCT t.actor)::int AS actors,
            COUNT(*) FILTER (
              WHERE t.event_type IN ('CLICK', 'SEARCH_CLICK') AND EXISTS (
                SELECT 1 FROM product_interaction_events c
                WHERE c.product_id = t.product_id AND c.event_type = 'ADD_CART'
                  AND c.created_at >= t.created_at
                  AND c.created_at < t.created_at + ($3::int * interval '1 day')
                  AND CASE WHEN t.user_id IS NOT NULL THEN c.user_id = t.user_id ELSE c.session_id = t.session_id END
              )
            )::int AS add_carts,
            COUNT(*) FILTER (
              WHERE t.event_type IN ('CLICK', 'SEARCH_CLICK') AND EXISTS (
                SELECT 1 FROM product_interaction_events c
                WHERE c.product_id = t.product_id AND c.event_type = 'PURCHASE'
                  AND c.created_at >= t.created_at
                  AND c.created_at < t.created_at + ($3::int * interval '1 day')
                  AND CASE WHEN t.user_id IS NOT NULL THEN c.user_id = t.user_id ELSE c.session_id = t.session_id END
              )
            )::int AS purchases
     FROM tagged t
     GROUP BY t.source
     ORDER BY impressions DESC, clicks DESC, t.source`,
    [audience, days, attributionDays]
  );
  return rows;
}
