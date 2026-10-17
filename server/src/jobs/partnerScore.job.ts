/**
 * partnerScore.job.ts — rebuilds every shop partner's Partner Score snapshot from live orders.
 *
 * Gated on the `virtual_storefront` module by the scheduler: a partner promotes through their
 * storefront and its links, so with storefronts off there is nobody to score.
 */

import { refreshAll } from '../services/partnerScore.service.ts';
import { registerJob } from './scheduler.ts';

export async function runPartnerScore(db, cache, logger = console) {
  const result = await refreshAll(db);
  logger.info?.(
    `[partnerScore] ${result.partners} partners measured over ${result.rules.window_days} days, ` +
      `${result.scored} scored, ${result.removed} stale snapshots removed.`
  );
  return {
    processedCount: result.partners,
    successCount: result.partners,
    errorCount: 0,
    errors: [],
    metadata: { scored: result.scored, removed: result.removed, window_days: result.rules.window_days },
  };
}

// WHY daily: the window is weeks long, so a day moves a score by a fraction of a point, and a daily
// rebuild keeps the band steady enough that a partner does not see it flicker.
registerJob({
  name: 'partner_score',
  intervalMs: 24 * 3600000,
  moduleKey: 'virtual_storefront',
  handler: runPartnerScore,
});
