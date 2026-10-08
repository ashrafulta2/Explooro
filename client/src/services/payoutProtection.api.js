/**
 * payoutProtection.api.js — Fast Payout and Return Protection (supplier attraction, step 5).
 * A supplier and a saler use the same Fast Payout handlers on their own routes; the person is always the
 * signed-in user, never a parameter.
 */
import { api } from '../core/api.js';

export const fastPayoutApi = {
  getSupplierView() {
    return api.get('/supplier/fast-payout');
  },
  supplierTake(escrowEntryId) {
    return api.post('/supplier/fast-payout', { escrow_entry_id: escrowEntryId });
  },
  getSalerView() {
    return api.get('/sourcing/fast-payout');
  },
  salerTake(escrowEntryId) {
    return api.post('/sourcing/fast-payout', { escrow_entry_id: escrowEntryId });
  },
};

export const returnProtectionApi = {
  getSupplierView() {
    return api.get('/supplier/return-protection');
  },
  setEnrollment(enrolled) {
    return api.put('/supplier/return-protection', { enrolled });
  },
  getSalerView() {
    return api.get('/sourcing/return-protection');
  },
};
