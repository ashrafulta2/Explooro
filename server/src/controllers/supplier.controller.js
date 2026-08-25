/**
 * supplier.controller.js — Supplier / Manufacturer Operations Controller (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AL.1:
 * - KPI Dashboard Aggregations (Live Stock, Low Stock, Pending Orders, Today's Earnings, Expiring Batches).
 * - Inventory & Multi-Node Stock Management.
 * - FEFO Batch Management, Clearance Actions & Recalls.
 * - Multi-Warehouse Mapping & Node Configurations.
 * - Fulfilment Queue, Consignments & Labels.
 * - Reseller Network Insights & Curators Leaderboard.
 * - Physical Shop Operating Status Toggle.
 */

import * as inventoryService from '../services/inventory.service.js';
import * as warehouseRoutingService from '../services/warehouseRouting.service.js';
import { AppError } from '../plugins/errorHandler.js';
import { toPaisa, toBdtNumber } from '../services/pricing.service.js';

/**
 * Aggregates high-level KPI metrics for the Supplier Dashboard.
 */
export async function getDashboardOverview(req, reply) {
  const supplierId = req.user.id;
  const db = req.server.db;

  // 1. Live stock & low-stock count
  const { rows: stockStats } = await db.query(
    `SELECT
       COUNT(p.id) AS total_products,
       COALESCE(SUM(p.stock_qty), 0)::integer AS total_units,
       COALESCE(SUM(CASE WHEN p.stock_qty <= p.low_stock_threshold THEN 1 ELSE 0 END), 0)::integer AS low_stock_count,
       COALESCE(SUM(CASE WHEN p.stock_qty = 0 THEN 1 ELSE 0 END), 0)::integer AS out_of_stock_count
     FROM products p
     WHERE p.supplier_id = $1 AND p.status != 'ARCHIVED'`,
    [supplierId]
  );

  // 2. Pending fulfilment orders & today's earnings
  const { rows: orderStats } = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN so.status IN ('PLACED', 'CONFIRMED', 'PROCESSING') THEN 1 ELSE 0 END), 0)::integer AS pending_orders_count,
       COALESCE(SUM(CASE WHEN so.created_at >= date_trunc('day', now()) THEN so.wholesale_margin ELSE 0 END), 0)::numeric AS today_earnings,
       COALESCE(SUM(CASE WHEN so.status = 'DELIVERED' THEN so.wholesale_margin ELSE 0 END), 0)::numeric AS total_settled_earnings
     FROM sub_orders so
     WHERE so.supplier_id = $1`,
    [supplierId]
  );

  // 3. Batches approaching expiration (< 60 days)
  const { rows: batchStats } = await db.query(
    `SELECT
       COUNT(pb.id) AS total_active_batches,
       COALESCE(SUM(CASE WHEN pb.exp_date <= (now() + interval '60 days') AND pb.exp_date > now() THEN 1 ELSE 0 END), 0)::integer AS expiring_soon_count,
       COALESCE(SUM(CASE WHEN pb.exp_date <= now() THEN 1 ELSE 0 END), 0)::integer AS expired_count
     FROM product_batches pb
     JOIN products p ON p.id = pb.product_id
     WHERE p.supplier_id = $1 AND pb.status IN ('ACTIVE', 'EXPIRING_SOON') AND pb.qty > 0`,
    [supplierId]
  );

  // 4. Warehouse nodes count
  const { rows: warehouseStats } = await db.query(
    `SELECT COUNT(id) AS total_warehouses
     FROM warehouse_nodes
     WHERE supplier_id = $1 AND is_active = true`,
    [supplierId]
  );

  // 5. Active resellers count
  const { rows: resellerStats } = await db.query(
    `SELECT COUNT(DISTINCT ssi.store_id) AS active_curators_count
     FROM saler_store_items ssi
     JOIN products p ON p.id = ssi.product_id
     WHERE p.supplier_id = $1`,
    [supplierId]
  );

  // 6. Physical shop status
  const { rows: storeStats } = await db.query(
    `SELECT is_open, opening_time, closing_time, holiday_schedule
     FROM physical_shop_status
     WHERE user_id = $1 LIMIT 1`,
    [supplierId]
  );

  const shopStatus = storeStats[0] || { is_open: true, opening_time: '09:00', closing_time: '20:00' };

  return reply.send({
    success: true,
    data: {
      metrics: {
        total_products: Number(stockStats[0]?.total_products || 0),
        total_units: Number(stockStats[0]?.total_units || 0),
        low_stock_count: Number(stockStats[0]?.low_stock_count || 0),
        out_of_stock_count: Number(stockStats[0]?.out_of_stock_count || 0),
        pending_orders_count: Number(orderStats[0]?.pending_orders_count || 0),
        today_earnings: Number(orderStats[0]?.today_earnings || 0),
        total_settled_earnings: Number(orderStats[0]?.total_settled_earnings || 0),
        total_active_batches: Number(batchStats[0]?.total_active_batches || 0),
        expiring_soon_count: Number(batchStats[0]?.expiring_soon_count || 0),
        expired_count: Number(batchStats[0]?.expired_count || 0),
        total_warehouses: Number(warehouseStats[0]?.total_warehouses || 0),
        active_curators_count: Number(resellerStats[0]?.active_curators_count || 0),
      },
      physical_shop: shopStatus,
    },
  });
}

/**
 * Returns supplier inventory with live stock levels and warehouse allocations.
 */
export async function getInventory(req, reply) {
  const supplierId = req.user.id;
  const { search, status } = req.query;

  const items = await inventoryService.getSupplierInventory(req.server.db, supplierId, { search, status });
  return reply.send({ success: true, data: items });
}

/**
 * Updates stock levels on product or variant in a specific warehouse node.
 */
export async function updateStockLevel(req, reply) {
  const supplierId = req.user.id;
  const { productId, variantId, warehouseNodeId, stockQty } = req.body;
  const db = req.server.db;

  if (!productId || stockQty === undefined) {
    throw new AppError('VALIDATION_FAILED', 'Product ID and stock quantity are required.', 'পণ্য আইডি এবং স্টক সংখ্যা আবশ্যক।');
  }

  // Ensure product ownership
  const { rows: prodRows } = await db.query(
    `SELECT id FROM products WHERE id = $1 AND supplier_id = $2`,
    [productId, supplierId]
  );
  if (prodRows.length === 0) {
    throw new AppError('UNAUTHORIZED', 'Not authorized to update this product stock.', 'এই পণ্যের স্টক পরিবর্তনের অনুমতি নেই।');
  }

  const parsedQty = Math.max(0, parseInt(stockQty, 10));

  // Update warehouse_stock table if warehouseNodeId is given
  if (warehouseNodeId) {
    await db.query(
      `INSERT INTO warehouse_stock (warehouse_node_id, product_id, variant_id, stock_qty, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (warehouse_node_id, product_id, COALESCE(variant_id, 0))
       DO UPDATE SET stock_qty = $4, updated_at = now()`,
      [warehouseNodeId, productId, variantId || null, parsedQty]
    );
  }

  // Re-calculate aggregate product stock
  const { rows: aggRows } = await db.query(
    `SELECT COALESCE(SUM(stock_qty), 0)::integer AS total_stock
     FROM warehouse_stock
     WHERE product_id = $1`,
    [productId]
  );

  const newTotal = aggRows[0]?.total_stock || parsedQty;

  await db.query(
    `UPDATE products SET stock_qty = $1, updated_at = now() WHERE id = $2`,
    [newTotal, productId]
  );

  return reply.send({ success: true, data: { productId, stock_qty: newTotal } });
}

/**
 * Lists supplier's batches with FEFO expiration metrics.
 */
export async function getBatches(req, reply) {
  const supplierId = req.user.id;
  const { status } = req.query;

  const batches = await inventoryService.getSupplierBatches(req.server.db, supplierId, { status });
  return reply.send({ success: true, data: batches });
}

/**
 * Creates a new batch.
 */
export async function createBatch(req, reply) {
  const supplierId = req.user.id;
  const batch = await inventoryService.createBatch(req.server.db, {
    supplierId,
    ...req.body,
  });

  return reply.code(201).send({ success: true, data: batch });
}

/**
 * 1-Click clearance sale trigger on an expiring batch.
 */
export async function triggerBatchClearance(req, reply) {
  const supplierId = req.user.id;
  const batchId = req.params.id;
  const discountPct = req.body?.discountPct || 20;

  const result = await inventoryService.applyBatchClearance(req.server.db, {
    supplierId,
    batchId,
    discountPct,
  });

  return reply.send({ success: true, data: result });
}

/**
 * Rapid recall isolation for a defective batch.
 */
export async function recallBatch(req, reply) {
  const supplierId = req.user.id;
  const batchId = req.params.id;
  const { reason } = req.body;

  const batch = await inventoryService.recallBatch(req.server.db, {
    supplierId,
    batchId,
    reason,
  });

  return reply.send({ success: true, data: batch });
}

/**
 * Lists supplier warehouse nodes.
 */
export async function getWarehouses(req, reply) {
  const supplierId = req.user.id;
  const db = req.server.db;

  const { rows } = await db.query(
    `SELECT
       wn.*,
       COALESCE(COUNT(ws.id), 0)::integer AS sku_count,
       COALESCE(SUM(ws.stock_qty), 0)::integer AS total_units_stored
     FROM warehouse_nodes wn
     LEFT JOIN warehouse_stock ws ON ws.warehouse_node_id = wn.id
     WHERE wn.supplier_id = $1
     GROUP BY wn.id
     ORDER BY wn.priority DESC, wn.id ASC`,
    [supplierId]
  );

  return reply.send({ success: true, data: rows });
}

/**
 * Adds a new warehouse node.
 */
export async function createWarehouse(req, reply) {
  const supplierId = req.user.id;
  const db = req.server.db;
  const { name, division, district, upazila, addressLine, latitude, longitude, priority = 0 } = req.body;

  if (!name || !division || !district || !addressLine) {
    throw new AppError('VALIDATION_FAILED', 'Name, division, district, and address line are required.', 'নাম, বিভাগ, জেলা এবং ঠিকানা আবশ্যক।');
  }

  // Resolve coordinates from district if not provided
  let lat = latitude;
  let lng = longitude;
  if (!lat || !lng) {
    const coords = warehouseRoutingService.getDistrictCoordinates(district);
    lat = coords.lat;
    lng = coords.lng;
  }

  const ref = `WH-${district.slice(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  const { rows } = await db.query(
    `INSERT INTO warehouse_nodes (
       ref, supplier_id, name, division, district, upazila, address_line,
       latitude, longitude, priority, is_active, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, now()
     ) RETURNING *`,
    [ref, supplierId, name.trim(), division.trim(), district.trim(), upazila?.trim() || null, addressLine.trim(), lat, lng, priority]
  );

  return reply.code(201).send({ success: true, data: rows[0] });
}

/**
 * Fulfilment queue of pending orders to pack with FEFO batch allocations.
 */
export async function getFulfilmentQueue(req, reply) {
  const supplierId = req.user.id;
  const db = req.server.db;

  const { rows: subOrders } = await db.query(
    `SELECT
       so.id,
       so.ref,
       so.order_id,
       so.status,
       so.subtotal_base,
       so.wholesale_margin,
       so.shipping_amount,
       so.total_amount,
       so.created_at,
       o.recipient_name,
       o.recipient_phone,
       o.division,
       o.district,
       o.upazila,
       o.address_line,
       o.payment_method,
       wn.name AS warehouse_name,
       wn.district AS warehouse_district,
       s.tracking_number,
       s.carrier,
       s.status AS shipment_status
     FROM sub_orders so
     JOIN orders o ON o.id = so.order_id
     LEFT JOIN warehouse_nodes wn ON wn.id = so.warehouse_node_id
     LEFT JOIN shipments s ON s.sub_order_id = so.id
     WHERE so.supplier_id = $1
       AND so.status IN ('PLACED', 'CONFIRMED', 'PROCESSING')
     ORDER BY so.id ASC`,
    [supplierId]
  );

  const subOrderIds = subOrders.map((s) => s.id);
  let items = [];

  if (subOrderIds.length > 0) {
    const { rows: itemRows } = await db.query(
      `SELECT
         oi.*,
         pb.batch_number,
         pb.exp_date AS batch_exp_date
       FROM order_items oi
       LEFT JOIN product_batches pb ON pb.id = oi.batch_id
       WHERE oi.sub_order_id = ANY($1::bigint[])
       ORDER BY oi.id ASC`,
      [subOrderIds]
    );
    items = itemRows;
  }

  const itemsBySubOrder = new Map();
  for (const item of items) {
    if (!itemsBySubOrder.has(item.sub_order_id)) {
      itemsBySubOrder.set(item.sub_order_id, []);
    }
    itemsBySubOrder.get(item.sub_order_id).push(item);
  }

  const queue = subOrders.map((so) => ({
    ...so,
    items: itemsBySubOrder.get(so.id) || [],
  }));

  return reply.send({ success: true, data: queue });
}

/**
 * 1-Click 3PL Consignment booking from fulfilment queue.
 */
export async function bookConsignment(req, reply) {
  const supplierId = req.user.id;
  const db = req.server.db;
  const { subOrderId, carrier = 'STEADFAST' } = req.body;

  if (!subOrderId) {
    throw new AppError('VALIDATION_FAILED', 'Sub-order ID is required.', 'সাব-অর্ডার আইডি আবশ্যক।');
  }

  const { rows: subOrderRows } = await db.query(
    `SELECT so.*, o.recipient_name, o.recipient_phone, o.district, o.address_line, o.payment_method
     FROM sub_orders so
     JOIN orders o ON o.id = so.order_id
     WHERE so.id = $1 AND so.supplier_id = $2`,
    [subOrderId, supplierId]
  );

  if (subOrderRows.length === 0) {
    throw new AppError('NOT_FOUND', 'Sub-order not found.', 'সাব-অর্ডার পাওয়া যায়নি।');
  }

  const so = subOrderRows[0];
  const trackingNumber = `TRK-${carrier.slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`;

  // Create shipment record
  const { rows: shipRows } = await db.query(
    `INSERT INTO shipments (
       sub_order_id, carrier, tracking_number, status, cod_amount, created_at
     ) VALUES (
       $1, $2, $3, 'MANIFESTED', $4, now()
     )
     ON CONFLICT (sub_order_id)
     DO UPDATE SET carrier = $2, tracking_number = $3, status = 'MANIFESTED', updated_at = now()
     RETURNING *`,
    [so.id, carrier, trackingNumber, so.payment_method === 'COD' ? so.total_amount : 0]
  );

  // Advance sub-order status to PROCESSING
  await db.query(
    `UPDATE sub_orders SET status = 'PROCESSING', updated_at = now() WHERE id = $1`,
    [subOrderId]
  );

  return reply.send({
    success: true,
    data: {
      shipment: shipRows[0],
      trackingNumber,
      carrier,
      message: `Consignment successfully booked with ${carrier}.`,
    },
  });
}

/**
 * Reseller network insights: Analytics on Salers who curate and sell the supplier's products.
 */
export async function getResellerInsights(req, reply) {
  const supplierId = req.user.id;
  const db = req.server.db;

  // 1. Top Salers Leaderboard for this supplier
  const { rows: topSalers } = await db.query(
    `SELECT
       u.id AS saler_id,
       COALESCE(up.display_name, up.full_name) AS saler_name,
       u.phone AS saler_phone,
       vs.shop_name,
       vs.slug AS store_slug,
       COUNT(DISTINCT so.id)::integer AS total_orders_sold,
       COALESCE(SUM(so.total_amount), 0)::numeric AS total_revenue_generated,
       COALESCE(SUM(so.saler_commission), 0)::numeric AS commissions_earned,
       COUNT(DISTINCT ssi.product_id)::integer AS curated_products_count
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN virtual_stores vs ON vs.saler_id = u.id
     LEFT JOIN saler_store_items ssi ON ssi.store_id = vs.id
     LEFT JOIN sub_orders so ON so.saler_id = u.id AND so.supplier_id = $1 AND so.status = 'DELIVERED'
     WHERE EXISTS (
       SELECT 1 FROM saler_store_items ssi2
       JOIN products p2 ON p2.id = ssi2.product_id
       WHERE ssi2.store_id = vs.id AND p2.supplier_id = $1
     ) OR so.supplier_id = $1
     GROUP BY u.id, up.display_name, up.full_name, vs.shop_name, vs.slug
     ORDER BY total_orders_sold DESC, total_revenue_generated DESC
     LIMIT 20`,
    [supplierId]
  );

  // 2. Geographic demand breakdown
  const { rows: regionalSales } = await db.query(
    `SELECT
       o.district,
       COUNT(so.id)::integer AS order_count,
       COALESCE(SUM(so.total_amount), 0)::numeric AS total_sales
     FROM sub_orders so
     JOIN orders o ON o.id = so.order_id
     WHERE so.supplier_id = $1
     GROUP BY o.district
     ORDER BY total_sales DESC
     LIMIT 10`,
    [supplierId]
  );

  return reply.send({
    success: true,
    data: {
      top_salers: topSalers,
      regional_distribution: regionalSales,
    },
  });
}

/**
 * Gets or updates the supplier's physical shop status.
 */
export async function getStoreStatus(req, reply) {
  const supplierId = req.user.id;
  const db = req.server.db;

  const { rows } = await db.query(
    `SELECT * FROM physical_shop_status WHERE user_id = $1`,
    [supplierId]
  );

  const status = rows[0] || {
    user_id: supplierId,
    is_open: true,
    opening_time: '09:00',
    closing_time: '20:00',
    holiday_schedule: null,
  };

  return reply.send({ success: true, data: status });
}

export async function updateStoreStatus(req, reply) {
  const supplierId = req.user.id;
  const db = req.server.db;
  const { isOpen, openingTime, closingTime, holidaySchedule } = req.body;

  const { rows } = await db.query(
    `INSERT INTO physical_shop_status (
       user_id, is_open, opening_time, closing_time, holiday_schedule, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, now()
     )
     ON CONFLICT (user_id)
     DO UPDATE SET
       is_open = COALESCE($2, physical_shop_status.is_open),
       opening_time = COALESCE($3, physical_shop_status.opening_time),
       closing_time = COALESCE($4, physical_shop_status.closing_time),
       holiday_schedule = COALESCE($5, physical_shop_status.holiday_schedule),
       updated_at = now()
     RETURNING *`,
    [supplierId, isOpen, openingTime || '09:00', closingTime || '20:00', holidaySchedule || null]
  );

  return reply.send({ success: true, data: rows[0] });
}
