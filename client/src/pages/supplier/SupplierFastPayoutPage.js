/**
 * SupplierFastPayoutPage.js — A supplier takes escrowed earnings early, for a fee.
 *
 * Route: /supplier/fast-payout  (module: sourcing, read: supplier.analytics.view, act: finance.fast_payout.request)
 * The screen is shared with the shop partner's; see components/payoutProtection/mountFastPayout.ts.
 */
import { mountFastPayout } from '../../components/payoutProtection/mountFastPayout.ts';
import { fastPayoutApi } from '../../services/payoutProtection.api.ts';

export default function SupplierFastPayoutPage(root) {
  return mountFastPayout(root, {
    load: () => fastPayoutApi.getSupplierView(),
    take: (entryId) => fastPayoutApi.supplierTake(entryId),
  });
}
