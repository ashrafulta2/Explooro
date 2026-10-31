/**
 * promotion.controller.ts — Handlers for Coupons, Vouchers & Flash Sales API (Prompt 9.2).
 */

import * as couponService from '../services/coupon.service.ts';
import * as supplierFlashSaleService from '../services/supplierFlashSale.service.ts';
import * as flashSaleService from '../services/flashSale.service.ts';
import { loadPricingContext } from '../services/retailMarkup.service.ts';

/**
 * The admin coupon list, with the pricing settings the coupon form warns against
 * (client/src/services/pricingConflicts.ts findCouponConflicts).
 */
export async function adminListCoupons(req, reply) {
  const db = req.db || req.server?.db;
  const { scope_type, funded_by, is_active, limit, offset } = req.query || {};
  const [coupons, pricing] = await Promise.all([
    couponService.listCoupons(db, {
      scopeType: scope_type,
      fundedBy: funded_by,
      isActive: is_active,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    }),
    loadPricingContext(db),
  ]);
  return reply.send({ coupons, pricing });
}

export async function getFlashSalePriceContext(req, reply) {
  const db = req.db || req.server?.db;
  return reply.send(await flashSaleService.getPriceContext(db, req.query?.product_id));
}

export async function createCoupon(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const user = req.user;

  const result = await couponService.createCoupon(db, cache, user, req.body, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.status(201).send({
    coupon: result,
  });
}

export async function validateCoupon(req, reply) {
  const db = req.db || req.server?.db;
  const { code, items, subtotal, district } = req.body || {};

  // WHY no shipping figure from the client: FREE_SHIPPING is priced from the delivery policy, the
  // same per-parcel charge checkout uses, so the preview cannot be talked into a bigger discount.
  // The client may name the district; the server turns it into a zone and a charge itself.
  const result = await couponService.validateCoupon(db, {
    code,
    userId: req.user?.id || null,
    items: items || [],
    subtotal: parseFloat(subtotal || 0),
    district: typeof district === 'string' ? district.slice(0, 64) : null,
    cache: req.server?.cache || null,
  });

  return reply.send(result);
}

export async function listCoupons(req, reply) {
  const db = req.db || req.server?.db;
  const { scope_type, funded_by, is_active, limit, offset } = req.query || {};

  const coupons = await couponService.listCoupons(db, {
    scopeType: scope_type,
    fundedBy: funded_by,
    isActive: is_active,
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({
    coupons,
  });
}

export async function toggleCouponActive(req, reply) {
  const db = req.db || req.server?.db;
  const couponId = parseInt(req.params.id, 10);
  const { is_active } = req.body || {};

  const result = await couponService.toggleCouponActive(db, req.user.id, couponId, is_active, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send({
    coupon: result,
  });
}

export async function getActiveFlashSales(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { limit } = req.query || {};

  const flashSales = await flashSaleService.getActiveAndUpcomingFlashSales(db, cache, {
    limit: limit ? parseInt(limit, 10) : 20,
  });

  return reply.send({
    flash_sales: flashSales,
  });
}

export async function createFlashSale(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;

  const result = await flashSaleService.createFlashSale(db, user, req.body, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.status(201).send({
    flash_sale: result,
  });
}

export async function emergencyStopFlashSale(req, reply) {
  const db = req.db || req.server?.db;
  const flashSaleId = parseInt(req.params.id, 10);
  const { reason } = req.body || {};

  const result = await flashSaleService.emergencyStop(db, req.user, flashSaleId, reason, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send({
    flash_sale: result,
  });
}

export async function listAllFlashSales(req, reply) {
  const db = req.db || req.server?.db;
  const { status, limit, offset } = req.query || {};

  const sales = await flashSaleService.listAllFlashSales(db, {
    status,
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({
    flash_sales: sales,
  });
}

// ── Supplier's own flash sales (migration 096) ───────────────────────────────

const metaOf = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

export async function supplierFlashOverview(req, reply) {
  return reply.send(await supplierFlashSaleService.getOverview(req.db || req.server?.db, req.user, req.query || {}));
}

export async function supplierFlashQuote(req, reply) {
  return reply.send(await supplierFlashSaleService.quote(req.db || req.server?.db, req.user, req.query || {}));
}

export async function supplierFlashCreate(req, reply) {
  const result = await supplierFlashSaleService.createOwnDeal(req.db || req.server?.db, req.user, req.body || {}, metaOf(req));
  return reply.status(201).send(result);
}

export async function supplierFlashStop(req, reply) {
  const deal = await supplierFlashSaleService.stopOwnDeal(req.db || req.server?.db, req.user, req.params.id, metaOf(req));
  return reply.send({ flash_sale: deal });
}

export async function getSupplierFlashRules(req, reply) {
  return reply.send({ rules: await supplierFlashSaleService.getRules(req.db || req.server?.db), limits: supplierFlashSaleService.RULE_LIMITS });
}

export async function updateSupplierFlashRules(req, reply) {
  const { rules, reason, expected_updated_at: expectedUpdatedAt } = req.body || {};
  const saved = await supplierFlashSaleService.updateRules(req.db || req.server?.db, { rules, reason, expectedUpdatedAt, user: req.user, reqMeta: metaOf(req) });
  return reply.send({ rules: saved, limits: supplierFlashSaleService.RULE_LIMITS });
}
