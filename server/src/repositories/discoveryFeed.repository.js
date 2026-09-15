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
    const placeholders = row.map((val) => {
      params.push(val);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  await db.query(
    `INSERT INTO product_interaction_events (${cols.join(', ')})
     VALUES ${valueRows.join(', ')}`,
    params
  );
  return events.length;
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
