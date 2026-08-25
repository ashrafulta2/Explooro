/**
 * coupon.service.js — Coupon & Voucher Promotion Service (Prompt 9.2).
 *
 * Implements:
 * 1. Coupon creation with multi-dimensional scopes (PLATFORM, SUPPLIER, SALER, CATEGORY, PRODUCT).
 * 2. Strict cost attribution: Explicit funding party (PLATFORM, SUPPLIER, SALER) driving ledger entries.
 * 3. Validation against constraints: min spend, max discount, budget cap, per-user limits, first-order-only.
 * 4. Atomic reservation inside checkout transactions using SELECT ... FOR UPDATE pessimistic row locks.
 * 5. Concurrency safety guaranteeing a budget cap is never exceeded.
 */

import { withTransaction } from '../config/db.js';
import { AppError } from '../plugins/errorHandler.js';
import { writeAudit } from '../lib/audit.js';
import * as couponRepo from '../repositories/coupon.repository.js';
import { isEnabled } from './module.service.js';

export const VALID_DISCOUNT_TYPES = new Set(['PERCENT', 'FIXED', 'FREE_SHIPPING', 'BUY_X_GET_Y']);
export const VALID_SCOPES = new Set(['PLATFORM', 'SUPPLIER', 'SALER', 'CATEGORY', 'PRODUCT']);
export const VALID_FUNDING_PARTIES = new Set(['PLATFORM', 'SUPPLIER', 'SALER']);

/**
 * Creates a new coupon with budget caps and cost attribution.
 */
export async function createCoupon(db, cache, creatorUser, couponData, reqMeta = {}) {
  const code = String(couponData.code || '').trim().toUpperCase();
  if (!code || code.length < 3 || code.length > 30) {
    throw new AppError('INVALID_COUPON_CODE', 'Coupon code must be between 3 and 30 characters.');
  }

  const discountType = couponData.discount_type || 'PERCENT';
  if (!VALID_DISCOUNT_TYPES.has(discountType)) {
    throw new AppError('INVALID_DISCOUNT_TYPE', `Discount type must be one of: ${[...VALID_DISCOUNT_TYPES].join(', ')}`);
  }

  const discountValue = Number(couponData.discount_value);
  if (isNaN(discountValue) || discountValue <= 0) {
    throw new AppError('INVALID_DISCOUNT_VALUE', 'Discount value must be greater than zero.');
  }
  if (discountType === 'PERCENT' && discountValue > 100) {
    throw new AppError('INVALID_DISCOUNT_VALUE', 'Percentage discount cannot exceed 100%.');
  }

  const scopeType = couponData.scope_type || 'PLATFORM';
  if (!VALID_SCOPES.has(scopeType)) {
    throw new AppError('INVALID_SCOPE', `Scope type must be one of: ${[...VALID_SCOPES].join(', ')}`);
  }

  const fundedBy = couponData.funded_by || 'PLATFORM';
  if (!VALID_FUNDING_PARTIES.has(fundedBy)) {
    throw new AppError('INVALID_FUNDED_BY', `Funded by must be one of: ${[...VALID_FUNDING_PARTIES].join(', ')}`);
  }

  // Non-super-admins cannot fund platform-wide discounts from platform treasury
  const isStaff = creatorUser.roles?.some(r => ['super_admin', 'admin'].includes(r));
  if (fundedBy === 'PLATFORM' && !isStaff) {
    throw new AppError('UNAUTHORIZED_FUNDING', 'Only platform administrators can create platform-funded coupons.');
  }

  const minSpend = Number(couponData.min_spend) || 0;
  const maxDiscount = couponData.max_discount != null ? Number(couponData.max_discount) : null;
  const budgetCap = couponData.budget_cap != null ? Number(couponData.budget_cap) : null;
  const usageLimit = couponData.usage_limit != null ? parseInt(couponData.usage_limit, 10) : null;
  const perUserLimit = parseInt(couponData.per_user_limit || 1, 10);
  const firstOrderOnly = Boolean(couponData.first_order_only);
  const isStackable = Boolean(couponData.is_stackable);

  const startsAt = couponData.starts_at ? new Date(couponData.starts_at) : new Date();
  const expiresAt = couponData.expires_at ? new Date(couponData.expires_at) : new Date(Date.now() + 30 * 86400000);

  if (expiresAt <= startsAt) {
    throw new AppError('INVALID_EXPIRY', 'Coupon expiration date must be after the start date.');
  }

  // Check uniqueness of coupon code
  const existing = await couponRepo.findCouponByCode(db, code);
  if (existing) {
    throw new AppError('COUPON_CODE_EXISTS', `Coupon code "${code}" already exists.`);
  }

  const query = `
    INSERT INTO coupons (
      code, discount_type, discount_value, max_discount, min_spend,
      budget_cap, usage_limit, per_user_limit, first_order_only, is_stackable,
      scope_type, scope_ref, funded_by, funded_by_user_id,
      starts_at, expires_at, is_active, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true, $17)
    RETURNING *
  `;

  const { rows } = await db.query(query, [
    code,
    discountType,
    discountValue.toFixed(2),
    maxDiscount != null ? maxDiscount.toFixed(2) : null,
    minSpend.toFixed(2),
    budgetCap != null ? budgetCap.toFixed(2) : null,
    usageLimit,
    perUserLimit,
    firstOrderOnly,
    isStackable,
    scopeType,
    couponData.scope_ref ? String(couponData.scope_ref) : null,
    fundedBy,
    fundedBy === 'PLATFORM' ? null : creatorUser.id,
    startsAt,
    expiresAt,
    creatorUser.id,
  ]);

  const createdCoupon = rows[0];

  await writeAudit(db, {
    userId: creatorUser.id,
    action: 'growth.coupon.create',
    resourceType: 'coupons',
    resourceId: createdCoupon.id,
    after: createdCoupon,
    ipAddress: reqMeta.ip || null,
    userAgent: reqMeta.userAgent || null,
  });

  return createdCoupon;
}

/**
 * Validates a coupon against a checkout cart and calculates discount amount.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {Object} params
 * @param {string} params.code - Coupon code
 * @param {number} [params.userId] - User applying the coupon
 * @param {Array<Object>} params.items - Cart items with { productId, categoryId, supplierId, salerId, price, qty }
 * @param {number} params.subtotal - Total cart qualifying amount
 * @param {number} [params.shippingAmount=0] - Shipping fee for free shipping calculation
 * @param {boolean} [params.forUpdate=false] - Whether to lock the coupon row
 * @returns {Promise<{ valid: boolean, coupon: Object, discountAmount: number, reason?: string, attribution: Object }>}
 */
export async function validateCoupon(db, {
  code,
  userId = null,
  items = [],
  subtotal = 0,
  shippingAmount = 0,
  forUpdate = false,
}) {
  if (!code) {
    return { valid: false, reason: 'NO_CODE_PROVIDED' };
  }

  const coupon = await couponRepo.findCouponByCode(db, code, { forUpdate });
  if (!coupon || !coupon.is_active) {
    return { valid: false, reason: 'COUPON_NOT_FOUND_OR_INACTIVE' };
  }

  const now = new Date();
  if (now < new Date(coupon.starts_at) || now > new Date(coupon.expires_at)) {
    return { valid: false, reason: 'COUPON_EXPIRED' };
  }

  // 1. Check budget cap
  const budgetCap = coupon.budget_cap != null ? Number(coupon.budget_cap) : null;
  const budgetUsed = Number(coupon.budget_used) || 0;
  if (budgetCap != null && budgetUsed >= budgetCap) {
    return { valid: false, reason: 'COUPON_BUDGET_EXHAUSTED' };
  }

  // 2. Check total usage limit
  if (coupon.usage_limit != null && Number(coupon.usage_count) >= Number(coupon.usage_limit)) {
    return { valid: false, reason: 'COUPON_USAGE_LIMIT_REACHED' };
  }

  // 3. Check per-user limit
  if (userId != null) {
    const userRedemptions = await couponRepo.getUserRedemptionCount(db, coupon.id, userId);
    if (userRedemptions >= Number(coupon.per_user_limit)) {
      return { valid: false, reason: 'USER_USAGE_LIMIT_EXCEEDED' };
    }

    // 4. Check first-order-only requirement
    if (coupon.first_order_only) {
      const { rows: orderRows } = await db.query(
        `SELECT id FROM orders WHERE customer_id = $1 AND status != 'CANCELLED' LIMIT 1`,
        [userId]
      );
      if (orderRows.length > 0) {
        return { valid: false, reason: 'FIRST_ORDER_ONLY' };
      }
    }
  }

  // 5. Check scope eligibility and calculate eligible subtotal
  let eligibleSubtotal = 0;
  if (coupon.scope_type === 'PLATFORM') {
    eligibleSubtotal = subtotal;
  } else if (coupon.scope_type === 'PRODUCT') {
    const targetProdId = Number(coupon.scope_ref);
    const matchingItems = items.filter(i => Number(i.productId || i.product_id) === targetProdId);
    eligibleSubtotal = matchingItems.reduce((sum, i) => sum + (Number(i.price) * Number(i.qty)), 0);
  } else if (coupon.scope_type === 'CATEGORY') {
    const targetCatId = Number(coupon.scope_ref);
    const matchingItems = items.filter(i => Number(i.categoryId || i.category_id) === targetCatId);
    eligibleSubtotal = matchingItems.reduce((sum, i) => sum + (Number(i.price) * Number(i.qty)), 0);
  } else if (coupon.scope_type === 'SUPPLIER') {
    const targetSupId = Number(coupon.scope_ref);
    const matchingItems = items.filter(i => Number(i.supplierId || i.supplier_id) === targetSupId);
    eligibleSubtotal = matchingItems.reduce((sum, i) => sum + (Number(i.price) * Number(i.qty)), 0);
  } else if (coupon.scope_type === 'SALER') {
    const targetSalerId = Number(coupon.scope_ref);
    const matchingItems = items.filter(i => Number(i.salerId || i.saler_id) === targetSalerId);
    eligibleSubtotal = matchingItems.reduce((sum, i) => sum + (Number(i.price) * Number(i.qty)), 0);
  }

  if (eligibleSubtotal <= 0) {
    return { valid: false, reason: 'NO_ELIGIBLE_ITEMS_FOR_SCOPE' };
  }

  // 6. Check min_spend constraint
  const minSpend = Number(coupon.min_spend) || 0;
  if (eligibleSubtotal < minSpend) {
    return { valid: false, reason: 'MIN_SPEND_NOT_MET', minSpend, eligibleSubtotal };
  }

  // 7. Compute discount amount
  let discountAmount = 0;
  const discountVal = Number(coupon.discount_value);

  if (coupon.discount_type === 'PERCENT') {
    discountAmount = (eligibleSubtotal * discountVal) / 100;
    if (coupon.max_discount != null) {
      discountAmount = Math.min(discountAmount, Number(coupon.max_discount));
    }
  } else if (coupon.discount_type === 'FIXED') {
    discountAmount = Math.min(discountVal, eligibleSubtotal);
  } else if (coupon.discount_type === 'FREE_SHIPPING') {
    discountAmount = Math.min(shippingAmount, discountVal > 0 ? discountVal : shippingAmount);
  } else if (coupon.discount_type === 'BUY_X_GET_Y') {
    // e.g. Buy 2 Get 1 Free: 1 item discount
    const totalQty = items.reduce((sum, i) => sum + (Number(i.qty) || 1), 0);
    if (totalQty >= 2) {
      const minItemPrice = Math.min(...items.map(i => Number(i.price)));
      discountAmount = Math.min(minItemPrice, eligibleSubtotal);
    }
  }

  discountAmount = Number(discountAmount.toFixed(2));

  // If budget cap exists, ensure discount does not exceed remaining budget
  if (budgetCap != null) {
    const remainingBudget = Math.max(0, budgetCap - budgetUsed);
    if (remainingBudget <= 0) {
      return { valid: false, reason: 'COUPON_BUDGET_EXHAUSTED' };
    }
    discountAmount = Math.min(discountAmount, remainingBudget);
  }

  // 8. Cost attribution metadata
  const attribution = {
    fundedBy: coupon.funded_by,
    fundedByUserId: coupon.funded_by_user_id,
    discountAmount,
    couponCode: coupon.code,
    couponId: coupon.id,
  };

  return {
    valid: true,
    coupon,
    discountAmount,
    attribution,
  };
}

/**
 * Atomically reserves and redeems a coupon within a checkout transaction.
 *
 * @param {import('pg').PoolClient} client - Database transaction client
 * @param {Object} params
 * @param {number} params.couponId
 * @param {number} params.userId
 * @param {number} params.orderId
 * @param {number} params.discountAmount
 * @returns {Promise<Object>} Redemption record
 */
export async function redeemCouponInTransaction(client, {
  couponId,
  userId,
  orderId,
  discountAmount,
}) {
  // Lock coupon row for concurrency safety
  const { rows: cRows } = await client.query(
    `SELECT * FROM coupons WHERE id = $1 FOR UPDATE`,
    [couponId]
  );

  if (cRows.length === 0) {
    throw new AppError('COUPON_NOT_FOUND', 'Coupon not found during redemption.');
  }

  const coupon = cRows[0];
  const budgetCap = coupon.budget_cap != null ? Number(coupon.budget_cap) : null;
  const budgetUsed = Number(coupon.budget_used) || 0;
  const usageLimit = coupon.usage_limit != null ? Number(coupon.usage_limit) : null;
  const usageCount = Number(coupon.usage_count) || 0;

  // Strict check under concurrency lock
  if (budgetCap != null && (budgetUsed + discountAmount) > budgetCap) {
    throw new AppError('COUPON_BUDGET_EXCEEDED', 'Coupon budget cap has been reached.');
  }
  if (usageLimit != null && (usageCount + 1) > usageLimit) {
    throw new AppError('COUPON_USAGE_LIMIT_EXCEEDED', 'Coupon usage limit has been reached.');
  }

  // Check per-user limit under lock
  if (userId) {
    const userRedemptions = await couponRepo.getUserRedemptionCount(client, couponId, userId);
    if (userRedemptions >= Number(coupon.per_user_limit)) {
      throw new AppError('USER_USAGE_LIMIT_EXCEEDED', 'You have already reached the redemption limit for this coupon.');
    }
  }

  // Increment usage and budget
  await client.query(
    `UPDATE coupons
     SET usage_count = usage_count + 1,
         budget_used = budget_used + $1
     WHERE id = $2`,
    [discountAmount.toFixed(2), couponId]
  );

  // Insert redemption record
  const redemption = await couponRepo.recordRedemption(client, {
    couponId,
    userId,
    orderId,
    discountAmount: discountAmount.toFixed(2),
  });

  return redemption;
}

/**
 * Lists coupons for management with budget and usage analytics.
 */
export async function listCoupons(db, { scopeType, fundedBy, isActive, limit = 50, offset = 0 } = {}) {
  let query = `
    SELECT c.*,
           u.display_name as creator_name,
           fu.display_name as funder_name
    FROM coupons c
    LEFT JOIN user_profiles u ON u.user_id = c.created_by
    LEFT JOIN user_profiles fu ON fu.user_id = c.funded_by_user_id
    WHERE 1=1
  `;
  const params = [];

  if (scopeType) {
    params.push(scopeType);
    query += ` AND c.scope_type = $${params.length}`;
  }
  if (fundedBy) {
    params.push(fundedBy);
    query += ` AND c.funded_by = $${params.length}`;
  }
  if (isActive != null) {
    params.push(isActive === 'true' || isActive === true);
    query += ` AND c.is_active = $${params.length}`;
  }

  query += ` ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await db.query(query, params);
  return rows;
}

/**
 * Deactivates or cancels an active coupon.
 */
export async function toggleCouponActive(db, userId, couponId, isActive, reqMeta = {}) {
  const { rows } = await db.query(
    `UPDATE coupons SET is_active = $1 WHERE id = $2 RETURNING *`,
    [isActive, couponId]
  );

  if (rows.length === 0) {
    throw new AppError('COUPON_NOT_FOUND', 'Coupon not found.');
  }

  await writeAudit(db, {
    userId,
    action: isActive ? 'growth.coupon.activate' : 'growth.coupon.deactivate',
    resourceType: 'coupons',
    resourceId: couponId,
    after: rows[0],
    ipAddress: reqMeta.ip || null,
    userAgent: reqMeta.userAgent || null,
  });

  return rows[0];
}
