/**
 * SalerFastPayoutPage.js — A shop partner takes escrowed commission early, for a fee.
 *
 * Route: /saler/fast-payout  (module: sourcing, read: shop partner.sourcing.view, act: finance.fast_payout.request)
 * The screen is shared with the supplier's; see components/payoutProtection/mountFastPayout.ts.
 */
import { mountFastPayout } from '../../components/payoutProtection/mountFastPayout.ts';
import { fastPayoutApi } from '../../services/payoutProtection.api.ts';

export default function SalerFastPayoutPage(root) {
  return mountFastPayout(root, {
    load: () => fastPayoutApi.getSalerView(),
    take: (entryId) => fastPayoutApi.salerTake(entryId),
  });
}
