/**
 * escrowRelease.job.js — Hourly Escrow Release Automation & Dead-Letter Routing (Prompt 6.2).
 *
 * Implements:
 * - Hourly sweep finding mature LOCKED escrow holds (hold_until <= now())
 * - Releases each sub-order inside its own transaction
 * - Dead-letter queue routing for failed holds rather than infinite silent retries
 * - Automatic registration with the scheduler engine under module 'returns_engine'
 */

import * as vaultService from '../services/vault.service.js';
import { registerJob } from './scheduler.js';

/**
 * Sweeps all mature escrow entries and releases them to respective supplier/saler/platform wallets.
 *
 * @param {import('pg').Pool} db
 * @param {Object} [cache]
 * @param {Console} [logger]
 */
export async function runEscrowReleaseSweep(db, cache, logger = console) {
  const log = logger.info?.bind(logger) || logger.log?.bind(logger) || console.log;
  const errLog = logger.error?.bind(logger) || console.error;

  // 1. Find all mature locked escrow entries
  const { rows: dueEntries } = await db.query(
    `SELECT id, sub_order_id, wallet_id, beneficiary_role, amount, hold_until, failure_count
     FROM escrow_entries
     WHERE status = 'LOCKED' AND hold_until <= now()
     ORDER BY sub_order_id ASC, id ASC`
  );

  if (dueEntries.length === 0) {
    return {
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      errors: [],
      metadata: { message: 'No mature escrow holds due for release.' },
    };
  }

  // 2. Group by distinct sub_order_id
  const subOrderMap = new Map();
  for (const entry of dueEntries) {
    const list = subOrderMap.get(entry.sub_order_id) || [];
    list.push(entry);
    subOrderMap.set(entry.sub_order_id, list);
  }

  log(`[escrowRelease] Found ${dueEntries.length} due escrow entries across ${subOrderMap.size} sub-orders.`);

  let successCount = 0;
  let errorCount = 0;
  const errors = [];
  const releasedSubOrderIds = [];

  // 3. Process each sub-order independently inside its own transaction
  for (const [subOrderId, entries] of subOrderMap.entries()) {
    try {
      const todayDate = new Date().toISOString().slice(0, 10);
      const result = await vaultService.releaseEscrow(db, {
        subOrderId,
        releasedBy: null,
        idempotencyKey: `cron_release:${subOrderId}:${todayDate}`,
      });

      if (result.success) {
        successCount += 1;
        releasedSubOrderIds.push(subOrderId);
      } else {
        errorCount += 1;
        errors.push({ subOrderId, reason: result.message || 'Release returned success: false' });
      }
    } catch (err) {
      errorCount += 1;
      const errorMsg = err.message || 'Unknown error during escrow release';
      errors.push({ subOrderId, reason: errorMsg, stack: err.stack });
      errLog(`[escrowRelease] Failed to release escrow for sub-order #${subOrderId}:`, err);

      // 4. Route to Dead-Letter Queue and record failure in escrow_entries
      const entryIds = entries.map((e) => e.id);
      for (const entry of entries) {
        await db.query(
          `INSERT INTO escrow_dead_letters (
             escrow_entry_id, sub_order_id, failure_reason, failure_stack, attempts, status
           )
           VALUES ($1, $2, $3, $4, 1, 'PENDING')`,
          [entry.id, subOrderId, errorMsg, err.stack]
        ).catch(() => {});
      }

      await db.query(
        `UPDATE escrow_entries
         SET failure_count = failure_count + 1,
             last_error = $2,
             status = CASE WHEN failure_count >= 5 THEN 'FAILED' ELSE status END
         WHERE id = ANY($1::bigint[])`,
        [entryIds, errorMsg]
      ).catch(() => {});
    }
  }

  return {
    processedCount: subOrderMap.size,
    successCount,
    errorCount,
    errors,
    metadata: {
      totalEntries: dueEntries.length,
      releasedSubOrderIds,
    },
  };
}

// Register with scheduler (hourly by default: 3600000ms = 1 hour)
registerJob({
  name: 'escrow_release',
  intervalMs: 3600000,
  moduleKey: 'returns_engine',
  handler: runEscrowReleaseSweep,
});
