/**
 * cartRecovery.job.js — Periodic Abandoned Cart Recovery Automation Worker (Prompt 9.6).
 *
 * Implements:
 * - Inactivity detection scanning carts idle >= inactivity_minutes.
 * - Multi-step recovery sequence progression (+1h reminder, +24h 5% incentive, +72h 10% final).
 * - Automatic registration with the scheduler engine under module 'cart_recovery'.
 */

import * as cartRecoveryService from '../services/cartRecovery.service.js';
import { registerJob } from './scheduler.js';

export async function runCartRecoverySweep(db, cache, logger = console) {
  const log = logger.info?.bind(logger) || logger.log?.bind(logger) || console.log;

  const result = await cartRecoveryService.processRecoverySequence(db, cache);
  if (result.step1Count > 0 || result.step2Count > 0 || result.step3Count > 0) {
    log(
      `[cartRecoveryJob] Nudged carts: Step 1 (+1h): ${result.step1Count}, Step 2 (+24h): ${result.step2Count}, Step 3 (+72h): ${result.step3Count}`
    );
  }

  return {
    processedCount: result.processedCount,
    successCount: (result.step1Count || 0) + (result.step2Count || 0) + (result.step3Count || 0),
    errorCount: 0,
    errors: [],
    metadata: result,
  };
}

// Register with distributed job scheduler to run every 15 minutes
registerJob({
  name: 'cart_recovery_sweep',
  module: 'cart_recovery',
  cron: '*/15 * * * *',
  handler: runCartRecoverySweep,
});
