/**
 * developer.api.js — Client API service for Developer Portal, API Keys & Webhooks (Prompt 10.7).
 */

import { api } from '../core/api.js';

export async function listApiKeys() {
  return api.get('/developer/api-keys');
}

export async function createApiKey(payload) {
  return api.post('/developer/api-keys', payload);
}

export async function rotateApiKey(id) {
  return api.post(`/developer/api-keys/${id}/rotate`, {});
}

export async function revokeApiKey(id) {
  return api.delete(`/developer/api-keys/${id}`);
}

export async function listWebhookSubscriptions() {
  return api.get('/developer/webhooks');
}

export async function createWebhookSubscription(payload) {
  return api.post('/developer/webhooks', payload);
}

export async function deleteWebhookSubscription(id) {
  return api.delete(`/developer/webhooks/${id}`);
}

export async function listWebhookDeliveries(params = {}) {
  return api.get('/developer/webhooks/deliveries', { query: params });
}

export async function replayWebhookDelivery(deliveryId) {
  return api.post(`/developer/webhooks/deliveries/${deliveryId}/replay`, {});
}
