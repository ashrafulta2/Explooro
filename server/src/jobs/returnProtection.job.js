/**
 * returnProtection.job.js — pays protection claims the refund could not, and charges premiums that are due.
 *
 * Gated on the `sourcing` module by the scheduler. With it off nobody can enrol; covers already issued
 * are better settled by hand than by a job running behind a switched-off feature.
 */

import { settleDue } from '../services/returnProtection.service.js';
import { registerJob } from './scheduler.js';

export async function runReturnProtection(db, cache, logger = console) {
  const r = await settleDue(db, logger);
  logger.info?.(`[returnProtection] ${r.claims_paid} claims paid, ${r.premiums_charged} premiums charged.`);
  return {
    processedCount: r.claims_paid + r.premiums_charged,
    successCount: r.claims_paid + r.premiums_charged,
    errorCount: r.errors.length,
    errors: r.errors,
    metadata: { claims_paid: r.claims_paid, premiums_charged: r.premiums_charged, skipped: r.skipped },
  };
}

// WHY hourly: a premium is only due once the escrow has released (itself an hourly job), and a claim that
// failed at the refund is simply retried on the next run.
registerJob({
  name: 'return_protection',
  intervalMs: 3600000,
  moduleKey: 'sourcing',
  handler: runReturnProtection,
});
