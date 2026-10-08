/**
 * sampleKit.job.js — refunds samples nobody shipped and releases samples nobody confirmed.
 *
 * Gated on the `sourcing` module by the scheduler: with it off, nobody can request a sample, and a
 * request already in flight is better settled by hand than by a job running behind a switched-off feature.
 */

import { settleDue } from '../services/sampleKit.service.js';
import { registerJob } from './scheduler.js';

export async function runSampleKit(db, cache, logger = console) {
  const r = await settleDue(db, logger);
  logger.info?.(`[sampleKit] ${r.expired} expired and refunded, ${r.auto_confirmed} auto-confirmed and released.`);
  return {
    processedCount: r.expired + r.auto_confirmed,
    successCount: r.expired + r.auto_confirmed,
    errorCount: r.errors.length,
    errors: r.errors,
    metadata: { expired: r.expired, auto_confirmed: r.auto_confirmed, skipped: r.skipped },
  };
}

// WHY hourly: the windows are measured in days, so an hour of lateness is invisible, and a failed
// request is simply retried on the next run.
registerJob({
  name: 'sample_kit',
  intervalMs: 3600000,
  moduleKey: 'sourcing',
  handler: runSampleKit,
});
