/**
 * flashSale.service.ts — Flash Sale Campaigns & Inventory Protection (Prompt 9.2).
 *
 * Implements:
 * 1. Flash sale scheduling with dedicated stock allocation.
 * 2. Atomic stock reservation under SELECT ... FOR UPDATE (guarantees zero overselling).
 * 3. Live countdown and remaining stock tracking for homepage & product widgets.
 * 4. Emergency stop capability (execute_then_review maker-checker).
 */

import { randomBytes } from 'node:crypto';
import { withTransaction } from '../config/db.ts';
import { AppError } from '../plugins/errorHandler.ts';
import { writeAudit } from '../lib/audit.ts';
import { isEnabled } from './module.service.ts';
import { primaryImageKeySql, toPublicImageUrl } from '../lib/productImage.ts';
import { resolvePlatformPricingConfig } from './pricing.service.ts';
import { liveFlashSaleSql, boughtAtDealSql } from '../repositories/flashSale.repository.ts';

function generateFlashSaleRef() {
  const code = randomBytes(4).toString('hex').toUpperCase();
  return `FLS-${code}`;
}

/**
 * Creates and schedules a new Flash Sale deal.
 */
export async function createFlashSale(db, creatorUser, saleData, reqMeta: Record<string, any> = {}) {
  const productId = parseInt(saleData.product_id, 10);
  const variantId = saleData.variant_id ? parseInt(saleData.variant_id, 10) : null;

  // WHY VALIDATION_FAILED / NOT_FOUND: the error handler maps a closed list of codes to statuses.
  // The old ad-hoc codes (INVALID_DISCOUNT_PRICE, PRODUCT_NOT_FOUND, …) weren't on it, so every bad
  // input came back as a 500 "server error" with no Bangla message.
  const invalid = (field, en, bn) => new AppError('VALIDATION_FAILED', en, bn, { field });

  if (isNaN(productId)) {
    throw invalid('product_id', 'Valid product ID is required for flash sale.', 'ফ্ল্যাশ সেলের জন্য সঠিক পণ্য আইডি প্রয়োজন।');
  }

  const discountPrice = Number(saleData.discount_price);
  const allocatedQty = parseInt(saleData.allocated_qty, 10);
  const perUserLimit = parseInt(saleData.per_user_limit || 1, 10);

  if (isNaN(discountPrice) || discountPrice <= 0) {
    throw invalid('discount_price', 'Discount price must be greater than zero.', 'ছাড়ের মূল্য শূন্যের বেশি হতে হবে।');
  }
  if (isNaN(allocatedQty) || allocatedQty <= 0) {
    throw invalid('allocated_qty', 'Allocated stock quantity must be at least 1.', 'বরাদ্দকৃত স্টক অন্তত ১ হতে হবে।');
  }
  if (isNaN(perUserLimit) || perUserLimit <= 0) {
    throw invalid('per_user_limit', 'Per-customer limit must be at least 1.', 'প্রতি গ্রাহকের সীমা অন্তত ১ হতে হবে।');
  }

  const startsAt = saleData.starts_at ? new Date(saleData.starts_at) : new Date();
  const endsAt = saleData.ends_at ? new Date(saleData.ends_at) : new Date(Date.now() + 24 * 3600000);

  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw invalid('ends_at', 'Flash sale end time must be strictly after start time.', 'ফ্ল্যাশ সেলের শেষ সময় শুরুর সময়ের পরে হতে হবে।');
  }

  // Fetch product to verify stock and price
  const { rows: prodRows } = await db.query(
    `SELECT id, title_en, title_bn, default_retail_price, stock_qty, status,
            (base_cost + wholesale_margin) AS supplier_price
     FROM products WHERE id = $1`,
    [productId]
  );

  if (prodRows.length === 0) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'পণ্য পাওয়া যায়নি।');
  }

  const product = prodRows[0];
  const originalPrice = Number(product.default_retail_price);

  if (discountPrice >= originalPrice) {
    throw invalid(
      'discount_price',
      `Discount price (৳${discountPrice}) must be lower than original price (৳${originalPrice}).`,
      `ছাড়ের মূল্য (৳${discountPrice}) মূল মূল্যের (৳${originalPrice}) চেয়ে কম হতে হবে।`
    );
  }

  // WHY refused, not warned: checkout never sells under the supplier's price (pricing.service), so a
  // deal below it could not be bought by anyone. Same rule live streams apply to a special price.
  const supplierPrice = Number(product.supplier_price);
  if (Math.round(discountPrice * 100) < Math.round(supplierPrice * 100)) {
    throw invalid(
      'discount_price',
      `Discount price (৳${discountPrice}) cannot be below what the supplier is paid (৳${supplierPrice.toFixed(2)}).`,
      `ছাড়ের মূল্য (৳${discountPrice}) supplier এর প্রাপ্য দামের (৳${supplierPrice.toFixed(2)}) নিচে হতে পারবে না।`
    );
  }

  if (Number(product.stock_qty) < allocatedQty) {
    throw new AppError(
      'INSUFFICIENT_STOCK',
      `Cannot allocate ${allocatedQty} units; available product stock is only ${product.stock_qty}.`,
      `${allocatedQty} ইউনিট বরাদ্দ করা যাবে না; পণ্যের স্টক মাত্র ${product.stock_qty}।`
    );
  }

  // WHY: product listings LEFT JOIN the live sale for each product, so two overlapping sales on one
  // product would list it twice and leave its price ambiguous at checkout.
  const { rows: overlapping } = await db.query(
    `SELECT id FROM flash_sales
      WHERE product_id = $1 AND status IN ('ACTIVE', 'SCHEDULED')
        AND starts_at < $3 AND ends_at > $2
      LIMIT 1`,
    [productId, startsAt, endsAt]
  );
  if (overlapping.length > 0) {
    throw new AppError(
      'CONFLICT',
      'This product already has a flash sale in that time window.',
      'এই সময়ে পণ্যটিতে ইতিমধ্যে একটি ফ্ল্যাশ সেল চালু আছে।'
    );
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
export async function getActiveAndUpcomingFlashSales(db, cache, { limit = 20 }: Record<string, any> = {}) {
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
           ${primaryImageKeySql('p')} as product_image_key,
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

  return rows.map(({ product_image_key: imageKey, ...deal }) => {
    const startsAtMs = new Date(deal.starts_at).getTime();
    const endsAtMs = new Date(deal.ends_at).getTime();
    const isLive = startsAtMs <= now && now <= endsAtMs;
    const remainingStock = Math.max(0, deal.allocated_qty - deal.sold_qty);
    const soldPercentage = Math.min(100, Math.round((deal.sold_qty / deal.allocated_qty) * 100));

    return {
      ...deal,
      product_image_url: toPublicImageUrl(imageKey),
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
 * The live deal for one product (and variant), with what this customer has bought at its price.
 * Used by add-to-cart; the cart read joins the same columns (cart.repository.ts).
 */
export async function findLiveFlashSale(db, { productId, variantId = null, userId = null }) {
  const { rows } = await db.query(
    `SELECT id, discount_price, variant_id, per_user_limit,
            allocated_qty - sold_qty - reserved_qty AS remaining_qty
       FROM flash_sales
      WHERE product_id = $1 AND (variant_id IS NULL OR variant_id = $2)
        AND ${liveFlashSaleSql()}
      ORDER BY starts_at DESC
      LIMIT 1`,
    [productId, variantId]
  );
  if (!rows.length) return null;
  const deal = rows[0];
  let boughtQty = 0;
  if (userId) {
    const { rows: bought } = await db.query(boughtAtDealSql('$1', '$2'), [deal.id, userId]);
    boughtQty = Number(bought[0]?.bought_qty || 0);
  }
  return { ...deal, bought_qty: boughtQty };
}

/**
 * Prices one cart line against a live deal. Pure, so the cart and add-to-cart cannot disagree.
 *
 * The deal price is all or nothing per line: a line asking for more than the customer may still buy
 * at the deal price (per_user_limit, minus earlier orders and earlier lines of the same deal in this
 * cart, capped by the deal's remaining stock) is priced at retail and says how many would qualify.
 * WHY not split the line: an order line has one retail price (order_items.retail_price).
 *
 * @param {Object} p
 * @param {number} p.retailUnitPrice  the line's regular price, variant delta included
 * @param {number} [p.variantDelta]   the variant's price delta; a product-wide deal keeps it
 * @param {Object|null} p.deal        { id, discount_price, variant_id, per_user_limit, remaining_qty, bought_qty }
 * @param {number} p.qty
 * @param {number} [p.usedInCart]     units of this deal that earlier lines of the cart already take
 */
export function resolveFlashLine({ retailUnitPrice, variantDelta = 0, deal, qty, usedInCart = 0 }: {
  retailUnitPrice: number|string; variantDelta?: number|string|null; deal: any; qty: number; usedInCart?: number;
}) {
  const regular = { unitPrice: Number(retailUnitPrice), flashSaleId: null, warning: null };
  if (!deal || deal.id == null) return regular;

  const dealPrice = Number(deal.discount_price) + (deal.variant_id == null ? Number(variantDelta || 0) : 0);
  if (!(dealPrice > 0) || dealPrice >= Number(retailUnitPrice)) return regular;

  const allowed = Math.max(0, Math.min(
    Number(deal.remaining_qty) - usedInCart,
    Number(deal.per_user_limit) - Number(deal.bought_qty || 0) - usedInCart
  ));
  if (qty <= allowed) return { unitPrice: dealPrice, flashSaleId: Number(deal.id), warning: null };

  const price = `৳${dealPrice.toFixed(2)}`;
  return {
    ...regular,
    warning: {
      code: 'FLASH_DEAL_LIMIT',
      deal_qty: allowed,
      deal_price: dealPrice.toFixed(2),
      message_en: allowed > 0
        ? `Only ${allowed} can be bought at the flash price of ${price}. Lower the quantity to get it; this line is at the regular price.`
        : 'You have already bought the most this flash deal allows, so this line is at the regular price.',
      message_bn: allowed > 0
        ? `ফ্ল্যাশ মূল্য ${price} এ মাত্র ${allowed}টি কেনা যাবে। পরিমাণ কমালে এই দাম পাবেন; এখন এই লাইনটি নিয়মিত দামে আছে।`
        : 'এই ফ্ল্যাশ অফারে সর্বোচ্চ যতটি কেনা যায় তা আপনি কিনে ফেলেছেন, তাই এই লাইনটি নিয়মিত দামে আছে।',
    },
  };
}

/**
 * Atomically reserves flash sale stock inside a checkout transaction.
 *
 * Locks the deal row, then re-checks what the cart read promised: the deal is still live, has the
 * units, and the customer stays within per_user_limit counting earlier orders. Any failure is a 409,
 * so the shopper reloads the cart, which then shows the regular price. Checkout never charges a
 * price the shopper was not shown.
 *
 * @param {import('pg').PoolClient} client - Transaction client
 * @param {Object} params
 * @param {number} params.flashSaleId
 * @param {number} params.requestedQty  every unit of this deal in the order, across lines
 * @param {number} [params.userId]
 * @returns {Promise<Object>} Updated deal details
 */
export async function reserveFlashSaleStock(client: import('pg').PoolClient, {
  flashSaleId,
  requestedQty = 1,
  userId = null,
}: { flashSaleId: number; requestedQty: number; userId?: number; }): Promise<any> {
  const { rows } = await client.query(
    `SELECT * FROM flash_sales WHERE id = $1 FOR UPDATE`,
    [flashSaleId]
  );

  if (rows.length === 0) {
    throw new AppError('FLASH_SALE_NOT_FOUND', 'Flash sale deal not found.', 'ফ্ল্যাশ সেলটি পাওয়া যায়নি।');
  }

  const deal = rows[0];
  const now = new Date();

  if (deal.status === 'CANCELLED') {
    throw new AppError('FLASH_SALE_CANCELLED', 'This flash sale deal has been cancelled.', 'এই ফ্ল্যাশ সেলটি বাতিল করা হয়েছে।');
  }

  // WHY PAUSED and COMPLETED too: only ACTIVE and SCHEDULED deals are live (flashSale.repository.ts liveFlashSaleSql).
  if (!['ACTIVE', 'SCHEDULED'].includes(deal.status) || now < new Date(deal.starts_at) || now > new Date(deal.ends_at)) {
    throw new AppError('FLASH_SALE_EXPIRED', 'Flash sale deal is not currently active.', 'ফ্ল্যাশ সেলটি এখন চালু নেই।');
  }

  let boughtQty = 0;
  if (userId) {
    const { rows: bought } = await client.query(boughtAtDealSql('$1', '$2'), [flashSaleId, userId]);
    boughtQty = Number(bought[0]?.bought_qty || 0);
  }
  if (boughtQty + requestedQty > Number(deal.per_user_limit)) {
    throw new AppError(
      'FLASH_SALE_LIMIT_EXCEEDED',
      `You can purchase a maximum of ${deal.per_user_limit} units at flash sale price.`,
      `ফ্ল্যাশ সেল মূল্যে সর্বোচ্চ ${deal.per_user_limit}টি কেনা যায়।`,
      { per_user_limit: Number(deal.per_user_limit), already_bought: boughtQty }
    );
  }

  const totalAllocated = Number(deal.allocated_qty);
  const totalSold = Number(deal.sold_qty);
  const totalReserved = Number(deal.reserved_qty);

  if (totalSold + totalReserved + requestedQty > totalAllocated) {
    throw new AppError('FLASH_SALE_OUT_OF_STOCK', 'Flash sale allocated stock has been fully claimed.', 'ফ্ল্যাশ সেলের বরাদ্দ স্টক শেষ হয়ে গেছে।');
  }

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
export async function emergencyStop(db, adminUser, flashSaleId, reason = 'Emergency stop triggered by admin', reqMeta: Record<string, any> = {}) {
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
    throw new AppError('NOT_FOUND', 'Flash sale deal not found.', 'ফ্ল্যাশ সেল পাওয়া যায়নি।');
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
export async function listAllFlashSales(db, { status, limit = 50, offset = 0 }: Record<string, any> = {}) {
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

/**
 * What the flash sale form needs to warn about a price before it is saved
 * (client/src/services/pricingConflicts.ts findDealPriceConflicts): the product's supplier price,
 * retail price and partner profit, and the platform minimum.
 */
export async function getPriceContext(db, productId) {
  const id = parseInt(productId, 10);
  if (isNaN(id)) {
    throw new AppError('VALIDATION_FAILED', 'Valid product ID is required.', 'সঠিক পণ্য আইডি প্রয়োজন।', { field: 'product_id' });
  }
  const { rows } = await db.query(
    `SELECT id, title_en, title_bn, default_retail_price AS retail_price, partner_profit,
            (base_cost + wholesale_margin) AS supplier_price
     FROM products WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) throw new AppError('NOT_FOUND', 'Product not found.', 'পণ্য পাওয়া যায়নি।');
  const { platformDefaultProfitPct } = await resolvePlatformPricingConfig(db);
  const p = rows[0];
  return {
    product: {
      id: Number(p.id),
      title_en: p.title_en,
      title_bn: p.title_bn,
      supplier_price: Number(p.supplier_price),
      retail_price: Number(p.retail_price),
      partner_profit: Number(p.partner_profit),
    },
    platform_default_profit_pct: platformDefaultProfitPct,
  };
}
