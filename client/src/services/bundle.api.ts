/**
 * bundle.api.ts — API client for Cross-Seller Bundling & Surge Pricing (Prompt 10.5).
 */

import { api } from '../core/api.ts';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, unknown>;

export async function previewBundleBreakdown(payload: Params) {
  return api.post('/saler/bundles/preview', payload);
}

export async function createBundle(payload: Params) {
  return api.post('/saler/bundles', payload);
}

export async function listSalerBundles(params: Params = {}) {
  return api.get('/saler/bundles', { query: params });
}

export async function getBundle(idOrRef: number | string) {
  return api.get(`/bundles/${idOrRef}`);
}

export async function updateBundle(id: number | string, payload: Params) {
  return api.patch(`/saler/bundles/${id}`, payload);
}

export async function deleteBundle(id: number | string) {
  return api.delete(`/saler/bundles/${id}`);
}

export async function addBundleToCart(payload: Params) {
  return api.post('/cart/bundle', payload);
}

export async function listSurgeRecommendations(params: Params = {}) {
  return api.get('/supplier/surge/recommendations', { query: params });
}

export async function analyzeProductDemand(productId: number | string) {
  return api.get(`/supplier/surge/analyze/${productId}`);
}

export async function acceptSurgeRecommendation(id: number | string) {
  return api.post(`/supplier/surge/recommendations/${id}/accept`, {});
}

export async function dismissSurgeRecommendation(id: number | string) {
  return api.post(`/supplier/surge/recommendations/${id}/dismiss`, {});
}
