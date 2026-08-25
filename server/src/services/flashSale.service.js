/**
 * flashSale.service.js — Flash Sale Campaigns & Inventory Protection (Prompt 9.2).
 *
 * Implements:
 * 1. Flash sale scheduling with dedicated stock allocation.
 * 2. Atomic stock reservation under SELECT ... FOR UPDATE (guarantees zero overselling).
 * 3. Live countdown and remaining stock tracking for homepage & product widgets.
 * 4. Emergency stop capability (execute_then_review maker-checker).
 */

import { randomBytes } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import { isEnabled } from './module.service.js';

function generateFlashSaleRef() {
  const code = randomBytes(4).toString('hex').toUpperCase();
  return `FLS-${code}`;
}

/**
 * Creates and schedules a new Flash Sale deal.
 */
export async function createFlashSale(db, creatorUser, saleData, reqMeta = {}) {
  const productId = parseInt(saleData.product_id, 10);
  const variantId = saleData.variant_id ? parseInt(saleData.variant_id, 10) : null;

  if (isNaN(productId)) {
    throw new AppError('INVALID_PRODUCT', 'Valid product ID is required for flash sale.');
  }

  const discountPrice = Number(saleData.discount_price);
  const allocatedQty = parseInt(saleData.allocated_qty, 10);
  const perUserLimit = parseInt(saleData.per_user_limit || 1, 10);

  if (isNaN(discountPrice) || discountPrice <= 0) {
    throw new AppError('INVALID_DISCOUNT_PRICE', 'Discount price must be greater than zero.');
  }
  if (isNaN(allocatedQty) || allocatedQty <= 0) {
    throw new AppError('INVALID_ALLOCATED_QTY', 'Allocated stock quantity must be at least 1.');
  }

  const startsAt = saleData.starts_at ? new Date(saleData.starts_at) : new Date();
  const endsAt = saleData.ends_at ? new Date(saleData.ends_at) : new Date(Date.now() + 24 * 3600000);

  if (endsAt <= startsAt) {
    throw new AppError('INVALID_TIME_WINDOW', 'Flash sale end time must be strictly after start time.');
  }

  // Fetch product to verify stock and price
  const { rows: prodRows } = await db.query(
    `SELECT id, title_en, title_bn, default_retail_price, stock_qty, status
     FROM products WHERE id = $1`,
    [productId]
  );

  if (prodRows.length === 0) {
    throw new AppError('PRODUCT_NOT_FOUND', 'Product not found.');
  }

  const product = prodRows[0];
  const originalPrice = Number(product.default_retail_price);

  if (discountPrice >= originalPrice) {
    throw new AppError('INVALID_DISCOUNT_PRICE', `Discount price (৳${discountPrice}) must be lower than original price (৳${originalPrice}).`);
  }

  if (Number(product.stock_qty) < allocatedQty) {
    throw new AppError('INSUFFICIENT_STOCK', `Cannot allocate ${allocatedQty} units; available product stock is only ${product.stock_qty}.`);
  }

  const ref = generateFlashSaleRef();
  const title = saleData.title || `Flash Deal: ${product.title_en}`;

  const query = `
    INSERT INTO flash_sales (
      ref, title, product_id, variant_id, discount_price, original_price,
      allocated_qty, per_user_limit, starts_at, ends_at, status, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SCHEDULED', $11)
    RETURNING *
  `;

  const { rows } = await db.query(query, [
    ref,
    title,
    productId,
    variantId,
    discountPrice.toFixed(2),
    originalPrice.toFixed(2),
    allocatedQty,
    perUserLimit,
    startsAt,
    endsAt,
    creatorUser.id,
  ]);

  const createdDeal = rows[0];

  await writeAudit(db, {
    userId: creatorUser.id,
    action: 'growth.campaign.create_flash_sale',
    resourceType: 'flash_sales',
    resourceId: createdDeal.id,
    after: createdDeal,
    ipAddress: reqMeta.ip || null,
    userAgent: reqMeta.userAgent || null,
  });

  return createdDeal;
}

/**
 * Returns active and upcoming flash sales with live countdowns and stock percentages.
 */
export async function getActiveAndUpcomingFlashSales(db, cache, { limit = 20 } = {}) {
  // Check if flash_sale module is enabled
  const enabled = await isEnabled(db, cache, 'flash_sale');
  if (!enabled) {
    return [];
  }

  const query = `
    SELECT fs.*,
           p.title_en as product_title_en,
           p.title_bn as product_title_bn,
           p.slug as product_slug,
           p.primary_image_url as product_image_url,
           p.rating_avg,
           p.rating_count
    FROM flash_sales fs
    JOIN products p ON p.id = fs.product_id
    WHERE fs.status IN ('ACTIVE', 'SCHEDULED')
      AND fs.ends_at > now()
      AND fs.sold_qty < fs.allocated_qty
    ORDER BY
      CASE WHEN fs.starts_at <= now() THEN 1 ELSE 2 END ASC,
      fs.starts_at ASC
    LIMIT $1
  `;

  const { rows } = await db.query(query, [limit]);
  const now = Date.now();

  return rows.map((deal) => {
    const startsAtMs = new Date(deal.starts_at).getTime();
    const endsAtMs = new Date(deal.ends_at).getTime();
    const isLive = startsAtMs <= now && now <= endsAtMs;
    const remainingStock = Math.max(0, deal.allocated_qty - deal.sold_qty);
    const soldPercentage = Math.min(100, Math.round((deal.sold_qty / deal.allocated_qty) * 100));

    return {
      ...deal,
      is_live: isLive,
      status: isLive ? 'ACTIVE' : 'SCHEDULED',
      remaining_stock: remainingStock,
      sold_percentage: soldPercentage,
      countdown_ms: isLive ? Math.max(0, endsAtMs - now) : Math.max(0, startsAtMs - now),
      countdown_target: isLive ? 'ENDS_IN' : 'STARTS_IN',
    };
  });
}

/**
 * Atomically reserves flash sale stock inside a checkout transaction.
 *
 * @param {import('pg').PoolClient} client - Transaction client
 * @param {Object} params
 * @param {number} params.flashSaleId
 * @param {number} params.requestedQty
 * @param {number} [params.userId]
 * @returns {Promise<Object>} Updated deal details
 */
export async function reserveFlashSaleStock(client, {
  flashSaleId,
  requestedQty = 1,
  userId = null,
}) {
  const { rows } = await client.query(
    `SELECT * FROM flash_sales WHERE id = $1 FOR UPDATE`,
    [flashSaleId]
  );

  if (rows.length === 0) {
    throw new AppError('FLASH_SALE_NOT_FOUND', 'Flash sale deal not found.');
  }

  const deal = rows[0];
  const now = new Date();

  if (deal.status === 'CANCELLED') {
    throw new AppError('FLASH_SALE_CANCELLED', 'This flash sale deal has been cancelled.');
  }

  if (now < new Date(deal.starts_at) || now > new Date(deal.ends_at)) {
    throw new AppError('FLASH_SALE_EXPIRED', 'Flash sale deal is not currently active.');
  }

  if (requestedQty > Number(deal.per_user_limit)) {
    throw new AppError(
      'FLASH_SALE_LIMIT_EXCEEDED',
      `You can purchase a maximum of ${deal.per_user_limit} units at flash sale price.`
    );
  }

  const totalAllocated = Number(deal.allocated_qty);
  const totalSold = Number(deal.sold_qty);
  const totalReserved = Number(deal.reserved_qty);

  if (totalSold + totalReserved + requestedQty > totalAllocated) {
    throw new AppError('FLASH_SALE_OUT_OF_STOCK', 'Flash sale allocated stock has been fully claimed.');
  }

  // Atomically increment sold quantity (or reserved quantity)
  const { rows: updatedRows } = await client.query(
    `UPDATE flash_sales
     SET sold_qty = sold_qty + $1,
         updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [requestedQty, flashSaleId]
  );

  return updatedRows[0];
}

/**
 * Emergency-stops an active flash sale campaign instantly.
 */
export async function emergencyStop(db, adminUser, flashSaleId, reason = 'Emergency stop triggered by admin', reqMeta = {}) {
  const { rows } = await db.query(
    `UPDATE flash_sales
     SET status = 'CANCELLED',
         emergency_stopped_by = $1,
         emergency_stopped_at = now(),
         updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [adminUser.id, flashSaleId]
  );

  if (rows.length === 0) {
    throw new AppError('FLASH_SALE_NOT_FOUND', 'Flash sale deal not found.');
  }

  await writeAudit(db, {
    userId: adminUser.id,
    action: 'growth.campaign.emergency_stop',
    resourceType: 'flash_sales',
    resourceId: flashSaleId,
    after: { status: 'CANCELLED', reason, stoppedBy: adminUser.id },
    ipAddress: reqMeta.ip || null,
    userAgent: reqMeta.userAgent || null,
  });

  return rows[0];
}

/**
 * Lists all flash sales for admin governance.
 */
export async function listAllFlashSales(db, { status, limit = 50, offset = 0 } = {}) {
  let query = `
    SELECT fs.*,
           p.title_en as product_title_en,
           p.title_bn as product_title_bn,
           u.display_name as creator_name,
           su.display_name as stopper_name
    FROM flash_sales fs
    JOIN products p ON p.id = fs.product_id
    LEFT JOIN user_profiles u ON u.user_id = fs.created_by
    LEFT JOIN user_profiles su ON su.user_id = fs.emergency_stopped_by
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    params.push(status);
    query += ` AND fs.status = $${params.length}`;
  }

  query += ` ORDER BY fs.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await db.query(query, params);
  return rows;
}
