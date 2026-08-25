/**
 * expiryWarning.job.js — Daily Batch Expiration Warning & 1-Click Clearance Trigger Sweep (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AJ & §AL.1:
 * - Scans all active product batches approaching expiration (30 & 60-day thresholds).
 * - Updates status to EXPIRING_SOON.
 * - Generates 1-click clearance sale recommendations and alerts suppliers.
 * - Gated by module `fefo_batches`.
 */

import { registerJob } from './scheduler.js';
import * as inventoryService from '../services/inventory.service.js';

export async function runExpiryWarningSweep(db, cache, logger = console) {
  return inventoryService.checkExpiryWarnings(db, cache, logger);
}

// Register job with distributed in-process scheduler (24h interval)
registerJob({
  name: 'batch_expiry_warning_sweep',
  moduleKey: 'fefo_batches',
  intervalMs: 86400000, // 24 hours
  handler: runExpiryWarningSweep,
});
