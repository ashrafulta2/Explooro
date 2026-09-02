/**
 * liveStream.service.js — Live Stream Commerce Business Logic Service (Prompt 10.1 / DFD Subsystem 15.0).
 *
 * Implements:
 * 1. Stream lifecycle: scheduling, live initiation, completion, and moderator forced termination.
 * 2. Streaming adapter orchestration (room creation, publisher/viewer token generation).
 * 3. Real-time product pinning and catalog synchronization with < 1s latency.
 * 4. In-stream checkout execution with direct order stream attribution and real-time purchase toasts.
 * 5. Moderation hooks (participant muting, stream termination audit).
 * 6. Live recordings and replay media pipeline integration.
 */

import { AppError } from '../plugins/errorHandler.js';
import { generateRef } from '../lib/ref.js';
import * as liveRepo from '../repositories/liveStream.repository.js';
import { streaming } from '../integrations/streaming/index.js';
import {
  broadcastToStream,
  isUserMutedInStream,
  muteUserInStream,
  unmuteUserInStream,
  getStreamMutes,
} from '../sockets/presence.js';
import * as auditService from './audit.service.js';
import { detectContactInfoLeak } from './chat.service.js';
import { preScreenContent } from './moderation.service.js';

export async function scheduleStream(db, {
  hostId,
  storeId = null,
  title,
  description = null,
  coverImage = null,
  scheduledFor = null,
  products = [],
  settings = {},
}) {
  if (!title || !title.trim()) {
    throw new AppError('TITLE_REQUIRED', 'Stream title is required.', 'লাইভ স্ট্রিমের শিরোনাম আবশ্যক।');
  }

  const ref = generateRef('LIV');
  const tempRoomId = `room_pending_${ref}`;

  // 1. Create Stream Record in DB
  const stream = await liveRepo.createStream(db, {
    ref,
    hostId: Number(hostId),
    storeId: storeId ? Number(storeId) : null,
    title: title.trim(),
    description,
    coverImage,
    status: 'SCHEDULED',
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    roomId: tempRoomId,
    settingsJson: {
      chat_enabled: true,
      audio_only_allowed: true,
      ...settings,
    },
  });

  // 2. Associate featured showcase products
  if (products && products.length > 0) {
    await liveRepo.addProductsToStream(db, stream.id, products);
  }

  // 3. Initialize streaming room via adapter
  const room = await streaming.createRoom({
    streamId: stream.id,
    title: stream.title,
    hostId,
  });

  // Update room_id with adapter room ID
  await db.query('UPDATE live_streams SET room_id = $1 WHERE id = $2', [room.roomId, stream.id]);
  stream.room_id = room.roomId;

  return stream;
}

export async function startStream(db, { streamId, hostId, user }) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিমটি খুঁজে পাওয়া যায়নি।');
  }

  if (Number(stream.host_id) !== Number(hostId) && user?.role !== 'admin' && user?.role !== 'super_admin') {
    throw new AppError('FORBIDDEN', 'Only the host can start this live stream.', 'শুধুমাত্র হোস্ট এই স্ট্রিম শুরু করতে পারবেন।');
  }

  if (stream.status === 'LIVE') {
    // Already live, return existing stream & publisher token
    const tokenData = await streaming.getPublisherToken({
      streamId: stream.id,
      roomId: stream.room_id,
      userId: hostId,
      userName: user?.full_name || stream.host_name,
    });
    return { stream, tokenData };
  }

  if (stream.status === 'TERMINATED' || stream.status === 'ENDED') {
    throw new AppError('STREAM_CLOSED', 'This stream has already concluded.', 'এই লাইভ স্ট্রিমটি ইতিমধ্যে শেষ হয়েছে।');
  }

  const updated = await liveRepo.updateStreamStatus(db, stream.id, 'LIVE');

  // Broadcast stream started
  broadcastToStream(stream.id, {
    type: 'live:stream_started',
    payload: {
      streamId: stream.id,
      title: stream.title,
      startedAt: updated.started_at,
    },
  });

  const tokenData = await streaming.getPublisherToken({
    streamId: stream.id,
    roomId: stream.room_id,
    userId: hostId,
    userName: user?.full_name || stream.host_name,
  });

  return { stream: updated, tokenData };
}

export async function endStream(db, { streamId, hostId, user }) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিমটি খুঁজে পাওয়া যায়নি।');
  }

  if (Number(stream.host_id) !== Number(hostId) && user?.role !== 'admin' && user?.role !== 'super_admin') {
    throw new AppError('FORBIDDEN', 'Only the host can end this live stream.', 'শুধুমাত্র হোস্ট এই স্ট্রিম শেষ করতে পারবেন।');
  }

  // End streaming room via adapter
  await streaming.endRoom({ streamId: stream.id, roomId: stream.room_id });

  // Get recording metadata
  const recording = await streaming.getRecording({ streamId: stream.id, roomId: stream.room_id });

  const updated = await liveRepo.updateStreamStatus(db, stream.id, 'ENDED', {
    recordingUrl: recording?.recordingUrl || null,
    playbackUrl: recording?.recordingUrl || null,
  });

  // Broadcast stream ended
  broadcastToStream(stream.id, {
    type: 'live:stream_ended',
    payload: {
      streamId: stream.id,
      endedAt: updated.ended_at,
      totalSalesCount: updated.total_sales_count,
      totalSalesAmount: updated.total_sales_amount,
    },
  });

  return updated;
}

export async function terminateStream(db, { streamId, moderatorId, reason }) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিমটি খুঁজে পাওয়া যায়নি।');
  }

  await streaming.endRoom({ streamId: stream.id, roomId: stream.room_id });

  const updated = await liveRepo.updateStreamStatus(db, stream.id, 'TERMINATED', {
    terminatedBy: moderatorId,
    terminationReason: reason || 'Policy Violation',
  });

  await liveRepo.createMessage(db, {
    streamId: stream.id,
    userId: moderatorId,
    messageType: 'MODERATION',
    content: `Stream was terminated by moderation. Reason: ${reason}`,
    metadataJson: { action: 'TERMINATE', moderatorId, reason },
  });

  // WHY: cutting a seller's broadcast off mid-sale is one of the most contestable actions a
  // moderator can take, and it was writing nothing to audit_logs — leaving no before/after to
  // answer "who stopped my stream, and on what grounds?" with.
  await auditService.record(db, {
    actor: moderatorId,
    action: 'live.stream.terminate',
    target_type: 'live_stream',
    target_ref: stream.ref ?? String(stream.id),
    before: { status: stream.status, terminated_by: stream.terminated_by, termination_reason: stream.termination_reason },
    after: { status: updated.status, terminated_by: moderatorId, termination_reason: reason || 'Policy Violation' },
    risk_tier: 'HIGH',
  });

  broadcastToStream(stream.id, {
    type: 'live:stream_terminated',
    payload: {
      streamId: stream.id,
      moderatorId,
      reason,
      timestamp: Date.now(),
    },
  });

  return updated;
}

export async function getStreamDetails(db, streamId, currentUser = null, audioOnly = false) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিমটি খুঁজে পাওয়া যায়নি।');
  }

  const products = await liveRepo.getStreamProducts(db, streamId);
  const pinnedProduct = await liveRepo.getPinnedProduct(db, streamId);
  const recentMessages = await liveRepo.getStreamMessages(db, streamId, { limit: 50 });

  // Generate appropriate token based on role
  let tokenData = null;
  const isHost = currentUser && Number(currentUser.id) === Number(stream.host_id);

  if (isHost) {
    tokenData = await streaming.getPublisherToken({
      streamId: stream.id,
      roomId: stream.room_id,
      userId: currentUser.id,
      userName: currentUser.full_name,
    });
  } else {
    tokenData = await streaming.getViewerToken({
      streamId: stream.id,
      roomId: stream.room_id,
      userId: currentUser?.id || null,
      userName: currentUser?.full_name || 'Guest Viewer',
      audioOnly: Boolean(audioOnly),
    });
  }

  return {
    stream,
    products,
    pinnedProduct,
    recentMessages,
    tokenData,
    driver: streaming.driverName,
    isHost,
    isMuted: currentUser ? isUserMutedInStream(streamId, currentUser.id) : false,
  };
}

export async function listStreams(db, filters = {}) {
  const streams = await liveRepo.listStreams(db, filters);
  return { streams };
}

export async function pinProduct(db, { streamId, hostId, productId, user }) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Stream not found.', 'স্ট্রিম পাওয়া যায়নি।');
  }

  if (Number(stream.host_id) !== Number(hostId) && user?.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only host can pin products.', 'শুধুমাত্র হোস্ট প্রোডাক্ট পিন করতে পারবেন।');
  }

  await liveRepo.pinProduct(db, streamId, Number(productId));
  const pinnedProduct = await liveRepo.getPinnedProduct(db, streamId);

  // Broadcast pin event to room with sub-second latency
  broadcastToStream(streamId, {
    type: 'live:pinned_product',
    payload: {
      streamId: Number(streamId),
      pinnedProduct,
      timestamp: Date.now(),
    },
  });

  return pinnedProduct;
}

export async function unpinProduct(db, { streamId, hostId, productId = null, user }) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Stream not found.', 'স্ট্রিম পাওয়া যায়নি।');
  }

  if (Number(stream.host_id) !== Number(hostId) && user?.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only host can unpin products.', 'শুধুমাত্র হোস্ট প্রোডাক্ট আনপিন করতে পারবেন।');
  }

  await liveRepo.unpinProduct(db, streamId, productId ? Number(productId) : null);

  broadcastToStream(streamId, {
    type: 'live:pinned_product',
    payload: {
      streamId: Number(streamId),
      pinnedProduct: null,
      timestamp: Date.now(),
    },
  });

  return { success: true };
}

export async function recordStreamReaction(db, { streamId, userId, emoji = '❤️' }) {
  const totalLikes = await liveRepo.incrementLikes(db, streamId, 1);

  broadcastToStream(streamId, {
    type: 'live:reaction_broadcast',
    payload: {
      streamId: Number(streamId),
      userId,
      emoji,
      totalLikes,
      timestamp: Date.now(),
    },
  });

  return { totalLikes };
}

export async function recordStreamPurchase(db, { streamId, orderRef, orderAmount, buyerName, productTitle }) {
  const sId = Number(streamId);
  const stats = await liveRepo.recordStreamSale(db, sId, Number(orderAmount));

  // Broadcast live sale event to all stream viewers and host
  broadcastToStream(sId, {
    type: 'live:sale_event',
    payload: {
      streamId: sId,
      orderRef,
      orderAmount,
      buyerName: buyerName ? buyerName.slice(0, 1) + '***' : 'A shopper',
      productTitle,
      totalSalesCount: stats.total_sales_count,
      totalSalesAmount: stats.total_sales_amount,
      timestamp: Date.now(),
    },
  });

  return stats;
}

export async function executeInStreamBuy(pool, cache, {
  streamId,
  user,
  productId,
  variantId = null,
  qty = 1,
  recipientName,
  recipientPhone,
  division,
  district,
  addressLine,
  paymentMethod = 'COD',
}) {
  const sId = Number(streamId);
  const stream = await liveRepo.findStreamById(pool, sId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিম পাওয়া যায়নি।');
  }

  // Look up product
  const { rows: prodRows } = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
  const product = prodRows[0];
  if (!product) {
    throw new AppError('PRODUCT_NOT_FOUND', 'Product not found.', 'পণ্য পাওয়া যায়নি।');
  }

  const orderRef = generateRef('ORD');
  const unitPrice = Number(product.base_cost) + Number(product.wholesale_margin) + 150; // demo retail
  const itemsAmount = unitPrice * Number(qty);
  const shippingAmount = division === 'Dhaka' ? 60 : 120;
  const totalAmount = itemsAmount + shippingAmount;

  // Insert order attributed to live_stream_id
  const insertOrderSql = `
    INSERT INTO orders (
      ref, customer_id, total_amount, items_amount, shipping_amount,
      payment_method, payment_status, recipient_name, recipient_phone,
      division, district, address_line, live_stream_id, placed_at, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, $9, $10, $11, $12, now(), now())
    RETURNING *;
  `;

  const { rows: orderRows } = await pool.query(insertOrderSql, [
    orderRef,
    user.id,
    totalAmount,
    itemsAmount,
    shippingAmount,
    paymentMethod,
    recipientName || user.full_name || 'In-Stream Buyer',
    recipientPhone || user.phone || '01700000000',
    division || 'Dhaka',
    district || 'Dhaka',
    addressLine || 'Live Stream Instant Order',
    sId,
  ]);

  const order = orderRows[0];

  // Record stream sale stats and broadcast purchase notification toast
  await recordStreamPurchase(pool, {
    streamId: sId,
    orderRef: order.ref,
    orderAmount: totalAmount,
    buyerName: user.full_name || 'Customer',
    productTitle: product.title_en,
  });

  return {
    order,
    messageEn: 'In-stream purchase completed successfully!',
    messageBn: 'লাইভ স্ট্রিমে অর্ডারটি সফলভাবে সম্পন্ন হয়েছে!',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Moderation Console (/moderator/live)
//
// Prompt 10.1 REQUIREMENT 6 gave moderators two blunt controls — mute a participant, terminate a
// stream — with nothing in between, and no surface to decide from. Everything below serves the
// console: the signals a moderator triages on, and the one action that sits between "watch" and
// "kill the broadcast" (removing a single message).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Advisory flags on one chat message. Deliberately reuses the two detectors the platform already
 * trusts elsewhere rather than inventing a third vocabulary:
 *   - chat.service.js's detectContactInfoLeak — the Phase 8 off-platform-contact detector.
 *   - moderation.service.js's preScreenContent — the same EN/BN banned-keyword blocklist the
 *     product queue screens against, so a term banned for a listing is banned in live chat too.
 *
 * ADVISORY, never automatic: nothing here removes a message on its own. It only decides what a
 * human sees first.
 */
export async function flagLiveMessage(db, content) {
  const flags = [];

  const leak = detectContactInfoLeak(content);
  if (leak.isLeaked) {
    flags.push({
      code: 'EXTERNAL_CONTACT_LEAK',
      severity: 'HIGH',
      label_en: 'Off-platform contact details shared in chat',
      label_bn: 'চ্যাটে প্ল্যাটফর্মের বাইরের যোগাযোগের তথ্য শেয়ার করা হয়েছে',
      matches: leak.matches,
    });
  }

  try {
    // preScreenContent screens a title+description pair; a chat line is just a description with
    // no title, and it is passed as both EN and BN so either blocklist can match it — live chat
    // is routinely code-mixed Banglish, so language cannot be inferred from the field it arrived in.
    // preScreenContent returns a bare array of flags, not a { flags } envelope.
    const screened = await preScreenContent({
      descriptionEn: content,
      descriptionBn: content,
      db,
    });
    for (const flag of Array.isArray(screened) ? screened : (screened?.flags ?? [])) {
      if (flag.code === 'PROHIBITED_KEYWORD_EN' || flag.code === 'PROHIBITED_KEYWORD_BN') {
        flags.push(flag);
      }
    }
  } catch {
    // A blocklist lookup failure must not blank the moderator's chat feed — the leak detector
    // above is pure and already ran, so the feed degrades to fewer flags rather than to nothing.
  }

  return flags;
}

/**
 * Stream list for the console's left rail, with the counts a moderator triages on.
 */
export async function listStreamsForModeration(db, { status = null, limit = 50 } = {}) {
  const streams = await liveRepo.listStreamsForModeration(db, { status, limit });
  return streams.map((stream) => ({
    ...stream,
    muted_count: getStreamMutes(stream.id).length,
  }));
}

/**
 * Everything the console's right pane renders for one stream: the broadcast, its chat with
 * advisory flags resolved, who is currently muted, and the moderation actions already taken.
 */
/**
 * What the console can actually show of the broadcast itself.
 *
 *   LIVE                  -> an OBSERVER token. Covert by design: the moderator subscribes without
 *                            joining the roster and without the ability to publish data, so the
 *                            host cannot see they are being watched and the moderator cannot speak
 *                            as a viewer. Observation is silent; enforcement is not — every mute,
 *                            removal and termination is announced into the stream's own log.
 *   ENDED / TERMINATED    -> the recording, because a termination gets contested after the fact and
 *                            "what did the stream actually show" is the whole question then.
 *   SCHEDULED             -> nothing has been broadcast yet.
 */
async function buildPreview(stream, { moderator = null, audioOnly = false } = {}) {
  if (stream.status === 'LIVE') {
    const token = await streaming.getViewerToken({
      streamId: stream.id,
      roomId: stream.room_id,
      userId: moderator?.id ?? null,
      userName: 'Moderation',
      audioOnly,
      observer: true,
    });
    return {
      mode: 'LIVE',
      driver: streaming.driverName,
      room_id: stream.room_id,
      playback_url: stream.playback_url ?? null,
      audio_only: Boolean(audioOnly),
      token: token.token,
      identity: token.identity,
      hidden: token.hidden,
      can_publish_data: token.permissions.canPublishData,
      expires_at: token.expiresAt,
    };
  }

  if (stream.status === 'ENDED' || stream.status === 'TERMINATED') {
    // A recording is not always there — the pipeline may still be processing, or the broadcast may
    // have been cut before anything was captured. Returning mode UNAVAILABLE lets the console say
    // so rather than render a dead player.
    try {
      const recording = await streaming.getRecording({ streamId: stream.id, roomId: stream.room_id });
      if (recording?.status === 'READY' && recording.recordingUrl) {
        return {
          mode: 'RECORDING',
          driver: streaming.driverName,
          recording_url: stream.recording_url ?? recording.recordingUrl,
          duration_seconds: recording.durationSeconds ?? null,
          recorded_at: recording.recordedAt ?? null,
        };
      }
      return { mode: 'UNAVAILABLE', reason: 'RECORDING_NOT_READY' };
    } catch {
      return { mode: 'UNAVAILABLE', reason: 'RECORDING_NOT_READY' };
    }
  }

  return { mode: 'NOT_STARTED' };
}

export async function getStreamModerationFeed(db, streamId, { sinceId = 0, limit = 200, moderator = null, audioOnly = false } = {}) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিমটি খুঁজে পাওয়া যায়নি।');
  }

  const rows = await liveRepo.getStreamMessagesForModeration(db, stream.id, { sinceId, limit });

  const messages = [];
  const actionLog = [];

  for (const row of rows) {
    if (row.message_type === 'MODERATION') {
      actionLog.push({
        id: row.id,
        action: row.metadata_json?.action ?? 'MODERATION',
        content: row.content,
        actor_id: row.user_id,
        actor_name: row.user_name,
        metadata: row.metadata_json ?? {},
        created_at: row.created_at,
      });
      continue;
    }

    // Only real chat carries user-authored text worth screening; PIN_PRODUCT / BUY / REACTION
    // rows are system-generated and can never contain a policy violation.
    const flags =
      row.message_type === 'CHAT' && !row.deleted_at ? await flagLiveMessage(db, row.content) : [];

    messages.push({
      id: row.id,
      message_type: row.message_type,
      content: row.content,
      user_id: row.user_id,
      user_name: row.user_name,
      user_roles: row.user_roles ?? [],
      created_at: row.created_at,
      deleted_at: row.deleted_at,
      deleted_by: row.deleted_by,
      deleted_by_name: row.deleted_by_name,
      deletion_reason: row.deletion_reason,
      flags,
    });
  }

  return {
    stream,
    preview: await buildPreview(stream, { moderator, audioOnly }),
    messages,
    action_log: actionLog.reverse(),
    mutes: getStreamMutes(stream.id),
    flagged_count: messages.filter((m) => m.flags.length > 0).length,
    removed_count: messages.filter((m) => m.deleted_at).length,
  };
}

/**
 * Removes one abusive chat message without stopping the broadcast — the proportionate action the
 * console previously had no way to take, since mute silences a person and terminate kills the sale.
 */
export async function removeStreamMessage(db, { streamId, messageId, moderatorId, reason }) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিমটি খুঁজে পাওয়া যায়নি।');
  }

  const removed = await liveRepo.softDeleteMessage(db, {
    streamId: stream.id,
    messageId,
    moderatorId,
    reason: reason || 'Policy Violation',
  });

  if (!removed) {
    // Covers both "no such message" and "belongs to a different stream" on purpose: a moderator
    // must not be able to probe another broadcast's message ids through the difference.
    throw new AppError(
      'MESSAGE_NOT_FOUND',
      'That message is not in this stream, or has already been removed.',
      'বার্তাটি এই স্ট্রিমে নেই, অথবা এটি ইতিমধ্যে সরানো হয়েছে।'
    );
  }

  await liveRepo.createMessage(db, {
    streamId: stream.id,
    userId: moderatorId,
    messageType: 'MODERATION',
    content: `A chat message was removed. Reason: ${reason || 'Policy Violation'}`,
    metadataJson: {
      action: 'REMOVE_MESSAGE',
      moderatorId,
      messageId: removed.id,
      targetUserId: removed.user_id,
      reason: reason || 'Policy Violation',
    },
  });

  await auditService.record(db, {
    actor: moderatorId,
    action: 'live.message.remove',
    target_type: 'live_stream_message',
    target_ref: String(removed.id),
    before: { content: removed.content, deleted_at: null, user_id: removed.user_id },
    after: {
      deleted_at: removed.deleted_at,
      deleted_by: moderatorId,
      deletion_reason: removed.deletion_reason,
    },
    risk_tier: 'MEDIUM',
  });

  // Viewers still have the message on screen; without this it stays there until they reload.
  broadcastToStream(stream.id, {
    type: 'live:message_removed',
    payload: { streamId: stream.id, messageId: removed.id, timestamp: Date.now() },
  });

  return removed;
}

/**
 * Silences a participant for a bounded window, and records it. Enforcement stays in the socket
 * layer (that is where the connection to silence lives); this adds the paper trail around it.
 */
export async function muteParticipant(db, { streamId, targetUserId, moderatorId, durationMinutes = 15, reason }) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিমটি খুঁজে পাওয়া যায়নি।');
  }

  muteUserInStream(stream.id, targetUserId, durationMinutes * 60 * 1000);

  await liveRepo.createMessage(db, {
    streamId: stream.id,
    userId: moderatorId,
    messageType: 'MODERATION',
    content: `Participant muted for ${durationMinutes} minutes. Reason: ${reason || 'Chat policy violation'}`,
    metadataJson: {
      action: 'MUTE',
      moderatorId,
      targetUserId,
      durationMinutes,
      reason: reason || 'Chat policy violation',
    },
  });

  await auditService.record(db, {
    actor: moderatorId,
    action: 'live.participant.mute',
    target_type: 'user',
    target_ref: String(targetUserId),
    before: { muted: false, stream_id: stream.id },
    after: {
      muted: true,
      stream_id: stream.id,
      duration_minutes: durationMinutes,
      reason: reason || null,
    },
    risk_tier: 'MEDIUM',
  });

  broadcastToStream(stream.id, {
    type: 'live:participant_muted',
    payload: { streamId: stream.id, targetUserId, durationMinutes, timestamp: Date.now() },
  });

  return { target_user_id: targetUserId, duration_minutes: durationMinutes };
}

/**
 * Lifts a mute early — the counterpart to muteParticipant, so a mistaken or heeded mute is not a
 * one-way door the moderator has to wait out.
 */
export async function unmuteParticipant(db, { streamId, targetUserId, moderatorId }) {
  const stream = await liveRepo.findStreamById(db, streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিমটি খুঁজে পাওয়া যায়নি।');
  }

  const wasMuted = unmuteUserInStream(stream.id, targetUserId);
  if (!wasMuted) {
    // Nothing changed, so nothing is logged — an audit trail of no-ops is noise that makes the
    // real entries harder to find.
    return { target_user_id: targetUserId, was_muted: false };
  }

  await liveRepo.createMessage(db, {
    streamId: stream.id,
    userId: moderatorId,
    messageType: 'MODERATION',
    content: 'Participant mute lifted by moderation.',
    metadataJson: { action: 'UNMUTE', moderatorId, targetUserId },
  });

  await auditService.record(db, {
    actor: moderatorId,
    action: 'live.participant.unmute',
    target_type: 'user',
    target_ref: String(targetUserId),
    before: { muted: true, stream_id: stream.id },
    after: { muted: false, stream_id: stream.id },
    risk_tier: 'MEDIUM',
  });

  broadcastToStream(stream.id, {
    type: 'live:participant_unmuted',
    payload: { streamId: stream.id, targetUserId, timestamp: Date.now() },
  });

  return { target_user_id: targetUserId, was_muted: true };
}
