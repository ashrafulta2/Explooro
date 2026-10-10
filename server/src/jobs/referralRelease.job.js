/**
 * referralRelease.job.js — pays out referral commissions whose holding period has ended.
 *
 * The rule lives in referralEscrow.service.js `releaseDueEarnings`; this file only schedules it. Gated
 * on the referral_engine module, so with the programme switched off held commissions stay held.
 */

import { releaseDueEarnings } from '../services/referralEscrow.service.js';
import { registerJob } from './scheduler.js';

export async function runReferralRelease(db, cache, logger = console) {
  const result = await releaseDueEarnings(db);
  logger.info?.(`[referralRelease] released ${result.released} of ${result.scanned} due commissions (৳${result.totalReleased}).`);
  if (result.batchFull) logger.warn?.('[referralRelease] batch was full — more commissions remain for the next run.');
  return {
    processedCount: result.scanned,
    successCount: result.released,
    errorCount: result.errors.length,
    errors: result.errors,
    metadata: { totalReleased: result.totalReleased, batchFull: result.batchFull },
  };
}

// WHY hourly: the holding period is counted in days, but an hourly run keeps the delay between
// "eligible" and "spendable" short without a per-earning timer.
registerJob({
  name: 'referral_release',
  intervalMs: 3600000,
  moduleKey: 'referral_engine',
  handler: runReferralRelease,
});
