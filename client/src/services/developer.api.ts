/**
 * developer.api.ts — Client API service for Developer Portal, API Keys & Webhooks (Prompt 10.7).
 */

import { api } from '../core/api.ts';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, unknown>;

export async function listApiKeys() {
  return api.get('/developer/api-keys');
}

export async function createApiKey(payload: Params) {
  return api.post('/developer/api-keys', payload);
}

export async function rotateApiKey(id: number | string) {
  return api.post(`/developer/api-keys/${id}/rotate`, {});
}

export async function revokeApiKey(id: number | string) {
  return api.delete(`/developer/api-keys/${id}`);
}

export async function listWebhookSubscriptions() {
  return api.get('/developer/webhooks');
}

export async function createWebhookSubscription(payload: Params) {
  return api.post('/developer/webhooks', payload);
}

export async function deleteWebhookSubscription(id: number | string) {
  return api.delete(`/developer/webhooks/${id}`);
}

export async function listWebhookDeliveries(params: Params = {}) {
  return api.get('/developer/webhooks/deliveries', { query: params });
}

export async function replayWebhookDelivery(deliveryId: number | string) {
  return api.post(`/developer/webhooks/deliveries/${deliveryId}/replay`, {});
}
