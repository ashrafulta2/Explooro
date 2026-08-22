/**
 * order.repository.js — SQL repository for orders, sub-orders, and order items (Prompt 5.2).
 *
 * Implements deterministic row locking, FEFO batch allocation, and multi-supplier queries.
 */

export async function createOrder(db, {
  ref,
  customerId,
  totalAmount,
  itemsAmount,
  shippingAmount = 0,
  discountAmount = 0,
  coinsRedeemed = 0,
  coinsDiscount = 0,
  currency = 'BDT',
  paymentMethod,
  paymentStatus = 'PENDING',
  isOtpVerified = false,
  trustScoreAtOrder = null,
  couponId = null,
  teamPurchaseId = null,
  idempotencyKey = null,
  recipientName,
  recipientPhone,
  division,
  district,
  upazila = null,
  addressLine,
}) {
  const query = `
    INSERT INTO orders (
      ref, customer_id, total_amount, items_amount, shipping_amount, discount_amount,
      coins_redeemed, coins_discount, currency, payment_method, payment_status,
      is_otp_verified, trust_score_at_order, coupon_id, team_purchase_id, idempotency_key,
      recipient_name, recipient_phone, division, district, upazila, address_line,
      placed_at, created_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22,
      now(), now()
    )
    RETURNING *
  `;
  const { rows } = await db.query(query, [
    ref,
    customerId,
    totalAmount,
    itemsAmount,
    shippingAmount,
    discountAmount,
    coinsRedeemed,
    coinsDiscount,
    currency,
    paymentMethod,
    paymentStatus,
    isOtpVerified,
    trustScoreAtOrder,
    couponId,
    teamPurchaseId,
    idempotencyKey,
    recipientName,
    recipientPhone,
    division,
    district,
    upazila,
    addressLine,
  ]);
  return rows[0];
}

export async function createSubOrder(db, {
  ref,
  orderId,
  supplierId,
  salerId = null,
  warehouseNodeId = null,
  subtotalBase,
  wholesaleMargin = 0,
  netRetailMargin = 0,
  salerCommission = 0,
  platformMargin = 0,
  shippingAmount = 0,
  discountShare = 0,
  totalAmount,
  status = 'PLACED',
}) {
  const query = `
    INSERT INTO sub_orders (
      ref, order_id, supplier_id, saler_id, warehouse_node_id,
      subtotal_base, wholesale_margin, net_retail_margin,
      saler_commission, platform_margin, shipping_amount, discount_share,
      total_amount, status, created_at
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, now()
    )
    RETURNING *
  `;
  const { rows } = await db.query(query, [
    ref,
    orderId,
    supplierId,
    salerId,
    warehouseNodeId,
    subtotalBase,
    wholesaleMargin,
    netRetailMargin,
    salerCommission,
    platformMargin,
    shippingAmount,
    discountShare,
    totalAmount,
    status,
  ]);
  return rows[0];
}

export async function createOrderItem(db, {
  subOrderId,
  productId,
  variantId = null,
  batchId = null,
  bundleId = null,
  titleSnapshot,
  qty,
  basePrice,
  retailPrice,
  lineTotal,
}) {
  const query = `
    INSERT INTO order_items (
      sub_order_id, product_id, variant_id, batch_id, bundle_id,
      title_snapshot, qty, base_price, retail_price, line_total, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
    RETURNING *
  `;
  const { rows } = await db.query(query, [
    subOrderId,
    productId,
    variantId,
    batchId,
    bundleId,
    titleSnapshot,
    qty,
    basePrice,
    retailPrice,
    lineTotal,
  ]);
  return rows[0];
}

/**
 * Deterministic Row Locking:
 * Locks products and variants in strictly ascending ID order to eliminate database deadlocks.
 */
export async function lockProductsAndVariants(client, lineItems) {
  // 1. Extract unique product IDs in ASC order
  const productIds = [...new Set(lineItems.map((item) => Number(item.product_id)))].sort((a, b) => a - b);

  // 2. Extract unique variant IDs in ASC order
  const variantIds = [...new Set(lineItems.map((item) => item.variant_id).filter(Boolean).map(Number))].sort((a, b) => a - b);

  let lockedProducts = [];
  if (productIds.length > 0) {
    const { rows } = await client.query(
      `SELECT id, ref, title_en, title_bn, slug, status, base_cost, wholesale_margin, default_retail_price, stock_qty, supplier_id, category_id
       FROM products
       WHERE id = ANY($1::bigint[])
       ORDER BY id ASC
       FOR UPDATE`,
      [productIds]
    );
    lockedProducts = rows;
  }

  let lockedVariants = [];
  if (variantIds.length > 0) {
    const { rows } = await client.query(
      `SELECT id, product_id, sku, price_delta, stock_qty, is_active
       FROM product_variants
       WHERE id = ANY($1::bigint[])
       ORDER BY id ASC
       FOR UPDATE`,
      [variantIds]
    );
    lockedVariants = rows;
  }

  return {
    productsById: new Map(lockedProducts.map((p) => [Number(p.id), p])),
    variantsById: new Map(lockedVariants.map((v) => [Number(v.id), v])),
  };
}

/**
 * Allocates inventory batch using FEFO (First-Expired, First-Out).
 */
export async function allocateFefoBatch(client, { productId, variantId = null, qty, warehouseNodeId = null }) {
  let query = `
    SELECT id, warehouse_node_id, batch_number, exp_date, qty
    FROM product_batches
    WHERE product_id = $1
      AND (variant_id IS NULL OR variant_id = $2)
      AND status = 'ACTIVE'
      AND qty >= $3
  `;
  const params = [productId, variantId, qty];

  if (warehouseNodeId) {
    query += ` AND warehouse_node_id = $4`;
    params.push(warehouseNodeId);
  }

  query += ` ORDER BY exp_date ASC NULLS LAST, id ASC LIMIT 1 FOR UPDATE`;

  const { rows } = await client.query(query, params);
  if (rows.length > 0) {
    const batch = rows[0];
    await client.query(
      `UPDATE product_batches SET qty = qty - $1, updated_at = now() WHERE id = $2`,
      [qty, batch.id]
    );
    return batch;
  }

  return null;
}

/**
 * Decrements stock on product and variant records.
 */
export async function deductStock(client, { productId, variantId = null, qty }) {
  await client.query(
    `UPDATE products
     SET stock_qty = stock_qty - $1, sold_count = sold_count + $1, updated_at = now()
     WHERE id = $2`,
    [qty, productId]
  );

  if (variantId) {
    await client.query(
      `UPDATE product_variants
       SET stock_qty = stock_qty - $1, updated_at = now()
       WHERE id = $2`,
      [qty, variantId]
    );
  }
}

/**
 * Restores inventory stock when an order is cancelled.
 */
export async function restoreStock(client, orderItems) {
  for (const item of orderItems) {
    const qty = Number(item.qty);
    await client.query(
      `UPDATE products
       SET stock_qty = stock_qty + $1, sold_count = GREATEST(0, sold_count - $1), updated_at = now()
       WHERE id = $2`,
      [qty, item.product_id]
    );

    if (item.variant_id) {
      await client.query(
        `UPDATE product_variants
         SET stock_qty = stock_qty + $1, updated_at = now()
         WHERE id = $2`,
        [qty, item.variant_id]
      );
    }

    if (item.batch_id) {
      await client.query(
        `UPDATE product_batches
         SET qty = qty + $1, updated_at = now()
         WHERE id = $2`,
        [qty, item.batch_id]
      );
    }
  }
}

export async function findOrderByRef(db, ref, { userId = null, allowAny = false } = {}) {
  let query = `
    SELECT
      o.*,
      u.full_name AS customer_name,
      u.phone AS customer_phone,
      c.code AS coupon_code
    FROM orders o
    JOIN users u ON u.id = o.customer_id
    LEFT JOIN coupons c ON c.id = o.coupon_id
    WHERE o.ref = $1
  `;
  const params = [ref];

  if (!allowAny && userId) {
    query += ` AND o.customer_id = $2`;
    params.push(userId);
  }

  const { rows } = await db.query(query, params);
  if (!rows.length) return null;

  const order = rows[0];
  const subOrders = await getSubOrdersByOrderId(db, order.id);
  return { ...order, sub_orders: subOrders };
}

export async function findOrderById(db, id, { userId = null, allowAny = false } = {}) {
  let query = `
    SELECT
      o.*,
      u.full_name AS customer_name,
      u.phone AS customer_phone,
      c.code AS coupon_code
    FROM orders o
    JOIN users u ON u.id = o.customer_id
    LEFT JOIN coupons c ON c.id = o.coupon_id
    WHERE o.id = $1
  `;
  const params = [id];

  if (!allowAny && userId) {
    query += ` AND o.customer_id = $2`;
    params.push(userId);
  }

  const { rows } = await db.query(query, params);
  if (!rows.length) return null;

  const order = rows[0];
  const subOrders = await getSubOrdersByOrderId(db, order.id);
  return { ...order, sub_orders: subOrders };
}

export async function findOrderByIdempotencyKey(db, idempotencyKey) {
  if (!idempotencyKey) return null;
  const { rows } = await db.query(
    `SELECT * FROM orders WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  if (!rows.length) return null;
  const order = rows[0];
  const subOrders = await getSubOrdersByOrderId(db, order.id);
  return { ...order, sub_orders: subOrders };
}

export async function getSubOrdersByOrderId(db, orderId) {
  const { rows: subOrders } = await db.query(
    `SELECT
       so.*,
       supp.full_name AS supplier_name,
       supp.phone AS supplier_phone,
       saler.full_name AS saler_name,
       wn.name AS warehouse_node_name
     FROM sub_orders so
     JOIN users supp ON supp.id = so.supplier_id
     LEFT JOIN users saler ON saler.id = so.saler_id
     LEFT JOIN warehouse_nodes wn ON wn.id = so.warehouse_node_id
     WHERE so.order_id = $1
     ORDER BY so.id ASC`,
    [orderId]
  );

  const subOrderIds = subOrders.map((s) => s.id);
  if (!subOrderIds.length) return [];

  const { rows: items } = await db.query(
    `SELECT
       oi.*,
       p.ref AS product_ref,
       p.slug AS product_slug,
       pv.sku AS variant_sku
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN product_variants pv ON pv.id = oi.variant_id
     WHERE oi.sub_order_id = ANY($1::bigint[])
     ORDER BY oi.id ASC`,
    [subOrderIds]
  );

  const itemsBySubOrder = new Map();
  for (const item of items) {
    const sId = item.sub_order_id;
    if (!itemsBySubOrder.has(sId)) itemsBySubOrder.set(sId, []);
    itemsBySubOrder.get(sId).push(item);
  }

  return subOrders.map((so) => ({
    ...so,
    items: itemsBySubOrder.get(so.id) || [],
  }));
}

export async function listUserOrders(db, userId, { limit = 20, cursor = null } = {}) {
  let query = `
    SELECT
      o.id,
      o.ref,
      o.total_amount,
      o.items_amount,
      o.shipping_amount,
      o.discount_amount,
      o.currency,
      o.payment_method,
      o.payment_status,
      o.placed_at,
      COUNT(so.id)::int AS sub_order_count
    FROM orders o
    LEFT JOIN sub_orders so ON so.order_id = o.id
    WHERE o.customer_id = $1
  `;
  const params = [userId];

  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
      if (decoded.id) {
        query += ` AND o.id < $${params.length + 1}`;
        params.push(decoded.id);
      }
    } catch {
      // Ignore malformed cursor
    }
  }

  query += ` GROUP BY o.id ORDER BY o.id DESC LIMIT $${params.length + 1}`;
  params.push(limit + 1);

  const { rows } = await db.query(query, params);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const nextCursor = hasMore && items.length > 0
    ? Buffer.from(JSON.stringify({ id: items[items.length - 1].id })).toString('base64')
    : null;

  return {
    orders: items,
    cursor: {
      next: nextCursor,
      has_more: hasMore,
    },
    count: items.length,
  };
}

export async function cancelOrder(client, orderId) {
  // Update sub-orders
  await client.query(
    `UPDATE sub_orders SET status = 'CANCELLED', updated_at = now() WHERE order_id = $1 AND status = 'PLACED'`,
    [orderId]
  );

  // Update root order
  await client.query(
    `UPDATE orders SET updated_at = now() WHERE id = $1`,
    [orderId]
  );
}
