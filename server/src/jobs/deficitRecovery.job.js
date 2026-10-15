/**
 * deficitRecovery.job.js — closes negative-balance deficit records once the wallet has earned them back.
 *
 * Gated on `returns_engine` by the scheduler, like escrow_release: every deficit comes from a
 * clawback (return, partial return, warranty refund). No money moves here; see
 * clawback.service.ts settleDeficitRecoveries.
 */

import { settleDeficitRecoveries } from '../services/clawback.service.ts';
import { registerJob } from './scheduler.ts';

export async function runDeficitRecovery(db, cache, logger = console) {
  const r = await settleDeficitRecoveries(db);

  logger.info?.(
    `[deficitRecovery] ${r.walletsSettled} of ${r.walletsChecked} wallets settled: ` +
      `${r.recordsRecovered} records recovered, ${r.recordsPartial} partly, ৳${r.recoveredAmount} in all.`
  );
  if (r.batchFull) logger.warn?.('[deficitRecovery] hit the per-run wallet cap — more wallets remain for the next run.');
  for (const e of r.errors) logger.error?.(`[deficitRecovery] wallet ${e.walletId} failed: ${e.message}`);

  return {
    processedCount: r.walletsChecked,
    successCount: r.walletsSettled,
    errorCount: r.errors.length,
    errors: r.errors,
    metadata: r,
  };
}

// WHY daily: the records only feed the finance page's deficit list, and a run that finds nothing to
// settle costs one indexed lookup per open wallet.
registerJob({
  name: 'deficit_recovery',
  intervalMs: 24 * 3600000,
  moduleKey: 'returns_engine',
  handler: runDeficitRecovery,
});
