/**
 * subscriptionRenewal.job.js — hourly Shop Partner Pro renewal sweep.
 *
 * Bills renewals, runs the grace period, lifts expired waivers and sends renewal reminders
 * (see subscriptionBilling.service.ts). Gated on the `subscription_fees` module by the scheduler:
 * with the module OFF the job is skipped and nothing is billed.
 */

import { runRenewalSweep } from '../services/subscriptionBilling.service.ts';
import { registerJob } from './scheduler.ts';

export async function runSubscriptionRenewalSweep(db, cache, logger = console) {
  const result = await runRenewalSweep(db, cache);
  if (result.errorCount > 0) {
    logger.error?.('[subscriptionRenewal] some subscriptions failed to process:', result.errors);
  }
  return result;
}

registerJob({
  name: 'subscription_renewal',
  intervalMs: 3600000,
  moduleKey: 'subscription_fees',
  handler: runSubscriptionRenewalSweep,
});
