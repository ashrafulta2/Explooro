/**
 * requireRestriction.js — Granular per-user activity restriction middleware (Prompt 2.4 / 2.6).
 *
 * Enforces user and segment restrictions per docs/rbac-spec.md §5:
 * - BLOCK: 403 USER_RESTRICTED with reason in user's language.
 * - THROTTLE: Rate limits capability to limit_value; throws 429 RATE_LIMITED when exceeded.
 * - FORCE_REVIEW_QUEUE: Allows request, tags req.forceReviewQueue = true for moderation.
 * - SHADOW_BAN: Allows request, tags req.shadowBanned = true for suppressed visibility.
 */

import * as rbacService from '../services/rbac.service.js';
import { AppError } from '../plugins/errorHandler.js';

const THROTTLE_WINDOW_SECONDS = 86400; // 24 hours default limit window

export function requireRestriction(capabilityKey) {
  return async function requireRestrictionHandler(req) {
    if (!req.user) {
      throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
    }

    const { db, cache } = req.server;
    const restriction = await rbacService.evaluateRestrictionsForCapability(db, req.user.id, capabilityKey);

    if (!restriction) {
      return;
    }

    req.restriction = restriction;

    switch (restriction.mode) {
      case 'BLOCK':
        throw new AppError(
          'USER_RESTRICTED',
          restriction.reason,
          restriction.reason_bn || restriction.reason,
          {
            capability: capabilityKey,
            restriction_id: restriction.id,
            mode: 'BLOCK',
          }
        );

      case 'THROTTLE': {
        const limit = Number(restriction.limit_value);
        if (Number.isFinite(limit) && limit > 0 && cache) {
          const throttleKey = `throttle:${capabilityKey}:${req.user.id}`;
          const current = await cache.incr(throttleKey);

          if (current === 1) {
            await cache.expire(throttleKey, THROTTLE_WINDOW_SECONDS);
          }

          if (current > limit) {
            const ttlMs = await cache.ttl(throttleKey);
            const retryAfterS = ttlMs > 0 ? Math.ceil(ttlMs / 1000) : THROTTLE_WINDOW_SECONDS;

            throw new AppError(
              'RATE_LIMITED',
              `You have exceeded your limit of ${limit} for ${capabilityKey}. Please try again later.`,
              `আপনি ${capabilityKey} এর জন্য আপনার ${limit} এর সীমা অতিক্রম করেছেন। অনুগ্রহ করে পরে আবার চেষ্টা করুন।`,
              {
                capability: capabilityKey,
                limit,
                current,
                retry_after_s: retryAfterS,
              }
            );
          }
        }
        break;
      }

      case 'FORCE_REVIEW_QUEUE':
        req.forceReviewQueue = true;
        break;

      case 'SHADOW_BAN':
        req.shadowBanned = true;
        break;

      default:
        break;
    }
  };
}

export default function requireRestrictionPlugin(app) {
  app.decorate('requireRestriction', requireRestriction);
}

requireRestrictionPlugin[Symbol.for('skip-override')] = true;
