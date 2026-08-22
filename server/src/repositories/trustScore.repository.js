/**
 * trustScore.repository.js — SQL repository for buyer/seller trust scores (Prompt 5.2).
 *
 * Adheres to raw SQL repository architecture (docs/architecture-map.md §1).
 */

export async function findTrustScoreByUserId(db, userId) {
  const { rows } = await db.query(
    `SELECT * FROM trust_scores WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

export async function upsertTrustScore(db, {
  userId,
  score,
  tier = 'STARTER',
  deliverySuccessRate = null,
  returnRate = null,
  disputeRate = null,
  codRefusalCount = 0,
  completedOrders = 0,
  manualAdjustment = 0,
  adjustedBy = null,
}) {
  const query = `
    INSERT INTO trust_scores (
      user_id, score, tier, delivery_success_rate, return_rate, dispute_rate,
      cod_refusal_count, completed_orders, manual_adjustment, adjusted_by,
      computed_at, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now(), now())
    ON CONFLICT (user_id)
    DO UPDATE SET
      score = EXCLUDED.score,
      tier = EXCLUDED.tier,
      delivery_success_rate = COALESCE(EXCLUDED.delivery_success_rate, trust_scores.delivery_success_rate),
      return_rate = COALESCE(EXCLUDED.return_rate, trust_scores.return_rate),
      dispute_rate = COALESCE(EXCLUDED.dispute_rate, trust_scores.dispute_rate),
      cod_refusal_count = EXCLUDED.cod_refusal_count,
      completed_orders = EXCLUDED.completed_orders,
      manual_adjustment = EXCLUDED.manual_adjustment,
      adjusted_by = COALESCE(EXCLUDED.adjusted_by, trust_scores.adjusted_by),
      computed_at = now(),
      updated_at = now()
    RETURNING *
  `;
  const { rows } = await db.query(query, [
    userId,
    score,
    tier,
    deliverySuccessRate,
    returnRate,
    disputeRate,
    codRefusalCount,
    completedOrders,
    manualAdjustment,
    adjustedBy,
  ]);
  return rows[0];
}

export async function getUserOrderMetrics(db, userId) {
  const query = `
    SELECT
      COUNT(CASE WHEN o.payment_status = 'PAID' OR so.status = 'DELIVERED' THEN 1 END) AS completed_orders,
      COUNT(CASE WHEN so.status IN ('RETURNED', 'REFUNDED') THEN 1 END) AS returned_orders,
      COUNT(CASE WHEN o.payment_method = 'COD' AND so.status = 'CANCELLED' THEN 1 END) AS cod_refusal_count,
      COUNT(so.id) AS total_orders
    FROM orders o
    LEFT JOIN sub_orders so ON so.order_id = o.id
    WHERE o.customer_id = $1
  `;
  const { rows } = await db.query(query, [userId]);
  return rows[0] || { completed_orders: 0, returned_orders: 0, cod_refusal_count: 0, total_orders: 0 };
}
