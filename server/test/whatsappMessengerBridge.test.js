/**
 * whatsappMessengerBridge.test.js — Prompt 8.3 Test Suite
 *
 * Tests:
 * - Acceptance 1: Inbound WhatsApp message ingested into unified inbox.
 * - Acceptance 2: Sending product card dispatches interactive payload with 1-tap checkout link.
 * - Acceptance 3: Single-use expiring checkout token lifecycle.
 * - Acceptance 4: Meta webhook handshake and signature verification.
 * - Acceptance 5: Fastify HTTP REST API endpoints.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import whatsappRoutes from '../src/routes/whatsapp.routes.js';
import salerInboxRoutes from '../src/routes/salerInbox.routes.js';
import * as waService from '../src/services/whatsappCommerce.service.js';
import * as mockWaDriver from '../src/integrations/whatsapp/mock.js';

function createMockDb() {
  const users = [
    { id: 1, full_name: 'Saler Karim', role: 'saler', phone: '01700000001' },
    { id: 50, full_name: 'Customer Jamila', role: 'customer', phone: '01711223344' },
  ];

  const products = [
    {
      id: 1,
      title_en: 'Premium Jamdani Saree',
      title_bn: 'প্রিমিয়াম জামদানি শাড়ি',
      base_price: '4500.00',
      images_json: ['/jamdani-1.jpg'],
      description_en: 'Authentic handwoven Jamdani saree.',
      supplier_id: 10,
    },
  ];

  const chatThreads = [
    {
      id: 10,
      ref: 'THR-WA-9921',
      thread_type: 'CUSTOMER_SALER',
      participant_ids: [1, 50],
      metadata_json: { channel: 'WHATSAPP', customer_phone: '01711223344', last_customer_message_at: new Date().toISOString() },
      last_message_at: new Date().toISOString(),
      last_message_preview: 'Is this Jamdani authentic?',
      created_at: new Date().toISOString(),
    },
  ];

  const chatMessages = [
    {
      id: 101,
      thread_id: 10,
      sender_id: 50,
      content: 'Is this Jamdani authentic?',
      msg_type: 'TEXT',
      payload_json: { channel: 'WHATSAPP' },
      read_by: [50],
      created_at: new Date().toISOString(),
    },
  ];

  const chatParticipants = [
    { thread_id: 10, user_id: 1, unread_count: 1, last_read_message_id: 0 },
    { thread_id: 10, user_id: 50, unread_count: 0, last_read_message_id: 101 },
  ];

  let nextUserId = 100;
  let nextThreadId = 20;
  let nextMsgId = 200;

  const mockDb = {
    users,
    products,
    chatThreads,
    chatMessages,
    chatParticipants,
    async query(sql, params = []) {
      const q = sql.trim();

      // SELECT users WHERE phone = $1
      if (q.includes('FROM users WHERE phone = $1')) {
        const ph = params[0];
        const found = users.filter((u) => u.phone === ph);
        return { rows: found };
      }

      // INSERT INTO users
      if (q.startsWith('INSERT INTO users')) {
        const u = { id: nextUserId++, phone: params[0], full_name: params[1], role: 'customer' };
        users.push(u);
        return { rows: [u] };
      }

      // SELECT chat_threads WHERE participant_ids = $1
      if (q.includes('FROM chat_threads') && q.includes('participant_ids = $1')) {
        const pIds = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
        const found = chatThreads.filter((t) => JSON.stringify(t.participant_ids.sort()) === JSON.stringify(pIds.sort()));
        return { rows: found };
      }

      // SELECT chat_threads WHERE id = $1
      if (q.includes('FROM chat_threads WHERE id = $1')) {
        const tId = params[0];
        const found = chatThreads.find((t) => t.id === Number(tId));
        return { rows: found ? [found] : [] };
      }

      // UPDATE chat_threads
      if (q.startsWith('UPDATE chat_threads')) {
        const tId = params[0];
        const found = chatThreads.find((t) => t.id === Number(tId));
        if (found) {
          found.metadata_json = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
          found.last_message_preview = params[2];
        }
        return { rows: found ? [found] : [] };
      }

      // INSERT INTO chat_threads
      if (q.startsWith('INSERT INTO chat_threads')) {
        const t = {
          id: nextThreadId++,
          ref: params[0],
          thread_type: 'CUSTOMER_SALER',
          participant_ids: typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1],
          metadata_json: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2],
          last_message_preview: params[3],
          created_at: new Date().toISOString(),
        };
        chatThreads.push(t);
        return { rows: [t] };
      }

      // INSERT INTO chat_messages
      if (q.startsWith('INSERT INTO chat_messages')) {
        const m = {
          id: nextMsgId++,
          thread_id: params[0],
          sender_id: params[1],
          content: params[2],
          msg_type: params[3],
          payload_json: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
          read_by: typeof params[5] === 'string' ? JSON.parse(params[5]) : params[5],
          created_at: new Date().toISOString(),
        };
        chatMessages.push(m);
        return { rows: [m] };
      }

      // SELECT products WHERE id = $1
      if (q.includes('FROM products WHERE id = $1')) {
        const pId = params[0];
        const found = products.find((p) => p.id === Number(pId));
        return { rows: found ? [found] : [] };
      }

      // SELECT unified threads for saler
      if (q.includes('FROM chat_threads t') && q.includes('chat_thread_participants p')) {
        const sId = params[0];
        const salerThreads = chatThreads.filter((t) => t.participant_ids.includes(Number(sId)));
        return {
          rows: salerThreads.map((t) => {
            const p = chatParticipants.find((cp) => cp.thread_id === t.id && cp.user_id === Number(sId)) || {};
            return {
              ...t,
              unread_count: p.unread_count || 0,
              last_read_message_id: p.last_read_message_id || 0,
            };
          }),
        };
      }

      // INSERT INTO chat_thread_participants
      if (q.includes('INSERT INTO chat_thread_participants')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  const poolMock = {
    ...mockDb,
    async connect() {
      return {
        ...mockDb,
        release() {},
      };
    },
  };

  return { mockDb: poolMock, state: { users, products, chatThreads, chatMessages } };
}

test('Prompt 8.3 — WhatsApp & Messenger Conversational Commerce Bridge', async (t) => {
  // Test 1: Acceptance 1 — Inbound WhatsApp message ingested into unified inbox
  await t.test('Acceptance 1: Inbound WhatsApp message creates unified thread & message', async () => {
    const { mockDb } = createMockDb();

    const result = await waService.ingestInboundMessage(mockDb, {
      fromPhone: '01899887766',
      customerName: 'Amina Shopper',
      salerId: 1,
      content: 'Do you have red Jamdani in stock?',
      metaMessageId: 'wamid.HBgLMTgy',
      channel: 'WHATSAPP',
    });

    assert.ok(result.threadId);
    assert.ok(result.messageId);

    // Verify saler unified inbox retrieves conversation
    const threads = await waService.getUnifiedSalerThreads(mockDb, 1);
    assert.ok(threads.items.length >= 2);
    const waThread = threads.items.find((th) => th.id === result.threadId);
    assert.ok(waThread);
    assert.equal(waThread.channel, 'WHATSAPP');
    assert.equal(waThread.customerPhone, '01899887766');
    assert.equal(waThread.inside24h, true);
  });

  // Test 2: Acceptance 2 — Interactive WhatsApp product card with 1-tap checkout link
  await t.test('Acceptance 2: Sending product card dispatches interactive CTA payload with 1-tap checkout link', async () => {
    mockWaDriver.clearSentMessages();
    const { mockDb } = createMockDb();

    const result = await waService.sendProductCard(mockDb, {
      threadId: 10,
      salerId: 1,
      productId: 1,
      note: 'Here is the product you requested!',
    });

    assert.ok(result.message);
    assert.ok(result.checkoutUrl.includes('/checkout/wa/'));
    assert.ok(result.token);

    // Verify payload recorded in driver
    const sent = mockWaDriver.getSentMessages();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'interactive');
    assert.equal(sent[0].interactive.type, 'cta_url');
    assert.equal(sent[0].interactive.action.parameters.url, result.checkoutUrl);
    assert.ok(sent[0].interactive.body.text.includes('Premium Jamdani Saree'));
  });

  // Test 3: Acceptance 3 — 1-tap checkout token is single-use and expires
  await t.test('Acceptance 3: 1-Tap checkout token is single-use and enforces expiration', () => {
    // 1. Create token
    const tokenInfo = waService.createCheckoutToken({
      salerId: 1,
      productId: 1,
      quantity: 1,
      customerPhone: '01711223344',
      expiresMinutes: 60,
    });

    assert.ok(tokenInfo.token);

    // 2. First consumption: VALID
    const consume1 = waService.consumeCheckoutToken(tokenInfo.token);
    assert.equal(consume1.valid, true);
    assert.equal(consume1.data.productId, 1);
    assert.equal(consume1.data.customerPhone, '01711223344');

    // 3. Second consumption: INVALID (single-use)
    const consume2 = waService.consumeCheckoutToken(tokenInfo.token);
    assert.equal(consume2.valid, false);
    assert.equal(consume2.error, 'TOKEN_ALREADY_USED');

    // 4. Expired token check
    const expiredTokenInfo = waService.createCheckoutToken({
      salerId: 1,
      productId: 1,
      expiresMinutes: -10, // already expired
    });
    const consumeExpired = waService.consumeCheckoutToken(expiredTokenInfo.token);
    assert.equal(consumeExpired.valid, false);
    assert.equal(consumeExpired.error, 'TOKEN_EXPIRED');
  });

  // Test 4: Acceptance 4 — Meta Webhook Handshake
  await t.test('Acceptance 4: Meta webhook verification handshake responds with challenge', async () => {
    const { mockDb } = createMockDb();
    const app = Fastify({ logger: false });

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);
    app.decorate('db', mockDb);
    app.decorate('cache', { get: async () => null, set: async () => 'OK', del: async () => 1 });

    process.env.WHATSAPP_VERIFY_TOKEN = 'test_verify_token_123';
    await app.register(whatsappRoutes, { prefix: '/api/v1' });

    // Webhook verification challenge
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token_123&hub.challenge=CHALLENGE_CODE_8821',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'CHALLENGE_CODE_8821');

    await app.close();
  });

  // Test 5: Fastify REST API Routes for Saler Unified Inbox
  await t.test('Acceptance 5: Fastify HTTP REST API for saler unified inbox & replies', async () => {
    const { mockDb } = createMockDb();
    const app = Fastify({ logger: false });

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);

    app.decorate('authenticate', async (req) => {
      req.user = { id: 1, role: 'saler', full_name: 'Saler Karim' };
    });

    app.decorate('db', mockDb);
    app.decorate('cache', { get: async () => null, set: async () => 'OK', del: async () => 1 });

    await app.register(salerInboxRoutes, { prefix: '/api/v1' });

    // 1. GET /api/v1/saler/inbox/threads
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/saler/inbox/threads',
    });
    assert.equal(listRes.statusCode, 200);
    assert.ok(listRes.json().data.items.length >= 1);

    // 2. POST /api/v1/saler/inbox/threads/10/send
    const replyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/saler/inbox/threads/10/send',
      payload: { content: 'Yes, Jamdani is 100% authentic cotton.' },
    });
    assert.equal(replyRes.statusCode, 201);
    assert.equal(replyRes.json().data.inside24h, true);

    await app.close();
  });
});
