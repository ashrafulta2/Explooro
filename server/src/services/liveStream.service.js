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
import { perParcelCharge } from './deliveryCharge.service.js';
import { withTransaction } from '../config/db.js';
import * as orderRepo from '../repositories/order.repository.js';
import { enforceCodGate } from './codGate.service.js';
import { validateCoupon } from './coupon.service.js';
import * as couponRepo from '../repositories/coupon.repository.js';
import { getReservedForProduct } from './teamStockReservation.service.js';
import { calculatePricingBreakdown, resolveSplitPercentages, toPaisa, toBdtNumber } from './pricing.service.js';
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

/**
 * A stream product's special price must cover the wholesale cost (base cost + wholesale margin).
 *
 * WHY here and not only at order time: executeInStreamBuy refuses a price under that floor, so a
 * special price below it produced a pinned "deal" nobody could buy. The seeded demo streams had four
 * such rows, including both currently pinned products. Checked before the stream row is created so a
 * rejected schedule leaves nothing behind.
 */
export async function assertSpecialPricesAboveFloor(db, products) {
  const priced = (products || [])
    .map((item) => ({
      productId: Number(item?.productId ?? item?.product_id ?? item),
      price: item?.specialPrice ?? item?.special_price ?? null,
    }))
    .filter((p) => p.price !== null && p.price !== undefined && p.price !== '');
  if (priced.length === 0) return;

  const { rows } = await db.query(
    'SELECT id, title_en, (base_cost + wholesale_margin) AS floor_price FROM products WHERE id = ANY($1::bigint[])',
    [priced.map((p) => p.productId)]
  );
  const floors = new Map(rows.map((r) => [Number(r.id), r]));
  for (const { productId, price } of priced) {
    const row = floors.get(productId);
    if (!row) {
      throw new AppError('PRODUCT_NOT_FOUND', `Product ${productId} not found.`, `পণ্য ${productId} পাওয়া যায়নি।`);
    }
    if (toPaisa(price) < toPaisa(row.floor_price)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `The special price for "${row.title_en}" cannot be below its wholesale cost (৳${Number(row.floor_price).toFixed(2)}).`,
        `"${row.title_en}" এর বিশেষ দাম পাইকারি খরচের (৳${Number(row.floor_price).toFixed(2)}) নিচে হতে পারবে না।`,
        { product_id: productId, floor_price: Number(row.floor_price) }
      );
    }
  }
}

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

  await assertSpecialPricesAboveFloor(db, products);

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

/**
 * What a live order would cost right now, without taking anything: the price the server will bill
 * (stream special price, else listed, plus a variant's price_delta), the delivery charge, the total,
 * and how many units are still buyable (stock net of open-team reservations).
 *
 * WHY it exists: the drawer used to add its own guess of the delivery charge to its own copy of the
 * price. Asking the server means the figure on the button is the figure that is billed. Read-only and
 * unlocked, so it is advisory: the order itself re-checks everything under the row lock.
 */
const COUPON_FAILURE_TEXT = {
  NO_CODE_PROVIDED: ['Enter a coupon code.', 'একটি কুপন কোড লিখুন।'],
  COUPON_NOT_FOUND_OR_INACTIVE: ['This coupon code is not valid.', 'এই কুপন কোডটি সঠিক নয়।'],
  COUPON_EXPIRED: ['This coupon has expired.', 'এই কুপনের মেয়াদ শেষ হয়ে গেছে।'],
  COUPON_BUDGET_EXHAUSTED: ['This coupon budget has been used up.', 'এই কুপনের বাজেট শেষ হয়ে গেছে।'],
  COUPON_USAGE_LIMIT_REACHED: ['This coupon has reached its usage limit.', 'এই কুপনের ব্যবহারের সীমা পূর্ণ হয়েছে।'],
  USER_USAGE_LIMIT_EXCEEDED: ['You have already used this coupon the maximum number of times.', 'আপনি এই কুপন সর্বোচ্চ সংখ্যক বার ব্যবহার করে ফেলেছেন।'],
  FIRST_ORDER_ONLY: ['This coupon is only for your first order.', 'এই কুপন শুধু আপনার প্রথম অর্ডারের জন্য।'],
  NO_ELIGIBLE_ITEMS_FOR_SCOPE: ['This coupon does not apply to this product.', 'এই কুপন এই পণ্যে প্রযোজ্য নয়।'],
  MIN_SPEND_NOT_MET: ['Your order is below the minimum spend for this coupon.', 'আপনার অর্ডার এই কুপনের সর্বনিম্ন খরচের চেয়ে কম।'],
};

/** English/Bangla wording for a validateCoupon failure reason, with a safe default. */
export function describeCouponFailure(reason) {
  const [en, bn] = COUPON_FAILURE_TEXT[reason] || ['This coupon cannot be applied.', 'এই কুপন প্রয়োগ করা যাচ্ছে না।'];
  return { message_en: en, message_bn: bn };
}

/** Runs validateCoupon for one live line; money in BDT numbers, as validateCoupon expects. */
function validateLiveCoupon(db, { code, userId, prod, salerId, unitPrice, quantity, shippingBdt, forUpdate }) {
  return validateCoupon(db, {
    code: String(code).trim(),
    userId,
    items: [{
      productId: prod.id,
      categoryId: prod.category_id,
      supplierId: prod.supplier_id,
      salerId,
      price: unitPrice,
      qty: quantity,
    }],
    subtotal: unitPrice * quantity,
    shippingAmount: shippingBdt,
    forUpdate,
  });
}

export async function quoteInStreamBuy(pool, cache, { streamId, productId, variantId = null, qty = 1, couponCode = null, userId = null }) {
  const quantity = Number(qty);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AppError('VALIDATION_FAILED', 'Quantity must be a whole number of at least 1.', 'পরিমাণ কমপক্ষে ১ এর পূর্ণসংখ্যা হতে হবে।');
  }
  const sId = Number(streamId);
  const stream = await liveRepo.findStreamById(pool, sId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিম পাওয়া যায়নি।');
  }
  const streamProduct = await liveRepo.getStreamProduct(pool, sId, Number(productId));
  if (!streamProduct) {
    throw new AppError('PRODUCT_NOT_IN_STREAM', 'This product is not part of this live stream.', 'এই পণ্যটি এই লাইভ স্ট্রিমের অংশ নয়।');
  }
  let unitPrice = Number(streamProduct.unit_price);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new AppError('PRODUCT_UNPRICED', 'This product has no price yet.', 'এই পণ্যের এখনও দাম নির্ধারণ হয়নি।');
  }

  const { rows } = await pool.query(
    'SELECT id, status, stock_qty, category_id, supplier_id FROM products WHERE id = $1',
    [Number(productId)]
  );
  const prod = rows[0];
  if (!prod || prod.status !== 'ACTIVE') {
    throw new AppError('PRODUCT_NOT_FOUND', 'Product is no longer available.', 'পণ্যটি এখন আর উপলব্ধ নেই।');
  }
  let available = Number(prod.stock_qty);
  if (variantId) {
    const { rows: vRows } = await pool.query(
      'SELECT price_delta, stock_qty, is_active FROM product_variants WHERE id = $1 AND product_id = $2',
      [Number(variantId), Number(productId)]
    );
    if (!vRows[0] || !vRows[0].is_active) {
      throw new AppError('NOT_FOUND', 'Selected variant is no longer available.', 'নির্বাচিত ভ্যারিয়েন্টটি আর উপলব্ধ নেই।');
    }
    unitPrice += Number(vRows[0].price_delta ?? 0);
    available = Number(vRows[0].stock_qty);
  }
  available = Math.max(0, Math.min(available, Number(prod.stock_qty) - await getReservedForProduct(pool, prod.id)));

  const shippingPaisa = toPaisa(await perParcelCharge(pool, cache));
  const itemsPaisa = toPaisa(unitPrice) * quantity;

  // WHY not thrown: a wrong code is something the drawer shows beside the field, not a failed quote.
  // The order re-validates under the coupon row lock, so this is advisory like the rest of the quote.
  let coupon = null;
  let discountPaisa = 0;
  if (couponCode && String(couponCode).trim()) {
    const v = await validateLiveCoupon(pool, {
      code: couponCode,
      userId,
      prod,
      salerId: stream.host_id ? Number(stream.host_id) : null,
      unitPrice,
      quantity,
      shippingBdt: toBdtNumber(shippingPaisa),
      forUpdate: false,
    });
    if (v.valid) {
      discountPaisa = Math.min(toPaisa(v.discountAmount), itemsPaisa + shippingPaisa);
      coupon = { code: v.coupon.code, valid: true, discount_amount: toBdtNumber(discountPaisa) };
    } else {
      coupon = { code: String(couponCode).trim(), valid: false, reason: v.reason, ...describeCouponFailure(v.reason) };
    }
  }
  return {
    stream_id: sId,
    product_id: Number(productId),
    quantity,
    unit_price: toBdtNumber(toPaisa(unitPrice)),
    items_amount: toBdtNumber(itemsPaisa),
    shipping_amount: toBdtNumber(shippingPaisa),
    discount_amount: toBdtNumber(discountPaisa),
    total_amount: toBdtNumber(itemsPaisa + shippingPaisa - discountPaisa),
    coupon,
    available_stock: available,
    in_stock: available >= quantity,
  };
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
  couponCode = null,
  idempotencyKey = null,
  otpCode = null,
  smsSender = null,
  isDevelopment = false,
  ip = null,
}) {
  // WHY required: a double-tap or a retried request must never place a second order for the same intent.
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required for an in-stream order.', 'ইন-স্ট্রিম অর্ডারের জন্য একটি Idempotency-Key হেডার আবশ্যক।');
  }
  const existing = await orderRepo.findOrderByIdempotencyKey(pool, idempotencyKey);
  if (existing) {
    return { order: existing, isReplay: true, originalAt: existing.created_at };
  }

  const sId = Number(streamId);
  const quantity = Number(qty);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AppError('VALIDATION_FAILED', 'Quantity must be a whole number of at least 1.', 'পরিমাণ কমপক্ষে ১ এর পূর্ণসংখ্যা হতে হবে।');
  }

  // WHY reject, not default: an order shipped to "In-Stream Buyer, 01700000000, Live Stream Instant
  // Order" is an order nobody can deliver. The drawer always sends all of these.
  const name = String(recipientName ?? '').trim();
  const address = String(addressLine ?? '').trim();
  if (!name || !division || !district || !address) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Recipient name, division, district and address line are required.',
      'প্রাপকের নাম, বিভাগ, জেলা এবং ঠিকানার বিবরণ আবশ্যক।'
    );
  }
  let cleanPhone = String(recipientPhone ?? '').replace(/[\s-]/g, '');
  if (cleanPhone.startsWith('01')) cleanPhone = `+88${cleanPhone}`;
  if (!/^\+8801[3-9]\d{8}$/.test(cleanPhone)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid Bangladeshi phone number for delivery.', 'ডেলিভারির জন্য ভুল বাংলাদেশি ফোন নম্বর।');
  }

  const stream = await liveRepo.findStreamById(pool, sId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', 'Live stream not found.', 'লাইভ স্ট্রিম পাওয়া যায়নি।');
  }
  if (stream.status !== 'LIVE') {
    throw new AppError('STREAM_NOT_LIVE', 'This stream is not live, so in-stream orders are closed.', 'এই স্ট্রিম এখন লাইভ নয়, তাই ইন-স্ট্রিম অর্ডার বন্ধ।');
  }

  // WHY the stream's own price: the host sets a special price per stream product; the drawer shows
  // exactly that figure (unit_price in the pinned-product payload), so the server resolves the same
  // one. A product that is not on this stream cannot be bought through it.
  const streamProduct = await liveRepo.getStreamProduct(pool, sId, Number(productId));
  if (!streamProduct) {
    throw new AppError('PRODUCT_NOT_IN_STREAM', 'This product is not part of this live stream.', 'এই পণ্যটি এই লাইভ স্ট্রিমের অংশ নয়।');
  }
  let unitPrice = Number(streamProduct.unit_price);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new AppError('PRODUCT_UNPRICED', 'This product has no price yet.', 'এই পণ্যের এখনও দাম নির্ধারণ হয়নি।');
  }

  // WHY configuration: the per-parcel delivery charge is set at /admin/platform/delivery; a live order
  // is one supplier parcel, so it pays the same charge as a normal checkout.
  const shippingPaisa = toPaisa(await perParcelCharge(pool, cache, { fresh: true }));

  let placed;
  try {
    placed = await placeInStreamOrder();
  } catch (err) {
    // WHY: two requests with one key can both pass the replay lookup above; the loser hits the UNIQUE
    // index on orders.idempotency_key. That is a replay of the winner's order, not a server error.
    if (err?.code === '23505' && String(err.constraint || '').includes('idempotency')) {
      const winner = await orderRepo.findOrderByIdempotencyKey(pool, idempotencyKey);
      if (winner) return { order: winner, isReplay: true, originalAt: winner.created_at };
    }
    throw err;
  }
  const { order, product } = placed;

  async function placeInStreamOrder() {
    return withTransaction(pool, async (client) => {
      // WHY lock first: stock is read and decremented under the same row lock checkout uses, so two
      // viewers hitting "buy" on the last unit cannot both succeed.
      const { productsById, variantsById } = await orderRepo.lockProductsAndVariants(client, [
        { product_id: Number(productId), variant_id: variantId ? Number(variantId) : null },
      ]);
      const prod = productsById.get(Number(productId));
      if (!prod || prod.status !== 'ACTIVE') {
        throw new AppError('PRODUCT_NOT_FOUND', 'Product is no longer available.', 'পণ্যটি এখন আর উপলব্ধ নেই।');
      }

      let availableStock = Number(prod.stock_qty);
      if (variantId) {
        const variant = variantsById.get(Number(variantId));
        if (!variant || !variant.is_active || Number(variant.product_id) !== Number(prod.id)) {
          throw new AppError('NOT_FOUND', 'Selected variant is no longer available.', 'নির্বাচিত ভ্যারিয়েন্টটি আর উপলব্ধ নেই।');
        }
        // price_delta is signed and relative to the price, as in the cart.
        unitPrice += Number(variant.price_delta ?? 0);
        availableStock = Number(variant.stock_qty);
      }
      // WHY net of reservations: units open team purchases are counting on are not for sale here.
      const reserved = await getReservedForProduct(client, prod.id);
      availableStock = Math.min(availableStock, Number(prod.stock_qty) - reserved);
      if (availableStock < quantity) {
        throw new AppError(
          'INSUFFICIENT_STOCK',
          `Only ${Math.max(0, availableStock)} left of "${prod.title_en}".`,
          `"${prod.title_bn || prod.title_en}" এর মাত্র ${Math.max(0, availableStock)}টি বাকি আছে।`,
          { product_ref: prod.ref, requested: quantity, available: Math.max(0, availableStock) }
        );
      }

      // WHY before any write: COD_OTP_REQUIRED throws and rolls the transaction back, so no stock is
      // taken for an order the shopper has not confirmed. Same gate as checkout and team purchase.
      // WHY the host as saler is resolved first: SALER-scoped coupons match on it.
      const salerId = stream.host_id ? Number(stream.host_id) : null;

      // WHY validated here: under the coupon row lock (forUpdate), so two orders cannot both take the
      // last use or the last of the budget. A bad code is refused, never silently ignored.
      let coupon = null;
      let discountPaisa = 0;
      if (couponCode && String(couponCode).trim()) {
        const v = await validateLiveCoupon(client, {
          code: couponCode,
          userId: user.id,
          prod,
          salerId,
          unitPrice,
          quantity,
          shippingBdt: toBdtNumber(shippingPaisa),
          forUpdate: true,
        });
        if (!v.valid) {
          const text = describeCouponFailure(v.reason);
          throw new AppError(
            v.reason === 'COUPON_BUDGET_EXHAUSTED' ? 'COUPON_BUDGET_EXHAUSTED' : 'COUPON_INVALID',
            text.message_en,
            text.message_bn,
            { reason: v.reason }
          );
        }
        coupon = v.coupon;
        discountPaisa = Math.min(toPaisa(v.discountAmount), toPaisa(unitPrice) * quantity + shippingPaisa);
      }

      const totalPaisa = toPaisa(unitPrice) * quantity + shippingPaisa - discountPaisa;
      let isOtpVerified = false;
      let trustScoreAtOrder = 50;
      if (paymentMethod === 'COD') {
        const gate = await enforceCodGate(pool, cache, {
          client,
          userId: user.id,
          phone: cleanPhone,
          orderAmount: toBdtNumber(totalPaisa),
          otpCode,
          smsSender,
          isDevelopment,
          ip,
        });
        isOtpVerified = gate.isOtpVerified;
        trustScoreAtOrder = gate.trustScore;
      }

      // WHY the host: the stream's host is the seller whose audience bought, so the sub-order carries
      // them as saler and the normal commission split applies.
      const split = await resolveSplitPercentages(client, {
        productId: prod.id,
        productRef: prod.ref,
        categoryId: prod.category_id,
        salerId,
        cache,
      });
      // Throws VALIDATION_FAILED when the (special) price is below the wholesale floor.
      const pricing = calculatePricingBreakdown({
        baseCost: prod.base_cost,
        wholesaleMargin: prod.wholesale_margin,
        retailPrice: unitPrice,
        salerSplitPct: split.salerSplitPct,
        platformSplitPct: split.platformSplitPct,
        ruleSource: split.ruleSource,
      });

      const lineTotalPaisa = toPaisa(unitPrice) * quantity;
      const netRetailPaisa = pricing.paisa.net_retail_margin * quantity;
      const salerPaisa = pricing.paisa.saler_earning * quantity;

      const batch = await orderRepo.allocateFefoBatch(client, {
        productId: prod.id,
        variantId: variantId ? Number(variantId) : null,
        qty: quantity,
      });
      await orderRepo.deductStock(client, {
        productId: prod.id,
        variantId: variantId ? Number(variantId) : null,
        qty: quantity,
      });

      const orderRef = generateRef('ORD');
      const rootOrder = await orderRepo.createOrder(client, {
        ref: orderRef,
        customerId: user.id,
        totalAmount: toBdtNumber(totalPaisa),
        itemsAmount: toBdtNumber(lineTotalPaisa),
        shippingAmount: toBdtNumber(shippingPaisa),
        discountAmount: toBdtNumber(discountPaisa),
        couponId: coupon?.id || null,
        paymentMethod,
        paymentStatus: 'PENDING',
        isOtpVerified,
        trustScoreAtOrder,
        idempotencyKey,
        recipientName: name,
        recipientPhone: cleanPhone,
        division,
        district,
        addressLine: address,
        liveStreamId: sId,
      });
      const subOrder = await orderRepo.createSubOrder(client, {
        ref: `${orderRef}-1`,
        orderId: rootOrder.id,
        supplierId: prod.supplier_id,
        salerId,
        subtotalBase: toBdtNumber(pricing.paisa.base_cost * quantity),
        wholesaleMargin: toBdtNumber(pricing.paisa.wholesale_margin * quantity),
        netRetailMargin: toBdtNumber(netRetailPaisa),
        salerCommission: toBdtNumber(salerPaisa),
        // Reconciled so saler_commission + platform_margin = net_retail_margin, as checkout does.
        platformMargin: toBdtNumber(netRetailPaisa - salerPaisa),
        shippingAmount: toBdtNumber(shippingPaisa),
        discountShare: toBdtNumber(discountPaisa),
        totalAmount: toBdtNumber(totalPaisa),
        status: 'PLACED',
      });
      await orderRepo.createOrderItem(client, {
        subOrderId: subOrder.id,
        productId: prod.id,
        variantId: variantId ? Number(variantId) : null,
        batchId: batch?.id || null,
        titleSnapshot: prod.title_en,
        qty: quantity,
        basePrice: pricing.base_cost,
        retailPrice: pricing.retail_price,
        lineTotal: toBdtNumber(lineTotalPaisa),
      });

      // WHY the same two calls as checkout: cancelOrder undoes exactly this (decrementCouponUsage).
      if (coupon) {
        await couponRepo.incrementCouponUsage(client, coupon.id, toBdtNumber(discountPaisa));
        await couponRepo.recordRedemption(client, {
          couponId: coupon.id,
          userId: user.id,
          orderId: rootOrder.id,
          discountAmount: toBdtNumber(discountPaisa),
        });
      }

      return { order: rootOrder, product: prod };
    });
  }

  // Stream stats and the sale toast run after commit: a failed broadcast must not undo a paid-for order.
  await recordStreamPurchase(pool, {
    streamId: sId,
    orderRef: order.ref,
    orderAmount: Number(order.total_amount),
    buyerName: user.full_name || 'Customer',
    productTitle: product.title_en,
  });

  return {
    order,
    isReplay: false,
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
