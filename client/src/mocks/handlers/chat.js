/**
 * chat.js — mock driver for Real-Time Chat (Prompts 8.1, 8.3, 8.4 / DFD Subsystem 7.0).
 *
 * Envelopes mirror `server/src/controllers/chat.controller.js` and the shapes returned by
 * `chat.service.js` (`getThreads` -> {items,count,limit,offset}, `getThreadMessages` ->
 * {threadId,items,nextCursor}, `markThreadRead` -> {success,threadId,unreadCount}), so the same
 * page code renders identically against this driver and against the real API.
 *
 * WHY a `SELF` sentinel instead of a literal sender id: `ChatPage` decides `isOutgoing` by
 * comparing `msg.sender_id` to the signed-in user's id, and the mock auth driver hands out string
 * ids that differ per dev account (`usr-dev-7` for the customer, `usr-dev-6` for the saler). A
 * hardcoded id would render every bubble on the wrong side for six of the seven dev logins, so
 * seeds store `SELF` and it is substituted with the live session's id at serialization time.
 */
import { getMockSessionUser } from './auth.js';

/** Placeholder for "whoever is signed in", resolved by `resolveSelf` on every read. */
export const SELF = '@self';

const DEFAULT_SELF_ID = 'usr-dev-7';

function selfId() {
  return getMockSessionUser()?.id ?? DEFAULT_SELF_ID;
}

function selfName() {
  return getMockSessionUser()?.name ?? 'You';
}

function resolveSelf(value) {
  return value === SELF ? selfId() : value;
}

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

/**
 * Shared thread seeds. `saler.js` serves the same three rows from `/saler/inbox/threads` so the
 * Unified Inbox and the /chat workspace never disagree about a thread's ref, channel or unread
 * count — the two surfaces read the same conversation.
 */
export const MOCK_CHAT_THREADS = [
  {
    id: 10,
    ref: 'THR-WA-89K2L1',
    thread_type: 'CUSTOMER_SALER',
    channel: 'WHATSAPP',
    customerPhone: '+8801812345678',
    other_participant_name: 'Rehana Akter',
    participant_ids: [100, SELF],
    metadata_json: { channel: 'WHATSAPP', role: 'customer' },
    inside24h: true,
    unread_count: 1,
    last_read_message_id: 0,
    last_message_at: minutesAgo(15),
    last_message_preview: 'Ami Dhakai Jamdani Saree ta order korte chai, delivery kobe pabo?',
    created_at: minutesAgo(60 * 26),
  },
  {
    id: 11,
    ref: 'THR-MS-44A9X2',
    thread_type: 'CUSTOMER_SALER',
    channel: 'MESSENGER',
    customerPhone: 'facebook:user:tanvir.hossain',
    other_participant_name: 'Tanvir Hossain',
    participant_ids: [101, SELF],
    metadata_json: { channel: 'MESSENGER', role: 'customer' },
    inside24h: true,
    unread_count: 0,
    last_read_message_id: 0,
    last_message_at: minutesAgo(180),
    last_message_preview: 'Rajshahi silk dupatta ki red color available ache?',
    created_at: minutesAgo(60 * 50),
  },
  {
    id: 12,
    ref: 'THR-DP-11C8Q9',
    thread_type: 'SALER_SUPPLIER',
    channel: 'IN_PLATFORM',
    customerPhone: '+8801711998877',
    other_participant_name: 'Meghna Textiles Ltd.',
    participant_ids: [102, SELF],
    metadata_json: { channel: 'IN_PLATFORM', role: 'supplier' },
    inside24h: false,
    unread_count: 0,
    last_read_message_id: 0,
    last_message_at: minutesAgo(60 * 36),
    last_message_preview: 'Thank you for the quick parcel dispatch!',
    created_at: minutesAgo(60 * 24 * 9),
  },
];

let nextMessageId = 5000;

// WHY no `read_by`: `chat.service.js`'s getThreadMessages SELECT does not return that column, so
// a live response never carries it. Seeding it here would make MessageBubble's ✓✓ appear in mock
// mode and nowhere else — the exact mock-vs-live divergence this driver exists to avoid.
function seedMessage({ threadId, senderId, senderName, senderRole, content, minutes, msgType = 'TEXT', payload = {} }) {
  return {
    id: nextMessageId++,
    client_msg_id: null,
    thread_id: threadId,
    sender_id: senderId,
    sender_name: senderName,
    sender_role: senderRole,
    content,
    msg_type: msgType,
    payload_json: payload,
    flagged_for_moderation: false,
    created_at: minutesAgo(minutes),
  };
}

/** threadId -> message[], oldest first (the order `getThreadMessages` returns after its reverse). */
const messagesByThread = new Map([
  [10, [
    seedMessage({ threadId: 10, senderId: 100, senderName: 'Rehana Akter', senderRole: 'customer', content: 'Assalamu alaikum, apnar shop theke ekta jinis kinte chai.', minutes: 95 }),
    seedMessage({ threadId: 10, senderId: SELF, senderName: 'You', senderRole: 'saler', content: 'Walaikum assalam! Obossoi — kon product ta dekhchen?', minutes: 92 }),
    seedMessage({
      threadId: 10,
      senderId: SELF,
      senderName: 'You',
      senderRole: 'saler',
      msgType: 'PRODUCT_CARD',
      content: 'Authentic Handloom Dhakai Jamdani Saree',
      payload: {
        productId: 1,
        productTitle: 'Authentic Handloom Dhakai Jamdani Saree',
        price: '3500.00',
        checkoutUrl: '/checkout/wa/mock-wa-token-123',
      },
      minutes: 90,
    }),
    seedMessage({ threadId: 10, senderId: 100, senderName: 'Rehana Akter', senderRole: 'customer', content: 'Ami Dhakai Jamdani Saree ta order korte chai, delivery kobe pabo?', minutes: 15 }),
  ]],
  [11, [
    seedMessage({ threadId: 11, senderId: 101, senderName: 'Tanvir Hossain', senderRole: 'customer', content: 'Rajshahi silk dupatta ki red color available ache?', minutes: 200 }),
    seedMessage({ threadId: 11, senderId: SELF, senderName: 'You', senderRole: 'saler', content: 'Ji, maroon ar deep red duitai stock e ache. Kon shade ta pochondo?', minutes: 180 }),
  ]],
  [12, [
    seedMessage({ threadId: 12, senderId: SELF, senderName: 'You', senderRole: 'saler', content: 'Order #ORD-4471 er parcel ta aaj dupure Steadfast e handover kora hoyeche.', minutes: 60 * 38 }),
    seedMessage({ threadId: 12, senderId: 102, senderName: 'Meghna Textiles Ltd.', senderRole: 'supplier', content: 'Thank you for the quick parcel dispatch!', minutes: 60 * 36 }),
  ]],
]);

/** Canned counterparty replies, cycled by the mock socket so a preview conversation goes somewhere. */
const AUTO_REPLIES = [
  'Ji, bujhte perechi. EkTu wait korun, dekhe boltechi.',
  'Accha, tahole ami confirm kore dicchi. Cash on delivery cholbe?',
  'Dhonnobad! Apnar service really fast. 🙏',
];
let autoReplyCursor = 0;

// Mirrors chat.service.js `detectContactInfoLeak` closely enough that a preview shows the
// moderation flag firing on a BD phone number or an off-platform handle.
const LEAK_PATTERNS = [
  /(?:\+?880|0)?1[3-9][\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{4}/,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  /\b(whatsapp|fb\.com|facebook\.com|imo)\b/i,
];

function detectsLeak(content) {
  return LEAK_PATTERNS.some((re) => re.test(content || ''));
}

function hydrateMessage(msg) {
  return {
    ...msg,
    sender_id: resolveSelf(msg.sender_id),
    sender_name: msg.sender_id === SELF ? selfName() : msg.sender_name,
  };
}

function hydrateThread(thread) {
  return {
    ...thread,
    participant_ids: thread.participant_ids.map(resolveSelf),
  };
}

/** All threads for the signed-in user, newest activity first. Shared with the saler inbox mock. */
export function listMockChatThreads() {
  return MOCK_CHAT_THREADS
    .slice()
    .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
    .map(hydrateThread);
}

function findThread(id) {
  return MOCK_CHAT_THREADS.find((t) => String(t.id) === String(id)) || null;
}

function threadMessages(id) {
  const key = Number(id);
  if (!messagesByThread.has(key)) messagesByThread.set(key, []);
  return messagesByThread.get(key);
}

function touchThread(threadId, message) {
  const thread = findThread(threadId);
  if (!thread) return;
  thread.last_message_at = message.created_at;
  thread.last_message_preview =
    message.msg_type === 'PRODUCT_CARD'
      ? (message.payload_json?.productTitle || 'Product card')
      : message.content;
}

/**
 * Appends a message to the in-memory store and returns it hydrated.
 * Exported because the mock WebSocket transport (`mocks/chatSocket.js`) persists through here —
 * a message sent over the socket must still be there when the thread is reopened over HTTP.
 */
export function appendMockMessage({ threadId, senderId, content, clientMsgId = null, msgType = 'TEXT', payloadJson = {}, senderName = null, senderRole = null }) {
  const message = {
    id: nextMessageId++,
    client_msg_id: clientMsgId,
    thread_id: Number(threadId),
    sender_id: senderId,
    sender_name: senderName,
    sender_role: senderRole,
    content,
    msg_type: msgType,
    payload_json: payloadJson || {},
    flagged_for_moderation: detectsLeak(content),
    created_at: new Date().toISOString(),
  };
  threadMessages(threadId).push(message);
  touchThread(threadId, message);
  return hydrateMessage(message);
}

/** Next canned counterparty reply for a thread, used by the mock socket. */
export function nextMockAutoReply(threadId) {
  const thread = findThread(threadId);
  const reply = AUTO_REPLIES[autoReplyCursor % AUTO_REPLIES.length];
  autoReplyCursor += 1;
  return appendMockMessage({
    threadId,
    senderId: thread?.participant_ids?.find((p) => p !== SELF) ?? 100,
    senderName: thread?.other_participant_name || 'Explooro User',
    senderRole: thread?.metadata_json?.role || 'customer',
    content: reply,
  });
}

const chatHandlers = [
  // 1. Short-lived WebSocket handshake ticket.
  {
    method: 'POST',
    path: '/chat/ticket',
    handler: () => ({
      status: 200,
      body: {
        data: {
          ticket: `mock-ticket-${Math.random().toString(36).slice(2, 12)}`,
          expiresIn: 30,
          userId: selfId(),
        },
        meta: { trace_id: 'MOCK-CHAT-TICKET' },
      },
    }),
  },

  // 2. Thread list.
  {
    method: 'GET',
    path: '/chat/threads',
    handler: ({ query }) => {
      const limit = Number(query?.limit) || 20;
      const offset = Number(query?.offset) || 0;
      const items = listMockChatThreads().slice(offset, offset + limit);
      return {
        status: 200,
        body: { data: { items, count: items.length, limit, offset }, meta: {} },
      };
    },
  },

  // 3. Create or open a thread with another participant.
  // 3. Create or open conversation thread
  {
    method: 'POST',
    path: '/chat/threads',
    handler: ({ body }) => {
      const targetId = body?.target_user_id;
      if (!targetId) {
        return {
          status: 400,
          body: {
            error: {
              code: 'INVALID_PARTICIPANT',
              message_en: 'Target participant must be a distinct user.',
              message_bn: 'অন্য একজন অংশগ্রহণকারী নির্বাচন করতে হবে।',
            },
          },
        };
      }

      const existing = MOCK_CHAT_THREADS.find((t) =>
        t.participant_ids.map(resolveSelf).some((id) => String(id) === String(targetId))
      );
      if (existing) {
        if (body?.metadata) {
          existing.metadata_json = { ...(existing.metadata_json || {}), ...body.metadata };
        }
        return { status: 200, body: { data: { thread: hydrateThread(existing), created: false }, meta: {} } };
      }

      const supplierName = body?.metadata?.supplier_name || body?.metadata?.seller_name || `Supplier #${targetId}`;

      const thread = {
        id: Math.max(...MOCK_CHAT_THREADS.map((t) => t.id)) + 1,
        ref: `THR-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        thread_type: body?.thread_type || 'CUSTOMER_SALER',
        channel: 'IN_PLATFORM',
        customerPhone: null,
        other_participant_name: supplierName,
        participant_ids: [targetId, SELF],
        metadata_json: { channel: 'IN_PLATFORM', ...(body?.metadata || {}) },
        inside24h: true,
        unread_count: 0,
        last_read_message_id: 0,
        last_message_at: new Date().toISOString(),
        last_message_preview: null,
        created_at: new Date().toISOString(),
      };
      MOCK_CHAT_THREADS.unshift(thread);
      return { status: 201, body: { data: { thread: hydrateThread(thread), created: true }, meta: {} } };
    },
  },

  // 3b. Get specific thread detail
  {
    method: 'GET',
    path: '/chat/threads/:id',
    handler: ({ params }) => {
      const thread = findThread(params.id);
      if (!thread) {
        return {
          status: 404,
          body: {
            error: {
              code: 'NOT_FOUND',
              message_en: `Chat thread #${params.id} does not exist.`,
              message_bn: `#${params.id} নম্বরের কথোপকথন নেই।`,
            },
          },
        };
      }
      return { status: 200, body: { data: { thread: hydrateThread(thread) }, meta: {} } };
    },
  },

  // 4. Cursor-paginated messages.
  {
    method: 'GET',
    path: '/chat/threads/:id/messages',
    handler: ({ params, query }) => {
      const threadId = Number(params.id);
      if (!findThread(threadId)) {
        return {
          status: 404,
          body: {
            error: {
              code: 'NOT_FOUND',
              message_en: `Chat thread #${params.id} does not exist.`,
              message_bn: `#${params.id} নম্বরের কথোপকথন নেই।`,
            },
          },
        };
      }

      const limit = Number(query?.limit) || 30;
      const cursor = query?.cursor ? Number(query.cursor) : null;
      const all = threadMessages(threadId).filter((m) => (cursor ? m.id < cursor : true));
      // Same window the server takes: the newest `limit`, returned oldest-first.
      const items = all.slice(-limit).map(hydrateMessage);
      return {
        status: 200,
        body: {
          data: { threadId, items, nextCursor: items.length > 0 ? items[0].id : null },
          meta: {},
        },
      };
    },
  },

  // 5. HTTP send fallback (used when the socket is down).
  {
    method: 'POST',
    path: '/chat/threads/:id/messages',
    handler: ({ params, body }) => {
      const thread = findThread(params.id);
      if (!thread) {
        return {
          status: 404,
          body: { error: { code: 'NOT_FOUND', message_en: `Chat thread #${params.id} does not exist.` } },
        };
      }
      const content = (body?.content || '').trim();
      if (!content) {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: 'Message content cannot be empty.',
              message_bn: 'বার্তা খালি রাখা যাবে না।',
            },
          },
        };
      }
      const message = appendMockMessage({
        threadId: thread.id,
        senderId: SELF,
        senderName: selfName(),
        senderRole: 'saler',
        content,
        clientMsgId: body?.client_msg_id || null,
        msgType: body?.msg_type || 'TEXT',
        payloadJson: body?.payload_json || {},
      });
      return { status: 201, body: { data: { message, idempotent: false }, meta: {} } };
    },
  },

  // 6. Mark thread read.
  {
    method: 'POST',
    path: '/chat/threads/:id/read',
    handler: ({ params, body }) => {
      const thread = findThread(params.id);
      if (thread) {
        thread.unread_count = 0;
        thread.last_read_message_id = Number(body?.last_read_message_id) || thread.last_read_message_id;
      }
      return {
        status: 200,
        body: { data: { success: true, threadId: Number(params.id), unreadCount: 0 }, meta: {} },
      };
    },
  },

  // 7. Report a message to moderation.
  {
    method: 'POST',
    path: '/chat/messages/:id/report',
    handler: ({ params }) => ({
      status: 200,
      body: { data: { success: true, reportedMessageId: Number(params.id) }, meta: {} },
    }),
  },
];

export default chatHandlers;
