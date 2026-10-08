/**
 * supplierScorecard.job.js — rebuilds every supplier's scorecard snapshot from live orders.
 *
 * Gated on the `sourcing` module by the scheduler: the scorecard exists to be read in the Sourcing
 * Catalog, so with that module off there is nobody to show it to and the job is skipped.
 */

import { refreshAll } from '../services/supplierScorecard.service.js';
import { registerJob } from './scheduler.js';

export async function runSupplierScorecard(db, cache, logger = console) {
  const result = await refreshAll(db);
  logger.info?.(
    `[supplierScorecard] ${result.suppliers} suppliers measured over ${result.rules.window_days} days, ` +
      `${result.graded} graded, ${result.removed} stale snapshots removed.`
  );
  return {
    processedCount: result.suppliers,
    successCount: result.suppliers,
    errorCount: 0,
    errors: [],
    metadata: { graded: result.graded, removed: result.removed, window_days: result.rules.window_days },
  };
}

// WHY daily: the window is weeks long, so one day of drift moves a score by a fraction of a point,
// and a daily rebuild keeps the grade steady enough that a saler does not see it flicker.
registerJob({
  name: 'supplier_scorecard',
  intervalMs: 24 * 3600000,
  moduleKey: 'sourcing',
  handler: runSupplierScorecard,
});
