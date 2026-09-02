/**
 * liveStream.repository.js — Database access layer for Live Stream Commerce (Prompt 10.1).
 *
 * Implements raw SQL queries for live_streams, live_stream_products, live_stream_messages,
 * and order attribution.
 */

export async function createStream(client, {
  ref,
  hostId,
  storeId = null,
  title,
  description = null,
  coverImage = null,
  status = 'SCHEDULED',
  scheduledFor = null,
  roomId,
  settingsJson = {},
}) {
  const query = `
    INSERT INTO live_streams (
      ref, host_id, store_id, title, description, cover_image,
      status, scheduled_for, room_id, settings_json, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
    RETURNING *;
  `;
  const values = [
    ref,
    hostId,
    storeId,
    title,
    description,
    coverImage,
    status,
    scheduledFor,
    roomId,
    JSON.stringify(settingsJson),
  ];
  const { rows } = await client.query(query, values);
  return rows[0];
}

export async function findStreamById(client, streamId) {
  const query = `
    SELECT 
      ls.*,
      COALESCE(up.display_name, up.full_name) AS host_name,
      u.phone AS host_phone,
      s.shop_name AS store_name,
      s.slug AS store_slug
    FROM live_streams ls
    JOIN users u ON u.id = ls.host_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN virtual_stores s ON s.id = ls.store_id
    WHERE ls.id = $1;
  `;
  const { rows } = await client.query(query, [streamId]);
  return rows[0] || null;
}

export async function listStreams(client, { status = null, hostId = null, limit = 20, cursor = null } = {}) {
  const params = [];
  let whereClauses = [];

  if (status) {
    params.push(status);
    whereClauses.push(`ls.status = $${params.length}`);
  }

  if (hostId) {
    params.push(hostId);
    whereClauses.push(`ls.host_id = $${params.length}`);
  }

  if (cursor) {
    params.push(cursor);
    whereClauses.push(`ls.id < $${params.length}`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  params.push(limit);

  const query = `
    SELECT 
      ls.*,
      COALESCE(up.display_name, up.full_name) AS host_name,
      s.shop_name AS store_name,
      s.slug AS store_slug,
      (SELECT COUNT(*)::int FROM live_stream_products lsp WHERE lsp.live_stream_id = ls.id) AS product_count
    FROM live_streams ls
    JOIN users u ON u.id = ls.host_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN virtual_stores s ON s.id = ls.store_id
    ${whereSql}
    ORDER BY 
      CASE WHEN ls.status = 'LIVE' THEN 1 WHEN ls.status = 'SCHEDULED' THEN 2 ELSE 3 END,
      ls.id DESC
    LIMIT $${params.length};
  `;

  const { rows } = await client.query(query, params);
  return rows;
}

/**
 * The moderation console's stream list. Same rows as listStreams plus the two counts a moderator
 * triages on — how much chat a broadcast is generating, and how much of it has already been taken
 * down — computed in SQL so the console does not have to pull every message of every stream.
 *
 * Ordering is deliberate: LIVE first (only a running stream can still be stopped), then by chat
 * volume, because that is the signal that correlates with something needing attention.
 */
export async function listStreamsForModeration(client, { status = null, limit = 50 } = {}) {
  const params = [];
  let whereSql = '';

  if (status && status !== 'ALL') {
    params.push(status);
    whereSql = `WHERE ls.status = $${params.length}`;
  }

  params.push(limit);

  const query = `
    SELECT
      ls.*,
      COALESCE(up.display_name, up.full_name) AS host_name,
      s.shop_name AS store_name,
      s.slug AS store_slug,
      (SELECT COUNT(*)::int FROM live_stream_products lsp WHERE lsp.live_stream_id = ls.id) AS product_count,
      (SELECT COUNT(*)::int FROM live_stream_messages m
        WHERE m.live_stream_id = ls.id AND m.message_type = 'CHAT' AND m.deleted_at IS NULL) AS chat_message_count,
      (SELECT COUNT(*)::int FROM live_stream_messages m
        WHERE m.live_stream_id = ls.id AND m.deleted_at IS NOT NULL) AS removed_message_count
    FROM live_streams ls
    JOIN users u ON u.id = ls.host_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN virtual_stores s ON s.id = ls.store_id
    ${whereSql}
    ORDER BY
      CASE WHEN ls.status = 'LIVE' THEN 1 WHEN ls.status = 'SCHEDULED' THEN 2 ELSE 3 END,
      chat_message_count DESC,
      ls.id DESC
    LIMIT $${params.length};
  `;

  const { rows } = await client.query(query, params);
  return rows;
}

export async function updateStreamStatus(client, streamId, status, extra = {}) {
  const fields = ['status = $2', 'updated_at = now()'];
  const values = [streamId, status];

  if (status === 'LIVE' && !extra.startedAt) {
    fields.push('started_at = now()');
  } else if (extra.startedAt) {
    values.push(extra.startedAt);
    fields.push(`started_at = $${values.length}`);
  }

  if (status === 'ENDED' || status === 'TERMINATED') {
    fields.push('ended_at = now()');
  }

  if (extra.recordingUrl) {
    values.push(extra.recordingUrl);
    fields.push(`recording_url = $${values.length}`);
  }

  if (extra.playbackUrl) {
    values.push(extra.playbackUrl);
    fields.push(`playback_url = $${values.length}`);
  }

  if (extra.terminatedBy) {
    values.push(extra.terminatedBy);
    fields.push(`terminated_by = $${values.length}`);
  }

  if (extra.terminationReason) {
    values.push(extra.terminationReason);
    fields.push(`termination_reason = $${values.length}`);
  }

  const query = `
    UPDATE live_streams
    SET ${fields.join(', ')}
    WHERE id = $1
    RETURNING *;
  `;

  const { rows } = await client.query(query, values);
  return rows[0];
}

export async function addProductsToStream(client, streamId, products) {
  if (!products || products.length === 0) return [];

  const results = [];
  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    const pId = item.productId || item.product_id || item;
    const specialPrice = item.specialPrice || item.special_price || null;
    const pinOrder = i + 1;

    const query = `
      INSERT INTO live_stream_products (live_stream_id, product_id, pin_order, special_price, created_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (live_stream_id, product_id) DO UPDATE SET
        special_price = EXCLUDED.special_price,
        pin_order = EXCLUDED.pin_order
      RETURNING *;
    `;
    const { rows } = await client.query(query, [streamId, pId, pinOrder, specialPrice]);
    results.push(rows[0]);
  }

  return results;
}

export async function getStreamProducts(client, streamId) {
  const query = `
    SELECT 
      lsp.id AS stream_product_id,
      lsp.live_stream_id,
      lsp.product_id,
      lsp.is_pinned,
      lsp.pinned_at,
      lsp.pin_order,
      lsp.special_price,
      p.title_en,
      p.title_bn,
      p.slug,
      (SELECT m.storage_key
       FROM product_images pi2
       JOIN media_assets m ON m.id = pi2.media_id
       WHERE pi2.product_id = p.id
       ORDER BY pi2.is_primary DESC, pi2.display_order ASC
       LIMIT 1) AS main_image,
      p.base_cost,
      p.wholesale_margin,
      p.stock_qty AS stock_quantity,
      p.status AS product_status
    FROM live_stream_products lsp
    JOIN products p ON p.id = lsp.product_id
    WHERE lsp.live_stream_id = $1
    ORDER BY lsp.is_pinned DESC, lsp.pin_order ASC, lsp.id ASC;
  `;
  const { rows } = await client.query(query, [streamId]);
  return rows;
}

export async function pinProduct(client, streamId, productId) {
  // First unpin all other products in this stream
  await client.query(
    'UPDATE live_stream_products SET is_pinned = false WHERE live_stream_id = $1',
    [streamId]
  );

  const query = `
    UPDATE live_stream_products
    SET is_pinned = true, pinned_at = now()
    WHERE live_stream_id = $1 AND product_id = $2
    RETURNING *;
  `;
  const { rows } = await client.query(query, [streamId, productId]);
  return rows[0] || null;
}

export async function unpinProduct(client, streamId, productId = null) {
  if (productId) {
    const { rows } = await client.query(
      'UPDATE live_stream_products SET is_pinned = false WHERE live_stream_id = $1 AND product_id = $2 RETURNING *',
      [streamId, productId]
    );
    return rows[0] || null;
  }
  await client.query(
    'UPDATE live_stream_products SET is_pinned = false WHERE live_stream_id = $1',
    [streamId]
  );
  return true;
}

export async function getPinnedProduct(client, streamId) {
  const query = `
    SELECT 
      lsp.id AS stream_product_id,
      lsp.live_stream_id,
      lsp.product_id,
      lsp.is_pinned,
      lsp.pinned_at,
      lsp.special_price,
      p.title_en,
      p.title_bn,
      p.slug,
      (SELECT m.storage_key
       FROM product_images pi2
       JOIN media_assets m ON m.id = pi2.media_id
       WHERE pi2.product_id = p.id
       ORDER BY pi2.is_primary DESC, pi2.display_order ASC
       LIMIT 1) AS main_image,
      p.base_cost,
      p.wholesale_margin,
      p.stock_qty AS stock_quantity,
      p.status AS product_status
    FROM live_stream_products lsp
    JOIN products p ON p.id = lsp.product_id
    WHERE lsp.live_stream_id = $1 AND lsp.is_pinned = true
    LIMIT 1;
  `;
  const { rows } = await client.query(query, [streamId]);
  return rows[0] || null;
}

export async function createMessage(client, { streamId, userId = null, messageType = 'CHAT', content, metadataJson = {} }) {
  const query = `
    INSERT INTO live_stream_messages (live_stream_id, user_id, message_type, content, metadata_json, created_at)
    VALUES ($1, $2, $3, $4, $5, now())
    RETURNING *;
  `;
  const values = [streamId, userId, messageType, content, JSON.stringify(metadataJson)];
  const { rows } = await client.query(query, values);
  return rows[0];
}

export async function getStreamMessages(client, streamId, { limit = 50, sinceId = 0 } = {}) {
  const query = `
    SELECT 
      lsm.*,
      COALESCE(up.display_name, up.full_name) AS user_name,
      -- Roles are a many-to-many (user_roles → roles), not a column on users; aggregated to the
      -- text[] the chat renderer expects for its moderator/host badges.
      COALESCE(
        (SELECT array_agg(r.key ORDER BY r.key)
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id),
        ARRAY[]::text[]
      ) AS user_roles
    FROM live_stream_messages lsm
    LEFT JOIN users u ON u.id = lsm.user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE lsm.live_stream_id = $1 AND lsm.id > $2
      -- A message a moderator removed must not reappear in any viewer's feed.
      AND lsm.deleted_at IS NULL
    ORDER BY lsm.id ASC
    LIMIT $3;
  `;
  const { rows } = await client.query(query, [streamId, sinceId, limit]);
  return rows;
}

/**
 * The moderation console's view of a stream's chat: unlike getStreamMessages it KEEPS removed
 * messages (marked with deleted_at / deleted_by / deletion_reason) so a moderator can see what was
 * taken down and by whom, and so a later dispute can still be argued from the evidence.
 */
export async function getStreamMessagesForModeration(client, streamId, { limit = 200, sinceId = 0 } = {}) {
  const query = `
    SELECT
      lsm.*,
      COALESCE(up.display_name, up.full_name) AS user_name,
      COALESCE(dp.display_name, dp.full_name) AS deleted_by_name,
      COALESCE(
        (SELECT array_agg(r.key ORDER BY r.key)
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id),
        ARRAY[]::text[]
      ) AS user_roles
    FROM live_stream_messages lsm
    LEFT JOIN users u ON u.id = lsm.user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN user_profiles dp ON dp.user_id = lsm.deleted_by
    WHERE lsm.live_stream_id = $1 AND lsm.id > $2
    ORDER BY lsm.id ASC
    LIMIT $3;
  `;
  const { rows } = await client.query(query, [streamId, sinceId, limit]);
  return rows;
}

/**
 * Soft-deletes one chat message. Returns null when the id does not belong to this stream, so the
 * caller cannot remove a message by guessing an id from another broadcast.
 */
export async function softDeleteMessage(client, { streamId, messageId, moderatorId, reason }) {
  const query = `
    UPDATE live_stream_messages
    SET deleted_at = now(), deleted_by = $3, deletion_reason = $4
    WHERE id = $2 AND live_stream_id = $1 AND deleted_at IS NULL
    RETURNING *;
  `;
  const { rows } = await client.query(query, [streamId, messageId, moderatorId, reason]);
  return rows[0] ?? null;
}

export async function incrementLikes(client, streamId, delta = 1) {
  const query = `
    UPDATE live_streams
    SET total_likes_count = total_likes_count + $2
    WHERE id = $1
    RETURNING total_likes_count;
  `;
  const { rows } = await client.query(query, [streamId, delta]);
  return rows[0]?.total_likes_count || 0;
}

export async function updateViewersCount(client, streamId, currentCount) {
  const query = `
    UPDATE live_streams
    SET 
      viewer_count = $2,
      peak_viewer_count = GREATEST(peak_viewer_count, $2)
    WHERE id = $1
    RETURNING viewer_count, peak_viewer_count;
  `;
  const { rows } = await client.query(query, [streamId, currentCount]);
  return rows[0];
}

export async function recordStreamSale(client, streamId, amount) {
  const query = `
    UPDATE live_streams
    SET 
      total_sales_count = total_sales_count + 1,
      total_sales_amount = total_sales_amount + $2
    WHERE id = $1
    RETURNING total_sales_count, total_sales_amount;
  `;
  const { rows } = await client.query(query, [streamId, amount]);
  return rows[0];
}
