/**
 * subscriptionRebate.js — the Saler Pro commission rebate lookup used by pricing.
 *
 * WHY a separate file: pricing.service.js is imported by subscription.service.js (for the platform
 * split cap), so the rebate lookup cannot live in subscription.service.js without a cycle.
 *
 * The rebate applies only when BOTH are true:
 *   1. the `subscription_fees` module is enabled for this saler (admin's OFF switch wins), and
 *   2. the saler holds a live subscription: ACTIVE inside its period, PAST_DUE inside grace, or
 *      WAIVED with no end / an end still in the future.
 * Anything else — no row, expired, module OFF — yields 0, i.e. today's behaviour exactly.
 */

import { isEnabled } from './module.service.js';

export const SUBSCRIPTION_MODULE_KEY = 'subscription_fees';

/**
 * Moves `rebatePct` points from the platform's share to the saler's, never taking the platform
 * below zero. Pure; returns the input untouched when there is nothing to apply.
 */
export function applyRebate(split, rebatePct) {
  const rebate = Number(rebatePct);
  if (!Number.isFinite(rebate) || rebate <= 0) return split;
  const moved = Math.min(rebate, Math.max(split.platformSplitPct, 0));
  if (moved <= 0) return split;
  return {
    salerSplitPct: parseFloat((split.salerSplitPct + moved).toFixed(2)),
    platformSplitPct: parseFloat((split.platformSplitPct - moved).toFixed(2)),
    ruleSource: `${split.ruleSource}+PRO_REBATE`,
  };
}

/**
 * @returns {Promise<number>} rebate percentage points, 0 when none applies
 */
export async function resolveProRebatePct(db, { salerId, cache = null } = {}) {
  if (!db || !salerId) return 0;
  if (!(await isEnabled(db, cache, SUBSCRIPTION_MODULE_KEY, { userId: salerId, role: 'saler' }))) return 0;

  const { rows } = await db.query(
    `SELECT p.commission_rebate_pct
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.user_id = $1
        AND p.is_active = true
        AND (
          (s.status = 'ACTIVE'   AND s.current_period_end > now())
          OR (s.status = 'PAST_DUE' AND s.grace_ends_at IS NOT NULL AND s.grace_ends_at > now())
          OR (s.status = 'WAIVED'   AND (s.waiver_ends_at IS NULL OR s.waiver_ends_at > now()))
        )
      LIMIT 1`,
    [salerId]
  );
  return rows.length ? parseFloat(rows[0].commission_rebate_pct) || 0 : 0;
}
