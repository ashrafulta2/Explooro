/**
 * payoutProtection.api.ts — Fast Payout and Return Protection (supplier attraction, step 5).
 * A supplier and a shop partner use the same Fast Payout handlers on their own routes; the person is always the
 * signed-in user, never a parameter.
 */
import { api } from '../core/api.ts';

export const fastPayoutApi = {
  getSupplierView() {
    return api.get('/supplier/fast-payout');
  },
  supplierTake(escrowEntryId: number | string) {
    return api.post('/supplier/fast-payout', { escrow_entry_id: escrowEntryId });
  },
  getSalerView() {
    return api.get('/sourcing/fast-payout');
  },
  salerTake(escrowEntryId: number | string) {
    return api.post('/sourcing/fast-payout', { escrow_entry_id: escrowEntryId });
  },
};

export const returnProtectionApi = {
  getSupplierView() {
    return api.get('/supplier/return-protection');
  },
  setEnrollment(enrolled: boolean) {
    return api.put('/supplier/return-protection', { enrolled });
  },
  getSalerView() {
    return api.get('/sourcing/return-protection');
  },
};
