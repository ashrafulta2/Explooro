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
  } = req.body || {};

  // Check if product_moderation module is enabled
  const isModerationModuleEnabled = req.isModuleEnabled ? req.isModuleEnabled('product_moderation') : true;

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
    isModerationModuleEnabled,
  });

  return reply.status(201).send({ data: { product }, product });
}

export async function updateProduct(req, reply) {
  const db = req.db || req.server?.db;
  const supplierId = req.user?.id;
  const { id } = req.params;
  const isStaff = req.user?.role === 'admin' || req.user?.role === 'super_admin';

  const product = await productService.updateProduct(db, parseInt(id, 10), supplierId, req.body || {}, isStaff);
  return reply.send({ data: { product }, product });
}

export async function deleteProduct(req, reply) {
  const db = req.db || req.server?.db;
  const supplierId = req.user?.id;
  const { id } = req.params;
  const isStaff = req.user?.role === 'admin' || req.user?.role === 'super_admin';

  const result = await productService.deleteProduct(db, parseInt(id, 10), supplierId, isStaff);
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
  } = req.body || {};

  const preview = await pricingService.previewPricing(db, {
    baseCost: base_cost,
    wholesaleMargin: wholesale_margin,
    retailPrice: retail_price,
    categoryId: category_id ? parseInt(category_id, 10) : undefined,
    productId: product_id ? parseInt(product_id, 10) : undefined,
  });

  return reply.send({ data: { preview }, preview });
}
