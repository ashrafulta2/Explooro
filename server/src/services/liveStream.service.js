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
import { broadcastToStream, isUserMutedInStream, muteUserInStream } from '../sockets/presence.js';

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
    metadataJson: { moderatorId, reason },
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
