/**
 * covisitRebuild.job.js — recomputes the "shoppers also viewed" aggregate (personalized feed, Phase E).
 *
 * Reads the behavioural event log and replaces product_covisits (see covisit.service.js). Gated on the
 * `personalization_signals` module by the scheduler: with capture switched off there is no new data to
 * learn from, so the job is skipped and the last aggregate simply ages.
 */

import { rebuildCovisits } from '../services/covisit.service.js';
import { registerJob } from './scheduler.js';

export async function runCovisitRebuild(db, cache, logger = console) {
  const result = await rebuildCovisits(db);
  logger.info?.(
    result.skipped
      ? '[covisitRebuild] co-visitation is disabled in settings — nothing rebuilt.'
      : `[covisitRebuild] ${result.pairs} related pairs across ${result.products} products.`
  );
  return {
    processedCount: result.products,
    successCount: result.products,
    errorCount: 0,
    errors: [],
    metadata: result,
  };
}

// WHY every 6 hours: a pair needs several shoppers to agree, so the aggregate moves slowly; running
// it more often would re-read the same log for almost the same answer.
registerJob({
  name: 'covisit_rebuild',
  intervalMs: 6 * 3600000,
  moduleKey: 'personalization_signals',
  handler: runCovisitRebuild,
});
