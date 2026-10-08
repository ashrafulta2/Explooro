/**
 * discoveryFeed.repository.js — Raw SQL for the discovery feed's behavioral signals.
 *
 * Two responsibilities, both thin: append interaction events (recordEvents), and read back a
 * recency-decayed affinity profile for one actor (getAffinity) that the ranking in
 * discoveryFeed.service.js turns into category/brand/supplier boosts. No ORM (repository layer
 * rule) — plain parameterized queries.
 */

/**
 * Bulk-inserts interaction events in a single round trip. `events` are already validated/normalized
 * by the service (event_type, weight, audience checked), so this only shapes the multi-row VALUES.
 *
 * WHY INSERT … SELECT … JOIN products rather than a plain INSERT … VALUES: product_id is a foreign
 * key, and with signals now captured site-wide a batch can carry a product that was deleted, or a
 * card that never was a catalog row. A plain INSERT would fail the whole batch on one bad id and
 * lose every good event beside it. The JOIN skips unknown products atomically, and lets category
 * and supplier be backfilled from the product row so a call site only has to know product_id.
 *
 * @returns {Promise<number>} rows actually written (unknown products are not counted)
 */
export async function recordEvents(db, events) {
  if (!events || events.length === 0) return 0;

  const cols = [
    'user_id',
    'session_id',
    'product_id',
    'category_id',
    'supplier_id',
    'event_type',
    'dwell_ms',
    'weight',
    'audience',
  ];
  // Explicit casts: in a VALUES list a bare NULL parameter has no type to infer from.
  const casts = ['bigint', 'text', 'bigint', 'bigint', 'bigint', 'text', 'integer', 'numeric', 'text'];

  const params = [];
  const valueRows = events.map((e) => {
    const row = [
      e.userId ?? null,
      e.sessionId ?? null,
      e.productId,
      e.categoryId ?? null,
      e.supplierId ?? null,
      e.eventType,
      e.dwellMs ?? 0,
      e.weight ?? 1,
      e.audience ?? 'customer',
    ];
    const placeholders = row.map((val, i) => {
      params.push(val);
      return `$${params.length}::${casts[i]}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const result = await db.query(
    `INSERT INTO product_interaction_events (${cols.join(', ')})
     SELECT v.user_id, v.session_id, v.product_id,
            COALESCE(v.category_id, p.category_id), COALESCE(v.supplier_id, p.supplier_id),
            v.event_type, v.dwell_ms, v.weight, v.audience
     FROM (VALUES ${valueRows.join(', ')}) AS v(${cols.join(', ')})
     JOIN products p ON p.id = v.product_id`,
    params
  );
  return typeof result?.rowCount === 'number' ? result.rowCount : events.length;
}

/**
 * Builds the actor's WHERE fragment. A signed-in user is tracked by user_id (their history follows
 * them across devices); a guest only by the opaque session_id their browser persists.
 */
function actorClause(params, { userId, sessionId }) {
  if (userId) {
    params.push(userId);
    return `user_id = $${params.length}`;
  }
  params.push(sessionId);
  return `session_id = $${params.length}`;
}

/**
 * Returns the actor's top categories / brands / suppliers by recency-decayed engagement score
 * within the window. Score = Σ (event weight × exp(−age / halflife)), so a click today counts for
 * more than a view three weeks ago. Empty arrays when the actor has no history — the caller then
 * falls back to popularity, which is exactly what a cold-start shopper should see.
 */
export async function getAffinity(
  db,
  { userId, sessionId, audience = 'customer', windowDays = 30, topN = 8 }
) {
  if (!userId && !sessionId) return { categoryIds: [], brands: [], supplierIds: [] };

  // Half-life = half the window: an event at the window's edge has decayed to ~0.25 of its weight.
  const halflifeSeconds = Math.max(1, (windowDays * 86400) / 2);
  const decayExpr = `EXP(-EXTRACT(EPOCH FROM (now() - e.created_at)) / ${halflifeSeconds})`;

  async function topBy(dimensionSql, joinSql = '') {
    const params = [];
    const actor = actorClause(params, { userId, sessionId });
    params.push(audience);
    const audienceIdx = params.length;
    params.push(windowDays);
    const windowIdx = params.length;
    params.push(topN);
    const limitIdx = params.length;

    const { rows } = await db.query(
      `SELECT ${dimensionSql} AS dim, SUM(e.weight * ${decayExpr}) AS score
       FROM product_interaction_events e
       ${joinSql}
       WHERE ${actor}
         AND e.audience = $${audienceIdx}
         AND e.created_at > now() - ($${windowIdx} || ' days')::interval
         AND ${dimensionSql} IS NOT NULL
       GROUP BY dim
       ORDER BY score DESC
       LIMIT $${limitIdx}`,
      params
    );
    return rows.map((r) => r.dim);
  }

  const [categoryIds, brands, supplierIds] = await Promise.all([
    topBy('e.category_id'),
    topBy('p.brand', 'JOIN products p ON p.id = e.product_id'),
    topBy('e.supplier_id'),
  ]);

  return {
    categoryIds: categoryIds.map((id) => Number(id)).filter(Number.isFinite),
    brands: brands.filter(Boolean),
    supplierIds: supplierIds.map((id) => Number(id)).filter(Number.isFinite),
  };
}

/** Appends one row to search_events. Inputs are validated/normalized by the service. */
export async function insertSearchEvent(db, e) {
  await db.query(
    `INSERT INTO search_events
       (user_id, session_id, query_raw, query_normalized, result_count, category_id, audience)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [e.userId, e.sessionId, e.queryRaw, e.queryNormalized, e.resultCount, e.categoryId, e.audience]
  );
}

/**
 * Stamps the actor's most recent not-yet-clicked search for this query with the product they
 * opened. Scoped to the last 30 minutes so a click cannot be credited to a search from days ago.
 */
export async function attachSearchClick(
  db,
  { userId, sessionId, audience, queryNormalized, productId, categoryId }
) {
  const params = [];
  const actor = actorClause(params, { userId, sessionId });
  params.push(audience, queryNormalized, productId, categoryId ?? null);
  const n = params.length;
  await db.query(
    `UPDATE search_events
     SET clicked_product_id = $${n - 1},
         category_id = COALESCE(category_id, $${n}::bigint, (SELECT category_id FROM products WHERE id = $${n - 1}))
     WHERE id = (
       SELECT id FROM search_events
       WHERE ${actor}
         AND audience = $${n - 3}
         AND query_normalized = $${n - 2}
         AND clicked_product_id IS NULL
         AND created_at > now() - interval '30 minutes'
       ORDER BY created_at DESC
       LIMIT 1
     )`,
    params
  );
}

/** Queries that found nothing, grouped and ranked by how often people ran them. */
export async function topZeroResultQueries(db, { days, limit }) {
  const { rows } = await db.query(
    `SELECT query_normalized AS query, COUNT(*)::int AS searches, MAX(created_at) AS last_searched_at
     FROM search_events
     WHERE result_count = 0 AND created_at > now() - ($1 || ' days')::interval
     GROUP BY query_normalized
     ORDER BY searches DESC, last_searched_at DESC
     LIMIT $2`,
    [days, limit]
  );
  return rows;
}
