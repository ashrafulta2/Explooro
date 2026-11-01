/**
 * live.api.ts — API client for Live Stream Commerce (Prompt 10.1 / DFD Subsystem 15.0).
 */

import { api } from '../core/api.ts';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, unknown>;

export async function scheduleLiveStream(payload: Params) {
  return api.post('/live/streams', payload);
}

export async function listLiveStreams(params: Params = {}) {
  return api.get('/live/streams', { query: params });
}

export async function getLiveStream(id: number | string, audioOnly = false) {
  return api.get(`/live/streams/${id}`, {
    query: { audio_only: audioOnly ? 'true' : 'false' },
  });
}

export async function startLiveStream(id: number | string) {
  return api.post(`/live/streams/${id}/start`, {});
}

export async function endLiveStream(id: number | string) {
  return api.post(`/live/streams/${id}/end`, {});
}

export async function pinLiveProduct(streamId: number | string, productId: number | string) {
  return api.post(`/live/streams/${streamId}/pin`, { product_id: Number(productId) });
}

export async function unpinLiveProduct(streamId: number | string, productId: number | string | null = null) {
  return api.post(`/live/streams/${streamId}/unpin`, { product_id: productId ? Number(productId) : undefined });
}

export async function sendLiveReaction(streamId: number | string, emoji = '❤️') {
  return api.post(`/live/streams/${streamId}/reaction`, { emoji });
}

export interface InStreamQuoteOptions {
  productId: number | string;
  variantId?: number | string | null;
  quantity?: number;
  couponCode?: string;
  district?: string;
}

export async function getInStreamQuote(streamId: number | string, { productId, variantId = null, quantity = 1, couponCode = '', district = '' }: InStreamQuoteOptions) {
  const query: Record<string, unknown> = { product_id: Number(productId), quantity };
  if (couponCode) query.coupon_code = couponCode;
  // The district picks the delivery zone the quote charges; the order resolves the same zone.
  if (district) query.district = district;
  if (variantId) query.variant_id = Number(variantId);
  return api.get(`/live/streams/${streamId}/quote`, { query });
}

export async function inStreamBuy(streamId: number | string, payload: Params, { idempotencyKey = null }: { idempotencyKey?: string | null } = {}) {
  // WHY a caller-held key: the drawer keeps one per open drawer so a double-tap replays the same order.
  return api.post(`/live/streams/${streamId}/in-stream-buy`, payload, idempotencyKey ? { idempotencyKey } : undefined);
}

export async function terminateLiveStream(streamId: number | string, reason = 'Policy Violation') {
  return api.post(`/live/streams/${streamId}/moderate/terminate`, { reason });
}

export async function muteLiveParticipant(streamId: number | string, targetUserId: number | string, durationMinutes: number | string = 15) {
  return api.post(`/live/streams/${streamId}/moderate/mute`, {
    target_user_id: Number(targetUserId),
    duration_minutes: Number(durationMinutes),
  });
}
