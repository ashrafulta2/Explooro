/**
 * coinExpiry.job.js — expires loyalty coins older than the policy's expiry_days.
 *
 * The rule lives in coin.service.js `expireStaleCoins`; this file only schedules it. Gated on the
 * loyalty_coins module: with it off nothing expires, so coins do not vanish while the feature is dark.
 */

import { expireStaleCoins } from '../services/coin.service.js';
import { registerJob } from './scheduler.js';

export async function runCoinExpiry(db, cache, logger = console) {
  const result = await expireStaleCoins(db);
  logger.info?.(`[coinExpiry] expired ${result.coinsExpired} coins across ${result.usersExpired} users (expiry ${result.expiryDays} days).`);
  if (result.batchFull) logger.warn?.('[coinExpiry] batch was full — more balances remain for the next run.');
  return {
    processedCount: result.usersExpired,
    successCount: result.usersExpired,
    errorCount: 0,
    errors: [],
    metadata: result,
  };
}

// WHY daily: expiry is measured in days, so a finer cadence only repeats a query that finds nothing.
registerJob({
  name: 'coin_expiry',
  intervalMs: 24 * 3600000,
  moduleKey: 'loyalty_coins',
  handler: runCoinExpiry,
});
