/**
 * analyticsRollup.job.js — Nightly Executive Analytics Summary Rollup Worker (Prompt 11.4).
 *
 * Implements:
 * - Nightly pre-computation of daily sales, revenues, liabilities, and user growth.
 * - Saves summary aggregates into `daily_analytics_rollups` so the admin dashboard loads instantly (<1s).
 * - Automatic registration with the distributed job scheduler.
 */

import * as analyticsService from '../services/analytics.service.js';
import { registerJob } from './scheduler.js';

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
registerJob({
  name: 'analytics_nightly_rollup',
  module: 'core',
  cron: '0 1 * * *', // 1:00 AM daily
  intervalMs: 86400000, // 24 hours
  handler: runNightlyAnalyticsRollup,
});
