/**
 * webSocketChatGateway.test.js — Prompt 8.1 Test Suite
 *
 * Tests:
 * - Acceptance 1: Real-time message exchange between two client connections.
 * - Acceptance 2: Disconnection & reconnection replay of missed messages exactly once.
 * - Acceptance 3: can_chat = BLOCK capability restriction enforcement.
 * - Acceptance 4: Ten rapid messages to offline user generate one consolidated notification.
 * - Acceptance 5: Off-platform contact info leak detection (BD phone, email, payment vectors).
 * - Acceptance 6: Fastify HTTP REST API endpoints for chat tickets, threads, and reporting.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import chatRoutes from '../src/routes/chat.routes.js';
import * as chatService from '../src/services/chat.service.js';
import * as presence from '../src/sockets/presence.js';
import { handleSocketMessage } from '../src/sockets/chat.handler.js';

function createMockDb() {
  const users = [
    { id: 101, full_name: 'Customer Rahim', role: 'customer' },
    { id: 102, full_name: 'Saler Karim', role: 'saler' },
    { id: 103, full_name: 'Restricted User', role: 'customer' },
  ];

  const userRestrictions = [
    {
      user_id: 103,
      capability: 'can_chat',
      restriction_type: 'BLOCK',
      reason_en: 'Direct messaging has been suspended due to policy violations.',
      reason_bn: 'নীতি লঙ্ঘনের কারণে সরাসরি মেসেজিং স্থগিত করা হয়েছে।',
    },
  ];

  const chatThreads = [
    {
      id: 1,
      ref: 'THR-7K2M9N',
      thread_type: 'CUSTOMER_SALER',
      participant_ids: [101, 102],
      metadata_json: { shop_slug: 'karim-store' },
      last_message_at: new Date().toISOString(),
      last_message_preview: 'Hello, is this product available?',
      created_at: new Date().toISOString(),
    },
  ];

  const chatMessages = [
    {
      id: 1,
      client_msg_id: 'msg-init-01',
      thread_id: 1,
      sender_id: 101,
      content: 'Hello, is this product available?',
      msg_type: 'TEXT',
      payload_json: {},
      read_by: [101],
      flagged_for_moderation: false,
      created_at: new Date(Date.now() - 60000).toISOString(),
    },
  ];

  const chatParticipants = [
    { thread_id: 1, user_id: 101, last_read_message_id: 1, unread_count: 0 },
    { thread_id: 1, user_id: 102, last_read_message_id: 0, unread_count: 1 },
  ];

  const moderationQueue = [];
  let nextMsgId = 2;

  const mockDb = {
    users,
    userRestrictions,
    chatThreads,
    chatMessages,
    chatParticipants,
    moderationQueue,
    async query(sql, params = []) {
      const q = sql.trim();

      // Check restrictions
      if (q.includes('FROM user_restrictions') && q.includes("capability = 'can_chat'")) {
        const uId = params[0];
        const res = userRestrictions.filter((r) => r.user_id === Number(uId));
        return { rows: res };
      }

      // SELECT chat_messages WHERE client_msg_id = $1
      if (q.includes('FROM chat_messages WHERE client_msg_id = $1')) {
        const cId = params[0];
        const found = chatMessages.filter((m) => m.client_msg_id === cId);
        return { rows: found };
      }

      // SELECT single chat_messages WHERE id = $1
      if (q.includes('FROM chat_messages WHERE id = $1')) {
        const mId = params[0];
        const found = chatMessages.find((m) => m.id === Number(mId));
        return { rows: found ? [found] : [] };
      }

      // SELECT chat_threads WHERE id = $1
      if (q.includes('FROM chat_threads WHERE id = $1')) {
        const tId = params[0];
        const found = chatThreads.find((t) => t.id === Number(tId));
        return { rows: found ? [found] : [] };
      }

      // INSERT INTO chat_messages
      if (q.startsWith('INSERT INTO chat_messages')) {
        const msg = {
          id: nextMsgId++,
          client_msg_id: params[0],
          thread_id: params[1],
          sender_id: params[2],
          content: params[3],
          msg_type: params[4],
          payload_json: typeof params[5] === 'string' ? JSON.parse(params[5]) : params[5],
          read_by: typeof params[6] === 'string' ? JSON.parse(params[6]) : params[6],
          flagged_for_moderation: Boolean(params[7]),
          created_at: new Date().toISOString(),
        };
        chatMessages.push(msg);
        return { rows: [msg] };
      }

      // UPDATE chat_threads last_message
      if (q.startsWith('UPDATE chat_threads')) {
        const tId = params[0];
        const found = chatThreads.find((t) => t.id === Number(tId));
        if (found) {
          found.last_message_preview = params[1];
          found.last_message_at = new Date().toISOString();
        }
        return { rows: [found] };
      }

      // SELECT users (+ profile name) WHERE u.id = $1
      if (q.includes('FROM users WHERE id = $1') || (q.includes('FROM users u') && q.includes('WHERE u.id = $1'))) {
        const uId = params[0];
        const found = users.find((u) => u.id === Number(uId));
        return { rows: found ? [found] : [] };
      }

      // SELECT chat_threads for user
      if (q.includes('FROM chat_threads t') && q.includes('chat_thread_participants p')) {
        const uId = params[0];
        const userThreads = chatThreads.filter((t) => t.participant_ids.includes(Number(uId)));
        return {
          rows: userThreads.map((t) => {
            const p = chatParticipants.find((cp) => cp.thread_id === t.id && cp.user_id === Number(uId)) || {};
            return {
              ...t,
              unread_count: p.unread_count || 0,
              last_read_message_id: p.last_read_message_id || 0,
            };
          }),
        };
      }

      // SELECT chat_messages for thread
      if (q.includes('FROM chat_messages m') && q.includes('WHERE m.thread_id = $1')) {
        const tId = params[0];
        const msgs = chatMessages.filter((m) => m.thread_id === Number(tId));
        return {
          rows: msgs.map((m) => {
            const u = users.find((usr) => usr.id === m.sender_id) || {};
            return {
              ...m,
              sender_name: u.full_name,
              sender_role: u.role,
            };
          }),
        };
      }

      // SELECT missed messages for user (sync replay)
      if (q.includes('FROM chat_messages m') && q.includes('m.id > $2')) {
        const uId = params[0];
        const sinceId = params[1];
        const userThreads = chatThreads.filter((t) => t.participant_ids.includes(Number(uId))).map((t) => t.id);
        const missed = chatMessages.filter((m) => userThreads.includes(m.thread_id) && m.id > Number(sinceId));
        return {
          rows: missed.map((m) => {
            const u = users.find((usr) => usr.id === m.sender_id) || {};
            return {
              ...m,
              sender_name: u.full_name,
            };
          }),
        };
      }

      // INSERT INTO moderation_queue
      if (q.startsWith('INSERT INTO moderation_queue')) {
        moderationQueue.push(params);
        return { rows: [{ id: 1 }] };
      }

      // INSERT/UPDATE chat_thread_participants
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

  return {
    mockDb: poolMock,
    state: {
      users,
      userRestrictions,
      chatThreads,
      chatMessages,
      chatParticipants,
      moderationQueue,
    },
  };
}

test('Prompt 8.1 — WebSocket Chat Gateway', async (t) => {
  // Test 1: Ticket-based WebSocket Handshake & Zero Raw JWT Leak
  await t.test('Handshake: Issues short-lived ticket and consumes atomically', () => {
    const { ticket, expiresIn } = presence.createTicket({
      userId: 101,
      role: 'customer',
      name: 'Rahim',
    });

    assert.ok(ticket);
    assert.equal(expiresIn, 60);

    // Consume ticket once
    const consumed = presence.consumeTicket(ticket);
    assert.equal(consumed.userId, 101);

    // Second consume fails (single-use ticket)
    const secondConsume = presence.consumeTicket(ticket);
    assert.equal(secondConsume, null);
  });

  // Test 2: Acceptance 1 — Two client connections exchange messages over WebSocket protocol
  await t.test('Acceptance 1: Two client sockets exchange messages in real-time', async () => {
    const { mockDb } = createMockDb();

    // Mock client socket for user 102 (Recipient)
    const recipientReceived = [];
    const mockRecipientWs = {
      readyState: 1, // OPEN
      send(data) {
        recipientReceived.push(JSON.parse(data));
      },
    };
    presence.registerUserSocket(102, mockRecipientWs);

    // Mock client socket for user 101 (Sender)
    const senderReceived = [];
    const mockSenderWs = {
      readyState: 1,
      send(data) {
        senderReceived.push(JSON.parse(data));
      },
    };
    presence.registerUserSocket(101, mockSenderWs);

    // Sender sends a chat frame
    handleSocketMessage(
      mockSenderWs,
      { id: 101, full_name: 'Customer Rahim' },
      JSON.stringify({
        type: 'chat:send',
        payload: {
          thread_id: 1,
          content: 'Is this available in size XL?',
          client_msg_id: 'client-tx-001',
        },
      }),
      mockDb
    );

    // Wait for async persistence
    await new Promise((r) => setTimeout(r, 50));

    // 1. Sender receives chat:ack
    const ack = senderReceived.find((f) => f.type === 'chat:ack');
    assert.ok(ack, 'Sender must receive chat:ack');
    assert.equal(ack.clientMsgId, 'client-tx-001');

    // 2. Recipient receives live chat:message
    const liveMsg = recipientReceived.find((f) => f.type === 'chat:message');
    assert.ok(liveMsg, 'Recipient must receive live chat:message');
    assert.equal(liveMsg.message.content, 'Is this available in size XL?');

    presence.unregisterUserSocket(101, mockSenderWs);
    presence.unregisterUserSocket(102, mockRecipientWs);
  });

  // Test 3: Acceptance 2 — Reconnection replay replays missed messages exactly once
  await t.test('Acceptance 2: chat:sync replays missed messages since last_received_id', async () => {
    const { mockDb, state } = createMockDb();

    // Add 2 offline messages for thread 1
    state.chatMessages.push(
      {
        id: 10,
        thread_id: 1,
        sender_id: 101,
        content: 'Missed message 1',
        created_at: new Date().toISOString(),
      },
      {
        id: 11,
        thread_id: 1,
        sender_id: 101,
        content: 'Missed message 2',
        created_at: new Date().toISOString(),
      }
    );

    const clientReceived = [];
    const reconnectingWs = {
      readyState: 1,
      send(data) {
        clientReceived.push(JSON.parse(data));
      },
    };

    // Reconnecting client requests sync since message id 1
    handleSocketMessage(
      reconnectingWs,
      { id: 102, full_name: 'Saler Karim' },
      JSON.stringify({
        type: 'chat:sync',
        payload: {
          since_message_id: 1,
        },
      }),
      mockDb
    );

    await new Promise((r) => setTimeout(r, 50));

    const syncRes = clientReceived.find((f) => f.type === 'chat:sync_response');
    assert.ok(syncRes, 'Must receive chat:sync_response');
    assert.equal(syncRes.count, 2);
    assert.equal(syncRes.missedMessages[0].content, 'Missed message 1');
    assert.equal(syncRes.missedMessages[1].content, 'Missed message 2');
  });

  // Test 4: Acceptance 3 — A user with can_chat=BLOCK cannot send messages and receives clear reason
  await t.test('Acceptance 3: can_chat = BLOCK restriction prohibits message sending with bilingual error', async () => {
    const { mockDb } = createMockDb();

    await assert.rejects(
      async () => {
        await chatService.sendMessage(mockDb, {
          threadId: 1,
          senderId: 103, // Restricted User
          content: 'Trying to chat while restricted',
        });
      },
      (err) => {
        assert.equal(err.code, 'USER_RESTRICTED');
        assert.equal(err.capability, 'can_chat');
        assert.ok(err.reason_bn.includes('নীতি লঙ্ঘনের'));
        return true;
      }
    );
  });

  // Test 5: Acceptance 4 — Ten rapid messages to offline user generate one debounced notification
  await t.test('Acceptance 4: Ten rapid messages to offline user produce 1 debounced notification batch', async () => {
    chatService.clearOfflineNotificationQueue();

    // Ensure recipient (102) is offline
    assert.equal(presence.isUserOnline(102), false);

    // Send 10 rapid messages
    for (let i = 1; i <= 10; i++) {
      chatService.enqueueDebouncedOfflineNotification({
        recipientId: 102,
        threadId: 1,
        senderId: 101,
        senderName: 'Customer Rahim',
        messageSnippet: `Message number ${i}`,
        debounceMs: 50, // fast debounce for test
      });
    }

    // Wait for debounce timer to fire
    await new Promise((r) => setTimeout(r, 100));

    const queue = chatService.getOfflineNotificationQueue();
    assert.equal(queue.length, 1, 'Ten rapid messages must consolidate into exactly ONE notification');
    assert.equal(queue[0].messageCount, 10);
    assert.ok(queue[0].summary.includes('10 new messages'));
  });

  // Test 6: Acceptance 5 — Contact info leak detection scans and flags off-platform vectors
  await t.test('Acceptance 5: Detects BD phone numbers, emails, and off-platform transaction handles', () => {
    // 1. Phone number test
    const phoneScan = chatService.detectContactInfoLeak('Call me at 01712345678 to pay outside');
    assert.equal(phoneScan.isLeaked, true);
    assert.ok(phoneScan.matches[0].includes('01712345678'));

    // 2. Email test
    const emailScan = chatService.detectContactInfoLeak('Contact me at seller@gmail.com');
    assert.equal(emailScan.isLeaked, true);
    assert.ok(emailScan.matches[0].includes('seller@gmail.com'));

    // 3. Clean message test
    const cleanScan = chatService.detectContactInfoLeak('What is the shipping cost to Chittagong?');
    assert.equal(cleanScan.isLeaked, false);
    assert.equal(cleanScan.matches.length, 0);
  });

  // Test 7: Fastify REST API Routes
  await t.test('Acceptance 6: Fastify HTTP REST API for chat ticket, threads, and report endpoints', async () => {
    const { mockDb } = createMockDb();
    const app = Fastify({ logger: false });

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);

    app.decorate('authenticate', async (req) => {
      req.user = { id: 101, role: 'customer', full_name: 'Customer Rahim' };
    });

    app.decorate('db', mockDb);
    app.decorate('cache', { get: async () => null, set: async () => 'OK', del: async () => 1 });

    await app.register(chatRoutes, { prefix: '/api/v1' });

    // 1. POST /api/v1/chat/ticket
    const ticketRes = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/ticket',
    });
    assert.equal(ticketRes.statusCode, 200);
    assert.ok(ticketRes.json().data.ticket);

    // 2. GET /api/v1/chat/threads
    const threadsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/chat/threads',
    });
    assert.equal(threadsRes.statusCode, 200);
    assert.equal(threadsRes.json().data.items.length, 1);

    // 3. GET /api/v1/chat/threads/1/messages
    const msgsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/chat/threads/1/messages',
    });
    assert.equal(msgsRes.statusCode, 200);
    assert.ok(msgsRes.json().data.items.length >= 1);

    // 4. POST /api/v1/chat/messages/1/report
    const repRes = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages/1/report',
      payload: { reason: 'Suspected off-platform payment solicitation' },
    });
    assert.equal(repRes.statusCode, 200);
    assert.equal(repRes.json().data.success, true);

    await app.close();
  });
});
