/**
 * salerTier.job.js — keeps every shop partner's commission tier current (see services/salerTier.service.js).
 *
 * Not gated on a platform module: the `saler.commission_tiers.enabled` setting is the switch, and the
 * service writes nothing while it is off.
 */

import { recomputeAll } from '../services/salerTier.service.js';
import { registerJob } from './scheduler.js';

export async function runSalerTier(db, cache, logger = console) {
  const r = await recomputeAll(db);
  if (!r.skipped) logger.info?.(`[salerTier] ${r.evaluated} salers evaluated, ${r.changed} changed tier.`);
  return {
    processedCount: r.evaluated,
    successCount: r.evaluated,
    errorCount: 0,
    errors: [],
    metadata: { changed: r.changed, skipped: r.skipped },
  };
}

// WHY hourly: the window is days long, so a tier moves slowly, but an admin who switches the feature
// on should see tiers fill within the hour rather than the next day. The run is idempotent.
registerJob({
  name: 'saler_tier',
  intervalMs: 3600000,
  handler: runSalerTier,
});
