/**
 * product.controller.js — Handlers for Catalog & Product endpoints (Prompt 4.3).
 */

import * as productService from '../services/product.service.js';
import * as pricingService from '../services/pricing.service.js';

export async function createProduct(req, reply) {
  const db = req.db || req.server?.db;
  const supplierId = req.user?.id;

  const {
    category_id,
    slug,
    title_en,
    title_bn,
    description_en,
    description_bn,
    brand,
    base_cost,
    wholesale_margin,
    default_retail_price,
    min_retail_price,
    stock_qty,
    low_stock_threshold,
    weight_grams,
    has_variants,
    warranty_months,
    media_ids,
  } = req.body || {};

  // Check if product_moderation module is enabled
  const isModerationModuleEnabled = req.isModuleEnabled ? req.isModuleEnabled('product_moderation') : true;
  const isSupplierVerificationEnabled = req.isModuleEnabled ? req.isModuleEnabled('supplier_verification') : false;

  const product = await productService.createProduct(db, {
    supplierId,
    categoryId: category_id,
    slug,
    titleEn: title_en,
    titleBn: title_bn,
    descriptionEn: description_en,
    descriptionBn: description_bn,
    brand,
    baseCost: base_cost,
    wholesaleMargin: wholesale_margin,
    defaultRetailPrice: default_retail_price,
    minRetailPrice: min_retail_price,
    stockQty: stock_qty,
    lowStockThreshold: low_stock_threshold,
    weightGrams: weight_grams,
    hasVariants: has_variants,
    warrantyMonths: warranty_months,
    mediaIds: media_ids,
    isModerationModuleEnabled,
    isSupplierVerificationEnabled,
  });

  return reply.status(201).send({ data: { product }, product });
}

// WHY: the admin "Register Product" form must send a real category_id, and no endpoint exposed
// the id/name pairs (only the top-level-only ads list). Category names are public catalog data.
export async function listCategories(req, reply) {
  const db = req.db || req.server?.db;
  const { rows } = await db.query(
    `SELECT id, name_en, name_bn, slug, parent_id
     FROM categories
     WHERE is_active = true
     ORDER BY display_order ASC, name_en ASC
     LIMIT 500`
  );
  return reply.send({ data: { categories: rows }, categories: rows });
}

// WHY both shapes: the real authenticate plugin sets `roles` (an array of role keys); `role` only
// exists on test stubs. Checking `role` alone meant a signed-in admin was never treated as staff
// and got FORBIDDEN editing any supplier's product.
function isStaffUser(user) {
  const roles = user?.roles || (user?.role ? [user.role] : []);
  return roles.includes('admin') || roles.includes('super_admin');
}

export async function updateProduct(req, reply) {
  const db = req.db || req.server?.db;
  const supplierId = req.user?.id;
  const { id } = req.params;

  const product = await productService.updateProduct(db, id, supplierId, req.body || {}, isStaffUser(req.user));
  return reply.send({ data: { product }, product });
}

export async function restockProduct(req, reply) {
  const db = req.db || req.server?.db;
  const { id } = req.params;
  const product = await productService.restockProduct(db, id, req.user?.id, req.body?.quantity, isStaffUser(req.user));
  return reply.send({ data: { product }, product });
}

export async function deleteProduct(req, reply) {
  const db = req.db || req.server?.db;
  const supplierId = req.user?.id;
  const { id } = req.params;

  const result = await productService.deleteProduct(db, id, supplierId, isStaffUser(req.user));
  return reply.send({ data: result, ...result });
}

export async function getProduct(req, reply) {
  const db = req.db || req.server?.db;
  const { id } = req.params;

  const product = await productService.getProductDetail(db, id);
  return reply.send({ data: { product }, product });
}

export async function listProducts(req, reply) {
  const db = req.db || req.server?.db;
  const {
    category_id,
    category_slug,
    brand,
    min_price,
    max_price,
    status,
    sort_by,
    limit,
    offset,
    supplier_id,
    flash_sale,
    supplier_tier,
    district,
    q,
  } = req.query || {};

  const products = await productService.listCatalog(db, {
    categoryId: category_id ? parseInt(category_id, 10) : undefined,
    categorySlug: category_slug,
    brand,
    minPrice: min_price ? parseFloat(min_price) : undefined,
    maxPrice: max_price ? parseFloat(max_price) : undefined,
    status: status || 'ACTIVE',
    sortBy: sort_by || 'newest',
    limit: limit ? parseInt(limit, 10) : 20,
    offset: offset ? parseInt(offset, 10) : 0,
    supplierId: supplier_id ? parseInt(supplier_id, 10) : undefined,
    flashSale: flash_sale === '1' || flash_sale === 'true' || flash_sale === true,
    supplierTier: supplier_tier,
    district,
    q,
  });

  return reply.send({ data: { products }, products });
}

export async function previewPricing(req, reply) {
  const db = req.db || req.server?.db;
  const {
    base_cost,
    wholesale_margin,
    retail_price,
    category_id,
    product_id,
    mode,
  } = req.body || {};

  const preview = await pricingService.previewPricing(db, {
    baseCost: base_cost,
    wholesaleMargin: wholesale_margin,
    retailPrice: retail_price,
    categoryId: category_id ? parseInt(category_id, 10) : undefined,
    productId: product_id ? parseInt(product_id, 10) : undefined,
    // WHY whitelisted: 'split' is the admin inspector's retail-minus-wholesale view driven by the
    // stored commission split; anything else keeps the saler-facing tiered default.
    mode: mode === 'split' ? 'split' : 'tiered',
  });

  return reply.send({ data: { preview }, preview });
}

/**
 * GET /admin/catalog/stats — KPI strip for the Super Admin catalog dashboard.
 *
 * `status` accepts any product status, or ALL. It defaults to ACTIVE so the figures agree with the
 * product table rendered beneath them, which lists ACTIVE products by default.
 */
export async function getCatalogStats(req, reply) {
  const db = req.db || req.server?.db;
  const { status } = req.query || {};

  const stats = await productService.getCatalogStats(db, {
    status: status ? String(status).toUpperCase() : 'ACTIVE',
  });

  return reply.send({ data: { stats }, stats });
}
