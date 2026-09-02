/**
 * liveStream.controller.js — HTTP request controller for Live Stream Commerce (Prompt 10.1).
 *
 * Implements API contract responses with data envelope, error codes, and audit logs.
 */

import * as liveService from '../services/liveStream.service.js';

export async function scheduleStream(req, reply) {
  const stream = await liveService.scheduleStream(req.server.db, {
    hostId: req.user.id,
    storeId: req.body?.store_id,
    title: req.body?.title,
    description: req.body?.description,
    coverImage: req.body?.cover_image,
    scheduledFor: req.body?.scheduled_for,
    products: req.body?.products || [],
    settings: req.body?.settings || {},
  });

  return reply.status(201).send({
    data: { stream },
    meta: {
      message_en: 'Live stream scheduled successfully.',
      message_bn: 'লাইভ স্ট্রিমটি সফলভাবে শিডিউল করা হয়েছে।',
    },
  });
}

export async function listStreams(req, reply) {
  const status = req.query.status || null;
  const hostId = req.query.host_id || null;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
  const cursor = req.query.cursor || null;

  const result = await liveService.listStreams(req.server.db, { status, hostId, limit, cursor });

  return reply.send({
    data: result,
  });
}

export async function getStream(req, reply) {
  const audioOnly = req.query.audio_only === 'true';
  const result = await liveService.getStreamDetails(
    req.server.db,
    req.params.id,
    req.user || null,
    audioOnly
  );

  return reply.send({
    data: result,
  });
}

export async function startStream(req, reply) {
  const result = await liveService.startStream(req.server.db, {
    streamId: req.params.id,
    hostId: req.user.id,
    user: req.user,
  });

  return reply.send({
    data: result,
    meta: {
      message_en: 'You are now LIVE!',
      message_bn: 'আপনি এখন লাইভে আছেন!',
    },
  });
}

export async function endStream(req, reply) {
  const result = await liveService.endStream(req.server.db, {
    streamId: req.params.id,
    hostId: req.user.id,
    user: req.user,
  });

  return reply.send({
    data: { stream: result },
    meta: {
      message_en: 'Live stream ended.',
      message_bn: 'লাইভ স্ট্রিম শেষ হয়েছে।',
    },
  });
}

export async function pinProduct(req, reply) {
  const pinned = await liveService.pinProduct(req.server.db, {
    streamId: req.params.id,
    hostId: req.user.id,
    productId: req.body?.product_id,
    user: req.user,
  });

  return reply.send({
    data: { pinned_product: pinned },
  });
}

export async function unpinProduct(req, reply) {
  await liveService.unpinProduct(req.server.db, {
    streamId: req.params.id,
    hostId: req.user.id,
    productId: req.body?.product_id,
    user: req.user,
  });

  return reply.send({
    data: { success: true },
  });
}

export async function recordReaction(req, reply) {
  const result = await liveService.recordStreamReaction(req.server.db, {
    streamId: req.params.id,
    userId: req.user?.id || null,
    emoji: req.body?.emoji || '❤️',
  });

  return reply.send({
    data: result,
  });
}

export async function executeInStreamBuy(req, reply) {
  const result = await liveService.executeInStreamBuy(req.server.db, req.server.cache, {
    streamId: req.params.id,
    user: req.user,
    productId: req.body?.product_id,
    variantId: req.body?.variant_id,
    qty: req.body?.quantity || 1,
    recipientName: req.body?.recipient_name,
    recipientPhone: req.body?.recipient_phone,
    division: req.body?.division,
    district: req.body?.district,
    addressLine: req.body?.address_line,
    paymentMethod: req.body?.payment_method || 'COD',
  });

  return reply.status(201).send({
    data: { order: result.order },
    meta: {
      message_en: result.messageEn,
      message_bn: result.messageBn,
    },
  });
}

export async function moderateTerminate(req, reply) {
  const result = await liveService.terminateStream(req.server.db, {
    streamId: req.params.id,
    moderatorId: req.user.id,
    reason: req.body?.reason || 'Policy Violation',
  });

  return reply.send({
    data: { stream: result },
    meta: {
      message_en: 'Stream has been force-terminated.',
      message_bn: 'স্ট্রিমটি জোরপূর্বক বন্ধ করা হয়েছে।',
    },
  });
}

export async function moderateMute(req, reply) {
  const { target_user_id, duration_minutes = 15, reason } = req.body || {};

  // WHY: this used to reach straight into sockets/presence.js and silence the user with nothing
  // written anywhere — no audit_logs row, no entry in the stream's own moderation log. It now
  // goes through the service so muting a participant leaves the same trail every other staff
  // action does.
  const result = await liveService.muteParticipant(req.server.db, {
    streamId: req.params.id,
    targetUserId: target_user_id,
    moderatorId: req.user.id,
    durationMinutes: duration_minutes,
    reason,
  });

  return reply.send({
    data: { success: true, ...result },
    meta: {
      message_en: 'User muted successfully.',
      message_bn: 'ব্যবহারকারীকে সফলভাবে মিউট করা হয়েছে।',
    },
  });
}

// ── Live Moderation Console (/moderator/live) ────────────────────────────────

export async function listModerationStreams(req, reply) {
  const streams = await liveService.listStreamsForModeration(req.server.db, {
    status: req.query?.status ?? null,
    limit: Math.min(Number(req.query?.limit) || 50, 100),
  });

  return reply.send({ data: { streams, total: streams.length } });
}

export async function getModerationFeed(req, reply) {
  const feed = await liveService.getStreamModerationFeed(req.server.db, req.params.id, {
    sinceId: Number(req.query?.since_id) || 0,
    limit: Math.min(Number(req.query?.limit) || 200, 500),
    moderator: req.user,
    // Data saver matters here as much as it does for shoppers: a moderator sweeping a dozen
    // broadcasts on a mobile connection should be able to drop to audio.
    audioOnly: req.query?.audio_only === 'true',
  });

  return reply.send({ data: feed });
}

export async function moderateRemoveMessage(req, reply) {
  const removed = await liveService.removeStreamMessage(req.server.db, {
    streamId: req.params.id,
    messageId: req.params.messageId,
    moderatorId: req.user.id,
    reason: req.body?.reason,
  });

  return reply.send({
    data: { message_id: removed.id, deleted_at: removed.deleted_at },
    meta: {
      message_en: 'Message removed from the live chat.',
      message_bn: 'লাইভ চ্যাট থেকে বার্তাটি সরানো হয়েছে।',
    },
  });
}

export async function moderateUnmute(req, reply) {
  const result = await liveService.unmuteParticipant(req.server.db, {
    streamId: req.params.id,
    targetUserId: req.body?.target_user_id,
    moderatorId: req.user.id,
  });

  return reply.send({
    data: result,
    meta: {
      message_en: result.was_muted ? 'Mute lifted.' : 'That participant was not muted.',
      message_bn: result.was_muted
        ? 'মিউট তুলে নেওয়া হয়েছে।'
        : 'এই অংশগ্রহণকারী মিউট করা ছিল না।',
    },
  });
}
