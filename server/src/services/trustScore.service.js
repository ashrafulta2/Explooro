/**
 * trustScore.service.js — Customer & Seller Trust Scoring Engine & COD Anti-Fraud (Prompt 5.2).
 *
 * Factors:
 *  - Delivery success rate (completed vs total)
 *  - Return rate
 *  - Account age (in days)
 *  - Verification level (phone verified, KYC verified)
 *  - Prior COD refusals (-25 pts per refusal)
 *  - Manual admin adjustments
 *
 * Scoring scale: 0 to 100
 * Tiers:
 *  - STARTER: 0 - 59
 *  - VERIFIED_TRADER: 60 - 84
 *  - ELITE_PARTNER: 85 - 100
 */

import * as trustRepo from '../repositories/trustScore.repository.js';
import * as userRepo from '../repositories/user.repository.js';

export const TRUST_THRESHOLDS = {
  MIN_COD_SCORE: 40,
  DEFAULT_MAX_COD_AMOUNT_BDT: 5000.0,
};

export function determineTier(score) {
  if (score >= 85) return 'ELITE_PARTNER';
  if (score >= 60) return 'VERIFIED_TRADER';
  return 'STARTER';
}

/**
 * Calculates and persists the dynamic trust score for a user.
 */
export async function calculateAndPersistTrustScore(db, userId) {
  const user = await userRepo.findUserById(db, userId);
  if (!user) return null;

  const existing = await trustRepo.findTrustScoreByUserId(db, userId);
  const metrics = await trustRepo.getUserOrderMetrics(db, userId);

  const completed = Number(metrics.completed_orders || 0);
  const returned = Number(metrics.returned_orders || 0);
  const codRefusals = Number(metrics.cod_refusal_count || 0);
  const total = Number(metrics.total_orders || 0);

  // 1. Base score starts at 50
  let score = 50;

  // 2. Account age bonus (up to +15 pts for accounts > 30 days)
  const daysOld = Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24));
  if (daysOld >= 90) score += 15;
  else if (daysOld >= 30) score += 10;
  else if (daysOld >= 7) score += 5;

  // 3. Verification bonus
  if (user.is_phone_verified) score += 10;
  if (user.is_email_verified) score += 5;

  // 4. Order performance
  let deliverySuccessRate = null;
  let returnRate = null;

  if (total > 0) {
    deliverySuccessRate = parseFloat(((completed / total) * 100).toFixed(2));
    returnRate = parseFloat(((returned / total) * 100).toFixed(2));

    // Successful orders increase score
    score += Math.min(25, completed * 5);

    // High return rate penalizes score
    if (returnRate > 20) score -= 15;
    else if (returnRate > 10) score -= 5;
  }

  // 5. Heavy penalty for COD refusals (-25 pts per refusal)
  score -= (codRefusals * 25);

  // 6. Apply manual adjustment if set by staff
  const manualAdjustment = existing ? Number(existing.manual_adjustment || 0) : 0;
  score += manualAdjustment;

  // Clamp strictly between 0 and 100
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = determineTier(score);

  return trustRepo.upsertTrustScore(db, {
    userId,
    score,
    tier,
    deliverySuccessRate,
    returnRate,
    codRefusalCount: codRefusals,
    completedOrders: completed,
    manualAdjustment,
    adjustedBy: existing?.adjusted_by || null,
  });
}

/**
 * Evaluates whether a COD order requires SMS OTP confirmation due to risk.
 */
export async function evaluateCodRisk(db, { userId, orderAmount }) {
  let record = await trustRepo.findTrustScoreByUserId(db, userId);
  if (!record) {
    record = await calculateAndPersistTrustScore(db, userId);
  }

  const score = record ? Number(record.score) : 50;

  // Check platform setting for max COD value if configured
  let maxCodValue = TRUST_THRESHOLDS.DEFAULT_MAX_COD_AMOUNT_BDT;
  try {
    const { rows } = await db.query(
      `SELECT value_json FROM platform_settings WHERE key = 'checkout.max_cod_order_value'`
    );
    if (rows.length > 0 && rows[0].value_json) {
      maxCodValue = parseFloat(rows[0].value_json.amount ?? rows[0].value_json ?? maxCodValue);
    }
  } catch {
    // Fallback to default
  }

  const isLowTrust = score < TRUST_THRESHOLDS.MIN_COD_SCORE;
  const isHighValue = Number(orderAmount) > maxCodValue;
  const requiresOtp = isLowTrust || isHighValue;

  let reason = null;
  if (isLowTrust && isHighValue) {
    reason = 'LOW_TRUST_AND_HIGH_VALUE';
  } else if (isLowTrust) {
    reason = 'LOW_TRUST_SCORE';
  } else if (isHighValue) {
    reason = 'HIGH_ORDER_VALUE';
  }

  return {
    requiresOtp,
    trustScore: score,
    tier: record?.tier || 'STARTER',
    maxCodValue,
    reason,
  };
}
