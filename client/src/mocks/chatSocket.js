/**
 * chatSocket.js — mock transport for the chat WebSocket (Prompt 8.4).
 *
 * WHY a fake socket rather than a mocked HTTP route: `services/websocket.js` owns the reconnect
 * backoff, the IndexedDB outbound queue and the status emitters, and none of that should be
 * branched on `VITE_API_MODE`. This object implements only the slice of the `WebSocket` interface
 * that manager touches (`readyState`, `send`, `close`, `onopen`/`onmessage`/`onclose`/`onerror`),
 * so the manager runs its real code path against a loopback instead of a live `/ws` upgrade.
 * Without it the ticket resolves, the upgrade fails against a backend that is not running, and the
 * connection pill sits on 🟡 Reconnecting forever with a retry storm behind it.
 *
 * Every frame below is byte-for-byte the shape `server/src/sockets/chat.handler.js` sends —
 * flat and camelCase, never wrapped in a `payload` object. Mock and live must be
 * indistinguishable to the client, otherwise the preview lies about whether the page works.
 */
import { appendMockMessage, nextMockAutoReply, SELF } from './handlers/chat.js';

const OPEN = 1;
const CLOSED = 3;

// Rough local-network feel, so optimistic-send states are actually visible in a preview.
const CONNECT_MS = 220;
const ACK_MS = 160;
const TYPING_MS = 900;
const REPLY_MS = 2400;

export function createMockChatSocket() {
  const timers = new Set();

  const socket = {
    readyState: 0,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (socket.readyState === OPEN) fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function emit(frame) {
    if (socket.readyState !== OPEN || typeof socket.onmessage !== 'function') return;
    socket.onmessage({ data: JSON.stringify(frame) });
  }

  /** Wire shape of `chat.service.js`'s real-time delivery payload. */
  function wireMessage(threadId, stored) {
    return {
      type: 'chat:message',
      threadId: Number(threadId),
      message: {
        id: stored.id,
        clientMsgId: stored.client_msg_id,
        senderId: stored.sender_id,
        senderName: stored.sender_name,
        content: stored.content,
        msgType: stored.msg_type,
        flaggedForModeration: stored.flagged_for_moderation,
        createdAt: stored.created_at,
      },
    };
  }

  function handleSend(payload) {
    const threadId = Number(payload.thread_id);
    const stored = appendMockMessage({
      threadId,
      senderId: SELF,
      content: payload.content,
      clientMsgId: payload.client_msg_id,
      msgType: payload.msg_type || 'TEXT',
      payloadJson: payload.payload_json || {},
    });

    later(() => {
      emit({
        type: 'chat:ack',
        clientMsgId: payload.client_msg_id,
        messageId: stored.id,
        threadId,
        idempotent: false,
        flaggedForModeration: stored.flagged_for_moderation,
        createdAt: stored.created_at,
      });
    }, ACK_MS);

    // The counterparty types, then replies — the live behaviour Prompt 8.4 asks to be
    // demonstrable, which otherwise needs a second browser and a running backend.
    later(() => emit({ type: 'chat:typing', threadId, userId: 'mock-peer', userName: 'Rehana Akter', isTyping: true }), TYPING_MS);
    later(() => {
      const reply = nextMockAutoReply(threadId);
      emit({ type: 'chat:typing', threadId, userId: 'mock-peer', userName: 'Rehana Akter', isTyping: false });
      emit(wireMessage(threadId, reply));
    }, REPLY_MS);
  }

  socket.send = (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    const { type, payload = {} } = frame;

    if (type === 'ping') {
      emit({ type: 'pong', timestamp: Date.now() });
    } else if (type === 'chat:send') {
      handleSend(payload);
    } else if (type === 'chat:read') {
      emit({ type: 'chat:read_ack', threadId: Number(payload.thread_id) });
    } else if (type === 'chat:sync') {
      // Nothing was missed: this socket never drops on its own, and the seeded threads are
      // already in the store the HTTP driver reads from.
      emit({
        type: 'chat:sync_response',
        sinceMessageId: Number(payload.since_message_id) || 0,
        missedMessages: [],
        count: 0,
      });
    } else if (type === 'chat:typing') {
      // Broadcast-to-others only; the sender is excluded, exactly as broadcastToThread does.
    } else {
      emit({ type: 'error', error: `UNKNOWN_FRAME_TYPE: ${type}` });
    }
  };

  socket.close = () => {
    if (socket.readyState === CLOSED) return;
    socket.readyState = CLOSED;
    timers.forEach(clearTimeout);
    timers.clear();
    if (typeof socket.onclose === 'function') socket.onclose({ code: 1000, reason: 'mock close' });
  };

  setTimeout(() => {
    if (socket.readyState === CLOSED) return;
    socket.readyState = OPEN;
    if (typeof socket.onopen === 'function') socket.onopen({});
  }, CONNECT_MS);

  return socket;
}

export default createMockChatSocket;
