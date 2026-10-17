/**
 * adPushBlast.job.ts — sends the Push Notification Blast ads that have been bought (see
 * services/adPushBlast.service.ts for the delivery and refund rules).
 *
 * WHY no moduleKey: the service stops SENDING while `sponsored_ads` is off but must still SETTLE, so a
 * switched-off module never strands an advertiser's refund. The scheduler's module gate would skip both.
 */

import { runPushBlastSweep } from '../services/adPushBlast.service.ts';
import { registerJob } from './scheduler.ts';

export async function runAdPushBlastJob(db, cache, logger = console) {
  const log = logger.info?.bind(logger) || logger.log?.bind(logger) || console.log;

  const result = await runPushBlastSweep(db, cache);
  if (result.sent > 0 || result.settled.length > 0) {
    log(`[adPushBlast] Sent ${result.sent} pushes (${result.failed} failed), settled ${result.settled.length} campaigns.`);
  }

  return {
    processedCount: result.sent + result.failed,
    successCount: result.sent,
    errorCount: result.failed,
    errors: [],
    metadata: { campaigns: result.campaigns, settled: result.settled },
  };
}

registerJob({
  name: 'ad_push_blast',
  intervalMs: 5 * 60 * 1000,
  handler: runAdPushBlastJob,
});
