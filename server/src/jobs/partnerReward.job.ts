/**
 * partnerReward.job.ts — closes each finished month of the shop partner reward pool and pays it out.
 *
 * Gated on the `virtual_storefront` module: with storefronts off there are no partners to pay, and the
 * pool simply waits. Runs daily; a month closes on the first run after `settle_lag_days` past its end,
 * and the run row per month makes every later run a no-op for it.
 */

import { closeDueMonths } from '../services/partnerReward.service.ts';
import { registerJob } from './scheduler.ts';

export async function runPartnerReward(db, cache, logger = console) {
  const { results } = await closeDueMonths(db);
  const closed = results.filter((r) => !r.skipped);
  for (const r of closed) {
    logger.info?.(
      `[partnerReward] closed ${r.start}: pool ৳${r.poolAmount} (ad share ৳${r.adShare}), ` +
        `paid ৳${r.paidAmount} to ${r.partnersScored} partners, carried ৳${r.carriedAmount}.`
    );
  }
  return {
    processedCount: results.length,
    successCount: closed.length,
    errorCount: 0,
    errors: [],
    metadata: { closed: closed.map((r) => ({ period: r.start, paid: r.paidAmount, partners: r.partnersScored })) },
  };
}

registerJob({
  name: 'partner_reward',
  intervalMs: 24 * 3600000,
  moduleKey: 'virtual_storefront',
  handler: runPartnerReward,
});
