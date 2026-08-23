/**
 * whatsappCommerce.service.js — Conversational Commerce Engine (Prompt 8.3 / DFD Subsystem 20.0).
 *
 * Implements:
 * 1. 1-Tap Single-Use Expiring Checkout Tokens (/checkout/wa/:token).
 * 2. Ingestion of inbound Meta WhatsApp/Messenger messages into unified chat_threads.
 * 3. 24-Hour customer service window enforcement.
 * 4. Interactive WhatsApp product card dispatch with prefilled checkout buttons.
 */

import { randomUUID } from 'node:crypto';
import { createWhatsAppSender } from '../integrations/whatsapp/index.js';
import { sendToUser } from '../sockets/presence.js';
import { withTransaction } from '../config/db.js';

// In-memory checkout tokens map: token -> { salerId, productId, variantId, quantity, customerPhone, expiresAt, used }
const checkoutTokens = new Map();

let cachedSender = null;
function getSender() {
  if (!cachedSender) {
    cachedSender = createWhatsAppSender({});
  }
  return cachedSender;
}

/**
 * Creates a signed single-use expiring token for 1-tap WhatsApp checkout.
 */
export function createCheckoutToken({
  salerId,
  productId,
  variantId = null,
  quantity = 1,
  customerPhone = null,
  expiresMinutes = 60,
  webBaseUrl = process.env.PUBLIC_WEB_URL || 'http://localhost:5173',
}) {
  const token = randomUUID();
  const expiresAt = Date.now() + expiresMinutes * 60 * 1000;

  const data = {
    token,
    salerId: Number(salerId),
    productId: Number(productId),
    variantId: variantId ? Number(variantId) : null,
    quantity: Number(quantity) || 1,
    customerPhone: customerPhone ? String(customerPhone).trim() : null,
    expiresAt,
    used: false,
    createdAt: new Date().toISOString(),
  };

  checkoutTokens.set(token, data);

  const checkoutUrl = `${webBaseUrl}/checkout/wa/${token}`;

  return {
    token,
    checkoutUrl,
    expiresInSeconds: expiresMinutes * 60,
  };
}

/**
 * Validates and consumes a 1-tap checkout token.
 */
export function consumeCheckoutToken(token) {
  if (!token || !checkoutTokens.has(token)) {
    return { valid: false, error: 'TOKEN_NOT_FOUND', message: 'Invalid or missing checkout token.' };
  }

  const data = checkoutTokens.get(token);

  if (data.used) {
    return { valid: false, error: 'TOKEN_ALREADY_USED', message: 'This single-use checkout link has already been used.' };
  }

  if (Date.now() > data.expiresAt) {
    return { valid: false, error: 'TOKEN_EXPIRED', message: 'This checkout link has expired. Please request a new link.' };
  }

  // Mark token as used (single-use)
  data.used = true;
  data.usedAt = new Date().toISOString();

  return {
    valid: true,
    data: {
      salerId: data.salerId,
      productId: data.productId,
      variantId: data.variantId,
      quantity: data.quantity,
      customerPhone: data.customerPhone,
    },
  };
}

/**
 * Checks if a timestamp is within the 24-hour Meta customer service window.
 */
export function isWithin24HourWindow(lastCustomerMessageAt) {
  if (!lastCustomerMessageAt) return false;
  const lastTime = new Date(lastCustomerMessageAt).getTime();
  const elapsed = Date.now() - lastTime;
  return elapsed <= 24 * 60 * 60 * 1000;
}

/**
 * Ingests an inbound WhatsApp/Messenger message into unified chat_threads.
 */
export async function ingestInboundMessage(db, {
  fromPhone,
  customerName = 'WhatsApp Customer',
  salerId,
  content,
  metaMessageId = null,
  channel = 'WHATSAPP',
}) {
  const runner = async (txClient) => {
    // 1. Find or create customer shadow account
    let customerUserId = null;
    const { rows: existingUsers } = await txClient.query(
      `SELECT id, full_name, phone FROM users WHERE phone = $1 LIMIT 1`,
      [fromPhone]
    );

    if (existingUsers.length > 0) {
      customerUserId = existingUsers[0].id;
    } else {
      const { rows: createdUsers } = await txClient.query(
        `INSERT INTO users (phone, full_name, role, status, created_at)
         VALUES ($1, $2, 'customer', 'ACTIVE', now())
         RETURNING id`,
        [fromPhone, customerName]
      );
      customerUserId = createdUsers[0].id;
    }

    // 2. Find or create unified chat_thread between customer and saler
    const participantIds = [Math.min(Number(customerUserId), Number(salerId)), Math.max(Number(customerUserId), Number(salerId))];

    const { rows: existingThreads } = await txClient.query(
      `SELECT * FROM chat_threads
       WHERE participant_ids = $1 AND thread_type = 'CUSTOMER_SALER'
       LIMIT 1`,
      [JSON.stringify(participantIds)]
    );

    let thread = null;
    if (existingThreads.length > 0) {
      thread = existingThreads[0];
      // Update thread metadata with 24-hour window timestamp & channel
      const meta = {
        ...(thread.metadata_json || {}),
        channel,
        customer_phone: fromPhone,
        last_customer_message_at: new Date().toISOString(),
      };

      await txClient.query(
        `UPDATE chat_threads
         SET metadata_json = $2, last_message_at = now(), last_message_preview = $3, updated_at = now()
         WHERE id = $1`,
        [thread.id, JSON.stringify(meta), content.slice(0, 100)]
      );
    } else {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let refCode = '';
      for (let i = 0; i < 8; i++) refCode += chars.charAt(Math.floor(Math.random() * chars.length));
      const ref = `THR-WA-${refCode}`;

      const meta = {
        channel,
        customer_phone: fromPhone,
        last_customer_message_at: new Date().toISOString(),
      };

      const { rows: createdThreads } = await txClient.query(
        `INSERT INTO chat_threads (ref, thread_type, participant_ids, metadata_json, last_message_at, last_message_preview, created_at, updated_at)
         VALUES ($1, 'CUSTOMER_SALER', $2, $3, now(), $4, now(), now())
         RETURNING *`,
        [ref, JSON.stringify(participantIds), JSON.stringify(meta), content.slice(0, 100)]
      );
      thread = createdThreads[0];
    }

    // 3. Persist inbound message
    const { rows: insertedMessages } = await txClient.query(
      `INSERT INTO chat_messages (
         thread_id, sender_id, content, msg_type, payload_json, read_by, created_at
       )
       VALUES ($1, $2, $3, 'TEXT', $4, $5, now())
       RETURNING *`,
      [
        thread.id,
        customerUserId,
        content,
        JSON.stringify({ channel, metaMessageId, fromPhone }),
        JSON.stringify([customerUserId]),
      ]
    );

    const message = insertedMessages[0];

    // 4. Update unread count for Saler
    await txClient.query(
      `INSERT INTO chat_thread_participants (thread_id, user_id, unread_count, joined_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (thread_id, user_id) DO UPDATE
       SET unread_count = chat_thread_participants.unread_count + 1`,
      [thread.id, salerId]
    );

    // 5. Emit live arrival over WebSocket to Saler
    sendToUser(salerId, {
      type: 'chat:message',
      threadId: thread.id,
      channel,
      message: {
        id: message.id,
        senderId: customerUserId,
        senderName: customerName,
        content: message.content,
        msgType: 'TEXT',
        channel,
        createdAt: message.created_at,
      },
    });

    return {
      threadId: thread.id,
      messageId: message.id,
      customerUserId,
    };
  };

  return withTransaction(db, runner);
}

/**
 * Sends an outbound WhatsApp reply to a customer from a saler.
 */
export async function sendOutboundReply(db, {
  threadId,
  salerId,
  content,
}) {
  const runner = async (txClient) => {
    const { rows: threadRows } = await txClient.query(
      `SELECT * FROM chat_threads WHERE id = $1`,
      [threadId]
    );

    if (threadRows.length === 0) {
      throw new Error(`THREAD_NOT_FOUND: Thread #${threadId} not found.`);
    }

    const thread = threadRows[0];
    const meta = thread.metadata_json || {};
    const customerPhone = meta.customer_phone;

    if (!customerPhone) {
      throw new Error('MISSING_CUSTOMER_PHONE: No external phone attached to this thread.');
    }

    // Check 24-hour customer window
    const inside24h = isWithin24HourWindow(meta.last_customer_message_at);
    const sender = getSender();

    let dispatchRes;
    if (inside24h) {
      dispatchRes = await sender.sendTextMessage(customerPhone, content);
    } else {
      // Outside 24h: Fall back to pre-approved notification template
      dispatchRes = await sender.sendTemplateMessage(customerPhone, 'saler_message_notification', [
        { type: 'body', parameters: [{ type: 'text', text: content.slice(0, 100) }] },
      ]);
    }

    // Persist to chat_messages
    const { rows: inserted } = await txClient.query(
      `INSERT INTO chat_messages (
         thread_id, sender_id, content, msg_type, payload_json, read_by, created_at
       )
       VALUES ($1, $2, $3, 'TEXT', $4, $5, now())
       RETURNING *`,
      [
        threadId,
        salerId,
        content,
        JSON.stringify({ channel: 'WHATSAPP', inside24h, providerId: dispatchRes?.messageId }),
        JSON.stringify([salerId]),
      ]
    );

    return {
      message: inserted[0],
      inside24h,
      dispatchResult: dispatchRes,
    };
  };

  return withTransaction(db, runner);
}

/**
 * Sends an interactive product card with 1-tap checkout link via WhatsApp.
 */
export async function sendProductCard(db, {
  threadId,
  salerId,
  productId,
  variantId = null,
  note = null,
}) {
  const runner = async (txClient) => {
    // 1. Fetch thread and customer phone
    const { rows: threadRows } = await txClient.query(
      `SELECT * FROM chat_threads WHERE id = $1`,
      [threadId]
    );

    if (threadRows.length === 0) {
      throw new Error(`THREAD_NOT_FOUND: Thread #${threadId} not found.`);
    }

    const thread = threadRows[0];
    const meta = thread.metadata_json || {};
    const customerPhone = meta.customer_phone;

    if (!customerPhone) {
      throw new Error('MISSING_CUSTOMER_PHONE: No external phone attached to this thread.');
    }

    // 2. Fetch product details
    const { rows: productRows } = await txClient.query(
      `SELECT id, title_en, title_bn, base_price, images_json, description_en
       FROM products WHERE id = $1`,
      [productId]
    );

    if (productRows.length === 0) {
      throw new Error(`PRODUCT_NOT_FOUND: Product #${productId} not found.`);
    }

    const prod = productRows[0];
    const images = Array.isArray(prod.images_json) ? prod.images_json : [];
    const imageUrl = images[0] || '/demo-product.jpg';

    // 3. Generate single-use expiring 1-tap checkout token
    const tokenInfo = createCheckoutToken({
      salerId,
      productId,
      variantId,
      customerPhone,
      expiresMinutes: 60,
    });

    const productPayload = {
      title: prod.title_en,
      price: prod.base_price,
      description: prod.description_en || '',
      image_url: imageUrl,
    };

    // 4. Dispatch via WhatsApp interactive message
    const sender = getSender();
    const dispatchRes = await sender.sendInteractiveProductCard(customerPhone, {
      product: productPayload,
      checkoutUrl: tokenInfo.checkoutUrl,
      headerText: note ? `${note}\n\n*${prod.title_en}* (৳${prod.base_price})` : null,
    });

    // 5. Persist message in chat_messages
    const { rows: inserted } = await txClient.query(
      `INSERT INTO chat_messages (
         thread_id, sender_id, content, msg_type, payload_json, read_by, created_at
       )
       VALUES ($1, $2, $3, 'PRODUCT_CARD', $4, $5, now())
       RETURNING *`,
      [
        threadId,
        salerId,
        `[Product Card] ${prod.title_en} - ৳${prod.base_price}`,
        JSON.stringify({
          channel: 'WHATSAPP',
          productId: prod.id,
          productTitle: prod.title_en,
          price: prod.base_price,
          checkoutUrl: tokenInfo.checkoutUrl,
          token: tokenInfo.token,
          providerId: dispatchRes?.messageId,
        }),
        JSON.stringify([salerId]),
      ]
    );

    return {
      message: inserted[0],
      checkoutUrl: tokenInfo.checkoutUrl,
      token: tokenInfo.token,
      dispatchResult: dispatchRes,
    };
  };

  return withTransaction(db, runner);
}

/**
 * Retrieves unified conversations for saler with channel badges and 24-hour status.
 */
export async function getUnifiedSalerThreads(db, salerId, { limit = 30, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT t.id, t.ref, t.thread_type, t.participant_ids, t.metadata_json,
            t.last_message_at, t.last_message_preview, t.created_at,
            COALESCE(p.unread_count, 0) as unread_count,
            COALESCE(p.last_read_message_id, 0) as last_read_message_id
     FROM chat_threads t
     LEFT JOIN chat_thread_participants p ON p.thread_id = t.id AND p.user_id = $1
     WHERE t.participant_ids @> to_jsonb($1::bigint) OR t.participant_ids @> to_jsonb(ARRAY[$1::bigint])
     ORDER BY t.last_message_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [salerId, limit, offset]
  );

  const decorated = rows.map((t) => {
    const meta = t.metadata_json || {};
    const channel = meta.channel || 'IN_PLATFORM';
    const lastCustMsg = meta.last_customer_message_at;
    const inside24h = isWithin24HourWindow(lastCustMsg);

    return {
      ...t,
      channel,
      customerPhone: meta.customer_phone || null,
      inside24h,
      lastCustomerMessageAt: lastCustMsg || null,
    };
  });

  return {
    items: decorated,
    count: decorated.length,
    limit,
    offset,
  };
}
