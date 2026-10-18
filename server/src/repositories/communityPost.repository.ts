/**
 * communityPost.repository.ts — SQL for the community timeline (migration 080).
 *
 * SQL only: no business rules, no validation. Every query is parameterised. Writes take the
 * caller's `db` (a pool or a transaction client) so the service can compose them in one transaction.
 */

// One SELECT shape for every read, so a post looks identical in the timeline, the moderation queue
// and the response to a write. The author's shown name is the shop name for a shop partner and the
// profile name for everyone else.
const POST_SELECT = `
  SELECT p.id, p.ref, p.author_id, p.author_role, p.post_type, p.kind, p.product_id, p.order_item_id,
         p.title, p.body, p.details, p.audience, p.is_pinned, p.status, p.hidden_reason,
         p.like_count, p.created_at,
         COALESCE((SELECT vs.shop_name FROM virtual_stores vs
                    WHERE vs.saler_id = p.author_id AND vs.deleted_at IS NULL
                    ORDER BY vs.id LIMIT 1), up.display_name, up.full_name) AS author_name,
         pr.ref AS product_ref, pr.title_en AS product_title_en, pr.title_bn AS product_title_bn,
         pr.default_retail_price AS product_price, pr.slug AS product_slug,
         (SELECT COUNT(*)::int FROM community_post_reports r
           WHERE r.post_id = p.id AND r.status = 'OPEN') AS open_report_count,
         (SELECT COUNT(*)::int FROM community_post_comments c
           WHERE c.post_id = p.id AND c.status = 'PUBLISHED') AS comment_count,
         COALESCE(p.author_id = $1, false) AS is_mine,
         EXISTS (SELECT 1 FROM community_post_likes l
                  WHERE l.post_id = p.id AND l.user_id = $1) AS liked_by_me,
         EXISTS (SELECT 1 FROM community_post_saves sv
                  WHERE sv.post_id = p.id AND sv.user_id = $1) AS saved_by_me
  FROM community_posts p
  LEFT JOIN user_profiles up ON up.user_id = p.author_id
  LEFT JOIN products pr ON pr.id = p.product_id`;

/**
 * One page of the timeline. `$1` is the viewer (null for a guest, so liked_by_me is false).
 * Pinned posts sort first, then by the chosen order; `id` is the final tie-break so two posts with
 * the same timestamp never swap places between pages.
 */
export async function listPosts(db, { viewerId = null, type = null, role = null, authorId = null, savedOnly = false,
  audiences, sort = 'recent', limit, offset }) {
  const params: any[] = [viewerId];
  const where = [`p.status = 'PUBLISHED'`];
  if (type) { params.push(type); where.push(`p.post_type = $${params.length}`); }
  if (role) { params.push(role); where.push(`p.author_role = $${params.length}`); }
  if (authorId) { params.push(authorId); where.push(`p.author_id = $${params.length}`); }
  // The viewer's private list. $1 is the viewer, so a guest (null) matches nothing.
  if (savedOnly) where.push(`EXISTS (SELECT 1 FROM community_post_saves sv WHERE sv.post_id = p.id AND sv.user_id = $1)`);
  params.push(audiences);
  // An author always sees their own post, whatever audience it targets (a supplier's update is for
  // shop partners, but the supplier must still find it on their own timeline).
  where.push(`(p.audience = ANY($${params.length}::text[]) OR p.author_id = $1)`);
  params.push(limit, offset);
  const order = sort === 'top' ? 'p.like_count DESC, p.id DESC' : 'p.created_at DESC, p.id DESC';
  const { rows } = await db.query(
    `${POST_SELECT}
     WHERE ${where.join(' AND ')}
     ORDER BY p.is_pinned DESC, ${order}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/**
 * The uploads a member may attach to a post: theirs, uploaded for the community, not deleted, not
 * rejected by moderation, and not already on another post. Returns only the usable ones, so a caller
 * that asked for N and got fewer knows at least one was somebody else's, wrong, or already taken.
 * `FOR UPDATE` serialises two posts racing for the same file inside one transaction.
 */
export async function lockUsableMedia(db, userId, mediaIds) {
  const { rows } = await db.query(
    `SELECT a.id, a.mime_type
       FROM media_assets a
      WHERE a.id = ANY($1::bigint[])
        AND a.owner_id = $2
        AND a.purpose = 'COMMUNITY'
        AND a.deleted_at IS NULL
        AND a.moderation_status <> 'REJECTED'
        AND NOT EXISTS (SELECT 1 FROM community_post_media m WHERE m.media_id = a.id)
      FOR UPDATE OF a`,
    [mediaIds, userId]
  );
  return rows;
}

/** Joins the files to the post in the order the author chose (array order is display order). */
export async function attachMedia(db, postId, mediaIds) {
  if (!mediaIds.length) return;
  await db.query(
    `INSERT INTO community_post_media (post_id, media_id, position)
     SELECT $1, m.media_id, (m.ord - 1)::smallint
       FROM UNNEST($2::bigint[]) WITH ORDINALITY AS m(media_id, ord)`,
    [postId, mediaIds]
  );
}

/**
 * The files for a page of posts, in one query. Only APPROVED files are shown: a file held for review
 * (FORCE_REVIEW_QUEUE) stays off the timeline until a moderator approves it.
 */
export async function listMediaForPosts(db, postIds) {
  if (!postIds.length) return [];
  const { rows } = await db.query(
    `SELECT m.post_id, a.id, a.mime_type, a.storage_key, a.width, a.height
       FROM community_post_media m
       JOIN media_assets a ON a.id = m.media_id
      WHERE m.post_id = ANY($1::bigint[])
        AND a.deleted_at IS NULL
        AND a.moderation_status = 'APPROVED'
      ORDER BY m.post_id, m.position`,
    [postIds]
  );
  return rows;
}

// A comment reads like a post author: the shop name for a shop partner, the profile name otherwise,
// and the highest role the account holds for the little role chip.
const COMMENT_SELECT = `
  SELECT c.id, c.post_id, c.author_id, c.body, c.status, c.created_at,
         COALESCE((SELECT vs.shop_name FROM virtual_stores vs
                    WHERE vs.saler_id = c.author_id AND vs.deleted_at IS NULL
                    ORDER BY vs.id LIMIT 1), up.display_name, up.full_name) AS author_name,
         (SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = c.author_id ORDER BY r.level DESC LIMIT 1) AS author_role,
         COALESCE(c.author_id = $1, false) AS is_mine
  FROM community_post_comments c
  LEFT JOIN user_profiles up ON up.user_id = c.author_id`;

/** The live comments of one post, oldest first, so a thread reads top to bottom. */
export async function listComments(db, { postId, viewerId = null, limit, offset }) {
  const { rows } = await db.query(
    `${COMMENT_SELECT}
     WHERE c.post_id = $2 AND c.status = 'PUBLISHED'
     ORDER BY c.created_at, c.id
     LIMIT $3 OFFSET $4`,
    [viewerId, postId, limit, offset]
  );
  return rows;
}

export async function getComment(db, id, viewerId = null) {
  const { rows } = await db.query(`${COMMENT_SELECT} WHERE c.id = $2`, [viewerId, id]);
  return rows[0] ?? null;
}

export async function insertComment(db, { postId, authorId, body }) {
  const { rows } = await db.query(
    `INSERT INTO community_post_comments (post_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
    [postId, authorId, body]
  );
  return rows[0].id;
}

/** Takes a live comment down. Returns false when it was not live (already removed). */
export async function removeComment(db, id, removerId) {
  const { rowCount } = await db.query(
    `UPDATE community_post_comments
        SET status = 'REMOVED', removed_by = $2, removed_at = now()
      WHERE id = $1 AND status = 'PUBLISHED'`,
    [id, removerId]
  );
  return rowCount === 1;
}

export async function countComments(db, postId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM community_post_comments WHERE post_id = $1 AND status = 'PUBLISHED'`,
    [postId]
  );
  return rows[0].n;
}

/** Counts per post type for the tab badges, under the same visibility rules as listPosts. */
export async function countByType(db, { viewerId = null, role = null, audiences }) {
  const params: any[] = [audiences, viewerId];
  let roleSql = '';
  if (role) { params.push(role); roleSql = `AND author_role = $3`; }
  const { rows } = await db.query(
    `SELECT post_type, COUNT(*)::int AS n
     FROM community_posts
     WHERE status = 'PUBLISHED' AND (audience = ANY($1::text[]) OR author_id = $2) ${roleSql}
     GROUP BY post_type`,
    params
  );
  return rows;
}

export async function getPost(db, id, viewerId = null) {
  const { rows } = await db.query(`${POST_SELECT} WHERE p.id = $2`, [viewerId, id]);
  return rows[0] ?? null;
}

export async function insertPost(db, p) {
  const { rows } = await db.query(
    `INSERT INTO community_posts
       (ref, author_id, author_role, post_type, kind, product_id, order_item_id, title, body,
        details, audience, is_pinned)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
     RETURNING id`,
    [p.ref, p.authorId, p.authorRole, p.postType, p.kind, p.productId, p.orderItemId,
      p.title, p.body, JSON.stringify(p.details ?? {}), p.audience, p.isPinned]
  );
  return rows[0].id;
}

/**
 * The viewer's delivered order lines that have no review post yet — what a customer may review.
 * Same proof of purchase as review.repository.findReviewableOrderItem (a DELIVERED sub-order).
 */
export async function listReviewableItems(db, userId) {
  const { rows } = await db.query(
    `SELECT oi.id AS order_item_id, o.ref AS order_ref, so.delivered_at,
            pr.id AS product_id, pr.ref AS product_ref, pr.title_en, pr.title_bn,
            (SELECT vs.shop_name FROM virtual_stores vs
              WHERE vs.saler_id = so.saler_id AND vs.deleted_at IS NULL
              ORDER BY vs.id LIMIT 1) AS shop_name
     FROM order_items oi
     JOIN sub_orders so ON so.id = oi.sub_order_id
     JOIN orders o ON o.id = so.order_id
     JOIN products pr ON pr.id = oi.product_id
     WHERE o.customer_id = $1
       AND so.status = 'DELIVERED'
       AND NOT EXISTS (SELECT 1 FROM community_posts cp
                        WHERE cp.order_item_id = oi.id AND cp.post_type = 'REVIEW')
     ORDER BY so.delivered_at DESC NULLS LAST
     LIMIT 50`,
    [userId]
  );
  return rows;
}

export async function findDeliveredItem(db, userId, orderItemId) {
  const { rows } = await db.query(
    `SELECT oi.id AS order_item_id, oi.product_id
     FROM order_items oi
     JOIN sub_orders so ON so.id = oi.sub_order_id
     JOIN orders o ON o.id = so.order_id
     WHERE oi.id = $1 AND o.customer_id = $2 AND so.status = 'DELIVERED'`,
    [orderItemId, userId]
  );
  return rows[0] ?? null;
}

export async function listSupplierProducts(db, supplierId) {
  const { rows } = await db.query(
    `SELECT id AS product_id, ref AS product_ref, title_en, title_bn, stock_qty
     FROM products
     WHERE supplier_id = $1 AND status = 'ACTIVE'
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 100`,
    [supplierId]
  );
  return rows;
}

export async function listPartnerProducts(db, salerId) {
  const { rows } = await db.query(
    `SELECT pr.id AS product_id, pr.ref AS product_ref, pr.title_en, pr.title_bn,
            COALESCE(si.custom_retail_price, pr.default_retail_price) AS price
     FROM saler_store_items si
     JOIN products pr ON pr.id = si.product_id
     WHERE si.saler_id = $1 AND si.is_active AND pr.status = 'ACTIVE'
     ORDER BY si.display_order, si.added_at DESC
     LIMIT 100`,
    [salerId]
  );
  return rows;
}

export async function supplierOwnsProduct(db, supplierId, productId) {
  const { rows } = await db.query(
    `SELECT 1 FROM products WHERE id = $1 AND supplier_id = $2 AND status = 'ACTIVE'`,
    [productId, supplierId]
  );
  return rows.length > 0;
}

export async function partnerSellsProduct(db, salerId, productId) {
  const { rows } = await db.query(
    `SELECT 1 FROM saler_store_items si JOIN products pr ON pr.id = si.product_id
     WHERE si.saler_id = $1 AND si.product_id = $2 AND si.is_active AND pr.status = 'ACTIVE'`,
    [salerId, productId]
  );
  return rows.length > 0;
}

/** Inserts the like and returns true, or removes it and returns false. Keeps like_count exact. */
export async function toggleLike(db, postId, userId) {
  const { rowCount } = await db.query(
    `INSERT INTO community_post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [postId, userId]
  );
  const liked = rowCount === 1;
  if (!liked) {
    await db.query(`DELETE FROM community_post_likes WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
  }
  const { rows } = await db.query(
    `UPDATE community_posts
        SET like_count = (SELECT COUNT(*) FROM community_post_likes WHERE post_id = $1)
      WHERE id = $1 RETURNING like_count`,
    [postId]
  );
  return { liked, likeCount: rows[0].like_count };
}

/** Adds the post to the member's saved list and returns true, or takes it off and returns false. */
export async function toggleSave(db, postId, userId) {
  const { rowCount } = await db.query(
    `INSERT INTO community_post_saves (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [postId, userId]
  );
  if (rowCount === 1) return true;
  await db.query(`DELETE FROM community_post_saves WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
  return false;
}

export async function insertReport(db, { postId, reporterId, reason, note }) {
  const { rowCount } = await db.query(
    `INSERT INTO community_post_reports (post_id, reporter_id, reason, note)
     VALUES ($1, $2, $3, $4) ON CONFLICT (post_id, reporter_id) DO NOTHING`,
    [postId, reporterId, reason, note]
  );
  return rowCount === 1;
}

export async function countOpenReports(db, postId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM community_post_reports WHERE post_id = $1 AND status = 'OPEN'`,
    [postId]
  );
  return rows[0].n;
}

/** Locks the post row for the rest of the transaction: report counting and hiding must not interleave. */
export async function lockPost(db, id) {
  const { rows } = await db.query(
    `SELECT id, status, author_id, post_type, hidden_reason FROM community_posts WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return rows[0] ?? null;
}

export async function setStatus(db, id, status, hiddenReason) {
  await db.query(
    `UPDATE community_posts SET status = $2, hidden_reason = $3, updated_at = now() WHERE id = $1`,
    [id, status, hiddenReason]
  );
}

export async function resolveReports(db, postId, status, resolverId) {
  const { rowCount } = await db.query(
    `UPDATE community_post_reports
        SET status = $2, resolved_by = $3, resolved_at = now()
      WHERE post_id = $1 AND status = 'OPEN'`,
    [postId, status, resolverId]
  );
  return rowCount;
}

/**
 * The moderation queue: posts with open reports, plus posts currently hidden (so a hidden post can
 * be restored). Most reported first, so the worst is at the top.
 */
export async function listQueue(db, { limit, offset }) {
  const { rows } = await db.query(
    `${POST_SELECT}
     WHERE p.status <> 'REMOVED'
       AND (p.status = 'HIDDEN' OR EXISTS (
             SELECT 1 FROM community_post_reports r WHERE r.post_id = p.id AND r.status = 'OPEN'))
     ORDER BY (SELECT COUNT(*) FROM community_post_reports r WHERE r.post_id = p.id AND r.status = 'OPEN') DESC,
              p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [null, limit, offset]
  );
  return rows;
}

/** Most common open report reason per post, for the queue row. */
export async function topReasons(db, postIds) {
  if (!postIds.length) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT ON (post_id) post_id, reason
       FROM (SELECT post_id, reason, COUNT(*) AS n
               FROM community_post_reports
              WHERE post_id = ANY($1::bigint[]) AND status = 'OPEN'
              GROUP BY post_id, reason) t
      ORDER BY post_id, n DESC`,
    [postIds]
  );
  return rows;
}

export async function queueStats(db) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(DISTINCT post_id)::int FROM community_post_reports WHERE status = 'OPEN') AS open_reports,
       (SELECT COUNT(*)::int FROM community_posts WHERE created_at >= date_trunc('day', now())) AS posts_today,
       (SELECT COUNT(*)::int FROM community_posts
         WHERE status = 'HIDDEN' AND updated_at >= now() - interval '7 days') AS hidden_this_week,
       (SELECT COALESCE(ROUND(EXTRACT(EPOCH FROM AVG(resolved_at - created_at)) / 3600)::int, 0)
          FROM community_post_reports WHERE resolved_at IS NOT NULL
           AND resolved_at >= now() - interval '30 days') AS avg_review_hours`
  );
  return rows[0];
}
