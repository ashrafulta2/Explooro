/**
 * teamPurchaseExpiry.job.js — Periodic Team Purchase Expiry & Automatic Refund Worker (Prompt 9.5).
 *
 * Implements:
 * - Scans expired incomplete teams (expires_at <= now() AND status = 'ACTIVE')
 * - Automatically executes 100% refunds for all held member authorizations
 * - Releases reserved inventory back to catalog stock
 * - Registers job with scheduler under module 'group_buying'
 */

import * as teamPurchaseService from '../services/teamPurchase.service.js';
import { registerJob } from './scheduler.js';

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

// Automatically register with distributed job scheduler
registerJob({
  name: 'team_purchase_expiry',
  module: 'group_buying',
  cron: '*/5 * * * *', // Every 5 minutes
  handler: runTeamPurchaseExpirySweep,
});
