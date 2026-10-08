/**
 * product.service.js — Product management, moderation routing & sourcing logic (Prompt 4.3).
 */

import * as productRepo from '../repositories/product.repository.js';
import { calculatePricingBreakdown, loadSplitRules, resolveSplitPercentages, toPaisa } from './pricing.service.js';
import { AppError } from '../plugins/errorHandler.js';
import { getStorageDriver } from '../integrations/storage/index.js';
import { withTransaction } from '../config/db.js';
import { writeAudit } from '../lib/audit.js';
import * as recoCache from './recoCache.service.js';

// Response copy only — no schema for "average response time" exists yet (chat/messaging is
// Phase 8), so the supplier card derives a reasonable estimate from trust tier instead of
// inventing a tracking column ahead of the feature that would actually measure it.
const RESPONSE_TIME_BY_TIER = {
  ELITE_PARTNER: { hours_en: 'Usually responds within 1 hour', hours_bn: 'সাধারণত ১ ঘণ্টার মধ্যে সাড়া দেয়' },
  VERIFIED_TRADER: { hours_en: 'Usually responds within a few hours', hours_bn: 'সাধারণত কয়েক ঘণ্টার মধ্যে সাড়া দেয়' },
  STARTER: { hours_en: 'Usually responds within a day', hours_bn: 'সাধারণত এক দিনের মধ্যে সাড়া দেয়' },
};

// WHY 8: matches the client ImageUploader's maxFiles, so the form can never offer more slots than
// the API accepts. A gallery limit, not a business number, so it lives with the validation.
export const MAX_PRODUCT_IMAGES = 8;

/**
 * Normalises `media_ids` from a create request and checks each one is a PRODUCT image the caller
 * uploaded. Throws VALIDATION_FAILED otherwise, so a product is never created half-attached.
 */
async function resolveProductMediaIds(db, mediaIds, supplierId, { productId = null, requireOne = false } = {}) {
  if (mediaIds === undefined || mediaIds === null) return [];
  if (requireOne && Array.isArray(mediaIds) && mediaIds.length === 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'A product needs at least one photo.',
      'একটি প্রোডাক্টে অন্তত একটি ছবি থাকতে হবে।',
      { field: 'media_ids' }
    );
  }
  if (!Array.isArray(mediaIds) || mediaIds.some((id) => !/^\d+$/.test(String(id)))) {
    throw new AppError('VALIDATION_FAILED', 'Invalid product image reference.', 'প্রোডাক্ট ছবির রেফারেন্স সঠিক নয়।', {
      field: 'media_ids',
    });
  }
  const ids = [...new Set(mediaIds.map(Number))];
  if (ids.length > MAX_PRODUCT_IMAGES) {
    throw new AppError(
      'VALIDATION_FAILED',
      `A product can have at most ${MAX_PRODUCT_IMAGES} images.`,
      `একটি প্রোডাক্টে সর্বোচ্চ ${MAX_PRODUCT_IMAGES}টি ছবি থাকতে পারে।`,
      { field: 'media_ids' }
    );
  }
  if (!ids.length) return [];
  const owned = productId
    ? await productRepo.findAttachableProductMedia(db, ids, supplierId, productId)
    : await productRepo.findOwnedProductMedia(db, ids, supplierId);
  if (owned.length !== ids.length) {
    throw new AppError(
      'VALIDATION_FAILED',
      'One or more images are not product images you uploaded.',
      'এক বা একাধিক ছবি আপনার আপলোড করা প্রোডাক্ট ছবি নয়।',
      { field: 'media_ids' }
    );
  }
  return ids;
}

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
    mediaIds,
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

  const imageIds = await resolveProductMediaIds(db, mediaIds, supplierId);

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

  const images = await productRepo.insertProductImages(db, product.id, imageIds);

  const pricing = await calculateProductPricing(db, product);
  return { ...product, pricing, images };
}

// WHY id-or-ref: every client surface addresses products by `ref` (PRD-…), but the route used to
// parseInt the param, so an edit or delete from the admin catalog always hit NaN → NOT_FOUND.
async function findProductByIdOrRef(db, idOrRef) {
  const key = String(idOrRef ?? '').trim();
  const product = /^\d+$/.test(key)
    ? await productRepo.getProductById(db, Number(key))
    : await productRepo.getProductByRef(db, key);
  if (!product) {
    throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
  }
  return product;
}

// Mock DBs in tests have no pool.connect(); a real pg Pool does.
function inTransaction(db, fn) {
  return typeof db.connect === 'function' ? withTransaction(db, fn) : fn(db);
}

const AUDITED_PRODUCT_FIELDS = [
  'title_en', 'title_bn', 'description_en', 'description_bn', 'brand', 'category_id', 'base_cost',
  'wholesale_margin', 'default_retail_price', 'min_retail_price', 'stock_qty', 'status',
];

/**
 * Throws FORBIDDEN unless a supplier may move their own product from `from` to `to` without staff.
 *
 * WHY: PATCH writes `status` straight through, so an owner could set a PENDING_APPROVAL or REJECTED
 * product to ACTIVE and skip moderation entirely. Going live is moderation's decision; a supplier
 * may only take a listing down (pause, archive) or put back up one moderation already let through.
 */
async function assertSupplierStatusChange(db, product, to) {
  const from = product.status;
  if (to === from || to === 'ARCHIVED') return;
  if (from === 'ACTIVE' && to === 'PAUSED') return;
  if (from === 'PAUSED' && to === 'ACTIVE') {
    // WHY null counts as approved: a product created with product_moderation off, or in an
    // auto_approve category, goes live without any product_approvals row. The latest row (not any
    // row) decides, so an approved product later resubmitted and rejected cannot be resumed.
    const latest = await productRepo.getLatestProductApprovalStatus(db, Number(product.id));
    if (latest === null || latest === 'APPROVED') return;
    throw new AppError(
      'FORBIDDEN',
      'This product has not been approved, so it cannot be made active again.',
      'এই প্রোডাক্টটি অনুমোদিত হয়নি, তাই এটি আবার সক্রিয় করা যাবে না।'
    );
  }
  throw new AppError(
    'FORBIDDEN',
    `You cannot change this product's status from ${from} to ${to}.`,
    `আপনি এই প্রোডাক্টের স্ট্যাটাস ${from} থেকে ${to} এ পরিবর্তন করতে পারবেন না।`
  );
}

export async function updateProduct(db, idOrRef, supplierId, rawFields = {}, isStaff = false) {
  const existing = await findProductByIdOrRef(db, idOrRef);
  const id = Number(existing.id);
  const { media_ids: mediaIds, ...fields } = rawFields;

  // `supplier_id` is a NUMERIC/BIGINT column, which node-postgres returns as a string; `supplierId`
  // is a real Number off req.user.id — a strict !== always treated every owner as a non-owner.
  if (!isStaff && Number(existing.supplier_id) !== Number(supplierId)) {
    throw new AppError('FORBIDDEN', 'You do not own this product.', 'আপনি এই প্রোডাক্টটির মালিক নন।');
  }

  if (!isStaff && fields.status !== undefined) {
    await assertSupplierStatusChange(db, existing, fields.status);
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

  // Validated before any write, so a bad photo list never leaves a half-applied edit.
  const imageIds =
    mediaIds === undefined ? null : await resolveProductMediaIds(db, mediaIds, supplierId, { productId: id, requireOne: true });

  const pick = (row) => Object.fromEntries(AUDITED_PRODUCT_FIELDS.map((k) => [k, row?.[k] ?? null]));
  // WHY snapshot now: the "before" must not depend on the update returning a new row object.
  const before = pick(existing);

  const { updated, images } = await inTransaction(db, async (tx) => {
    const beforeImageIds = imageIds ? await productRepo.getProductMediaIds(tx, id) : null;
    const updated = await productRepo.updateProduct(tx, id, fields);
    let images;
    if (imageIds) {
      await productRepo.deleteProductImages(tx, id);
      images = await productRepo.insertProductImages(tx, id, imageIds);
    }

    await writeAudit(tx, {
      action: 'catalog.product.update',
      targetType: 'product',
      targetRef: existing.ref,
      actorId: supplierId,
      before: { ...before, ...(beforeImageIds ? { media_ids: beforeImageIds } : {}) },
      after: { ...pick(updated), ...(imageIds ? { media_ids: imageIds } : {}) },
    });
    return { updated, images };
  });

  const pricing = await calculateProductPricing(db, updated);
  return { ...updated, pricing, ...(images ? { images } : {}) };
}

/**
 * Adds stock to a product. WHY a dedicated increment instead of PATCH stock_qty: the admin page's
 * copy of stock can be minutes old, and writing "old + 50" back would erase every unit sold since.
 */
export async function restockProduct(db, idOrRef, userId, quantity, isStaff = false) {
  const qty = Number(quantity);
  // 2^31-1 is the INTEGER column's ceiling — a technical bound, not a business rule.
  if (!Number.isInteger(qty) || qty < 1 || qty > 2147483647) {
    throw new AppError('VALIDATION_FAILED', 'Quantity must be a whole number of at least 1.', 'পরিমাণ অবশ্যই ১ বা তার বেশি পূর্ণ সংখ্যা হতে হবে।', {
      field: 'quantity',
    });
  }

  const existing = await findProductByIdOrRef(db, idOrRef);
  if (!isStaff && Number(existing.supplier_id) !== Number(userId)) {
    throw new AppError('FORBIDDEN', 'You do not own this product.', 'আপনি এই প্রোডাক্টটির মালিক নন।');
  }

  return inTransaction(db, async (tx) => {
    const updated = await productRepo.incrementStock(tx, Number(existing.id), qty);
    if (!updated) {
      throw new AppError('NOT_FOUND', 'Product not found.', 'প্রোডাক্ট পাওয়া যায়নি।');
    }
    await writeAudit(tx, {
      action: 'catalog.product.restock',
      targetType: 'product',
      targetRef: existing.ref,
      actorId: userId,
      before: { stock_qty: Number(updated.stock_qty) - qty },
      after: { stock_qty: Number(updated.stock_qty), added: qty },
    });
    return updated;
  });
}

export async function deleteProduct(db, idOrRef, supplierId, isStaff = false) {
  const existing = await findProductByIdOrRef(db, idOrRef);
  const id = Number(existing.id);

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
  const driver = getStorageDriver();
  // WHY preloaded: pricing a page one product at a time cost three queries each (a product rule, a
  // category rule, the global default) - about 70 for one home load. Three queries cover the page.
  const preloaded = await loadSplitRules(db, products);
  const enriched = await Promise.all(
    products.map(async (p) => {
      const pricing = await calculateProductPricing(db, p, preloaded);
      // `products` has no image column — the primary image lives in product_images.
      const image_url = p.primary_image_key ? driver.getPublicUrl(p.primary_image_key) : null;
      return { ...p, image_url, pricing };
    })
  );
  return enriched;
}

/**
 * The candidate pool for a ranked list (Phase D): the top `limit` catalog rows by `ranking`, thin —
 * id, supplier, category, brand, listing date and the score with its components. Pricing, images and
 * variants are NOT loaded; hydrate the rows that survive with listCatalogByIds.
 */
export async function listCandidates(db, { ranking, limit, poolCache, ...filters } = {}) {
  const query = {
    ...filters,
    status: 'ACTIVE',
    sortBy: 'recommended',
    ranking,
    candidatesOnly: true,
    limit,
    offset: 0,
  };
  const load = () => recoCache.timed('pool_query', () => productRepo.listProducts(db, query));
  if (!poolCache?.cache) return load();
  // WHY the whole query is the key: the spec carries the weights, tuning, the shopper's seeds and
  // affinity, so any change to the policy or the person is a different key, never a stale hit.
  return recoCache.cachedPool({
    cache: poolCache.cache,
    config: poolCache.config,
    key: recoCache.poolKey({ ...query, ranking }),
    load,
  });
}

/**
 * Full catalog rows for an ordered list of ids, in that order. An id that is no longer listed (sold
 * out, unpublished between the pool query and now) is skipped, not an error. Any `filters` ride
 * along unchanged (inStock, withVariants, ...), so hydration applies the same rules as the pool did.
 */
export async function listCatalogByIds(db, ids, filters = {}) {
  const wanted = (ids || []).map(Number).filter(Number.isFinite);
  if (!wanted.length) return [];
  const rows = await listCatalog(db, {
    ...filters,
    status: 'ACTIVE',
    productIds: wanted,
    sortBy: 'newest',
    limit: wanted.length,
    offset: 0,
  });
  const order = new Map(wanted.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(Number(a.id)) ?? 0) - (order.get(Number(b.id)) ?? 0));
}

// Protocol limit from docs/api-contract.md §4.1 ("limit default 20, maximum 100"), not a tunable
// business number — it caps how much one page of any cursor-paginated feed may cost.
export const MAX_CATALOG_PAGE_SIZE = 100;
export const DEFAULT_CATALOG_PAGE_SIZE = 20;

/**
 * One cursor-paginated page of the public catalog, in the envelope docs/api-contract.md §4.1
 * mandates for feeds. Over-fetches by one row to answer `has_more` without a second COUNT query.
 *
 * `total` is only resolved on a feed's first page (`withTotal`), because that is the only page the
 * grid's "N products" label reads — a deep scroll must not pay for a repeated COUNT.
 *
 * @returns {Promise<{products: object[], hasMore: boolean, limit: number, offset: number, total: number|null}>}
 */
export async function listCatalogPage(db, { limit, offset = 0, minMarginPct, withTotal = false, ...filters } = {}) {
  const parsedLimit = parseInt(limit, 10);
  const pageSize = Math.min(
    Math.max(Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_CATALOG_PAGE_SIZE, 1),
    MAX_CATALOG_PAGE_SIZE
  );
  const start = Math.max(parseInt(offset, 10) || 0, 0);

  const [rows, total] = await Promise.all([
    listCatalog(db, { ...filters, limit: pageSize + 1, offset: start }),
    withTotal ? productRepo.countProducts(db, filters) : Promise.resolve(null),
  ]);
  const hasMore = rows.length > pageSize;
  let page = hasMore ? rows.slice(0, pageSize) : rows;

  // WHY margin is filtered here and not in SQL: saler margin % is derived by the pricing service
  // from the commission split, which is configuration — there is no column to put in a WHERE.
  // The consequence is honest and documented: with min_margin set a page can come back short
  // while `has_more` stays true, so the grid keeps scrolling rather than stopping early.
  let marginFiltered = false;
  if (minMarginPct !== undefined && minMarginPct !== null && minMarginPct !== '') {
    const threshold = parseFloat(minMarginPct);
    if (Number.isFinite(threshold)) {
      // Compare against the same number the product card badges (pricing.saler_margin_pct), so a
      // "20%+" filter can never surface a card labelled 15%.
      page = page.filter((p) => Number(p.pricing?.saler_margin_pct ?? 0) >= threshold);
      marginFiltered = true;
    }
  }

  return {
    products: page,
    hasMore,
    limit: pageSize,
    offset: start,
    // The COUNT above only knows the SQL filters, so it would over-report once margin has been
    // applied in JS. Report no total rather than a wrong one — the grid falls back to counting
    // what it has loaded.
    total: marginFiltered ? null : total,
  };
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

async function calculateProductPricing(db, product, preloaded) {
  const { salerSplitPct, platformSplitPct, ruleSource } = await resolveSplitPercentages(db, {
    productId: product.id,
    productRef: product.ref,
    categoryId: product.category_id,
    preloaded,
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
