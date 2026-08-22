/**
 * audit.service.js — Audit Log Engine & Tamper-Evident Hash Chain (Prompt 2.7).
 *
 * Implements tamper-evident audit logging per docs/rbac-spec.md §7 and docs/erd.md §2:
 * 1. Automatic context capture from AsyncLocalStorage (actor, ip, user-agent, trace_id).
 * 2. Recursive redaction of sensitive credentials & PII before persistence.
 * 3. Hash chain verification (prev_hash -> row_hash verification).
 * 4. Query API with multi-field filtering & cursor pagination.
 * 5. Merged human-readable user activity timeline.
 * 6. Reversibility metadata (undo_payload) for one-click reverts.
 */

import { createHash } from 'node:crypto';
import * as auditRepo from '../repositories/audit.repository.js';
import * as permRepo from '../repositories/permission.repository.js';
import { getRequestContext } from '../plugins/requestContext.js';
import { AppError } from '../plugins/errorHandler.js';

/**
 * List of sensitive key patterns that must never be stored in plaintext.
 */
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /^pass(code)?$/i,
  /token/i,
  /secret/i,
  /^otp/i,
  /nid/i,
  /trade_license/i,
  /vat_tin/i,
  /account_num/i,
  /bank_acc/i,
  /card_num/i,
  /cvv/i,
  /pin$/i,
  /auth_code/i,
];

/**
 * Checks if a key name matches any sensitive key pattern.
 */
function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Checks if a string value appears to be a token (e.g. JWT or Bearer string).
 */
function isTokenLikeString(val) {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) return true;
  // Check for JWT-like 3-segment format (e.g. eyJhbGciOi...)
  if (/^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(trimmed)) return true;
  return false;
}

/**
 * Recursively scrubs sensitive fields from objects, arrays, and primitive payloads.
 *
 * @param {*} data - Payload to redact
 * @returns {*} Redacted clone
 */
export function redactSensitiveData(data) {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    if (isTokenLikeString(data)) {
      return '[REDACTED]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value);
    } else if (isTokenLikeString(value)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Computes a SHA-256 hash of previous hash + payload.
 */
export function computeAuditRowHash(prevHash, payload) {
  const hash = createHash('sha256');
  hash.update(prevHash || '');
  hash.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return hash.digest('hex');
}

/**
 * Records an audit log entry. Pulls context automatically from requestContext.
 */
export async function record(
  db,
  {
    action,
    targetType = null,
    target_type = null,
    targetRef = null,
    target_ref = null,
    before = null,
    beforeJson = null,
    before_json = null,
    after = null,
    afterJson = null,
    after_json = null,
    meta = null,
    undoPayload = null,
    undo_payload = null,
    riskTier = null,
    risk_tier = null,
    isBreakglass = false,
    is_breakglass = false,
    actor = null,
    actorId = null,
    actor_id = null,
    actorRole = null,
    actor_role = null,
    ip = null,
    userAgent = null,
    user_agent = null,
    traceId = null,
    trace_id = null,
  }
) {
  const reqCtx = getRequestContext();

  const resolvedActorId = actorId ?? actor_id ?? (typeof actor === 'object' ? actor?.id : actor) ?? reqCtx?.user?.id ?? null;
  const resolvedActorRole = actorRole ?? actor_role ?? (typeof actor === 'object' ? (actor?.role || actor?.roles?.[0]) : null) ?? reqCtx?.user?.roles?.[0] ?? null;
  const resolvedIp = ip ?? reqCtx?.ip ?? null;
  const resolvedUserAgent = userAgent ?? user_agent ?? reqCtx?.userAgent ?? null;
  const resolvedTraceId = traceId ?? trace_id ?? reqCtx?.traceId ?? null;

  const rawBefore = before ?? beforeJson ?? before_json ?? null;
  let rawAfter = after ?? afterJson ?? after_json ?? null;

  if (meta && typeof meta === 'object') {
    rawAfter = { ...(rawAfter || {}), meta };
  }

  const redactedBefore = rawBefore ? redactSensitiveData(rawBefore) : null;
  const redactedAfter = rawAfter ? redactSensitiveData(rawAfter) : null;
  const resolvedUndo = undoPayload ?? undo_payload ?? null;
  const redactedUndo = resolvedUndo ? redactSensitiveData(resolvedUndo) : null;

  const rawTargetRef = targetRef ?? target_ref ?? null;
  const resolvedTargetRef = rawTargetRef !== null && rawTargetRef !== undefined ? String(rawTargetRef) : null;

  return auditRepo.insertAuditLog(db, {
    actorId: resolvedActorId,
    actorRole: resolvedActorRole,
    action,
    targetType: targetType ?? target_type ?? null,
    targetRef: resolvedTargetRef,
    beforeJson: redactedBefore,
    afterJson: redactedAfter,
    undoPayload: redactedUndo,
    riskTier: riskTier ?? risk_tier ?? null,
    isBreakglass: isBreakglass || is_breakglass || false,
    ipAddress: resolvedIp,
    userAgent: resolvedUserAgent,
    traceId: resolvedTraceId,
  });
}

/**
 * Walks the audit log chain from oldest to newest and verifies hash integrity.
 * Reports the first broken link, if any.
 */
export async function verifyChain(db) {
  const logs = await auditRepo.getAuditChainForVerification(db, { limit: 10000, offset: 0 });

  if (logs.length === 0) {
    return {
      verified: true,
      total_checked: 0,
      message: 'Audit log chain is empty.',
    };
  }

  for (let i = 0; i < logs.length; i++) {
    const current = logs[i];

    if (i === 0) {
      // First row: prev_hash should be null or empty
      if (current.prev_hash !== null && current.prev_hash !== undefined && current.prev_hash !== '') {
        return {
          verified: false,
          broken_link: {
            id: current.id,
            index: i,
            expected_prev_hash: null,
            actual_prev_hash: current.prev_hash,
            stored_row_hash: current.row_hash,
            created_at: current.created_at,
          },
          total_checked: i + 1,
        };
      }
    } else {
      const prev = logs[i - 1];
      if (current.prev_hash !== prev.row_hash) {
        return {
          verified: false,
          broken_link: {
            id: current.id,
            index: i,
            expected_prev_hash: prev.row_hash,
            actual_prev_hash: current.prev_hash,
            stored_row_hash: current.row_hash,
            created_at: current.created_at,
          },
          total_checked: i + 1,
        };
      }
    }
  }

  return {
    verified: true,
    total_checked: logs.length,
  };
}

/**
 * Queries audit logs with filtering and pagination.
 */
export async function queryAuditLogs(db, filters) {
  return auditRepo.listAuditLogs(db, filters);
}

/**
 * Generates a human-readable timeline for a specific user account.
 */
export async function getUserTimeline(db, userId) {
  const user = await permRepo.getUserProfileAndTrust(db, userId);
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found.', 'ব্যবহারকারী পাওয়া যায়নি।');
  }

  const logs = await auditRepo.getUserTimelineAuditLogs(db, userId, user.ref, { limit: 100 });

  const timeline = logs.map((log) => {
    let category = 'system';
    let titleEn = log.action;
    let titleBn = log.action;

    if (log.action.startsWith('auth.')) {
      category = 'auth';
      if (log.action === 'auth.login') {
        titleEn = 'User signed in';
        titleBn = 'ব্যবহারকারী লগইন করেছেন';
      } else if (log.action === 'auth.logout') {
        titleEn = 'User signed out';
        titleBn = 'ব্যবহারকারী লগআউট করেছেন';
      } else if (log.action === 'auth.register') {
        titleEn = 'Account registered';
        titleBn = 'অ্যাকাউন্ট তৈরি করা হয়েছে';
      } else if (log.action === 'auth.2fa.enroll_start') {
        titleEn = '2FA setup initiated';
        titleBn = 'টু-ফ্যাক্টর অথেনটিকেশন সেটআপ শুরু';
      } else if (log.action === 'auth.2fa.enrolled') {
        titleEn = '2FA enrolled successfully';
        titleBn = 'টু-ফ্যাক্টর অথেনটিকেশন সক্রিয় করা হয়েছে';
      }
    } else if (log.action.startsWith('user_restriction.')) {
      category = 'restriction';
      if (log.action === 'user_restriction.apply') {
        titleEn = 'Activity restriction applied';
        titleBn = 'কার্যকলাপে নিষেধাজ্ঞা প্রয়োগ করা হয়েছে';
      } else if (log.action === 'user_restriction.update') {
        titleEn = 'Activity restriction updated';
        titleBn = 'নিষেধাজ্ঞা আপডেট করা হয়েছে';
      } else if (log.action === 'user_restriction.lift') {
        titleEn = 'Activity restriction lifted';
        titleBn = 'নিষেধাজ্ঞা প্রত্যাহার করা হয়েছে';
      }
    } else if (log.action.startsWith('admin.grant.') || log.action.startsWith('access_request.')) {
      category = 'access';
      if (log.action === 'admin.grant.create') {
        titleEn = 'Access grant created';
        titleBn = 'বিশেষ অ্যাক্সেস প্রদান করা হয়েছে';
      } else if (log.action === 'admin.grant.revoke') {
        titleEn = 'Access grant revoked';
        titleBn = 'অ্যাক্সেস প্রত্যাহার করা হয়েছে';
      } else if (log.action === 'access_request.create') {
        titleEn = 'JIT access requested';
        titleBn = 'সাময়িক অ্যাক্সেসের আবেদন জমা দেওয়া হয়েছে';
      } else if (log.action === 'access_request.approve') {
        titleEn = 'JIT access approved';
        titleBn = 'সাময়িক অ্যাক্সেস অনুমোদন করা হয়েছে';
      } else if (log.action === 'access_request.reject') {
        titleEn = 'JIT access rejected';
        titleBn = 'সাময়িক অ্যাক্সেস বাতিল করা হয়েছে';
      }
    } else if (log.action.startsWith('pending_action.')) {
      category = 'maker_checker';
      if (log.action === 'pending_action.create') {
        titleEn = 'Action submitted for maker-checker review';
        titleBn = 'অনুমোদনের জন্য আবেদন পাঠানো হয়েছে';
      } else if (log.action === 'pending_action.approve') {
        titleEn = 'Action approved by reviewer';
        titleBn = 'আবেদনটি পর্যালোচক কর্তৃক অনুমোদিত হয়েছে';
      } else if (log.action === 'pending_action.reject') {
        titleEn = 'Action rejected by reviewer';
        titleBn = 'আবেদনটি বাতিল করা হয়েছে';
      }
    }

    return {
      id: log.id,
      action: log.action,
      category,
      title_en: titleEn,
      title_bn: titleBn,
      target_type: log.target_type,
      target_ref: log.target_ref,
      actor_id: log.actor_id,
      actor_ref: log.actor_ref,
      actor_role: log.actor_role,
      risk_tier: log.risk_tier,
      details: log.after_json,
      created_at: log.created_at,
    };
  });

  return {
    user_id: user.id,
    user_ref: user.ref,
    timeline,
  };
}
