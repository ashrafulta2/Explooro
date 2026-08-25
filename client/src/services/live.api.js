/**
 * live.api.js — API client for Live Stream Commerce (Prompt 10.1 / DFD Subsystem 15.0).
 */

import { api } from '../core/api.js';

export async function scheduleLiveStream(payload) {
  return api.post('/live/streams', payload);
}

export async function listLiveStreams(params = {}) {
  return api.get('/live/streams', { params });
}

export async function getLiveStream(id, audioOnly = false) {
  return api.get(`/live/streams/${id}`, {
    params: { audio_only: audioOnly ? 'true' : 'false' },
  });
}

export async function startLiveStream(id) {
  return api.post(`/live/streams/${id}/start`, {});
}

export async function endLiveStream(id) {
  return api.post(`/live/streams/${id}/end`, {});
}

export async function pinLiveProduct(streamId, productId) {
  return api.post(`/live/streams/${streamId}/pin`, { product_id: Number(productId) });
}

export async function unpinLiveProduct(streamId, productId = null) {
  return api.post(`/live/streams/${streamId}/unpin`, { product_id: productId ? Number(productId) : undefined });
}

export async function sendLiveReaction(streamId, emoji = '❤️') {
  return api.post(`/live/streams/${streamId}/reaction`, { emoji });
}

export async function inStreamBuy(streamId, payload) {
  return api.post(`/live/streams/${streamId}/in-stream-buy`, payload);
}

export async function terminateLiveStream(streamId, reason = 'Policy Violation') {
  return api.post(`/live/streams/${streamId}/moderate/terminate`, { reason });
}

export async function muteLiveParticipant(streamId, targetUserId, durationMinutes = 15) {
  return api.post(`/live/streams/${streamId}/moderate/mute`, {
    target_user_id: Number(targetUserId),
    duration_minutes: Number(durationMinutes),
  });
}
