/**
 * promotion.controller.js — Handlers for Coupons, Vouchers & Flash Sales API (Prompt 9.2).
 */

import * as couponService from '../services/coupon.service.js';
import * as flashSaleService from '../services/flashSale.service.js';

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
  const { code, items, subtotal, shipping_amount } = req.body || {};

  const result = await couponService.validateCoupon(db, {
    code,
    userId: req.user?.id || null,
    items: items || [],
    subtotal: parseFloat(subtotal || 0),
    shippingAmount: parseFloat(shipping_amount || 0),
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
