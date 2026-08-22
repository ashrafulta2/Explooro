/**
 * review.repository.js — Data access for product reviews & review media (Prompt 4.6).
 */

/**
 * Finds a DELIVERED order_item this user bought for this product that has no review yet.
 * Returns null when the user never bought it, bought it but it hasn't been delivered, or already
 * reviewed every eligible item — the service layer turns each case into a distinct message.
 */
export async function findReviewableOrderItem(db, userId, productId) {
  const { rows } = await db.query(
    `SELECT oi.id AS order_item_id, so.delivered_at
     FROM order_items oi
     JOIN sub_orders so ON so.id = oi.sub_order_id
     JOIN orders o ON o.id = so.order_id
     WHERE o.customer_id = $1
       AND oi.product_id = $2
       AND so.status = 'DELIVERED'
       AND NOT EXISTS (
         SELECT 1 FROM reviews r WHERE r.order_item_id = oi.id AND r.user_id = $1
       )
     ORDER BY so.delivered_at DESC
     LIMIT 1`,
    [userId, productId]
  );
  return rows[0] ?? null;
}

/** Whether the user has ANY order_item for this product at all, delivered or not — distinguishes
 * "never purchased" from "purchased but not yet delivered" for the client-facing message. */
export async function hasAnyOrderForProduct(db, userId, productId) {
  const { rows } = await db.query(
    `SELECT so.status
     FROM order_items oi
     JOIN sub_orders so ON so.id = oi.sub_order_id
     JOIN orders o ON o.id = so.order_id
     WHERE o.customer_id = $1 AND oi.product_id = $2
     ORDER BY so.status = 'DELIVERED' DESC, so.created_at DESC
     LIMIT 1`,
    [userId, productId]
  );
  return rows[0] ?? null;
}

export async function insertReview(db, { productId, orderItemId, userId, rating, title, body }) {
  const { rows } = await db.query(
    `INSERT INTO reviews (product_id, order_item_id, user_id, rating, title, body, is_verified_purchase, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, 'PUBLISHED', now())
     RETURNING *`,
    [productId, orderItemId, userId, rating, title ?? null, body ?? null]
  );
  return rows[0];
}

export async function insertReviewMedia(db, { reviewId, mediaId, mediaKind }) {
  const { rows } = await db.query(
    `INSERT INTO review_media (review_id, media_id, media_kind, moderation_status, created_at)
     VALUES ($1, $2, $3, 'PENDING', now())
     RETURNING *`,
    [reviewId, mediaId, mediaKind]
  );
  return rows[0];
}

/** Recomputes products.rating_avg/rating_count from the live reviews table — called after insert. */
export async function recomputeProductRating(db, productId) {
  await db.query(
    `UPDATE products p
     SET rating_avg = sub.avg_rating, rating_count = sub.cnt
     FROM (
       SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*) AS cnt
       FROM reviews WHERE product_id = $1 AND status = 'PUBLISHED' AND deleted_at IS NULL
     ) sub
     WHERE p.id = $1`,
    [productId]
  );
}

const SORT_COLUMNS = {
  newest: 'r.created_at DESC',
  oldest: 'r.created_at ASC',
  helpful: 'r.helpful_count DESC, r.created_at DESC',
  rating_high: 'r.rating DESC, r.created_at DESC',
  rating_low: 'r.rating ASC, r.created_at DESC',
};

export async function listReviewsByProduct(db, productId, { rating, hasPhotos, sort = 'newest', limit = 10, offset = 0 } = {}) {
  const conditions = ['r.product_id = $1', "r.status = 'PUBLISHED'", 'r.deleted_at IS NULL'];
  const params = [productId];

  if (rating) {
    params.push(rating);
    conditions.push(`r.rating = $${params.length}`);
  }
  if (hasPhotos) {
    conditions.push(`EXISTS (SELECT 1 FROM review_media rm WHERE rm.review_id = r.id)`);
  }

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await db.query(
    `SELECT r.*, up.display_name AS reviewer_name
     FROM reviews r
     LEFT JOIN user_profiles up ON up.user_id = r.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ${SORT_COLUMNS[sort] || SORT_COLUMNS.newest}
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  if (rows.length === 0) return rows;

  const ids = rows.map((r) => r.id);
  const { rows: mediaRows } = await db.query(
    `SELECT rm.review_id, rm.media_id, rm.media_kind, m.storage_key
     FROM review_media rm
     JOIN media_assets m ON m.id = rm.media_id
     WHERE rm.review_id = ANY($1::bigint[]) AND rm.moderation_status <> 'REJECTED'
     ORDER BY rm.display_order ASC`,
    [ids]
  );

  const mediaByReview = new Map();
  for (const m of mediaRows) {
    if (!mediaByReview.has(m.review_id)) mediaByReview.set(m.review_id, []);
    mediaByReview.get(m.review_id).push(m);
  }

  return rows.map((r) => ({ ...r, media: mediaByReview.get(r.id) || [] }));
}

export async function countReviewsByProduct(db, productId, { rating, hasPhotos } = {}) {
  const conditions = ['product_id = $1', "status = 'PUBLISHED'", 'deleted_at IS NULL'];
  const params = [productId];
  if (rating) {
    params.push(rating);
    conditions.push(`rating = $${params.length}`);
  }
  if (hasPhotos) {
    conditions.push(`EXISTS (SELECT 1 FROM review_media rm WHERE rm.review_id = reviews.id)`);
  }
  const { rows } = await db.query(
    `SELECT count(*)::int AS count FROM reviews WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows[0].count;
}

/** Rating distribution: { 5: 12, 4: 3, 3: 0, 2: 1, 1: 0 }. */
export async function getRatingDistribution(db, productId) {
  const { rows } = await db.query(
    `SELECT rating, count(*)::int AS count
     FROM reviews
     WHERE product_id = $1 AND status = 'PUBLISHED' AND deleted_at IS NULL
     GROUP BY rating`,
    [productId]
  );
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const row of rows) distribution[row.rating] = row.count;
  return distribution;
}

/** No per-user helpful-vote table exists in the schema (erd.md's reviews table models only a
 * running `helpful_count`) — this increments directly. Revisit with a dedup table if abuse shows up. */
export async function incrementHelpfulCount(db, reviewId) {
  const { rows } = await db.query(
    `UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = $1 AND deleted_at IS NULL RETURNING id, helpful_count`,
    [reviewId]
  );
  return rows[0] ?? null;
}
