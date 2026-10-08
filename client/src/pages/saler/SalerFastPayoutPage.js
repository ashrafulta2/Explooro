/**
 * SalerFastPayoutPage.js — A saler takes escrowed commission early, for a fee.
 *
 * Route: /saler/fast-payout  (module: sourcing, read: saler.sourcing.view, act: finance.fast_payout.request)
 * The screen is shared with the supplier's; see components/payoutProtection/mountFastPayout.js.
 */
import { mountFastPayout } from '../../components/payoutProtection/mountFastPayout.js';
import { fastPayoutApi } from '../../services/payoutProtection.api.js';

export default function SalerFastPayoutPage(root) {
  return mountFastPayout(root, {
    load: () => fastPayoutApi.getSalerView(),
    take: (entryId) => fastPayoutApi.salerTake(entryId),
  });
}
