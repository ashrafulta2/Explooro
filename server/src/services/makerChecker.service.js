/**
 * makerChecker.service.js — Maker-Checker Engine & Executor Registry (Mode C) (Prompt 2.5).
 *
 * Implements Mode C delegation per docs/rbac-spec.md §3.3:
 *
 * Invariants:
 * 1. Hard rule: No self-approval (approver_id must not equal actor_id).
 * 2. Preconditions are re-validated live at approval time, never trusted from captured payload.
 * 3. Atomic execution inside a database transaction: pre-check → execute → mark APPLIED.
 * 4. Audit trail with full before/after JSON on submission, approval, rejection, and failure.
 */

import * as permRepo from '../repositories/permission.repository.js';
import * as rbacService from './rbac.service.js';
import { withTransaction } from '../config/db.js';
import { writeAudit } from '../lib/audit.js';
import { AppError } from '../plugins/errorHandler.js';

// Action executor registry: action_key -> { validatePreconditions, execute }
const executorRegistry = new Map();

/**
 * Registers an executor for a HIGH-tier action key.
 * @param {string} actionKey - e.g. 'orders.refund.execute'
 * @param {{ validatePreconditions?: Function, execute: Function }} executor
 */
export function registerActionExecutor(actionKey, executor) {
  if (!executor || typeof executor.execute !== 'function') {
    throw new Error(`Invalid executor registered for ${actionKey}: execute function required`);
  }
  executorRegistry.set(actionKey, executor);
}

export function getRegisteredExecutor(actionKey) {
  return executorRegistry.get(actionKey) ?? null;
}

export async function getPendingAction(db, idOrRef) {
  if (typeof idOrRef === 'number' || /^\d+$/.test(String(idOrRef))) {
    return permRepo.getPendingAdminActionById(db, Number(idOrRef));
  }
  return permRepo.getPendingAdminActionByRef(db, String(idOrRef));
}

export async function listPendingActions(db, filter) {
  return permRepo.listPendingAdminActions(db, filter);
}

/**
 * Decides a pending action (APPROVE or REJECT).
 * On APPROVE: re-validates preconditions and executes mutations inside a transaction.
 */
export async function decidePendingAction(
  db,
  cache,
  { actionId, decision, approverId, approverNote = null, ip, userAgent, traceId }
) {
  if (!['APPROVE', 'REJECT'].includes(decision)) {
    throw new AppError('VALIDATION_FAILED', 'Decision must be APPROVE or REJECT.', 'সিদ্ধান্ত APPROVE বা REJECT হতে হবে।');
  }

  const existing = await permRepo.getPendingAdminActionById(db, actionId);
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Pending admin action not found.', 'অপেক্ষমাণ কাজটি পাওয়া যায়নি।');
  }

  if (existing.status !== 'PENDING') {
    throw new AppError(
      'CONFLICT',
      `Action is no longer pending (current status: ${existing.status}).`,
      `কাজটি আর অপেক্ষমাণ অবস্থায় নেই (বর্তমান স্ট্যাটাস: ${existing.status})।`
    );
  }

  // Hard Rule 1: No self-approval (docs/rbac-spec.md §3.3)
  if (Number(approverId) === Number(existing.actor_id)) {
    throw new AppError(
      'SELF_APPROVAL_FORBIDDEN',
      'You cannot approve an action that you submitted.',
      'নিজের জমা দেওয়া কাজ নিজে অনুমোদন করতে পারবেন না।'
    );
  }

  // Handle REJECT path
  if (decision === 'REJECT') {
    const rejected = await permRepo.updatePendingActionDecision(db, actionId, {
      status: 'REJECTED',
      approverId,
      approverNote,
    });

    await writeAudit(db, {
      actorId: approverId,
      action: 'pending_action.reject',
      targetType: existing.target_type,
      targetRef: existing.ref,
      beforeJson: {
        status: existing.status,
        action_key: existing.action_key,
        actor_id: existing.actor_id,
      },
      afterJson: {
        status: 'REJECTED',
        approver_id: approverId,
        approver_note: approverNote,
      },
      riskTier: 'HIGH',
      ip,
      userAgent,
      traceId,
    });

    await rbacService.invalidateUserPermissionCache(cache, existing.actor_id);
    return rejected;
  }

  // Handle APPROVE path
  const executor = getRegisteredExecutor(existing.action_key);
  const payload = existing.payload_json || {};

  // Atomic execution inside a transaction
  return withTransaction(db, async (txClient) => {
    // 1. Lock the row to prevent race conditions
    const lockedAction = await permRepo.getPendingAdminActionById(txClient, actionId, true);
    if (!lockedAction || lockedAction.status !== 'PENDING') {
      throw new AppError('CONFLICT', 'Action was decided by another reviewer.', 'অন্য পর্যালোচক ইতিমধ্যে সিদ্ধান্ত নিয়েছেন।');
    }

    const context = {
      db: txClient,
      cache,
      actionId,
      actionRef: existing.ref,
      actionKey: existing.action_key,
      targetType: existing.target_type,
      targetRef: existing.target_ref,
      actorId: existing.actor_id,
      approverId,
      approverNote,
      ip,
      userAgent,
      traceId,
    };

    // docs/rbac-spec.md §3.3 rule 3: "An action with no registered executor cannot be submitted."
    // requirePermission.js is meant to enforce this at submission time, but this is a second,
    // independent check — the alternative (silently proceeding with executor?.execute as a no-op)
    // marks the action APPLIED with nothing having actually happened, which is worse than failing:
    // it tells both the actor and the approver that something succeeded when it did not.
    if (!executor) {
      const failureReason = `No executor registered for action_key "${existing.action_key}".`;
      await permRepo.updatePendingActionDecision(txClient, actionId, {
        status: 'FAILED',
        approverId,
        approverNote,
        failureReason,
      });

      await writeAudit(txClient, {
        actorId: approverId,
        action: 'pending_action.fail',
        targetType: existing.target_type,
        targetRef: existing.ref,
        afterJson: { status: 'FAILED', failure_reason: failureReason },
        riskTier: 'HIGH',
        ip,
        userAgent,
        traceId,
      });

      throw new AppError(
        'INTERNAL_ERROR',
        'This action cannot be applied yet — no executor is wired up for it.',
        'এই কাজটি এখনো কার্যকর করা সম্ভব নয় — এর জন্য কোনো এক্সিকিউটর যুক্ত নেই।',
        { failure_reason: failureReason }
      );
    }

    // 2. Preconditions RE-VALIDATED NOW (docs/rbac-spec.md §3.3 item 2)
    if (executor?.validatePreconditions) {
      try {
        await executor.validatePreconditions(payload, context);
      } catch (err) {
        const failureReason = err.message || 'Precondition validation failed at approval time';
        await permRepo.updatePendingActionDecision(txClient, actionId, {
          status: 'FAILED',
          approverId,
          approverNote,
          failureReason,
        });

        await writeAudit(txClient, {
          actorId: approverId,
          action: 'pending_action.fail',
          targetType: existing.target_type,
          targetRef: existing.ref,
          afterJson: { status: 'FAILED', failure_reason: failureReason },
          riskTier: 'HIGH',
          ip,
          userAgent,
          traceId,
        });

        if (err instanceof AppError) throw err;
        throw new AppError(
          'PRECONDITION_CHANGED',
          `Approval failed because conditions have changed: ${failureReason}`,
          `অনুমোদন ব্যর্থ হয়েছে কারণ শর্তাবলী পরিবর্তিত হয়েছে: ${failureReason}`,
          { failure_reason: failureReason }
        );
      }
    }

    // 3. Apply mutations via registered executor
    let executionResult = null;
    if (executor?.execute) {
      try {
        executionResult = await executor.execute(payload, context);
      } catch (err) {
        const failureReason = err.message || 'Execution error';
        await permRepo.updatePendingActionDecision(txClient, actionId, {
          status: 'FAILED',
          approverId,
          approverNote,
          failureReason,
        });

        await writeAudit(txClient, {
          actorId: approverId,
          action: 'pending_action.fail',
          targetType: existing.target_type,
          targetRef: existing.ref,
          afterJson: { status: 'FAILED', failure_reason: failureReason },
          riskTier: 'HIGH',
          ip,
          userAgent,
          traceId,
        });

        if (err instanceof AppError) throw err;
        throw new AppError(
          'INTERNAL_ERROR',
          'Action execution failed inside transaction.',
          'লেনদেনের মধ্যে কাজটি কার্যকর করা সম্ভব হয়নি।',
          { error: failureReason }
        );
      }
    }

    // 4. Mark status = APPLIED
    const applied = await permRepo.updatePendingActionDecision(txClient, actionId, {
      status: 'APPLIED',
      approverId,
      approverNote,
      appliedAt: new Date(),
    });

    // 5. Write audit log
    await writeAudit(txClient, {
      actorId: approverId,
      action: 'pending_action.approve',
      targetType: existing.target_type,
      targetRef: existing.ref,
      beforeJson: {
        status: existing.status,
        actor_id: existing.actor_id,
        action_key: existing.action_key,
        payload,
      },
      afterJson: {
        status: 'APPLIED',
        approver_id: approverId,
        approver_note: approverNote,
        execution_result: executionResult,
      },
      riskTier: 'HIGH',
      ip,
      userAgent,
      traceId,
    });

    // 6. Invalidate actor permission cache
    await rbacService.invalidateUserPermissionCache(cache, existing.actor_id);

    return {
      ...applied,
      result: executionResult,
    };
  });
}
