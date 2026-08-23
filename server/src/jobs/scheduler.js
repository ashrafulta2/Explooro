/**
 * scheduler.js — Distributed, Dependency-Light In-Process Job Scheduler (Prompt 6.2).
 *
 * Implements:
 * - PostgreSQL advisory locks (pg_try_advisory_lock) to prevent duplicate execution across worker instances
 * - Feature module gating: every job verifies its platform module is enabled before execution
 * - Execution audit logging in job_runs with start, end, processed count, and error details
 * - Graceful lifecycle management (startScheduler / stopScheduler / runJobNow)
 */

import { createHash } from 'node:crypto';
import * as moduleService from '../services/module.service.js';

/**
 * Converts a string job name into a deterministic 32-bit signed integer for pg advisory locking.
 */
export function hashJobNameToLockId(jobName) {
  const hash = createHash('sha256').update(jobName, 'utf8').digest('hex');
  const num = parseInt(hash.slice(0, 8), 16);
  // Convert unsigned 32-bit to signed 32-bit integer (-2147483648 to 2147483647)
  return (num | 0);
}

const jobRegistry = new Map();
let activeTimers = [];

/**
 * Registers a scheduled background job.
 *
 * @param {Object} jobDef
 * @param {string} jobDef.name - Unique job identifier (e.g. 'escrow_release')
 * @param {number} jobDef.intervalMs - Execution interval in milliseconds (e.g. 3600000 for hourly)
 * @param {string} [jobDef.moduleKey] - Required platform module key (e.g. 'returns_engine')
 * @param {Function} jobDef.handler - async function(db, cache, logger) returning { processedCount, successCount, errorCount, metadata }
 */
export function registerJob(jobDef) {
  if (!jobDef.name || typeof jobDef.handler !== 'function') {
    throw new Error('INVALID_JOB_DEFINITION: Job must have a name and handler function.');
  }
  const lockId = jobDef.lockId ?? hashJobNameToLockId(jobDef.name);
  jobRegistry.set(jobDef.name, {
    ...jobDef,
    lockId,
  });
}

/**
 * Executes a single job run with distributed advisory lock and database audit tracking.
 */
export async function runJobNow(jobName, db, cache, logger = console) {
  const log = logger.info?.bind(logger) || logger.log?.bind(logger) || console.log;
  const errLog = logger.error?.bind(logger) || console.error;

  const jobDef = jobRegistry.get(jobName);
  if (!jobDef) {
    throw new Error(`UNKNOWN_JOB: Job "${jobName}" is not registered.`);
  }

  // 1. Check module gating if moduleKey is specified
  if (jobDef.moduleKey) {
    const isModuleOn = await moduleService.isEnabled(db, cache, jobDef.moduleKey);
    if (!isModuleOn) {
      log(`[scheduler] Skipping job "${jobName}" — module "${jobDef.moduleKey}" is disabled.`);
      return { status: 'SKIPPED', reason: 'MODULE_DISABLED' };
    }
  }

  const client = await db.connect();
  let acquiredLock = false;
  let runId = null;
  const startTime = Date.now();

  try {
    // 2. Try acquiring PostgreSQL advisory lock
    const { rows: lockRows } = await client.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [jobDef.lockId]
    );

    acquiredLock = lockRows[0]?.acquired === true || lockRows[0]?.acquired === 't';
    if (!acquiredLock) {
      log(`[scheduler] Job "${jobName}" is already running in another process (lockId: ${jobDef.lockId}). Skipping.`);
      return { status: 'SKIPPED', reason: 'LOCK_HELD' };
    }

    // 3. Record job run start
    const { rows: runRows } = await client.query(
      `INSERT INTO job_runs (job_name, status, started_at)
       VALUES ($1, 'RUNNING', now())
       RETURNING id`,
      [jobName]
    );
    runId = runRows[0]?.id;

    log(`[scheduler] Starting job "${jobName}" (run #${runId})...`);

    // 4. Execute job handler
    const result = await jobDef.handler(db, cache, logger);
    const durationMs = Date.now() - startTime;

    const processedCount = result?.processedCount ?? 0;
    const successCount = result?.successCount ?? 0;
    const errorCount = result?.errorCount ?? 0;
    const errorDetails = result?.errors?.length > 0 ? JSON.stringify(result.errors) : null;
    const metadataJson = result?.metadata ? JSON.stringify(result.metadata) : null;

    // 5. Update job run completion
    if (runId) {
      await client.query(
        `UPDATE job_runs
         SET status = $2,
             ended_at = now(),
             duration_ms = $3,
             processed_count = $4,
             success_count = $5,
             error_count = $6,
             error_details_json = $7,
             metadata_json = $8
         WHERE id = $1`,
        [
          runId,
          errorCount > 0 && successCount === 0 && processedCount > 0 ? 'FAILED' : 'COMPLETED',
          durationMs,
          processedCount,
          successCount,
          errorCount,
          errorDetails,
          metadataJson,
        ]
      );
    }

    log(`[scheduler] Finished job "${jobName}" in ${durationMs}ms (Processed: ${processedCount}, Success: ${successCount}, Errors: ${errorCount})`);

    return {
      status: 'COMPLETED',
      runId,
      durationMs,
      processedCount,
      successCount,
      errorCount,
      result,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    errLog(`[scheduler] Job "${jobName}" failed:`, err);

    if (runId) {
      await client.query(
        `UPDATE job_runs
         SET status = 'FAILED',
             ended_at = now(),
             duration_ms = $2,
             error_count = 1,
             error_details_json = $3
         WHERE id = $1`,
        [
          runId,
          durationMs,
          JSON.stringify({ message: err.message, stack: err.stack }),
        ]
      ).catch(() => {});
    }

    throw err;
  } finally {
    if (acquiredLock) {
      await client.query('SELECT pg_advisory_unlock($1)', [jobDef.lockId]).catch(() => {});
    }
    client.release();
  }
}

/**
 * Starts all registered scheduler jobs.
 */
export function startScheduler(db, cache, logger = console, { runOnStartup = false } = {}) {
  stopScheduler();

  for (const [name, jobDef] of jobRegistry.entries()) {
    const intervalMs = jobDef.intervalMs || 3600000;

    if (runOnStartup) {
      runJobNow(name, db, cache, logger).catch((err) => {
        logger.error?.(`[scheduler] Initial run of "${name}" failed:`, err);
      });
    }

    const timer = setInterval(() => {
      runJobNow(name, db, cache, logger).catch((err) => {
        logger.error?.(`[scheduler] Periodic execution of "${name}" failed:`, err);
      });
    }, intervalMs);

    timer.unref?.();
    activeTimers.push(timer);
  }

  logger.info?.(`[scheduler] Scheduler started with ${jobRegistry.size} registered jobs.`);
}

/**
 * Stops all active scheduler timers.
 */
export function stopScheduler() {
  for (const timer of activeTimers) {
    clearInterval(timer);
  }
  activeTimers = [];
}
