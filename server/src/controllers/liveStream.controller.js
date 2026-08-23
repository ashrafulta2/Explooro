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
  const { target_user_id, duration_minutes = 15 } = req.body || {};
  // Call socket presence muting
  const { muteUserInStream } = await import('../sockets/presence.js');
  muteUserInStream(req.params.id, target_user_id, duration_minutes * 60 * 1000);

  return reply.send({
    data: { success: true, target_user_id, duration_minutes },
    meta: {
      message_en: 'User muted successfully.',
      message_bn: 'ব্যবহারকারীকে সফলভাবে মিউট করা হয়েছে।',
    },
  });
}
