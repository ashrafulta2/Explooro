/**
 * kycDecision.service.js — one place where a KYC verdict becomes final, however it was reached.
 *
 * Two doors lead here:
 *   1. A Super Admin decides directly (POST /admin/kyc/:id/decide).
 *   2. An Admin's request was deferred by requirePermission into pending_admin_actions, and a Super
 *      Admin approved it. Until this executor existed, that second door had no executor at all, so
 *      approving a deferred KYC decision failed with "no executor is wired up".
 *
 * Either way a VERIFIED verdict then tells the referral engine, so the KYC bonus (and the shared-NID
 * fraud check) happens exactly once per verdict, whichever door was used.
 */

import * as kycService from './kyc.service.js';
import * as referralService from './referral.service.js';
import { registerActionExecutor } from './makerChecker.service.js';

/** Highest-privilege role the caller holds; decideKyc only needs to know whether it is super_admin. */
export function reviewerRoleOf(roles) {
  const list = Array.isArray(roles) ? roles : [];
  return list.includes('super_admin') ? 'super_admin' : (list[0] ?? 'moderator');
}

/**
 * WHY after the verdict commits: evaluateQualifyingEvent opens its own transactions. Best-effort so a
 * referral problem never turns an approval into an error.
 */
export async function rewardVerifiedUser(db, cache, kyc, { log = null } = {}) {
  if (!kyc?.user_id) return [];
  try {
    return await referralService.evaluateQualifyingEvent(db, cache ?? null, {
      userId: kyc.user_id,
      eventType: 'KYC_VERIFIED',
    });
  } catch (err) {
    log?.warn?.({ err, kycId: kyc.id }, 'referral KYC bonus failed');
    return [];
  }
}

export async function decideAndReward(db, cache, { kycId, decision, reviewerId, roles, reasonEn, reasonBn, log = null }) {
  const result = await kycService.decideKyc(db, {
    kycId,
    decision,
    reviewerId,
    reviewerRole: reviewerRoleOf(roles),
    reasonEn,
    reasonBn,
  });
  if (!result.makerCheckerPending && result.decision === 'VERIFIED') {
    await rewardVerifiedUser(db, cache, result.kyc, { log });
  }
  return result;
}

registerActionExecutor('users.kyc.approve', {
  async validatePreconditions(payload, context) {
    if (!['VERIFIED', 'REJECTED'].includes(payload?.decision)) {
      throw new Error('The queued decision is not VERIFIED or REJECTED.');
    }
    const { rows } = await context.db.query(
      `SELECT status FROM kyc_verifications WHERE id = $1`,
      [Number(context.targetRef)]
    );
    if (rows.length === 0) throw new Error('The KYC submission no longer exists.');
    if (rows[0].status === 'VERIFIED') throw new Error('This KYC submission is already verified.');
  },

  // The requester is the audit actor (as with security.2fa.reset); the approver is on the pending action.
  async execute(payload, context) {
    const result = await kycService.decideKyc(context.db, {
      kycId: Number(context.targetRef),
      decision: payload.decision,
      reviewerId: context.actorId,
      reviewerRole: 'admin',
      reasonEn: payload.reason_en,
      reasonBn: payload.reason_bn,
      checkerApproved: true,
      client: context.db,
    });
    return { decision: result.decision, kyc: result.kyc };
  },

  async afterCommit(payload, context, result) {
    if (result?.decision === 'VERIFIED') await rewardVerifiedUser(context.db, context.cache, result.kyc);
  },
});
