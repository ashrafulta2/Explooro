/**
 * coupon.repository.js — SQL repository for coupon validation and redemptions (Prompt 5.2).
 *
 * Enforces raw SQL layered architecture (docs/architecture-map.md §1).
 */

export async function findCouponByCode(db, code, { forUpdate = false } = {}) {
  if (!code) return null;
  const lockClause = forUpdate ? 'FOR UPDATE' : '';
  const { rows } = await db.query(
    `SELECT * FROM coupons
     WHERE UPPER(code) = UPPER($1) AND is_active = true
     ${lockClause}`,
    [code.trim()]
  );
  return rows[0] || null;
}

export async function findCouponById(db, id, { forUpdate = false } = {}) {
  const lockClause = forUpdate ? 'FOR UPDATE' : '';
  const { rows } = await db.query(
    `SELECT * FROM coupons WHERE id = $1 ${lockClause}`,
    [id]
  );
  return rows[0] || null;
}

export async function getUserRedemptionCount(db, couponId, userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2`,
    [couponId, userId]
  );
  return rows[0]?.count || 0;
}

export async function incrementCouponUsage(db, couponId, discountAmount) {
  const { rows } = await db.query(
    `UPDATE coupons
     SET
       usage_count = usage_count + 1,
       budget_used = budget_used + $1
     WHERE id = $2
     RETURNING *`,
    [discountAmount, couponId]
  );
  return rows[0] || null;
}

export async function decrementCouponUsage(db, couponId, discountAmount) {
  const { rows } = await db.query(
    `UPDATE coupons
     SET
       usage_count = GREATEST(0, usage_count - 1),
       budget_used = GREATEST(0, budget_used - $1)
     WHERE id = $2
     RETURNING *`,
    [discountAmount, couponId]
  );
  return rows[0] || null;
}

export async function recordRedemption(db, { couponId, userId, orderId, discountAmount }) {
  const { rows } = await db.query(
    `INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, discount_amount, created_at)
     VALUES ($1, $2, $3, $4, now())
     RETURNING *`,
    [couponId, userId, orderId, discountAmount]
  );
  return rows[0];
}

export async function findRedemptionByOrder(db, orderId) {
  const { rows } = await db.query(
    `SELECT cr.*, c.code, c.discount_type
     FROM coupon_redemptions cr
     JOIN coupons c ON c.id = cr.coupon_id
     WHERE cr.order_id = $1`,
    [orderId]
  );
  return rows[0] || null;
}
