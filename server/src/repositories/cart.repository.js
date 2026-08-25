/**
 * cart.repository.js — SQL repository for carts, cart items, wishlists, and abandoned carts (Prompt 5.1).
 *
 * Enforces raw SQL layered architecture (docs/architecture-map.md §1).
 */

export async function findActiveCartByUser(db, userId) {
  const { rows } = await db.query(
    `SELECT * FROM carts WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY last_activity_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

export async function findActiveCartByGuestToken(db, guestToken) {
  if (!guestToken) return null;
  const { rows } = await db.query(
    `SELECT * FROM carts WHERE guest_token = $1 AND status = 'ACTIVE' ORDER BY last_activity_at DESC LIMIT 1`,
    [guestToken]
  );
  return rows[0] || null;
}

export async function createCart(db, { userId = null, guestToken = null }) {
  const { rows } = await db.query(
    `INSERT INTO carts (user_id, guest_token, status, last_activity_at, created_at)
     VALUES ($1, $2, 'ACTIVE', now(), now())
     RETURNING *`,
    [userId, guestToken]
  );
  return rows[0];
}

export async function touchCartActivity(db, cartId) {
  await db.query(
    `UPDATE carts SET last_activity_at = now(), updated_at = now() WHERE id = $1`,
    [cartId]
  );
}

export async function getCartItemsWithDetails(db, cartId) {
  const query = `
    SELECT
      ci.id,
      ci.cart_id,
      ci.product_id,
      ci.variant_id,
      ci.saler_id,
      ci.bundle_id,
      ci.qty,
      ci.price_at_add,
      ci.added_at,
      p.ref AS product_ref,
      p.title_en AS product_title_en,
      p.title_bn AS product_title_bn,
      p.slug AS product_slug,
      p.status AS product_status,
      p.default_retail_price AS current_product_retail_price,
      p.base_cost AS current_product_base_price,
      p.stock_qty AS current_product_stock_qty,
      p.supplier_id,
      up.full_name AS supplier_name,
      u.phone AS supplier_phone,
      -- Variants carry a delta off the product price, not an absolute override; the service reads
      -- variant_price_override ?? current_product_retail_price, so resolve the delta here.
      pv.attributes_json AS variant_attributes,
      pv.sku AS variant_sku,
      CASE WHEN pv.id IS NULL THEN NULL
           ELSE p.default_retail_price + pv.price_delta END AS variant_price_override,
      pv.stock_qty AS variant_stock_qty,
      pv.is_active AS variant_is_active,
      (
        SELECT m.storage_key
        FROM product_images pi2
        JOIN media_assets m ON m.id = pi2.media_id
        WHERE pi2.product_id = p.id
        ORDER BY pi2.is_primary DESC, pi2.display_order ASC
        LIMIT 1
      ) AS primary_image_url
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    JOIN users u ON u.id = p.supplier_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN product_variants pv ON pv.id = ci.variant_id
    WHERE ci.cart_id = $1
    ORDER BY ci.added_at ASC
  `;
  const { rows } = await db.query(query, [cartId]);
  return rows;
}

export async function upsertCartItem(db, { cartId, productId, variantId = null, salerId = null, bundleId = null, qty, priceAtAdd }) {
  // Uses ON CONFLICT on the unique expression index
  const query = `
    INSERT INTO cart_items (cart_id, product_id, variant_id, saler_id, bundle_id, qty, price_at_add, added_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, now())
    ON CONFLICT (cart_id, product_id, COALESCE(variant_id, 0), COALESCE(bundle_id, 0))
    DO UPDATE SET
      qty = cart_items.qty + EXCLUDED.qty,
      price_at_add = EXCLUDED.price_at_add,
      added_at = now()
    RETURNING *
  `;
  const { rows } = await db.query(query, [cartId, productId, variantId, salerId, bundleId, qty, priceAtAdd]);
  return rows[0];
}

export async function updateCartItemQty(db, { cartId, itemId, qty }) {
  const { rows } = await db.query(
    `UPDATE cart_items SET qty = $1 WHERE id = $2 AND cart_id = $3 RETURNING *`,
    [qty, itemId, cartId]
  );
  return rows[0] || null;
}

export async function deleteCartItem(db, { cartId, itemId }) {
  const { rows } = await db.query(
    `DELETE FROM cart_items WHERE id = $1 AND cart_id = $2 RETURNING *`,
    [itemId, cartId]
  );
  return rows[0] || null;
}

export async function clearCartItems(db, cartId) {
  await db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
}

export async function mergeGuestCart(db, { guestCartId, userCartId }) {
  // Move or add items from guest cart to user cart
  const guestItems = await db.query(`SELECT * FROM cart_items WHERE cart_id = $1`, [guestCartId]);
  for (const item of guestItems.rows) {
    await upsertCartItem(db, {
      cartId: userCartId,
      productId: item.product_id,
      variantId: item.variant_id,
      salerId: item.saler_id,
      bundleId: item.bundle_id,
      qty: item.qty,
      priceAtAdd: item.price_at_add,
    });
  }

  // Mark guest cart as MERGED
  await db.query(
    `UPDATE carts SET status = 'MERGED', updated_at = now() WHERE id = $1`,
    [guestCartId]
  );
}

/* ---------------- Wishlists ---------------- */

export async function getWishlistByUser(db, userId) {
  const query = `
    SELECT
      w.id,
      w.user_id,
      w.product_id,
      w.price_at_save,
      w.notify_on_drop,
      w.created_at,
      p.ref AS product_ref,
      p.title_en AS product_title_en,
      p.title_bn AS product_title_bn,
      p.slug AS product_slug,
      p.default_retail_price AS current_retail_price,
      p.status AS product_status,
      p.stock_qty,
      (
        SELECT m.storage_key
        FROM product_images pi2
        JOIN media_assets m ON m.id = pi2.media_id
        WHERE pi2.product_id = p.id
        ORDER BY pi2.is_primary DESC, pi2.display_order ASC
        LIMIT 1
      ) AS primary_image_url
    FROM wishlists w
    JOIN products p ON p.id = w.product_id
    WHERE w.user_id = $1
    ORDER BY w.created_at DESC
  `;
  const { rows } = await db.query(query, [userId]);
  return rows;
}

export async function addWishlistItem(db, { userId, productId, priceAtSave, notifyOnDrop = true }) {
  const { rows } = await db.query(
    `INSERT INTO wishlists (user_id, product_id, price_at_save, notify_on_drop, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, product_id)
     DO UPDATE SET price_at_save = EXCLUDED.price_at_save, notify_on_drop = EXCLUDED.notify_on_drop
     RETURNING *`,
    [userId, productId, priceAtSave, notifyOnDrop]
  );
  return rows[0];
}

export async function removeWishlistItem(db, { userId, productId }) {
  const { rows } = await db.query(
    `DELETE FROM wishlists WHERE user_id = $1 AND product_id = $2 RETURNING *`,
    [userId, productId]
  );
  return rows[0] || null;
}

export async function isProductInWishlist(db, { userId, productId }) {
  const { rows } = await db.query(
    `SELECT id FROM wishlists WHERE user_id = $1 AND product_id = $2`,
    [userId, productId]
  );
  return rows.length > 0;
}
