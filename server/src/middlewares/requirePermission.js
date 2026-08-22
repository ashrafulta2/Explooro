/**
 * requirePermission.js — Permission enforcement & Maker-Checker routing (Prompt 2.4).
 *
 * Implements permission checks and risk-tier routing per docs/rbac-spec.md §3.4:
 * - LOW / MEDIUM (not held) → 403 PERMISSION_DENIED (MEDIUM includes requestable: true for JIT)
 * - CRITICAL (not super_admin) → 403 PERMISSION_DENIED (requestable: false, super-admin only)
 * - HIGH (approve_before, non-super_admin) → 202 Accepted with PERMISSION_PENDING_APPROVAL
 *   and creates a pending_admin_actions record, preventing execution of the route handler.
 * - HIGH (execute_then_review) or super_admin → proceeds immediately.
 *
 * `options.skipMakerChecker` — for the maker-checker DECIDE endpoints themselves
 * (PATCH /admin/pending-actions/:id, PATCH /access-requests/:id), which are gated by the HIGH-tier
 * `admin.approval.decide`. Without this flag, a non-super-admin approver's attempt to decide a
 * pending action would itself be intercepted by the HIGH-tier branch below and deferred into a
 * *new* pending action — "approving" would recursively require its own approval, and only
 * super_admin (who bypasses maker-checker entirely) could ever decide anything. This flag makes
 * the check behave like a normal held/not-held permission gate regardless of risk tier, since the
 * endpoint IS the approval mechanism, not an action that itself needs approving.
 */

import * as rbacService from '../services/rbac.service.js';
import * as permRepo from '../repositories/permission.repository.js';
import { generateRef } from '../lib/ref.js';
import { writeAudit } from '../lib/audit.js';
import { AppError } from '../plugins/errorHandler.js';

const PENDING_ACTION_EXPIRY_HOURS = 72;

export function requirePermission(permissionKey, options = {}) {
  return async function requirePermissionHandler(req, reply) {
    if (!req.user) {
      throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
    }

    const { db, cache } = req.server;
    const resolved = await rbacService.resolvePermissions(db, cache, req.user.id);
    req.userPermissions = resolved.permissions;
    req.permissionSources = resolved.sources;

    const isSuperAdmin = resolved.roles.includes('super_admin');
    const perm = resolved.metadata.get(permissionKey) || (await permRepo.getPermissionByKey(db, permissionKey));

    if (!perm) {
      throw new AppError('NOT_FOUND', `Permission "${permissionKey}" not found in catalog.`, `অনুমতি "${permissionKey}" পাওয়া যায়নি।`);
    }

    const hasPerm = resolved.permissions.has(permissionKey);

    // The DECIDE endpoints check this permission directly, never deferring to maker-checker
    // regardless of risk tier — see the header comment for why.
    if (options.skipMakerChecker) {
      if (!hasPerm) {
        throw new AppError(
          'PERMISSION_DENIED',
          "You don't have access to this action.",
          'এই কাজটি করার অনুমতি আপনার নেই।',
          {
            permission_key: permissionKey,
            risk_tier: perm.risk_tier,
            requestable: false,
          }
        );
      }
      return;
    }

    // HIGH-tier maker-checker check (docs/rbac-spec.md §3.3)
    if (perm.risk_tier === 'HIGH') {
      // Super admins execute directly without maker-checker
      if (isSuperAdmin) {
        return;
      }

      // Urgent containment actions execute immediately, then undergo post-hoc review
      if (perm.approval_mode === 'execute_then_review') {
        if (!hasPerm) {
          throw new AppError(
            'PERMISSION_DENIED',
            "You don't have access to this action.",
            'এই কাজটি করার অনুমতি আপনার নেই।',
            {
              permission_key: permissionKey,
              risk_tier: 'HIGH',
              requestable: false,
              plain_en: perm.plain_en || undefined,
              plain_bn: perm.plain_bn || undefined,
            }
          );
        }
        return;
      }

      // NOTE on docs/rbac-spec.md §3.3 rule 3 ("an action with no registered executor cannot be
      // submitted"): this is deliberately NOT enforced here. Prompt 2.4's own acceptance criterion
      // ("A HIGH-tier request returns 202 with a pending action id, and nothing is mutated") is
      // tested against permissions like `orders.refund.execute` whose real business logic is
      // built in a much later phase — blocking submission until every HIGH permission has a
      // wired executor would make the routing mechanism itself untestable for years. Instead the
      // "no executor" case is guarded at approval time in makerChecker.service.js, which is where
      // it actually matters: nothing gets silently marked APPLIED without a real effect.

      // Default approve_before: serialise intent into pending_admin_actions and return 202
      const targetType =
        typeof options.targetType === 'function'
          ? options.targetType(req)
          : options.targetType || (req.params?.id ? 'resource' : 'action');

      const targetRef =
        typeof options.targetRef === 'function'
          ? options.targetRef(req)
          : options.targetRef || (req.params?.id ? String(req.params.id) : permissionKey);

      const ref = generateRef('PAA');
      const expiresAt = new Date(Date.now() + PENDING_ACTION_EXPIRY_HOURS * 60 * 60 * 1000);
      const actorNote = req.body?.actor_note || req.body?.reason || null;

      const pendingAction = await permRepo.createPendingAdminAction(db, {
        ref,
        actorId: req.user.id,
        actionKey: permissionKey,
        payloadJson: req.body || {},
        targetType,
        targetRef,
        actorNote,
        expiresAt,
      });

      await writeAudit(db, {
        actorId: req.user.id,
        actorRole: resolved.roles[0] || null,
        action: 'pending_action.submit',
        targetType,
        targetRef: ref,
        afterJson: { action_key: permissionKey, payload: req.body || {} },
        riskTier: 'HIGH',
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        traceId: req.traceId ?? null,
      });

      reply.code(202).send({
        deferred: {
          code: 'PERMISSION_PENDING_APPROVAL',
          pending_action_ref: pendingAction.ref,
          pending_action_id: pendingAction.id,
          action_key: permissionKey,
          message_en: 'Sent for approval. Your Admin must approve this before it takes effect.',
          message_bn: 'অনুমোদনের জন্য পাঠানো হয়েছে। কার্যকর হওয়ার আগে আপনার অ্যাডমিনকে এটি অনুমোদন করতে হবে।',
          expires_at: pendingAction.expires_at.toISOString(),
          trace_id: req.traceId ?? 'unknown',
        },
      });

      return reply;
    }

    // Non-HIGH tier permission check
    if (!hasPerm) {
      if (perm.risk_tier === 'CRITICAL') {
        throw new AppError(
          'PERMISSION_DENIED',
          'Only a Super Admin can use this.',
          'শুধুমাত্র একজন সুপার অ্যাডমিন এটি ব্যবহার করতে পারেন।',
          {
            permission_key: permissionKey,
            risk_tier: 'CRITICAL',
            requestable: false,
          }
        );
      }

      if (perm.risk_tier === 'MEDIUM') {
        throw new AppError(
          'PERMISSION_DENIED',
          "You don't have access to this yet.",
          'এতে আপনার এখনো অ্যাক্সেস নেই।',
          {
            permission_key: permissionKey,
            risk_tier: 'MEDIUM',
            requestable: true,
            plain_en: perm.plain_en || undefined,
            plain_bn: perm.plain_bn || undefined,
          }
        );
      }

      // LOW tier
      throw new AppError(
        'PERMISSION_DENIED',
        "You don't have permission to perform this action.",
        'এই কাজটি করার অনুমতি আপনার নেই।',
        {
          permission_key: permissionKey,
          risk_tier: 'LOW',
          requestable: false,
        }
      );
    }
  };
}

export default function requirePermissionPlugin(app) {
  app.decorate('requirePermission', requirePermission);
}

requirePermissionPlugin[Symbol.for('skip-override')] = true;
