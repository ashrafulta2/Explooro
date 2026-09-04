/**
 * product.service.js — Product management, moderation routing & sourcing logic (Prompt 4.3).
 */

import * as productRepo from '../repositories/product.repository.js';
import { calculatePricingBreakdown, resolveSplitPercentages, toPaisa } from './pricing.service.js';
import { AppError } from '../plugins/errorHandler.js';
import { getStorageDriver } from '../integrations/storage/index.js';

// Response copy only — no schema for "average response time" exists yet (chat/messaging is
// Phase 8), so the supplier card derives a reasonable estimate from trust tier instead of
// inventing a tracking column ahead of the feature that would actually measure it.
const RESPONSE_TIME_BY_TIER = {
  ELITE_PARTNER: { hours_en: 'Usually responds within 1 hour', hours_bn: 'সাধারণত ১ ঘণ্টার মধ্যে সাড়া দেয়' },
  VERIFIED_TRADER: { hours_en: 'Usually responds within a few hours', hours_bn: 'সাধারণত কয়েক ঘণ্টার মধ্যে সাড়া দেয়' },
  STARTER: { hours_en: 'Usually responds within a day', hours_bn: 'সাধারণত এক দিনের মধ্যে সাড়া দেয়' },
};

export function slugify(text) {
  if (!text) return `item-${Date.now()}`;
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

export function generateProductRef() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PRD-${timestamp}-${rand}`;
}

export async function createProduct(
  db,
  {
    supplierId,
    categoryId,
    slug,
    titleEn,
    titleBn,
    descriptionEn,
    descriptionBn,
    brand,
    baseCost,
    wholesaleMargin = 0,
    defaultRetailPrice,
    minRetailPrice,
    stockQty = 0,
    lowStockThreshold = 5,
    weightGrams,
    hasVariants = false,
    warrantyMonths = 0,
    isModerationModuleEnabled = true,
    isSupplierVerificationEnabled = false,
  }
) {
  if (isSupplierVerificationEnabled) {
    const { rows: kycRows } = await db.query(
      `SELECT status FROM kyc_verifications WHERE user_id = $1 AND status = 'VERIFIED'`,
      [supplierId]
    );
    if (kycRows.length === 0) {
      throw new AppError(
        'KYC_REQUIRED',
        'Supplier verification is mandatory before listing products. Please complete your KYC verification.',
        'পণ্য তালিকাভুক্ত করার আগে সরবরাহকারী যাচাইকরণ আবশ্যক। অনুগ্রহ করে আপনার কেওয়াইসি সম্পন্ন করুন।'
      );
    }
  }
  if (!titleEn || !titleBn) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Both English and Bengali product titles are required.',
      'ইংরেজি এবং বাংলা উভয় প্রোডাক্ট শিরোনাম আবশ্যক।'
    );
  }

  if (!categoryId) {
    throw new AppError('VALIDATION_FAILED', 'Category ID is required.', 'ক্যাটাগরি আইডি আবশ্যক।');
  }

  const category = await productRepo.getCategoryById(db, categoryId);
  if (!category) {
    throw new AppError('NOT_FOUND', 'Category not found.', 'ক্যাটাগরি পাওয়া যায়নি।');
  }

  const baseCostPaisa = toPaisa(baseCost);
  const wholesaleMarginPaisa = toPaisa(wholesaleMargin);
  const retailPricePaisa = toPaisa(defaultRetailPrice);

  if (retailPricePaisa < baseCostPaisa + wholesaleMarginPaisa) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Default retail price (${(retailPricePaisa / 100).toFixed(2)}) must be greater than or equal to base cost + wholesale margin (${((baseCostPaisa + wholesaleMarginPaisa) / 100).toFixed(2)}).`,
      `খুচরা মূল্য (${(retailPricePaisa / 100).toFixed(2)}) বেস খরচ এবং পাইকারি মার্জিনের সমষ্টির চেয়ে বেশি বা সমান হতে হবে।`
    );
  }

  const cleanSlug = slugify(slug || titleEn);
  const ref = generateProductRef();

  // Determine initial status based on product_moderation module and category auto_approve
  let initialStatus = 'ACTIVE';
  if (isModerationModuleEnabled && !category.auto_approve) {
    initialStatus = 'PENDING_APPROVAL';
  }

  const product = await productRepo.insertProduct(db, {
    ref,
    supplierId,
    categoryId,
    slug: cleanSlug,
    titleEn,
    titleBn,
    descriptionEn,
    descriptionBn,
    brand,
    baseCost,
    wholesaleMargin,
    defaultRetailPrice,
    minRetailPrice: minRetailPrice || defaultRetailPrice,
    stockQty,
    lowStockThreshold,
    weightGrams,
    hasVariants,
    warrantyMonths,
    status: initialStatus,
  });

  if (initialStatus === 'PENDING_APPROVAL') {
    await productRepo.insertProductApproval(db, {
      productId: product.id,
      submittedBy: supplierId,
      status: 'PENDING',
    });
  }

  const pricing = await calculateProductPricing(db, product);
  return { ...product, pricing };
}

export async function updateProduct(db, id, supplierId, fields = {}, isStaff = false) {
  const existing = await productRepo.getProductById(db, id);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
  }

  // `supplier_id` is a NUMERIC/BIGINT column, which node-postgres returns as a string; `supplierId`
  // is a real Number off req.user.id — a strict !== always treated every owner as a non-owner.
  if (!isStaff && Number(existing.supplier_id) !== Number(supplierId)) {
    throw new AppError('FORBIDDEN', 'You do not own this product.', 'আপনি এই প্রোডাক্টটির মালিক নন।');
  }

  // Validate pricing invariants if updated
  const baseCost = fields.base_cost !== undefined ? fields.base_cost : existing.base_cost;
  const wholesaleMargin = fields.wholesale_margin !== undefined ? fields.wholesale_margin : existing.wholesale_margin;
  const defaultRetailPrice = fields.default_retail_price !== undefined ? fields.default_retail_price : existing.default_retail_price;

  const baseCostPaisa = toPaisa(baseCost);
  const wholesaleMarginPaisa = toPaisa(wholesaleMargin);
  const retailPricePaisa = toPaisa(defaultRetailPrice);

  if (retailPricePaisa < baseCostPaisa + wholesaleMarginPaisa) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Retail price must cover base cost and wholesale margin.',
      'খুচরা মূল্য অবশ্যই বেস খরচ এবং পাইকারি মার্জিন কভার করতে হবে।'
    );
  }

  const updated = await productRepo.updateProduct(db, id, fields);
  const pricing = await calculateProductPricing(db, updated);
  return { ...updated, pricing };
}

export async function deleteProduct(db, id, supplierId, isStaff = false) {
  const existing = await productRepo.getProductById(db, id);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
  }

  // `supplier_id` is a NUMERIC/BIGINT column, which node-postgres returns as a string; `supplierId`
  // is a real Number off req.user.id — a strict !== always treated every owner as a non-owner.
  if (!isStaff && Number(existing.supplier_id) !== Number(supplierId)) {
    throw new AppError('FORBIDDEN', 'You do not own this product.', 'আপনি এই প্রোডাক্টটির মালিক নন।');
  }

  await productRepo.softDeleteProduct(db, id);
  return { success: true, message: 'Product deleted successfully.' };
}

export async function getProductDetail(db, idOrRefOrSlug) {
  let product = null;
  if (/^\d+$/.test(idOrRefOrSlug)) {
    product = await productRepo.getProductById(db, parseInt(idOrRefOrSlug, 10));
  } else {
    // Product detail links are built from `product.ref` (e.g. PRD-8F2K9QX7) everywhere in the
    // client, not the slug — try that first, falling back to slug for a human-typed URL.
    product = await productRepo.getProductByRef(db, idOrRefOrSlug);
    if (!product) product = await productRepo.getProductBySlug(db, idOrRefOrSlug);
  }

  if (!product) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
  }

  const pricing = await calculateProductPricing(db, product);
  const [variantRows, imageRows, supplier] = await Promise.all([
    productRepo.getVariantsByProductId(db, product.id),
    productRepo.getImagesByProductId(db, product.id),
    productRepo.getSupplierInfo(db, product.supplier_id),
  ]);

  const driver = getStorageDriver();
  const variants = variantRows.map((v) => ({
    ...v,
    image_url: v.image_storage_key ? driver.getPublicUrl(v.image_storage_key) : null,
  }));
  const images = imageRows.map((img) => ({
    ...img,
    url: driver.getPublicUrl(img.storage_key),
  }));

  const tier = supplier?.tier || 'STARTER';
  const supplierInfo = supplier && {
    id: supplier.id,
    ref: supplier.ref,
    name: supplier.display_name || supplier.full_name,
    district: supplier.district,
    tier,
    is_verified: tier !== 'STARTER',
    trust_score: supplier.score,
    completed_orders: supplier.completed_orders,
    response_time_en: RESPONSE_TIME_BY_TIER[tier]?.hours_en,
    response_time_bn: RESPONSE_TIME_BY_TIER[tier]?.hours_bn,
  };

  return { ...product, pricing, variants, images, supplier: supplierInfo };
}

export async function listCatalog(db, filters = {}) {
  const products = await productRepo.listProducts(db, filters);
  const enriched = await Promise.all(
    products.map(async (p) => {
      const pricing = await calculateProductPricing(db, p);
      return { ...p, pricing };
    })
  );
  return enriched;
}

export async function listSourcingCatalog(db, filters = {}) {
  const { minMarginPct, categoryId, brand, limit = 50, offset = 0 } = filters;
  const products = await productRepo.listProducts(db, {
    categoryId,
    brand,
    status: 'ACTIVE',
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
  });

  const enriched = [];
  for (const p of products) {
    const pricing = await calculateProductPricing(db, p);
    if (minMarginPct !== undefined && minMarginPct !== null && minMarginPct !== '') {
      const targetMin = parseFloat(minMarginPct);
      if (pricing.saler_margin_pct < targetMin && pricing.total_margin_pct < targetMin) {
        continue; // Filter out if margin below threshold
      }
    }
    enriched.push({
      ...p,
      pricing,
      sourcing_opportunity: {
        potential_profit: pricing.saler_earning,
        margin_pct: pricing.total_margin_pct,
        saler_margin_pct: pricing.saler_margin_pct,
        stock_available: p.stock_qty,
      },
    });
  }

  return enriched;
}

export async function addProductToSalerStore(db, { salerId, productId, customRetailPrice, collectionName }) {
  const product = await productRepo.getProductById(db, productId);
  if (!product || product.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 'Product not found or not active.', 'প্রোডাক্ট পাওয়া যায়নি অথবা সক্রিয় নয়।');
  }

  // Ensure saler has a virtual store
  let store = await productRepo.getVirtualStoreBySalerId(db, salerId);
  if (!store) {
    const storeRef = `STR-${Date.now().toString(36).toUpperCase()}`;
    const defaultSlug = `store-${salerId}-${Date.now().toString(36)}`;
    store = await productRepo.createVirtualStore(db, {
      salerId,
      ref: storeRef,
      slug: defaultSlug,
      shopName: `Store #${salerId}`,
    });
  }

  let finalCustomPrice = customRetailPrice;
  if (finalCustomPrice !== undefined && finalCustomPrice !== null) {
    const customPaisa = toPaisa(finalCustomPrice);
    const minPaisa = toPaisa(product.base_cost) + toPaisa(product.wholesale_margin);
    if (customPaisa < minPaisa) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Custom retail price must be at least BDT ${(minPaisa / 100).toFixed(2)}.`,
        `কাস্টম খুচরা মূল্য অবশ্যই কমপক্ষে ৳${(minPaisa / 100).toFixed(2)} হতে হবে।`
      );
    }
  } else {
    finalCustomPrice = product.default_retail_price;
  }

  const item = await productRepo.upsertSalerStoreItem(db, {
    storeId: store.id,
    salerId,
    productId,
    customRetailPrice: finalCustomPrice,
    collectionName: collectionName || 'General',
  });

  const pricing = await calculateProductPricing(db, {
    ...product,
    default_retail_price: finalCustomPrice,
  });

  return {
    ...item,
    pricing,
    store_slug: store.slug,
  };
}

export async function getSalerStoreItems(db, salerId) {
  const store = await productRepo.getVirtualStoreBySalerId(db, salerId);
  if (!store) return [];

  const items = await productRepo.listSalerStoreItems(db, store.id);
  const enriched = await Promise.all(
    items.map(async (item) => {
      const pricing = await calculateProductPricing(db, {
        id: item.product_id,
        category_id: item.category_id,
        base_cost: item.base_cost,
        wholesale_margin: item.wholesale_margin,
        default_retail_price: item.custom_retail_price || item.default_retail_price,
      });
      return {
        ...item,
        pricing,
      };
    })
  );
  return enriched;
}

async function calculateProductPricing(db, product) {
  const { salerSplitPct, platformSplitPct, ruleSource } = await resolveSplitPercentages(db, {
    productId: product.id,
    productRef: product.ref,
    categoryId: product.category_id,
  });

  return calculatePricingBreakdown({
    baseCost: product.base_cost,
    wholesaleMargin: product.wholesale_margin || 0,
    retailPrice: product.default_retail_price,
    salerSplitPct,
    platformSplitPct,
    ruleSource,
  });
}

/**
 * Fallback low-stock threshold, used only when a product carries no low_stock_threshold of its own
 * AND the platform has no `catalog.low_stock_threshold` setting. Ten matches the figure the admin
 * catalog UI has always shown in its "Low Stock" label and filter.
 */
const FALLBACK_LOW_STOCK_THRESHOLD = 10;

/**
 * Resolves the catalog-wide low-stock threshold: platform_settings wins, the constant above is the
 * bootstrap default. Same read-with-fallback shape as getSurgeConfig() in surgePricing.service.js.
 */
export async function resolveLowStockThreshold(db) {
  try {
    const { rows } = await db.query(
      `SELECT value_json FROM platform_settings WHERE key = 'catalog.low_stock_threshold'`
    );
    if (rows.length > 0 && rows[0].value_json !== null && rows[0].value_json !== undefined) {
      const raw = rows[0].value_json;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const value = Number(typeof parsed === 'object' ? parsed.threshold : parsed);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
  } catch {
    // Setting unreadable (missing table on a partial dev DB, malformed JSON) — the KPI is still
    // worth rendering with the default rather than failing the whole dashboard.
  }
  return FALLBACK_LOW_STOCK_THRESHOLD;
}

/**
 * Assembles the Super Admin catalog KPI payload.
 *
 * Every COUNT is cast to int4 in SQL so node-postgres hands back numbers; the money column is
 * NUMERIC and therefore arrives as a string, so it is the one field that needs coercing here.
 */
export async function getCatalogStats(db, { status = 'ACTIVE' } = {}) {
  const lowStockThreshold = await resolveLowStockThreshold(db);

  const [row, breakdown] = await Promise.all([
    productRepo.getCatalogStats(db, { status, lowStockThreshold }),
    productRepo.getCatalogCategoryBreakdown(db, { status }),
  ]);

  const counts = row || {};
  const toInt = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const categoriesBreakdown = {};
  for (const entry of breakdown || []) {
    categoriesBreakdown[entry.category_name_en] = toInt(entry.product_count);
  }

  return {
    total_products: toInt(counts.total_products),
    in_stock_count: toInt(counts.in_stock_count),
    low_stock_count: toInt(counts.low_stock_count),
    out_of_stock_count: toInt(counts.out_of_stock_count),
    flash_sale_count: toInt(counts.flash_sale_count),
    total_suppliers: toInt(counts.total_suppliers),
    verified_suppliers_count: toInt(counts.verified_suppliers_count),
    total_categories: toInt(counts.total_categories),
    total_potential_inventory_value: Math.round(toInt(counts.total_potential_inventory_value)),
    categories_breakdown: categoriesBreakdown,
    low_stock_threshold: lowStockThreshold,
    status_scope: status,
  };
}
