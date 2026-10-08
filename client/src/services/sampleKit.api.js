/**
 * sampleKit.api.js — Sample requests and marketing kits (supplier attraction, step 4).
 * Supplier and saler endpoints live side by side because the two pages are two halves of one exchange.
 */
import { api } from '../core/api.js';

export const sampleKitApi = {
  // supplier
  getSupplierSamples() {
    return api.get('/supplier/samples');
  },
  saveOffer(productId, payload) {
    return api.put(`/supplier/samples/${productId}/offer`, payload);
  },
  respond(requestId, action, payload = {}) {
    return api.post(`/supplier/samples/requests/${requestId}/${action}`, payload);
  },
  getSupplierKits() {
    return api.get('/supplier/marketing-kits');
  },
  saveKit(productId, payload) {
    return api.put(`/supplier/marketing-kits/${productId}`, payload);
  },

  // saler
  getSalerSamples() {
    return api.get('/sourcing/samples');
  },
  requestSample(payload) {
    return api.post('/sourcing/samples', payload);
  },
  act(requestId, action) {
    return api.post(`/sourcing/samples/${requestId}/${action}`, {});
  },
  getSalerKits() {
    return api.get('/sourcing/marketing-kits');
  },
};
