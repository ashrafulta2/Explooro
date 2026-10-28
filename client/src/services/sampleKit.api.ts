/**
 * sampleKit.api.ts — Sample requests and marketing kits (supplier attraction, step 4).
 * Supplier and shop partner endpoints live side by side because the two pages are two halves of one exchange.
 */
import { api } from '../core/api.ts';

/** A request body; the fields are the server's, passed through untouched. */
type Params = Record<string, unknown>;

export const sampleKitApi = {
  // supplier
  getSupplierSamples() {
    return api.get('/supplier/samples');
  },
  saveOffer(productId: number | string, payload: Params) {
    return api.put(`/supplier/samples/${productId}/offer`, payload);
  },
  respond(requestId: number | string, action: string, payload: Params = {}) {
    return api.post(`/supplier/samples/requests/${requestId}/${action}`, payload);
  },
  getSupplierKits() {
    return api.get('/supplier/marketing-kits');
  },
  saveKit(productId: number | string, payload: Params) {
    return api.put(`/supplier/marketing-kits/${productId}`, payload);
  },

  // shop partner
  getSalerSamples() {
    return api.get('/sourcing/samples');
  },
  requestSample(payload: Params) {
    return api.post('/sourcing/samples', payload);
  },
  act(requestId: number | string, action: string) {
    return api.post(`/sourcing/samples/${requestId}/${action}`, {});
  },
  getSalerKits() {
    return api.get('/sourcing/marketing-kits');
  },
};
