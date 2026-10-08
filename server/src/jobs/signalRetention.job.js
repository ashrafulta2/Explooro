/**
 * signalRetention.job.js — prunes the behavioural event log to the module's retention_days.
 *
 * Deletes product_interaction_events and search_events older than personalization_signals
 * `retention_days` (see signalRetention.service.js). Gated on the same module as capture by the
 * scheduler: with the module off the job is skipped, so already-captured rows are left as they are
 * until it is switched back on.
 */

import { purgeExpiredSignals } from '../services/signalRetention.service.js';
import { registerJob } from './scheduler.js';

export async function runSignalRetention(db, cache, logger = console) {
  const result = await purgeExpiredSignals(db);

  // Every table failing is a failed run, not a quiet success with an error list.
  if (result.errors.length > 0 && result.errors.length === Object.keys(result.tables).length) {
    throw new Error(`SIGNAL_RETENTION_FAILED: ${result.errors.map((e) => `${e.table}: ${e.message}`).join('; ')}`);
  }

  logger.info?.(
    `[signalRetention] deleted ${result.deleted} events older than ${result.retentionDays} days ` +
      `(${Object.entries(result.tables).map(([t, p]) => `${t}: ${p.deleted}`).join(', ')}).`
  );
  for (const [table, p] of Object.entries(result.tables)) {
    if (p.capped) logger.warn?.(`[signalRetention] ${table} hit the per-run batch cap — more expired rows remain for the next run.`);
  }
  if (result.shortensCovisitWindow) {
    logger.warn?.(
      `[signalRetention] retention_days (${result.retentionDays}) is shorter than the co-visitation window ` +
        `(${result.covisitWindowDays}) — co-visitation effectively only sees ${result.retentionDays} days.`
    );
  }
  for (const e of result.errors) logger.error?.(`[signalRetention] ${e.table} failed: ${e.message}`);

  return {
    processedCount: result.deleted,
    successCount: result.deleted,
    errorCount: result.errors.length,
    errors: result.errors,
    metadata: result,
  };
}

// WHY daily: the log only needs trimming to within a day of the cutoff, and a pass over an
// already-trimmed table is a pair of cheap indexed lookups that delete nothing.
registerJob({
  name: 'signal_retention',
  intervalMs: 24 * 3600000,
  moduleKey: 'personalization_signals',
  handler: runSignalRetention,
});
