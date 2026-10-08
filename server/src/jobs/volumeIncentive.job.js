/**
 * volumeIncentive.job.js — pays the monthly volume-incentive rebates that have come due.
 *
 * Gated on the `sourcing` module by the scheduler: the incentive is shown to salers in the Sourcing
 * Catalog area, and with that module off there is nobody to pay it for.
 */

import { settleDue } from '../services/volumeIncentive.service.js';
import { registerJob } from './scheduler.js';

export async function runVolumeIncentive(db, cache, logger = console) {
  const r = await settleDue(db, logger);
  logger.info?.(
    `[volumeIncentive] ${r.created} new payouts, ${r.paid} paid, ${r.unfunded} waiting on supplier funds, ${r.lapsed} lapsed.`
  );
  return {
    processedCount: r.created + r.paid + r.unfunded + r.lapsed,
    successCount: r.paid,
    errorCount: r.errors.length,
    errors: r.errors,
    metadata: { created: r.created, paid: r.paid, unfunded: r.unfunded, lapsed: r.lapsed },
  };
}

// WHY hourly: a month only becomes due once, so the work is tiny; but an UNFUNDED payout is retried
// on every run and a supplier who tops up their wallet should see the saler paid the same day.
registerJob({
  name: 'volume_incentive',
  intervalMs: 3600000,
  moduleKey: 'sourcing',
  handler: runVolumeIncentive,
});
