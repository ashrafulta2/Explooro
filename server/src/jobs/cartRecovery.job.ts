/**
 * cartRecovery.job.ts — Periodic Abandoned Cart Recovery Automation Worker (Prompt 9.6).
 *
 * Implements:
 * - Inactivity detection scanning carts idle >= inactivity_minutes.
 * - Multi-step recovery sequence progression (+1h reminder, +24h 5% incentive, +72h 10% final).
 * - Registered with the scheduler every 15 minutes, gated on the 'cart_recovery' module.
 */

import * as cartRecoveryService from '../services/cartRecovery.service.ts';
import { registerJob } from './scheduler.ts';

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

// WHY intervalMs/moduleKey: the scheduler has no cron syntax and reads only these two keys. This job
// passed `cron` and `module`, so it ran hourly and kept messaging shoppers with the module off.
registerJob({
  name: 'cart_recovery_sweep',
  moduleKey: 'cart_recovery',
  intervalMs: 15 * 60 * 1000,
  handler: runCartRecoverySweep,
});
