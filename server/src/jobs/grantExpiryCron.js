/**
 * grantExpiryCron.js — Background job expiring overdue grants, JIT windows & pending actions (Prompt 2.5).
 *
 * Runs periodically (default every 5 minutes) per docs/rbac-spec.md §3:
 * - Expired standing grants stop granting access immediately (version cache bumped).
 * - Expired JIT windows close automatically and are marked 'EXPIRED'.
 * - Expired pending admin actions are marked 'EXPIRED' and discarded.
 * - Writes audit log entries for all closed windows/actions.
 */

import * as permRepo from '../repositories/permission.repository.js';
import * as rbacService from '../services/rbac.service.js';
import { writeAudit } from '../lib/audit.js';

export async function runGrantExpiryJob(db, cache, logger = console) {
  const log = logger.info?.bind(logger) || logger.log?.bind(logger) || console.log;
  const affectedUserIds = new Set();

  // 1. Expire JIT windows
  const expiredJitRows = await permRepo.expireOverdueJitRequests(db);
  for (const row of expiredJitRows) {
    affectedUserIds.add(row.requester_id);
    await writeAudit(db, {
      action: 'access_request.expire',
      targetType: 'permission_grant_request',
      targetRef: row.ref,
      afterJson: { status: 'EXPIRED', permission_key: row.permission_key },
      riskTier: 'MEDIUM',
    });
  }

  // 2. Expire Pending Admin Actions
  const expiredActions = await permRepo.expireOverduePendingActions(db);
  for (const row of expiredActions) {
    affectedUserIds.add(row.actor_id);
    await writeAudit(db, {
      action: 'pending_action.expire',
      targetType: 'pending_admin_action',
      targetRef: row.ref,
      afterJson: { status: 'EXPIRED', action_key: row.action_key },
      riskTier: 'HIGH',
    });
  }

  // 3. Check for overdue standing grants
  const overdueGrants = await permRepo.findOverdueGrantOverrides(db);
  for (const grant of overdueGrants) {
    affectedUserIds.add(grant.user_id);
    // docs/rbac-spec.md §3.1: "Grant, revoke, and expiry each write an audit row" — expiry needs
    // no DB write of its own (an unrevoked-but-past-expiry grant is already excluded by every
    // active-overrides query), but the audit trail still needs a record that it lapsed.
    await writeAudit(db, {
      action: 'admin.grant.expire',
      targetType: 'user_permission_override',
      targetRef: String(grant.id),
      afterJson: { status: 'EXPIRED', permission_key: grant.permission_key, user_id: grant.user_id },
      riskTier: 'HIGH',
    });
  }

  // 4. Invalidate cache versions for all affected users
  if (cache) {
    for (const userId of affectedUserIds) {
      await rbacService.invalidateUserPermissionCache(cache, userId);
    }
  }

  const summary = {
    expiredJitCount: expiredJitRows.length,
    expiredPendingActionsCount: expiredActions.length,
    overdueGrantsCount: overdueGrants.length,
    invalidatedUsersCount: affectedUserIds.size,
  };

  if (summary.expiredJitCount > 0 || summary.expiredPendingActionsCount > 0 || summary.overdueGrantsCount > 0) {
    log('[grantExpiryCron] Swept expired access items:', summary);
  }

  return summary;
}

export function startGrantExpiryScheduler(db, cache, logger = console, intervalMs = 300000) {
  const timer = setInterval(() => {
    runGrantExpiryJob(db, cache, logger).catch((err) => {
      const errLog = logger.error?.bind(logger) || console.error;
      errLog('[grantExpiryCron] Error during sweep:', err);
    });
  }, intervalMs);

  timer.unref?.();

  return () => clearInterval(timer);
}
