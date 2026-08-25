/**
 * bundle.api.js — API client for Cross-Seller Bundling & Surge Pricing (Prompt 10.5).
 */

import { api } from '../core/api.js';

export async function previewBundleBreakdown(payload) {
  return api.post('/saler/bundles/preview', payload);
}

export async function createBundle(payload) {
  return api.post('/saler/bundles', payload);
}

export async function listSalerBundles(params = {}) {
  return api.get('/saler/bundles', { query: params });
}

export async function getBundle(idOrRef) {
  return api.get(`/bundles/${idOrRef}`);
}

export async function updateBundle(id, payload) {
  return api.patch(`/saler/bundles/${id}`, payload);
}

export async function deleteBundle(id) {
  return api.delete(`/saler/bundles/${id}`);
}

export async function addBundleToCart(payload) {
  return api.post('/cart/bundle', payload);
}

export async function listSurgeRecommendations(params = {}) {
  return api.get('/supplier/surge/recommendations', { query: params });
}

export async function analyzeProductDemand(productId) {
  return api.get(`/supplier/surge/analyze/${productId}`);
}

export async function acceptSurgeRecommendation(id) {
  return api.post(`/supplier/surge/recommendations/${id}/accept`, {});
}

export async function dismissSurgeRecommendation(id) {
  return api.post(`/supplier/surge/recommendations/${id}/dismiss`, {});
}
