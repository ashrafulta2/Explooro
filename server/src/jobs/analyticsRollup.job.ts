/**
 * analyticsRollup.job.ts — Nightly Executive Analytics Summary Rollup Worker (Prompt 11.4).
 *
 * Implements:
 * - Nightly pre-computation of daily sales, revenues, liabilities, and user growth.
 * - Saves summary aggregates into `daily_analytics_rollups` so the admin dashboard loads instantly (<1s).
 * - Automatic registration with the distributed job scheduler.
 */

import * as analyticsService from '../services/analytics.service.ts';
import { registerJob } from './scheduler.ts';

export async function runNightlyAnalyticsRollup(db, cache, logger = console) {
  const log = logger.info?.bind(logger) || logger.log?.bind(logger) || console.log;

  // Run rollup for yesterday's completed day
  const rollup = await analyticsService.runDailyRollup(db);

  log(`[analyticsRollupJob] Completed rollup for date: ${rollup.rollup_date} (GMV: ৳${rollup.gmv}, Revenue: ৳${rollup.platform_net_revenue})`);

  return {
    processedCount: 1,
    successCount: 1,
    errorCount: 0,
    errors: [],
    metadata: {
      rollupDate: rollup.rollup_date,
      gmv: rollup.gmv,
      platformNetRevenue: rollup.platform_net_revenue,
      totalOrders: rollup.total_orders,
    },
  };
}

// Register with distributed job scheduler to run daily
// WHY no module/cron keys: the scheduler reads neither (it runs every intervalMs from process start),
// and 'core' is not a module that can be switched off.
registerJob({
  name: 'analytics_nightly_rollup',
  intervalMs: 86400000, // 24 hours
  handler: runNightlyAnalyticsRollup,
});
