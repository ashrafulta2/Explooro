/**
 * bundle.service.js — Cross-Seller Dynamic Product Bundling & Split-Settlement Engine (Prompt 10.5).
 *
 * Implements idea proposition.md §AC.
 *
 * Critical Invariants:
 * 1. Multi-supplier combinations: Items can belong to distinct suppliers.
 * 2. Deterministic discount apportionment: Total bundle discount is apportioned proportionally
 *    across all contributing items in integer paisa, with any rounding remainder assigned to the
 *    highest-value item so that sum(discount_share) === total_discount.
 * 3. Guaranteed wholesale payout: The bundle price may never be lower than the sum of wholesale costs
 *    (base_cost + wholesale_margin) across all items, protecting suppliers from loss.
 * 4. Exact ledger balance: Total Customer Payment = Sum of Supplier Wholesale Payouts + Saler Profit + Platform Margin.
 */

import { AppError } from '../plugins/errorHandler.js';
import { toPaisa, toBdtNumber, toBdtString } from './pricing.service.js';
import { generateRef } from '../lib/ref.js';

/**
 * Calculates deterministic pricing and profit breakdown for a multi-product bundle.
 *
 * @param {object} params
 * @param {Array<object>} params.items List of items [{ productId, productTitle, variantId, qty, retailPrice, baseCost, wholesaleMargin, supplierId, supplierName }]
 * @param {number|string} params.bundlePrice Total bundle sale price
 * @param {number} [params.salerSplitPct=40] Saler commission split %
 * @param {number} [params.platformSplitPct=60] Platform split %
 * @returns {object} Full financial breakdown in BDT numbers, strings, and integer paisa
 */
export function calculateBundleBreakdown({
  items = [],
  bundlePrice,
  salerSplitPct = 40,
  platformSplitPct = 60,
}) {
  if (!Array.isArray(items) || items.length < 2) {
    throw new AppError(
      'VALIDATION_FAILED',
      'A bundle must contain at least 2 items.',
      'একটি বান্ডেলে কমপক্ষে ২টি পণ্য থাকতে হবে।'
    );
  }

  const bundlePricePaisa = toPaisa(bundlePrice);
  if (bundlePricePaisa <= 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Bundle price must be greater than 0.',
      'বান্ডেলের মূল্য ০-এর বেশি হতে হবে।'
    );
  }

  // Calculate sum of individual retail prices and sum of wholesale costs
  let sumOfPartsPaisa = 0;
  let totalBaseCostPaisa = 0;
  let totalWholesaleMarginPaisa = 0;
  let totalWholesaleCostPaisa = 0;

  const itemCalcs = items.map((item, index) => {
    const qty = Math.max(1, parseInt(item.qty || 1, 10));
    const retailPaisa = toPaisa(item.retailPrice ?? item.retail_price);
    const basePaisa = toPaisa(item.baseCost ?? item.base_cost ?? item.base_price ?? 0);
    const wholesaleMarginPaisa = toPaisa(item.wholesaleMargin ?? item.wholesale_margin ?? 0);
    const wholesaleCostPerUnitPaisa = basePaisa + wholesaleMarginPaisa;

    const lineRetailPaisa = retailPaisa * qty;
    const lineBaseCostPaisa = basePaisa * qty;
    const lineWholesaleMarginPaisa = wholesaleMarginPaisa * qty;
    const lineWholesaleCostPaisa = wholesaleCostPerUnitPaisa * qty;

    sumOfPartsPaisa += lineRetailPaisa;
    totalBaseCostPaisa += lineBaseCostPaisa;
    totalWholesaleMarginPaisa += lineWholesaleMarginPaisa;
    totalWholesaleCostPaisa += lineWholesaleCostPaisa;

    return {
      index,
      productId: item.productId ?? item.product_id,
      productRef: item.productRef ?? item.product_ref,
      productTitleEn: item.productTitleEn ?? item.product_title_en ?? item.title_en ?? item.productTitle ?? item.title ?? 'Product',
      productTitleBn: item.productTitleBn ?? item.product_title_bn ?? item.title_bn ?? '',
      variantId: item.variantId ?? item.variant_id ?? null,
      variantTitle: item.variantTitle ?? item.variant_title ?? null,
      supplierId: item.supplierId ?? item.supplier_id,
      supplierName: item.supplierName ?? item.supplier_name ?? 'Supplier',
      qty,
      retailPaisa,
      basePaisa,
      wholesaleMarginPaisa,
      wholesaleCostPerUnitPaisa,
      lineRetailPaisa,
      lineBaseCostPaisa,
      lineWholesaleMarginPaisa,
      lineWholesaleCostPaisa,
    };
  });

  if (bundlePricePaisa > sumOfPartsPaisa) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Bundle price (৳${(bundlePricePaisa / 100).toFixed(2)}) cannot exceed the sum of individual retail prices (৳${(sumOfPartsPaisa / 100).toFixed(2)}).`,
      `বান্ডেলের মূল্য (৳${(bundlePricePaisa / 100).toFixed(2)}) খুচরা মূল্যের মোট যোগফলের (৳${(sumOfPartsPaisa / 100).toFixed(2)}) চেয়ে বেশি হতে পারে না।`
    );
  }

  if (bundlePricePaisa < totalWholesaleCostPaisa) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Bundle price (৳${(bundlePricePaisa / 100).toFixed(2)}) cannot be lower than the combined wholesale cost (৳${(totalWholesaleCostPaisa / 100).toFixed(2)}).`,
      `বান্ডেলের মূল্য (৳${(bundlePricePaisa / 100).toFixed(2)}) সমন্বিত পাইকারি খরচের (৳${(totalWholesaleCostPaisa / 100).toFixed(2)}) চেয়ে কম হতে পারে না।`
    );
  }

  const totalDiscountPaisa = sumOfPartsPaisa - bundlePricePaisa;

  // Apportion discount share proportionally across items
  let apportionedDiscountPaisa = 0;
  let maxLineRetailIndex = 0;
  let maxLineRetailPaisa = -1;

  for (let i = 0; i < itemCalcs.length; i++) {
    const it = itemCalcs[i];
    if (it.lineRetailPaisa > maxLineRetailPaisa) {
      maxLineRetailPaisa = it.lineRetailPaisa;
      maxLineRetailIndex = i;
    }
    const itemDiscountSharePaisa = sumOfPartsPaisa > 0
      ? Math.floor((totalDiscountPaisa * it.lineRetailPaisa) / sumOfPartsPaisa)
      : 0;
    it.discountSharePaisa = itemDiscountSharePaisa;
    apportionedDiscountPaisa += itemDiscountSharePaisa;
  }

  // Remainder allocation to highest-value item
  const remainderPaisa = totalDiscountPaisa - apportionedDiscountPaisa;
  if (remainderPaisa > 0 && itemCalcs[maxLineRetailIndex]) {
    itemCalcs[maxLineRetailIndex].discountSharePaisa += remainderPaisa;
  }

  // Calculate effective retail price, net margins, and split per item
  let totalNetRetailMarginPaisa = 0;
  let totalSalerCommissionPaisa = 0;
  let totalPlatformMarginPaisa = 0;

  const suppliersMap = new Map();

  const processedItems = itemCalcs.map((it) => {
    const effectiveLineTotalPaisa = it.lineRetailPaisa - it.discountSharePaisa;
    const effectiveUnitPricePaisa = Math.floor(effectiveLineTotalPaisa / it.qty);
    const itemNetMarginPaisa = effectiveLineTotalPaisa - it.lineWholesaleCostPaisa;

    const itemSalerEarningPaisa = Math.floor((itemNetMarginPaisa * salerSplitPct) / 100);
    const itemPlatformEarningPaisa = itemNetMarginPaisa - itemSalerEarningPaisa;

    totalNetRetailMarginPaisa += itemNetMarginPaisa;
    totalSalerCommissionPaisa += itemSalerEarningPaisa;
    totalPlatformMarginPaisa += itemPlatformEarningPaisa;

    // Multi-supplier grouping
    const suppId = String(it.supplierId);
    if (!suppliersMap.has(suppId)) {
      suppliersMap.set(suppId, {
        supplierId: it.supplierId,
        supplierName: it.supplierName,
        itemCount: 0,
        totalWholesalePayoutPaisa: 0,
        items: [],
      });
    }
    const supp = suppliersMap.get(suppId);
    supp.itemCount += it.qty;
    supp.totalWholesalePayoutPaisa += it.lineWholesaleCostPaisa;
    supp.items.push({
      productId: it.productId,
      productTitleEn: it.productTitleEn,
      qty: it.qty,
      wholesalePayout: toBdtNumber(it.lineWholesaleCostPaisa),
    });

    return {
      productId: it.productId,
      productRef: it.productRef,
      productTitleEn: it.productTitleEn,
      productTitleBn: it.productTitleBn,
      variantId: it.variantId,
      variantTitle: it.variantTitle,
      supplierId: it.supplierId,
      supplierName: it.supplierName,
      qty: it.qty,
      originalRetailPrice: toBdtNumber(it.retailPaisa),
      originalLineTotal: toBdtNumber(it.lineRetailPaisa),
      discountShare: toBdtNumber(it.discountSharePaisa),
      effectiveUnitPrice: toBdtNumber(effectiveUnitPricePaisa),
      effectiveLineTotal: toBdtNumber(effectiveLineTotalPaisa),
      baseCost: toBdtNumber(it.basePaisa),
      wholesaleMargin: toBdtNumber(it.wholesaleMarginPaisa),
      wholesaleCost: toBdtNumber(it.lineWholesaleCostPaisa),
      netRetailMargin: toBdtNumber(itemNetMarginPaisa),
      salerCommission: toBdtNumber(itemSalerEarningPaisa),
      platformMargin: toBdtNumber(itemPlatformEarningPaisa),
      paisa: {
        original_retail: it.retailPaisa,
        original_line_total: it.lineRetailPaisa,
        discount_share: it.discountSharePaisa,
        effective_line_total: effectiveLineTotalPaisa,
        effective_unit_price: effectiveUnitPricePaisa,
        wholesale_cost: it.lineWholesaleCostPaisa,
        net_retail_margin: itemNetMarginPaisa,
        saler_commission: itemSalerEarningPaisa,
        platform_margin: itemPlatformEarningPaisa,
      },
    };
  });

  // Reconcile overall platform margin to guarantee zero drift
  totalPlatformMarginPaisa = totalNetRetailMarginPaisa - totalSalerCommissionPaisa;

  const discountPct = sumOfPartsPaisa > 0
    ? parseFloat(((totalDiscountPaisa / sumOfPartsPaisa) * 100).toFixed(2))
    : 0;

  const salerMarginPct = bundlePricePaisa > 0
    ? parseFloat(((totalSalerCommissionPaisa / bundlePricePaisa) * 100).toFixed(2))
    : 0;

  const suppliersList = Array.from(suppliersMap.values()).map((s) => ({
    supplier_id: s.supplierId,
    supplier_name: s.supplierName,
    item_count: s.itemCount,
    total_wholesale_payout: toBdtNumber(s.totalWholesalePayoutPaisa),
    items: s.items,
  }));

  return {
    sum_of_parts: toBdtNumber(sumOfPartsPaisa),
    bundle_price: toBdtNumber(bundlePricePaisa),
    discount_amount: toBdtNumber(totalDiscountPaisa),
    discount_pct: discountPct,
    total_wholesale_cost: toBdtNumber(totalWholesaleCostPaisa),
    total_net_margin: toBdtNumber(totalNetRetailMarginPaisa),
    total_saler_commission: toBdtNumber(totalSalerCommissionPaisa),
    total_platform_margin: toBdtNumber(totalPlatformMarginPaisa),
    saler_margin_pct: salerMarginPct,
    saler_split_pct: salerSplitPct,
    platform_split_pct: platformSplitPct,
    is_multi_supplier: suppliersMap.size > 1,
    supplier_count: suppliersMap.size,
    items: processedItems,
    suppliers: suppliersList,
    paisa: {
      sum_of_parts: sumOfPartsPaisa,
      bundle_price: bundlePricePaisa,
      discount_amount: totalDiscountPaisa,
      total_wholesale_cost: totalWholesaleCostPaisa,
      total_net_margin: totalNetRetailMarginPaisa,
      total_saler_commission: totalSalerCommissionPaisa,
      total_platform_margin: totalPlatformMarginPaisa,
    },
  };
}

/**
 * Creates a new cross-seller product bundle.
 */
export async function createBundle(db, {
  salerId,
  titleEn,
  titleBn,
  bundlePrice,
  items,
}) {
  if (!salerId) {
    throw new AppError('UNAUTHORIZED', 'Saler ID is required.', 'সেলার আইডি আবশ্যক।');
  }
  if (!titleEn || !titleBn) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Both English and Bengali bundle titles are required.',
      'ইংরেজি এবং বাংলা বান্ডেল শিরোনাম আবশ্যক।'
    );
  }
  if (!Array.isArray(items) || items.length < 2) {
    throw new AppError(
      'VALIDATION_FAILED',
      'A bundle must contain at least 2 items.',
      'একটি বান্ডেলে কমপক্ষে ২টি পণ্য থাকতে হবে।'
    );
  }

  // Fetch product and variant details from DB
  const productIds = items.map((it) => it.productId ?? it.product_id);
  const { rows: dbProducts } = await db.query(
    `SELECT p.id, p.ref, p.title_en, p.title_bn, p.default_retail_price AS retail_price,
            p.base_cost, p.wholesale_margin,
            p.stock_qty, p.status, p.supplier_id,
            COALESCE(up.display_name, up.full_name) AS supplier_name
     FROM products p
     JOIN users u ON u.id = p.supplier_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE p.id = ANY($1::bigint[])`,
    [productIds]
  );

  const productMap = new Map(dbProducts.map((p) => [Number(p.id), p]));

  // Validate active and available
  const enrichedItems = items.map((it) => {
    const pId = Number(it.productId ?? it.product_id);
    const prod = productMap.get(pId);
    if (!prod) {
      throw new AppError('NOT_FOUND', `Product #${pId} not found.`, `পণ্য #${pId} পাওয়া যায়নি।`);
    }
    if (prod.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_FAILED', `Product "${prod.title_en}" is not active.`, `পণ্যটি সক্রিয় নয়।`);
    }

    return {
      productId: prod.id,
      productRef: prod.ref,
      productTitleEn: prod.title_en,
      productTitleBn: prod.title_bn,
      variantId: it.variantId ?? it.variant_id ?? null,
      variantTitle: it.variantTitle ?? it.variant_title ?? null,
      supplierId: prod.supplier_id,
      supplierName: prod.supplier_name,
      qty: it.qty || 1,
      retailPrice: it.retailPrice ?? prod.retail_price,
      baseCost: prod.base_cost,
      wholesaleMargin: prod.wholesale_margin,
    };
  });

  const breakdown = calculateBundleBreakdown({
    items: enrichedItems,
    bundlePrice,
  });

  const ref = generateRef('BND');

  const client = db.connect ? await db.connect() : db;
  const isDedicated = !!db.connect;

  try {
    if (isDedicated) await client.query('BEGIN');

    const { rows: bundleRows } = await client.query(
      `INSERT INTO product_bundles (
        ref, saler_id, title_en, title_bn, bundle_price, sum_of_parts, discount_amount, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, now())
      RETURNING *`,
      [
        ref,
        salerId,
        titleEn.trim(),
        titleBn.trim(),
        breakdown.bundle_price,
        breakdown.sum_of_parts,
        breakdown.discount_amount,
      ]
    );

    const bundle = bundleRows[0];

    // Insert bundle items with apportioned discount share
    for (const item of breakdown.items) {
      await client.query(
        `INSERT INTO bundle_items (
          bundle_id, product_id, variant_id, qty, discount_share
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          bundle.id,
          item.productId,
          item.variantId,
          item.qty,
          item.discountShare,
        ]
      );
    }

    if (isDedicated) await client.query('COMMIT');

    return {
      ...bundle,
      breakdown,
    };
  } catch (err) {
    if (isDedicated) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isDedicated) client.release();
  }
}

/**
 * Retrieves a bundle by ID or Ref with live financial breakdown and items.
 */
export async function getBundleById(db, idOrRef) {
  const isRef = typeof idOrRef === 'string' && idOrRef.startsWith('BND-');
  const query = isRef
    ? `SELECT b.*, COALESCE(up.display_name, up.full_name) AS saler_name FROM product_bundles b JOIN users u ON u.id = b.saler_id LEFT JOIN user_profiles up ON up.user_id = u.id WHERE b.ref = $1`
    : `SELECT b.*, COALESCE(up.display_name, up.full_name) AS saler_name FROM product_bundles b JOIN users u ON u.id = b.saler_id LEFT JOIN user_profiles up ON up.user_id = u.id WHERE b.id = $1`;

  const { rows: bundleRows } = await db.query(query, [idOrRef]);
  if (bundleRows.length === 0) {
    throw new AppError('NOT_FOUND', 'Bundle not found.', 'বান্ডেল পাওয়া যায়নি।');
  }

  const bundle = bundleRows[0];

  // Fetch bundle items
  const { rows: itemRows } = await db.query(
    `SELECT bi.*, p.ref AS product_ref, p.title_en AS product_title_en, p.title_bn AS product_title_bn,
            p.default_retail_price AS retail_price, p.base_cost, p.wholesale_margin,
            p.stock_qty, p.status AS product_status,
            p.supplier_id, COALESCE(up.display_name, up.full_name) AS supplier_name,
            (SELECT m.storage_key FROM product_images pi2
              JOIN media_assets m ON m.id = pi2.media_id
              WHERE pi2.product_id = p.id
              ORDER BY pi2.is_primary DESC, pi2.display_order ASC LIMIT 1) AS primary_image_url
     FROM bundle_items bi
     JOIN products p ON p.id = bi.product_id
     JOIN users u ON u.id = p.supplier_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE bi.bundle_id = $1`,
    [bundle.id]
  );

  const items = itemRows.map((r) => ({
    productId: r.product_id,
    productRef: r.product_ref,
    productTitleEn: r.product_title_en,
    productTitleBn: r.product_title_bn,
    variantId: r.variant_id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    qty: r.qty,
    retailPrice: r.retail_price,
    baseCost: r.base_cost,
    wholesaleMargin: r.wholesale_margin,
    discountShare: r.discount_share,
    primaryImageUrl: r.primary_image_url,
    stockQty: r.stock_qty,
  }));

  const breakdown = calculateBundleBreakdown({
    items,
    bundlePrice: bundle.bundle_price,
  });

  return {
    ...bundle,
    items,
    breakdown,
  };
}

/**
 * Lists bundles with filters and pagination.
 */
export async function listBundles(db, { salerId = null, isActive = null, limit = 20, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (salerId) {
    conditions.push(`b.saler_id = $${idx++}`);
    params.push(salerId);
  }
  if (isActive !== null && isActive !== undefined) {
    conditions.push(`b.is_active = $${idx++}`);
    params.push(isActive);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT b.*, COALESCE(up.display_name, up.full_name) AS saler_name,
            (SELECT COUNT(*) FROM bundle_items bi WHERE bi.bundle_id = b.id) AS item_count,
            (SELECT COUNT(DISTINCT p.supplier_id) FROM bundle_items bi JOIN products p ON p.id = bi.product_id WHERE bi.bundle_id = b.id) AS supplier_count
     FROM product_bundles b
     JOIN users u ON u.id = b.saler_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     ${whereClause}
     ORDER BY b.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) AS total FROM product_bundles b ${whereClause}`,
    params
  );

  return {
    bundles: rows,
    total: parseInt(countRows[0]?.total || 0, 10),
    limit,
    offset,
  };
}

/**
 * Toggles or updates bundle active state and details.
 */
export async function updateBundle(db, bundleId, { salerId, titleEn, titleBn, bundlePrice, isActive }) {
  const { rows } = await db.query(
    `SELECT * FROM product_bundles WHERE id = $1`,
    [bundleId]
  );
  if (rows.length === 0) {
    throw new AppError('NOT_FOUND', 'Bundle not found.', 'বান্ডেল পাওয়া যায়নি।');
  }

  const bundle = rows[0];
  if (Number(bundle.saler_id) !== Number(salerId)) {
    throw new AppError('FORBIDDEN', 'You do not own this bundle.', 'আপনি এই বান্ডেলের মালিক নন।');
  }

  const updates = [];
  const params = [bundleId];
  let idx = 2;

  if (titleEn !== undefined) {
    updates.push(`title_en = $${idx++}`);
    params.push(titleEn.trim());
  }
  if (titleBn !== undefined) {
    updates.push(`title_bn = $${idx++}`);
    params.push(titleBn.trim());
  }
  if (isActive !== undefined) {
    updates.push(`is_active = $${idx++}`);
    params.push(Boolean(isActive));
  }
  if (bundlePrice !== undefined) {
    updates.push(`bundle_price = $${idx++}`);
    params.push(bundlePrice);
  }

  updates.push(`updated_at = now()`);

  const { rows: updatedRows } = await db.query(
    `UPDATE product_bundles SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );

  return updatedRows[0];
}

/**
 * Deletes a bundle.
 */
export async function deleteBundle(db, bundleId, salerId) {
  const { rows } = await db.query(
    `SELECT * FROM product_bundles WHERE id = $1`,
    [bundleId]
  );
  if (rows.length === 0) {
    throw new AppError('NOT_FOUND', 'Bundle not found.', 'বান্ডেল পাওয়া যায়নি।');
  }
  if (Number(rows[0].saler_id) !== Number(salerId)) {
    throw new AppError('FORBIDDEN', 'You do not own this bundle.', 'আপনি এই বান্ডেলের মালিক নন।');
  }

  await db.query(`DELETE FROM product_bundles WHERE id = $1`, [bundleId]);
  return { success: true };
}

/**
 * Adds an entire bundle to a cart, adding each product item with apportioned effective pricing.
 */
export async function addBundleToCart(db, { cartId, bundleId, salerId = null, qty = 1 }) {
  const bundle = await getBundleById(db, bundleId);
  if (!bundle.is_active) {
    throw new AppError(
      'VALIDATION_FAILED',
      'This bundle is currently inactive.',
      'এই বান্ডেলটি বর্তমানে নিষ্ক্রিয়।'
    );
  }

  const addedItems = [];
  for (const item of bundle.breakdown.items) {
    const itemQty = item.qty * qty;
    const { rows } = await db.query(
      `INSERT INTO cart_items (cart_id, product_id, variant_id, saler_id, bundle_id, qty, price_at_add, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (cart_id, product_id, COALESCE(variant_id, 0), COALESCE(bundle_id, 0))
       DO UPDATE SET
         qty = cart_items.qty + EXCLUDED.qty,
         price_at_add = EXCLUDED.price_at_add,
         added_at = now()
       RETURNING *`,
      [
        cartId,
        item.productId,
        item.variantId,
        salerId || bundle.saler_id,
        bundle.id,
        itemQty,
        item.effectiveUnitPrice,
      ]
    );
    addedItems.push(rows[0]);
  }

  return {
    bundle_id: bundle.id,
    bundle_ref: bundle.ref,
    items_count: addedItems.length,
    items: addedItems,
  };
}
