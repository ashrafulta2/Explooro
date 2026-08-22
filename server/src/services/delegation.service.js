/**
 * delegation.service.js — Standing Grants (Mode A) & JIT Access Requests (Mode B) (Prompt 2.5).
 *
 * Implements Mode A and Mode B delegation per docs/rbac-spec.md §3:
 * - Mode A: Standing Grants (max 90 days, min 10-char reason, no CRITICAL, audited, cache bumped).
 * - Mode B: JIT Access Requests (MEDIUM tier only, no self-grant, time-boxed window, audited, cache bumped).
 */

import * as permRepo from '../repositories/permission.repository.js';
import * as rbacService from './rbac.service.js';
import { generateRef } from '../lib/ref.js';
import { writeAudit } from '../lib/audit.js';
import { AppError } from '../plugins/errorHandler.js';

const MAX_GRANT_DAYS = 90;
const DEFAULT_JIT_WINDOW_MINUTES = 120;
const MAX_JIT_WINDOW_MINUTES = 480;

/* ========================================================================= */
/* MODE A: Standing Grants                                                  */
/* ========================================================================= */

export async function createStandingGrant(
  db,
  cache,
  {
    userId: rawUserId,
    user_id: rawUserId2,
    permissionKey: rawPermKey,
    permission_key: rawPermKey2,
    effect = 'GRANT',
    scopeJson = null,
    scope = null,
    reason,
    grantedBy,
    expiresAt: rawExpiresAt,
    expires_at: rawExpiresAt2,
    ip,
    userAgent,
    traceId,
  }
) {
  const userId = rawUserId ?? rawUserId2;
  const permissionKey = rawPermKey ?? rawPermKey2;
  const expiresAt = rawExpiresAt ?? rawExpiresAt2;
  const finalScopeJson = scopeJson ?? scope;
  if (!reason || reason.trim().length < 10) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Reason is mandatory and must be at least 10 characters.',
      'কারণ উল্লেখ করা বাধ্যতামূলক এবং অন্তত ১০ অক্ষরের হতে হবে।'
    );
  }

  if (!expiresAt) {
    throw new AppError('VALIDATION_FAILED', 'Expiry date is mandatory.', 'মেয়াদ উত্তীর্ণের তারিখ আবশ্যক।');
  }

  const expDate = new Date(expiresAt);
  const now = new Date();
  if (isNaN(expDate.getTime()) || expDate <= now) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Expiry date must be in the future.',
      'মেয়াদ উত্তীর্ণের তারিখ ভবিষ্যতের হতে হবে।'
    );
  }

  const maxDate = new Date(now.getTime() + MAX_GRANT_DAYS * 24 * 60 * 60 * 1000);
  if (expDate > maxDate) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Standing grants cannot exceed ${MAX_GRANT_DAYS} days.`,
      `অনুমোদনের মেয়াদ ${MAX_GRANT_DAYS} দিনের বেশি হতে পারবে না।`
    );
  }

  const perm = await permRepo.getPermissionByKey(db, permissionKey);
  if (!perm) {
    throw new AppError('NOT_FOUND', `Permission "${permissionKey}" not found.`, `অনুমতি "${permissionKey}" পাওয়া যায়নি।`);
  }

  if (perm.risk_tier === 'CRITICAL' && effect === 'GRANT') {
    throw new AppError(
      'PERMISSION_DENIED',
      'CRITICAL permissions cannot be granted via standing overrides.',
      'ক্রিটিক্যাল অনুমতি স্ট্যান্ডিং গ্র্যান্টের মাধ্যমে দেওয়া যায় না।'
    );
  }

  const grant = await permRepo.createGrantOverride(db, {
    userId,
    permissionKey,
    effect,
    scopeJson: finalScopeJson,
    reason,
    grantedBy,
    expiresAt: expDate,
  });

  await writeAudit(db, {
    actorId: grantedBy,
    action: effect === 'GRANT' ? 'admin.grant.create' : 'admin.deny.create',
    targetType: 'user_permission_override',
    targetRef: String(grant.id),
    afterJson: {
      user_id: userId,
      permission_key: permissionKey,
      effect,
      scope_json: finalScopeJson,
      expires_at: expDate.toISOString(),
      reason,
    },
    riskTier: perm.risk_tier,
    ip,
    userAgent,
    traceId,
  });

  await rbacService.invalidateUserPermissionCache(cache, userId);

  return grant;
}

export async function revokeStandingGrant(
  db,
  cache,
  { grantId, revokedBy, reason, ip, userAgent, traceId }
) {
  if (!reason || reason.trim().length < 10) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Reason is mandatory and must be at least 10 characters to revoke a grant.',
      'অনুমতি প্রত্যাহারের জন্য অন্তত ১০ অক্ষরের কারণ উল্লেখ করা বাধ্যতামূলক।'
    );
  }

  const existing = await permRepo.getGrantOverrideById(db, grantId);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Grant not found.', 'অনুমতি পাওয়া যায়নি।');
  }

  if (existing.revoked_at) {
    throw new AppError('CONFLICT', 'Grant is already revoked.', 'অনুমতিটি ইতিমধ্যে প্রত্যাহার করা হয়েছে।');
  }

  const revoked = await permRepo.revokeGrantOverride(db, grantId, {
    revokedBy,
    reason,
  });

  await writeAudit(db, {
    actorId: revokedBy,
    action: 'admin.grant.revoke',
    targetType: 'user_permission_override',
    targetRef: String(grantId),
    beforeJson: {
      id: existing.id,
      user_id: existing.user_id,
      permission_key: existing.permission_key,
      effect: existing.effect,
      expires_at: existing.expires_at,
    },
    afterJson: {
      revoked_at: revoked.revoked_at,
      revoked_by: revokedBy,
      reason,
    },
    riskTier: 'HIGH',
    ip,
    userAgent,
    traceId,
  });

  await rbacService.invalidateUserPermissionCache(cache, existing.user_id);

  return revoked;
}

export async function listStandingGrants(db, filter) {
  return permRepo.listGrantOverrides(db, filter);
}

/* ========================================================================= */
/* MODE B: Just-In-Time (JIT) Requests                                      */
/* ========================================================================= */

export async function createAccessRequest(
  db,
  { requesterId, permissionKey, targetScopeJson = null, reason, ip, userAgent, traceId }
) {
  if (!reason || reason.trim().length < 10) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Reason is mandatory and must be at least 10 characters.',
      'কারণ উল্লেখ করা বাধ্যতামূলক এবং অন্তত ১০ অক্ষরের হতে হবে।'
    );
  }

  const perm = await permRepo.getPermissionByKey(db, permissionKey);
  if (!perm) {
    throw new AppError('NOT_FOUND', `Permission "${permissionKey}" not found.`, `অনুমতি "${permissionKey}" পাওয়া যায়নি।`);
  }

  if (perm.risk_tier !== 'MEDIUM') {
    if (perm.risk_tier === 'CRITICAL') {
      throw new AppError(
        'PERMISSION_DENIED',
        'CRITICAL permissions are never requestable.',
        'ক্রিটিক্যাল অনুমতির জন্য আবেদন করা যায় না।'
      );
    }
    if (perm.risk_tier === 'HIGH') {
      throw new AppError(
        'PERMISSION_DENIED',
        'HIGH-tier permissions must go through Maker-Checker submission rather than JIT access requests.',
        'উচ্চ-ঝুঁকির কাজের জন্য সরাসরি মেকার-চেকার অনুমোদন ব্যবহার করুন।'
      );
    }
  }

  const ref = generateRef('PGR');

  const request = await permRepo.createAccessRequest(db, {
    ref,
    requesterId,
    permissionKey,
    targetScopeJson,
    reason,
  });

  await writeAudit(db, {
    actorId: requesterId,
    action: 'access_request.submit',
    targetType: 'permission_grant_request',
    targetRef: ref,
    afterJson: {
      permission_key: permissionKey,
      target_scope: targetScopeJson,
      reason,
    },
    riskTier: perm.risk_tier,
    ip,
    userAgent,
    traceId,
  });

  return request;
}

export async function decideAccessRequest(
  db,
  cache,
  { requestId, decision, approverId, approverNote = null, windowMinutes = DEFAULT_JIT_WINDOW_MINUTES, ip, userAgent, traceId }
) {
  if (!['APPROVE', 'REJECT'].includes(decision)) {
    throw new AppError('VALIDATION_FAILED', 'Decision must be APPROVE or REJECT.', 'সিদ্ধান্ত APPROVE বা REJECT হতে হবে।');
  }

  const request = await permRepo.getAccessRequestById(db, requestId);
  if (!request) {
    throw new AppError('NOT_FOUND', 'Access request not found.', 'অ্যাক্সেস আবেদন পাওয়া যায়নি।');
  }

  if (request.status !== 'PENDING') {
    throw new AppError(
      'CONFLICT',
      `Access request has already been decided (${request.status}).`,
      `আবেদনটি ইতিমধ্যে নিষ্পত্তি করা হয়েছে (${request.status})।`
    );
  }

  // Hard Rule: No self-approval (docs/rbac-spec.md §3.2)
  if (Number(approverId) === Number(request.requester_id)) {
    throw new AppError(
      'SELF_APPROVAL_FORBIDDEN',
      'You cannot approve your own access request.',
      'আপনি নিজের অ্যাক্সেস আবেদন নিজে অনুমোদন করতে পারবেন না।'
    );
  }

  let finalMinutes = null;
  let windowExpiresAt = null;
  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  if (decision === 'APPROVE') {
    const mins = Number(windowMinutes) || DEFAULT_JIT_WINDOW_MINUTES;
    finalMinutes = Math.min(Math.max(1, mins), MAX_JIT_WINDOW_MINUTES);
    windowExpiresAt = new Date(Date.now() + finalMinutes * 60 * 1000);
  }

  const updated = await permRepo.decideAccessRequest(db, requestId, {
    status,
    approverId,
    approverNote,
    windowMinutes: finalMinutes,
    windowExpiresAt,
  });

  await writeAudit(db, {
    actorId: approverId,
    action: decision === 'APPROVE' ? 'access_request.approve' : 'access_request.reject',
    targetType: 'permission_grant_request',
    targetRef: request.ref,
    beforeJson: {
      status: request.status,
      requester_id: request.requester_id,
      permission_key: request.permission_key,
    },
    afterJson: {
      status,
      approver_id: approverId,
      approver_note: approverNote,
      window_minutes: finalMinutes,
      window_expires_at: windowExpiresAt ? windowExpiresAt.toISOString() : null,
    },
    riskTier: request.risk_tier || 'MEDIUM',
    ip,
    userAgent,
    traceId,
  });

  // Invalidate requester's permission cache so the new window is active immediately
  await rbacService.invalidateUserPermissionCache(cache, request.requester_id);

  return updated;
}

export async function listAccessRequests(db, filter) {
  return permRepo.listAccessRequests(db, filter);
}

export async function getAccessRequest(db, idOrRef) {
  if (typeof idOrRef === 'number' || /^\d+$/.test(String(idOrRef))) {
    return permRepo.getAccessRequestById(db, Number(idOrRef));
  }
  return permRepo.getAccessRequestByRef(db, String(idOrRef));
}
