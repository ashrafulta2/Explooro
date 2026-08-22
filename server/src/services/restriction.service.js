/**
 * restriction.service.js — Granular Per-User Activity Control (Prompt 2.6).
 *
 * Implements granular capability restrictions per docs/rbac-spec.md §5:
 * - 12 Capability Switches (can_login, can_list_products, can_sell, can_buy, can_use_cod, can_withdraw,
 *   can_chat, can_live_stream, can_run_ads, can_refer, can_post_review, can_upload_video).
 * - 5 Numeric Limits (max_withdrawal_per_day, max_products, max_cod_order_value, max_daily_messages, ad_budget_cap).
 * - 4 Enforcement Modes (BLOCK, THROTTLE, FORCE_REVIEW_QUEUE, SHADOW_BAN).
 * - Maker-checker registration for restriction management actions.
 */

import * as permRepo from '../repositories/permission.repository.js';
import * as rbacService from './rbac.service.js';
import { evaluatePredicate } from './segment.service.js';
import { registerActionExecutor } from './makerChecker.service.js';
import { writeAudit } from '../lib/audit.js';
import { AppError } from '../plugins/errorHandler.js';

export const VALID_CAPABILITIES = new Set([
  'can_login',
  'can_list_products',
  'can_sell',
  'can_buy',
  'can_use_cod',
  'can_withdraw',
  'can_chat',
  'can_live_stream',
  'can_run_ads',
  'can_refer',
  'can_post_review',
  'can_upload_video',
  // Also allow numeric limit keys as capability keys when configured with THROTTLE
  'max_withdrawal_per_day',
  'max_products',
  'max_cod_order_value',
  'max_daily_messages',
  'ad_budget_cap',
]);

export const VALID_NUMERIC_LIMITS = new Set([
  'max_withdrawal_per_day',
  'max_products',
  'max_cod_order_value',
  'max_daily_messages',
  'ad_budget_cap',
]);

export const VALID_MODES = new Set(['BLOCK', 'THROTTLE', 'FORCE_REVIEW_QUEUE', 'SHADOW_BAN']);
export const VALID_SUBJECT_TYPES = new Set(['USER', 'SEGMENT']);

/**
 * Applies a new activity restriction on a single user or segment.
 */
export async function applyRestriction(
  db,
  cache,
  {
    subjectType,
    subjectRef,
    segmentPredicate = null,
    capabilityKey,
    mode,
    limitValue = null,
    reason,
    reasonBn = null,
    evidenceJson = null,
    appliedBy,
    expiresAt = null,
    ip,
    userAgent,
    traceId,
  }
) {
  if (!VALID_SUBJECT_TYPES.has(subjectType)) {
    throw new AppError('VALIDATION_FAILED', `Invalid subject_type: ${subjectType}. Must be USER or SEGMENT.`);
  }

  if (!VALID_CAPABILITIES.has(capabilityKey)) {
    throw new AppError('VALIDATION_FAILED', `Invalid capability_key: "${capabilityKey}".`);
  }

  if (!VALID_MODES.has(mode)) {
    throw new AppError('VALIDATION_FAILED', `Invalid mode: "${mode}". Must be BLOCK, THROTTLE, FORCE_REVIEW_QUEUE, or SHADOW_BAN.`);
  }

  if (mode === 'THROTTLE' && (limitValue === null || limitValue === undefined || Number(limitValue) <= 0)) {
    throw new AppError('VALIDATION_FAILED', 'THROTTLE mode requires a positive numeric limit_value.', 'থ্রোটল মোডের জন্য একটি সংখ্যাসূচক সীমা প্রয়োজন।');
  }

  if (mode === 'SHADOW_BAN' && (!evidenceJson || typeof evidenceJson !== 'object' || Object.keys(evidenceJson).length === 0)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'SHADOW_BAN mode requires evidence_json documenting concrete abuse.',
      'শ্যাডো ব্যান মোডের জন্য প্রমাণের তথ্য (evidence_json) প্রদান করা আবশ্যক।'
    );
  }

  if (!reason || reason.trim().length < 10) {
    throw new AppError('VALIDATION_FAILED', 'Reason is mandatory and must be at least 10 characters.', 'কারণ উল্লেখ করা আবশ্যক (অন্তত ১০ অক্ষর)।');
  }

  if (subjectType === 'SEGMENT' && (!segmentPredicate || typeof segmentPredicate !== 'object')) {
    throw new AppError('VALIDATION_FAILED', 'Segment restrictions require a valid segment_predicate object.');
  }

  let expDate = null;
  if (expiresAt) {
    expDate = new Date(expiresAt);
    if (isNaN(expDate.getTime()) || expDate <= new Date()) {
      throw new AppError('VALIDATION_FAILED', 'Expiry date must be in the future.', 'মেয়াদ উত্তীর্ণের তারিখ ভবিষ্যতের হতে হবে।');
    }
  }

  const restriction = await permRepo.createUserRestriction(db, {
    subjectType,
    subjectRef: String(subjectRef),
    segmentPredicate,
    capabilityKey,
    mode,
    limitValue: limitValue !== null ? Number(limitValue) : null,
    reason,
    reasonBn,
    evidenceJson,
    appliedBy,
    expiresAt: expDate,
  });

  await writeAudit(db, {
    actorId: appliedBy,
    action: 'user_restriction.apply',
    targetType: 'user_restriction',
    targetRef: String(restriction.id),
    afterJson: {
      subject_type: subjectType,
      subject_ref: subjectRef,
      capability_key: capabilityKey,
      mode,
      limit_value: limitValue,
      reason,
      expires_at: expDate ? expDate.toISOString() : null,
    },
    riskTier: 'HIGH',
    ip,
    userAgent,
    traceId,
  });

  if (subjectType === 'USER' && /^\d+$/.test(String(subjectRef))) {
    await rbacService.invalidateUserPermissionCache(cache, Number(subjectRef));
  } else {
    await rbacService.bumpGlobalPermissionVersion(cache);
  }

  return restriction;
}

/**
 * Updates an active restriction.
 */
export async function updateRestriction(
  db,
  cache,
  { restrictionId, mode = null, limitValue = null, reason = null, reasonBn = null, evidenceJson = null, expiresAt = null, updatedBy, ip, userAgent, traceId }
) {
  const existing = await permRepo.getUserRestrictionById(db, restrictionId);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Restriction not found.', 'নিষেধাজ্ঞা পাওয়া যায়নি।');
  }

  if (existing.lifted_at) {
    throw new AppError('CONFLICT', 'Cannot update a lifted restriction.', 'প্রত্যাহার করা নিষেধাজ্ঞা আপডেট করা যাবে না।');
  }

  if (mode && !VALID_MODES.has(mode)) {
    throw new AppError('VALIDATION_FAILED', `Invalid mode: "${mode}".`);
  }

  let expDate = null;
  if (expiresAt) {
    expDate = new Date(expiresAt);
    if (isNaN(expDate.getTime()) || expDate <= new Date()) {
      throw new AppError('VALIDATION_FAILED', 'Expiry date must be in the future.');
    }
  }

  const updated = await permRepo.updateUserRestriction(db, restrictionId, {
    mode,
    limitValue: limitValue !== null ? Number(limitValue) : null,
    reason,
    reasonBn,
    evidenceJson,
    expiresAt: expDate,
  });

  await writeAudit(db, {
    actorId: updatedBy,
    action: 'user_restriction.update',
    targetType: 'user_restriction',
    targetRef: String(restrictionId),
    beforeJson: {
      mode: existing.mode,
      limit_value: existing.limit_value,
      reason: existing.reason,
    },
    afterJson: {
      mode: updated.mode,
      limit_value: updated.limit_value,
      reason: updated.reason,
    },
    riskTier: 'HIGH',
    ip,
    userAgent,
    traceId,
  });

  if (existing.subject_type === 'USER' && /^\d+$/.test(String(existing.subject_ref))) {
    await rbacService.invalidateUserPermissionCache(cache, Number(existing.subject_ref));
  } else {
    await rbacService.bumpGlobalPermissionVersion(cache);
  }

  return updated;
}

/**
 * Lifts an active restriction.
 */
export async function liftRestriction(
  db,
  cache,
  { restrictionId, liftedBy, reason, ip, userAgent, traceId }
) {
  if (!reason || reason.trim().length < 10) {
    throw new AppError('VALIDATION_FAILED', 'Reason is mandatory and must be at least 10 characters to lift a restriction.', 'নিষেধাজ্ঞা প্রত্যাহারের জন্য অন্তত ১০ অক্ষরের কারণ প্রদান করুন।');
  }

  const existing = await permRepo.getUserRestrictionById(db, restrictionId);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Restriction not found.', 'নিষেধাজ্ঞা পাওয়া যায়নি।');
  }

  if (existing.lifted_at) {
    throw new AppError('CONFLICT', 'Restriction is already lifted.', 'নিষেধাজ্ঞাটি ইতিমধ্যে প্রত্যাহার করা হয়েছে।');
  }

  const lifted = await permRepo.liftUserRestriction(db, restrictionId, {
    liftedBy,
    liftReason: reason,
  });

  await writeAudit(db, {
    actorId: liftedBy,
    action: 'user_restriction.lift',
    targetType: 'user_restriction',
    targetRef: String(restrictionId),
    beforeJson: {
      id: existing.id,
      subject_type: existing.subject_type,
      subject_ref: existing.subject_ref,
      capability_key: existing.capability_key,
      mode: existing.mode,
    },
    afterJson: {
      lifted_at: lifted.lifted_at,
      lifted_by: liftedBy,
      lift_reason: reason,
    },
    riskTier: 'HIGH',
    ip,
    userAgent,
    traceId,
  });

  if (existing.subject_type === 'USER' && /^\d+$/.test(String(existing.subject_ref))) {
    await rbacService.invalidateUserPermissionCache(cache, Number(existing.subject_ref));
  } else {
    await rbacService.bumpGlobalPermissionVersion(cache);
  }

  return lifted;
}

export async function getUserRestrictions(db, userId, userRef = null) {
  return permRepo.listRestrictionsForUser(db, userId, userRef);
}

export async function listAllRestrictions(db, filter) {
  return permRepo.listAllRestrictions(db, filter);
}

/**
 * Checks whether a requested numeric value exceeds a user's active numeric limit restriction.
 *
 * @param {object} db - Database client
 * @param {number} userId - Target user ID
 * @param {string} limitKey - e.g. 'max_cod_order_value', 'max_withdrawal_per_day'
 * @param {number} requestedValue - The attempted value (e.g. order amount or withdrawal amount)
 * @throws {AppError} if limit is exceeded
 */
export async function checkNumericLimit(db, userId, limitKey, requestedValue) {
  const user = await permRepo.getUserProfileAndTrust(db, userId);
  if (!user) return;

  const directRestrictions = await permRepo.getDirectUserRestrictions(db, userId, user.ref, limitKey);
  const segmentRestrictions = await permRepo.getActiveSegmentRestrictions(db, limitKey);

  const roles = await permRepo.getRolesForUser(db, userId);
  const userContext = {
    userId,
    userRef: user.ref,
    status: user.status,
    district: user.district,
    division: user.division,
    tier: user.tier || 'STARTER',
    trust_score: user.trust_score !== null ? Number(user.trust_score) : 50,
    roles: roles.map((r) => r.key),
  };

  const matchingSegmentRestrictions = segmentRestrictions.filter((r) =>
    evaluatePredicate(r.segment_predicate, userContext)
  );

  const allRestrictions = [...directRestrictions, ...matchingSegmentRestrictions];

  for (const r of allRestrictions) {
    if (r.limit_value !== null && r.limit_value !== undefined) {
      if (Number(requestedValue) > Number(r.limit_value)) {
        const msgEn = r.reason || `Requested value (৳${requestedValue}) exceeds your current limit of ৳${r.limit_value}.`;
        const msgBn = r.reason_bn || `অনুরোধকৃত পরিমাণ (৳${requestedValue}) আপনার নির্ধারিত সীমা ৳${r.limit_value} অতিক্রম করেছে।`;

        throw new AppError('USER_RESTRICTED', msgEn, msgBn, {
          limit_key: limitKey,
          limit_value: Number(r.limit_value),
          requested_value: Number(requestedValue),
          restriction_id: r.id,
        });
      }
    }
  }
}

/* ========================================================================= */
/* Register the Maker-Checker Executor for Restriction Management            */
/* ========================================================================= */
/*
 * Every route in restriction.routes.js that mutates (apply/update/lift) is gated by the single
 * real catalog permission `users.restriction.manage` (HIGH tier) — there is no
 * `users.restriction.apply`/`users.restriction.lift` permission, so registering executors under
 * those names left this completely unreachable: requirePermission.js always creates the pending
 * action under action_key='users.restriction.manage', and approving it found no executor and
 * silently marked the action APPLIED without ever touching user_restrictions.
 *
 * Since apply/update/lift share one action_key, this one executor tells them apart via
 * `context.targetType`, set per-route in restriction.routes.js's requirePermission(...) options.
 */
registerActionExecutor('users.restriction.manage', {
  async validatePreconditions(payload, context) {
    if (context.targetType === 'user_restriction_apply') {
      if (!payload.subject_type || !payload.subject_ref || !payload.capability_key || !payload.mode || !payload.reason) {
        throw new Error('Missing required restriction payload parameters.');
      }
      return;
    }

    // update / lift both target an existing restriction, identified by target_ref (the :id
    // route param), not by anything in the payload.
    const existing = await permRepo.getUserRestrictionById(context.db, Number(context.targetRef));
    if (!existing || existing.lifted_at) {
      throw new Error('Restriction does not exist or has already been lifted.');
    }
  },

  async execute(payload, context) {
    if (context.targetType === 'user_restriction_apply') {
      return applyRestriction(context.db, context.cache, {
        subjectType: payload.subject_type,
        subjectRef: payload.subject_ref,
        segmentPredicate: payload.segment_predicate ?? null,
        capabilityKey: payload.capability_key,
        mode: payload.mode,
        limitValue: payload.limit_value ?? null,
        reason: payload.reason,
        reasonBn: payload.reason_bn ?? null,
        evidenceJson: payload.evidence_json ?? null,
        appliedBy: context.actorId,
        expiresAt: payload.expires_at ?? null,
        ip: context.ip,
        userAgent: context.userAgent,
        traceId: context.traceId,
      });
    }

    if (context.targetType === 'user_restriction_update') {
      return updateRestriction(context.db, context.cache, {
        restrictionId: Number(context.targetRef),
        mode: payload.mode ?? null,
        limitValue: payload.limit_value ?? null,
        reason: payload.reason ?? null,
        reasonBn: payload.reason_bn ?? null,
        evidenceJson: payload.evidence_json ?? null,
        expiresAt: payload.expires_at ?? null,
        updatedBy: context.actorId,
        ip: context.ip,
        userAgent: context.userAgent,
        traceId: context.traceId,
      });
    }

    if (context.targetType === 'user_restriction_lift') {
      return liftRestriction(context.db, context.cache, {
        restrictionId: Number(context.targetRef),
        liftedBy: context.actorId,
        reason: payload.reason,
        ip: context.ip,
        userAgent: context.userAgent,
        traceId: context.traceId,
      });
    }

    throw new Error(`Unrecognised targetType "${context.targetType}" for users.restriction.manage`);
  },
});
