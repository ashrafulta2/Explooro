/**
 * SupplierFastPayoutPage.js — A supplier takes escrowed earnings early, for a fee.
 *
 * Route: /supplier/fast-payout  (module: sourcing, read: supplier.analytics.view, act: finance.fast_payout.request)
 * The screen is shared with the saler's; see components/payoutProtection/mountFastPayout.js.
 */
import { mountFastPayout } from '../../components/payoutProtection/mountFastPayout.js';
import { fastPayoutApi } from '../../services/payoutProtection.api.js';

export default function SupplierFastPayoutPage(root) {
  return mountFastPayout(root, {
    load: () => fastPayoutApi.getSupplierView(),
    take: (entryId) => fastPayoutApi.supplierTake(entryId),
  });
}
