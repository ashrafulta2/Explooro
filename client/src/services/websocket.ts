/**
 * websocket.ts — WebSocket Connection Manager (Prompt 8.4 / DFD Subsystem 7.0 & PRD Gap #7).
 *
 * Implements:
 * 1. Single-use ticket authentication handshake (POST /chat/ticket).
 * 2. Auto-reconnect with exponential backoff and randomized jitter.
 * 3. Outbound offline queue persisted to IndexedDB (survives page reloads).
 * 4. Automatic queue flushing and missed-message replay (chat:sync) on reconnect.
 * 5. Connection status event emitters for reactive UI status badges.
 */

import { api } from '../core/api.js';

// Same switch core/api.js reads. In mock mode the ticket resolves but there is no /ws upgrade to
// make, so the manager talks to a loopback socket instead of retry-storming a backend that is not
// running. Every other code path — backoff, queue, heartbeat, status — is unchanged.
const MOCK_MODE = !(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_MODE === 'live');

// Connection States
export const WS_STATUS = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  OFFLINE: 'OFFLINE',
} as const;

export type WsStatus = (typeof WS_STATUS)[keyof typeof WS_STATUS];

/** A frame from server/src/sockets/chat.handler.ts. Flat: there is no `payload` wrapper. */
export interface ChatFrame {
  type: string;
  clientMsgId?: string;
  messageId?: number;
  threadId?: number;
  message?: { id?: number | string; [field: string]: unknown };
  [field: string]: unknown;
}

/** A chat message waiting for its ack; persisted to IndexedDB so a reload does not lose it. */
export interface OutboundItem {
  threadId: number;
  content: string;
  clientMsgId: string;
  msgType: string;
  payloadJson: unknown;
  createdAt: string;
}

/** The part of a WebSocket the manager uses, which the mock chat socket also provides. */
type ChatSocket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'onopen' | 'onmessage' | 'onclose' | 'onerror'>;

// IndexedDB Helper for Offline Queue Persistence (PRD Gap #7)
const DB_NAME = 'explooro_chat_db';
const DB_VERSION = 1;
const STORE_NAME = 'outbound_queue';

function openIndexedDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'clientMsgId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function persistQueueItem(item: OutboundItem): Promise<void> {
  const db = await openIndexedDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(item);
  } catch {
    // Ignore storage failure
  }
}

async function removePersistedQueueItem(clientMsgId: string): Promise<void> {
  const db = await openIndexedDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(clientMsgId);
  } catch {
    // Ignore storage failure
  }
}

async function loadPersistedQueue(): Promise<OutboundItem[]> {
  const db = await openIndexedDb();
  if (!db) return [];
  return new Promise<OutboundItem[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

class WebSocketManager {
  socket: ChatSocket | null;
  status: WsStatus;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  baseDelay: number;
  maxDelay: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  lastReceivedMessageId: number;
  outboundQueue: OutboundItem[];
  statusListeners: Set<(status: WsStatus) => void>;
  messageListeners: Set<(frame: ChatFrame) => void>;

  constructor() {
    this.socket = null;
    this.status = WS_STATUS.DISCONNECTED;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.baseDelay = 1000;
    this.maxDelay = 30000;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastReceivedMessageId = 0;

    this.outboundQueue = [];
    this.statusListeners = new Set();
    this.messageListeners = new Set();

    // Listen to browser online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (this.status !== WS_STATUS.CONNECTED) {
          this.reconnectAttempts = 0;
          this.connect();
        }
      });
      window.addEventListener('offline', () => {
        this.setStatus(WS_STATUS.OFFLINE);
      });
    }

    // Load persisted queue from IndexedDB on startup
    this.initPersistedQueue();
  }

  async initPersistedQueue(): Promise<void> {
    const persisted = await loadPersistedQueue();
    if (persisted.length > 0) {
      this.outboundQueue = [...persisted, ...this.outboundQueue];
    }
  }

  setStatus(status: WsStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch {
        // Safe dispatch
      }
    });
  }

  onStatusChange(listener: (status: WsStatus) => void): () => boolean {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onMessage(listener: (frame: ChatFrame) => void): () => boolean {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setStatus(WS_STATUS.OFFLINE);
      return;
    }

    this.setStatus(this.reconnectAttempts === 0 ? WS_STATUS.CONNECTING : WS_STATUS.RECONNECTING);

    try {
      // 1. Obtain short-lived ticket via HTTP
      const res = await api.post('/chat/ticket', {});
      const ticket = res?.data?.ticket;

      if (!ticket) {
        throw new Error('FAILED_TICKET: No ticket returned');
      }

      // 2. Compute WebSocket endpoint
      const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const protocol = isSecure ? 'wss:' : 'ws:';
      const host = (typeof window !== 'undefined' && window.location.host) || 'localhost:3000';
      const wsUrl = `${protocol}//${host}/ws?ticket=${ticket}`;

      // WHY dynamic: keeps the mock socket out of the entry bundle; live mode never loads it.
      // The cast: chatSocket.js adds send/close after building the object, so they are not in its
      // inferred type, but it implements exactly the ChatSocket slice (see its header).
      this.socket = MOCK_MODE
        ? ((await import('../mocks/chatSocket.js')).createMockChatSocket() as unknown as ChatSocket)
        : new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.setStatus(WS_STATUS.CONNECTED);
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.flushQueue();

        // If we previously had a last message ID, sync missed messages
        if (this.lastReceivedMessageId > 0) {
          this.send('chat:sync', { since_message_id: this.lastReceivedMessageId });
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          this.handleIncomingFrame(frame);
        } catch {
          // Ignore invalid JSON frame
        }
      };

      this.socket.onclose = () => {
        this.stopHeartbeat();
        if (this.status !== WS_STATUS.OFFLINE) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = () => {
        if (this.socket) {
          this.socket.close();
        }
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setStatus(WS_STATUS.OFFLINE);
      return;
    }

    this.setStatus(WS_STATUS.RECONNECTING);
    this.reconnectAttempts++;

    // Exponential backoff with jitter
    const delay = Math.min(
      this.maxDelay,
      this.baseDelay * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 1000
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send('ping', {});
      }
    }, 30000);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  handleIncomingFrame(frame: ChatFrame): void {
    // WHY the flat reads: server/src/sockets/chat.handler.ts sends
    // { type, clientMsgId, messageId, threadId } and { type, threadId, message: {...} } — it has
    // never wrapped frames in a `payload` object. Destructuring `payload` off the frame left it
    // undefined, so no ack ever cleared the outbound queue and no inbound message ever advanced
    // the replay cursor: after a reconnect chat:sync asked for everything since message 0 and
    // every queued message was re-sent forever.
    const { type } = frame;

    // Track last received message id for replay
    const incomingId = frame.message?.id;
    if (type === 'chat:message' && incomingId) {
      this.lastReceivedMessageId = Math.max(this.lastReceivedMessageId, Number(incomingId));
    }

    // Ack handling: remove confirmed item from queue and indexedDB
    if (type === 'chat:ack' && frame.clientMsgId) {
      this.dequeue(frame.clientMsgId);
    }

    // A rejected send must not sit in the queue forever being retried on every reconnect.
    if (type === 'chat:error' && frame.clientMsgId) {
      this.dequeue(frame.clientMsgId);
    }

    // Dispatch to subscribers
    this.messageListeners.forEach((listener) => {
      try {
        listener(frame);
      } catch {
        // Safe dispatch
      }
    });
  }

  send(type: string, payload: Record<string, unknown> = {}): boolean {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  /**
   * Enqueues chat message optimistically and flushes or saves to IndexedDB.
   */
  async sendMessage({
    threadId,
    content,
    clientMsgId,
    msgType = 'TEXT',
    payloadJson = null,
  }: {
    threadId: number | string;
    content: string;
    clientMsgId: string;
    msgType?: string;
    payloadJson?: unknown;
  }): Promise<OutboundItem> {
    const item: OutboundItem = {
      threadId: Number(threadId),
      content,
      clientMsgId,
      msgType,
      payloadJson,
      createdAt: new Date().toISOString(),
    };

    // Add to outbound queue
    this.outboundQueue.push(item);
    await persistQueueItem(item);

    if (this.status === WS_STATUS.CONNECTED && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.send('chat:send', {
        thread_id: item.threadId,
        content: item.content,
        client_msg_id: item.clientMsgId,
        msg_type: item.msgType,
        payload_json: item.payloadJson,
      });
    }

    return item;
  }

  async dequeue(clientMsgId: string): Promise<void> {
    this.outboundQueue = this.outboundQueue.filter((q) => q.clientMsgId !== clientMsgId);
    await removePersistedQueueItem(clientMsgId);
  }

  flushQueue(): void {
    if (this.outboundQueue.length === 0) return;
    const items = [...this.outboundQueue];

    items.forEach((item) => {
      this.send('chat:send', {
        thread_id: item.threadId,
        content: item.content,
        client_msg_id: item.clientMsgId,
        msg_type: item.msgType,
        payload_json: item.payloadJson,
      });
    });
  }

  sendTyping({
    threadId,
    isTyping,
    participantIds = [],
  }: {
    threadId: number | string;
    isTyping: boolean;
    participantIds?: (number | string)[];
  }): boolean {
    return this.send('chat:typing', {
      thread_id: Number(threadId),
      is_typing: Boolean(isTyping),
      participant_ids: participantIds,
    });
  }

  sendReadReceipt({ threadId, lastReadMessageId }: { threadId: number | string; lastReadMessageId: number | string }): boolean {
    return this.send('chat:read', {
      thread_id: Number(threadId),
      last_read_message_id: Number(lastReadMessageId),
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus(WS_STATUS.DISCONNECTED);
  }
}

export const wsManager = new WebSocketManager();
