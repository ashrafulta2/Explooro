/**
 * teamPurchaseExpiry.job.ts — Periodic Team Purchase Expiry & Automatic Refund Worker (Prompt 9.5).
 *
 * Implements:
 * - Scans expired incomplete teams (expires_at <= now() AND status = 'ACTIVE')
 * - Automatically executes 100% refunds for all held member authorizations
 * - Releases reserved inventory back to catalog stock
 * - Registered with the scheduler every 5 minutes, NOT gated on the 'group_buying' module (see below)
 */

import * as teamPurchaseService from '../services/teamPurchase.service.ts';
import { registerJob } from './scheduler.ts';

export async function runTeamPurchaseExpirySweep(db, cache, logger = console) {
  const log = logger.info?.bind(logger) || logger.log?.bind(logger) || console.log;

  const result = await teamPurchaseService.expireIncompleteTeams(db, cache);
  if (result.expiredCount > 0) {
    log(`[teamPurchaseExpiry] Expired ${result.expiredCount} incomplete teams and refunded ${result.refundedCount} member holds.`);
  }

  return {
    processedCount: result.expiredCount,
    successCount: result.expiredCount,
    errorCount: 0,
    errors: [],
    metadata: {
      expiredTeams: result.expiredCount,
      refundedHolds: result.refundedCount,
    },
  };
}

// WHY intervalMs: the scheduler has no cron syntax; this job passed `cron` and so ran on the 1-hour
// default, leaving an expired team's member holds unrefunded for up to an hour.
// WHY no moduleKey: switching team purchase off must not strand money. Teams already running still
// expire and their holds are still refunded.
registerJob({
  name: 'team_purchase_expiry',
  intervalMs: 5 * 60 * 1000,
  handler: runTeamPurchaseExpirySweep,
});
