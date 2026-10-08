/**
 * sampleKit.repository.js — Raw SQL for sample offers, sample requests and marketing kits.
 * No rules here: the service decides what the numbers mean, this file only reads and stores them.
 */

export async function getRulesRow(db) {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = 'supplier.sample_kit'`);
  return rows[0] ? rows[0].value_json : null;
}

// ---- supplier side ----------------------------------------------------------------------------------------

/** A supplier's own products with the sample offer and kit (if any) on each. */
export async function listSupplierProducts(db, supplierId) {
  const { rows } = await db.query(
    `SELECT p.id AS product_id, p.title_en, p.title_bn, p.status, p.base_cost,
            o.price AS sample_price, o.shipping_fee AS sample_shipping_fee, o.is_active AS sample_active,
            k.id AS kit_id, k.caption_en, k.caption_bn, k.hashtags, k.selling_points, k.video_url, k.is_published
       FROM products p
       LEFT JOIN sample_offers o ON o.product_id = p.id
       LEFT JOIN marketing_kits k ON k.product_id = p.id
      WHERE p.supplier_id = $1 AND p.deleted_at IS NULL AND p.status <> 'ARCHIVED'
      ORDER BY p.id DESC`,
    [supplierId]
  );
  return rows;
}

export async function getOwnedProduct(db, supplierId, productId) {
  const { rows } = await db.query(
    `SELECT id, supplier_id, status, title_en, title_bn FROM products
      WHERE id = $1 AND supplier_id = $2 AND deleted_at IS NULL`,
    [productId, supplierId]
  );
  return rows[0] || null;
}

export async function upsertOffer(db, { productId, supplierId, price, shippingFee, isActive }) {
  const { rows } = await db.query(
    `INSERT INTO sample_offers (product_id, supplier_id, price, shipping_fee, is_active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id) DO UPDATE
       SET price = EXCLUDED.price, shipping_fee = EXCLUDED.shipping_fee,
           is_active = EXCLUDED.is_active, updated_at = now()
     RETURNING *`,
    [productId, supplierId, price, shippingFee, isActive]
  );
  return rows[0];
}

export async function getOffer(db, productId) {
  const { rows } = await db.query(`SELECT * FROM sample_offers WHERE product_id = $1`, [productId]);
  return rows[0] || null;
}

export async function upsertKit(db, { productId, supplierId, kit }) {
  const { rows } = await db.query(
    `INSERT INTO marketing_kits (product_id, supplier_id, caption_en, caption_bn, hashtags, selling_points, video_url, is_published)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
     ON CONFLICT (product_id) DO UPDATE
       SET caption_en = EXCLUDED.caption_en, caption_bn = EXCLUDED.caption_bn,
           hashtags = EXCLUDED.hashtags, selling_points = EXCLUDED.selling_points,
           video_url = EXCLUDED.video_url, is_published = EXCLUDED.is_published, updated_at = now()
     RETURNING *`,
    [productId, supplierId, kit.caption_en, kit.caption_bn, JSON.stringify(kit.hashtags),
     JSON.stringify(kit.selling_points), kit.video_url, kit.is_published]
  );
  return rows[0];
}

export async function getKit(db, productId) {
  const { rows } = await db.query(`SELECT * FROM marketing_kits WHERE product_id = $1`, [productId]);
  return rows[0] || null;
}

// ---- saler side -------------------------------------------------------------------------------------------

/**
 * Active sample offers on live products, with the viewer's own live request on each (if any).
 * A supplier's own products are not offered back to them.
 */
export async function listOffersForSaler(db, salerId) {
  const { rows } = await db.query(
    `SELECT o.product_id, o.supplier_id, o.price, o.shipping_fee,
            p.title_en, p.title_bn, p.base_cost, p.default_retail_price,
            (SELECT m.storage_key FROM product_images pi JOIN media_assets m ON m.id = pi.media_id
              WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) AS image_key,
            COALESCE(up.display_name, up.full_name) AS supplier_name,
            r.id AS request_id, r.status AS request_status
       FROM sample_offers o
       JOIN products p ON p.id = o.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
       LEFT JOIN user_profiles up ON up.user_id = o.supplier_id
       LEFT JOIN sample_requests r ON r.product_id = o.product_id AND r.saler_id = $1
            AND r.status IN ('REQUESTED','ACCEPTED','SHIPPED','DELIVERED')
      WHERE o.is_active AND o.supplier_id <> $1
      ORDER BY o.updated_at DESC
      LIMIT 200`,
    [salerId]
  );
  return rows;
}

/** Published kits on live products, newest first, with the product's own gallery as the image pack. */
export async function listKitsForSaler(db) {
  const { rows } = await db.query(
    `SELECT k.product_id, k.supplier_id, k.caption_en, k.caption_bn, k.hashtags, k.selling_points, k.video_url, k.updated_at,
            p.title_en, p.title_bn,
            COALESCE(up.display_name, up.full_name) AS supplier_name,
            COALESCE((SELECT json_agg(m.storage_key ORDER BY pi.is_primary DESC, pi.display_order ASC)
                        FROM product_images pi JOIN media_assets m ON m.id = pi.media_id
                       WHERE pi.product_id = p.id), '[]'::json) AS image_keys
       FROM marketing_kits k
       JOIN products p ON p.id = k.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
       LEFT JOIN user_profiles up ON up.user_id = k.supplier_id
      WHERE k.is_published
      ORDER BY k.updated_at DESC
      LIMIT 200`
  );
  return rows;
}

// ---- requests ---------------------------------------------------------------------------------------------

export async function countOpenForSaler(db, salerId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM sample_requests
      WHERE saler_id = $1 AND status IN ('REQUESTED','ACCEPTED','SHIPPED')`,
    [salerId]
  );
  return rows[0].n;
}

export async function insertRequest(client, r) {
  const { rows } = await client.query(
    `INSERT INTO sample_requests
       (product_id, supplier_id, saler_id, price, shipping_fee, platform_fee,
        ship_to_name, ship_to_phone, ship_to_address, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [r.productId, r.supplierId, r.salerId, r.price, r.shippingFee, r.platformFee,
     r.shipTo.name, r.shipTo.phone, r.shipTo.address, r.note]
  );
  return rows[0];
}

export async function lockRequest(client, id) {
  const { rows } = await client.query(`SELECT * FROM sample_requests WHERE id = $1 FOR UPDATE`, [id]);
  return rows[0] || null;
}

export async function setHold(client, id, txnGroupId) {
  await client.query(`UPDATE sample_requests SET hold_txn_group_id = $2 WHERE id = $1`, [id, txnGroupId]);
}

/** Moves a request to a new status. The caller has already locked the row and checked the transition. */
export async function setStatus(client, id, status, extra = {}) {
  const { rows } = await client.query(
    `UPDATE sample_requests
        SET status = $2,
            responded_at = CASE WHEN $2 IN ('ACCEPTED','DECLINED') THEN now() ELSE responded_at END,
            shipped_at   = CASE WHEN $2 = 'SHIPPED' THEN now() ELSE shipped_at END,
            closed_at    = CASE WHEN $2 IN ('DELIVERED','DECLINED','CANCELLED','EXPIRED') THEN now() ELSE closed_at END,
            tracking_note  = COALESCE($3, tracking_note),
            decline_reason = COALESCE($4, decline_reason),
            close_txn_group_id = COALESCE($5, close_txn_group_id)
      WHERE id = $1
      RETURNING *`,
    [id, status, extra.trackingNote ?? null, extra.declineReason ?? null, extra.closeTxnGroupId ?? null]
  );
  return rows[0];
}

const REQUEST_COLUMNS = `r.id, r.product_id, r.supplier_id, r.saler_id, r.price, r.shipping_fee, r.platform_fee, r.status,
            r.ship_to_name, r.ship_to_phone, r.ship_to_address, r.note, r.tracking_note, r.decline_reason,
            r.requested_at, r.responded_at, r.shipped_at, r.closed_at, p.title_en, p.title_bn`;

export async function listRequestsForSupplier(db, supplierId) {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS}, COALESCE(up.display_name, up.full_name) AS saler_name
       FROM sample_requests r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN user_profiles up ON up.user_id = r.saler_id
      WHERE r.supplier_id = $1
      ORDER BY r.requested_at DESC
      LIMIT 100`,
    [supplierId]
  );
  return rows;
}

export async function listRequestsForSaler(db, salerId) {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS}, COALESCE(up.display_name, up.full_name) AS supplier_name
       FROM sample_requests r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN user_profiles up ON up.user_id = r.supplier_id
      WHERE r.saler_id = $1
      ORDER BY r.requested_at DESC
      LIMIT 100`,
    [salerId]
  );
  return rows;
}

/** Requests the supplier never shipped within `days` of being asked. */
export async function listUnshippedOlderThan(db, days) {
  const { rows } = await db.query(
    `SELECT id FROM sample_requests
      WHERE status IN ('REQUESTED','ACCEPTED') AND requested_at < now() - make_interval(days => $1)
      ORDER BY id LIMIT 500`,
    [days]
  );
  return rows.map((r) => r.id);
}

/** Shipped samples whose saler never confirmed within `days` of shipping. */
export async function listShippedOlderThan(db, days) {
  const { rows } = await db.query(
    `SELECT id FROM sample_requests
      WHERE status = 'SHIPPED' AND shipped_at < now() - make_interval(days => $1)
      ORDER BY id LIMIT 500`,
    [days]
  );
  return rows.map((r) => r.id);
}
