/**
 * rebuildCovisits.js — one-off run of the co-visitation rebuild (personalized feed, Phase E).
 *
 * `npm run covisit:rebuild` recomputes product_covisits from the behavioural event log right now,
 * with the same code the `covisit_rebuild` job runs every 6 hours. The job's first run is 6 hours
 * after the server starts (the scheduler does not run jobs at boot), so use this after a restore, a
 * bulk import of events, or when checking a tuning change.
 */

import '../config/loadEnvFile.js';
import { loadEnv } from '../config/env.js';
import { createDbPool } from '../config/db.js';
import { rebuildCovisits, resolveCovisitConfig } from '../services/covisit.service.js';

const pool = createDbPool(loadEnv());
try {
  const config = await resolveCovisitConfig(pool);
  const result = await rebuildCovisits(pool, { config });
  console.log(
    result.skipped
      ? 'Co-visitation is disabled in settings (recommendation.covisit.enabled) — nothing rebuilt.'
      : `Rebuilt product_covisits: ${result.pairs} related pairs across ${result.products} products ` +
          `(window ${config.window_days} days, at least ${config.min_actors} shoppers per pair).`
  );
} finally {
  await pool.end();
}
