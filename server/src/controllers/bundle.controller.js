/**
 * bundle.controller.js — Controller for Cross-Seller Bundling & Surge Pricing (Prompt 10.5).
 */

import * as bundleService from '../services/bundle.service.js';
import * as surgeService from '../services/surgePricing.service.js';

/**
 * Preview live profit breakdown for proposed bundle combo before creation.
 * POST /api/v1/saler/bundles/preview
 */
export async function previewBundleBreakdown(req, reply) {
  const { items, bundle_price, bundlePrice } = req.body || {};
  const price = bundlePrice ?? bundle_price;

  const breakdown = bundleService.calculateBundleBreakdown({
    items,
    bundlePrice: price,
  });

  return reply.send({
    data: breakdown,
  });
}

/**
 * Create a cross-seller product bundle.
 * POST /api/v1/saler/bundles
 */
export async function createBundle(req, reply) {
  const { title_en, title_bn, bundle_price, bundlePrice, items } = req.body || {};
  const price = bundlePrice ?? bundle_price;
  const salerId = req.user.id;

  const result = await bundleService.createBundle(req.server.db, {
    salerId,
    titleEn: title_en,
    titleBn: title_bn,
    bundlePrice: price,
    items,
  });

  return reply.status(201).send({
    data: result,
  });
}

/**
 * Get bundle details with live breakdown.
 * GET /api/v1/bundles/:idOrRef
 */
export async function getBundle(req, reply) {
  const { idOrRef } = req.params;
  const bundle = await bundleService.getBundleById(req.server.db, idOrRef);

  return reply.send({
    data: bundle,
  });
}

/**
 * List bundles for the authenticated saler or public catalog.
 * GET /api/v1/saler/bundles
 */
export async function listSalerBundles(req, reply) {
  const salerId = req.user?.id;
  const { is_active, limit, offset } = req.query || {};

  const result = await bundleService.listBundles(req.server.db, {
    salerId,
    isActive: is_active !== undefined ? is_active === 'true' || is_active === true : null,
    limit: limit ? parseInt(limit, 10) : 20,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({
    data: result.bundles,
    meta: {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    },
  });
}

/**
 * Update bundle.
 * PATCH /api/v1/saler/bundles/:id
 */
export async function updateBundle(req, reply) {
  const { id } = req.params;
  const salerId = req.user.id;
  const { title_en, title_bn, bundle_price, is_active } = req.body || {};

  const updated = await bundleService.updateBundle(req.server.db, id, {
    salerId,
    titleEn: title_en,
    titleBn: title_bn,
    bundlePrice: bundle_price,
    isActive: is_active,
  });

  return reply.send({
    data: updated,
  });
}

/**
 * Delete bundle.
 * DELETE /api/v1/saler/bundles/:id
 */
export async function deleteBundle(req, reply) {
  const { id } = req.params;
  const salerId = req.user.id;

  const result = await bundleService.deleteBundle(req.server.db, id, salerId);
  return reply.send({
    data: result,
  });
}

/**
 * Add bundle to user/guest cart.
 * POST /api/v1/cart/bundle
 */
export async function addBundleToCart(req, reply) {
  const { cart_id, bundle_id, qty, saler_id } = req.body || {};
  const result = await bundleService.addBundleToCart(req.server.db, {
    cartId: cart_id,
    bundleId: bundle_id,
    salerId: saler_id || req.user?.id,
    qty: qty || 1,
  });

  return reply.send({
    data: result,
  });
}

/**
 * List surge pricing recommendations for supplier.
 * GET /api/v1/supplier/surge/recommendations
 */
export async function listSupplierSurgeRecommendations(req, reply) {
  const supplierId = req.user?.id;
  const { status, limit, offset } = req.query || {};

  const result = await surgeService.listSurgeRecommendations(req.server.db, {
    supplierId,
    status: status || 'PENDING',
    limit: limit ? parseInt(limit, 10) : 20,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({
    data: result.recommendations,
    meta: {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    },
  });
}

/**
 * Trigger product demand analysis.
 * GET /api/v1/supplier/surge/analyze/:productId
 */
export async function analyzeProductDemand(req, reply) {
  const { productId } = req.params;
  const analysis = await surgeService.analyzeProductDemand(req.server.db, productId);

  return reply.send({
    data: analysis,
  });
}

/**
 * Accept surge pricing recommendation.
 * POST /api/v1/supplier/surge/recommendations/:id/accept
 */
export async function acceptSurgeRecommendation(req, reply) {
  const { id } = req.params;
  const supplierId = req.user?.id;

  const result = await surgeService.acceptSurgeRecommendation(req.server.db, {
    recommendationId: id,
    supplierId,
    appliedBy: req.user?.id,
  });

  return reply.send({
    data: result,
  });
}

/**
 * Dismiss surge pricing recommendation.
 * POST /api/v1/supplier/surge/recommendations/:id/dismiss
 */
export async function dismissSurgeRecommendation(req, reply) {
  const { id } = req.params;
  const supplierId = req.user?.id;

  const result = await surgeService.dismissSurgeRecommendation(req.server.db, {
    recommendationId: id,
    supplierId,
  });

  return reply.send({
    data: result,
  });
}

/**
 * Admin sweep to scan catalog for surges.
 * POST /api/v1/admin/surge/scan
 */
export async function scanSurges(req, reply) {
  const result = await surgeService.scanCatalogForSurges(req.server.db);
  return reply.send({
    data: result,
  });
}
