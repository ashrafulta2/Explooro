/**
 * websocket.js — WebSocket Connection Manager (Prompt 8.4 / DFD Subsystem 7.0 & PRD Gap #7).
 *
 * Implements:
 * 1. Single-use ticket authentication handshake (/api/v1/chat/ticket).
 * 2. Auto-reconnect with exponential backoff and randomized jitter.
 * 3. Outbound offline queue persisted to IndexedDB (survives page reloads).
 * 4. Automatic queue flushing and missed-message replay (chat:sync) on reconnect.
 * 5. Connection status event emitters for reactive UI status badges.
 */

import { api } from '../core/api.js';

// Connection States
export const WS_STATUS = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  OFFLINE: 'OFFLINE',
};

// IndexedDB Helper for Offline Queue Persistence (PRD Gap #7)
const DB_NAME = 'explooro_chat_db';
const DB_VERSION = 1;
const STORE_NAME = 'outbound_queue';

function openIndexedDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'clientMsgId' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = () => resolve(null);
  });
}

async function persistQueueItem(item) {
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

async function removePersistedQueueItem(clientMsgId) {
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

async function loadPersistedQueue() {
  const db = await openIndexedDb();
  if (!db) return [];
  return new Promise((resolve) => {
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

  async initPersistedQueue() {
    const persisted = await loadPersistedQueue();
    if (persisted.length > 0) {
      this.outboundQueue = [...persisted, ...this.outboundQueue];
    }
  }

  setStatus(status) {
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

  onStatusChange(listener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onMessage(listener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async connect() {
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

      this.socket = new WebSocket(wsUrl);

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

  scheduleReconnect() {
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

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send('ping', {});
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  handleIncomingFrame(frame) {
    const { type, payload } = frame;

    // Track last received message id for replay
    if (type === 'chat:message' && payload?.id) {
      this.lastReceivedMessageId = Math.max(this.lastReceivedMessageId, Number(payload.id));
    }

    // Ack handling: remove confirmed item from queue and indexedDB
    if (type === 'chat:ack' && payload?.client_msg_id) {
      this.dequeue(payload.client_msg_id);
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

  send(type, payload = {}) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  /**
   * Enqueues chat message optimistically and flushes or saves to IndexedDB.
   */
  async sendMessage({ threadId, content, clientMsgId, msgType = 'TEXT', payloadJson = null }) {
    const item = {
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

  async dequeue(clientMsgId) {
    this.outboundQueue = this.outboundQueue.filter((q) => q.clientMsgId !== clientMsgId);
    await removePersistedQueueItem(clientMsgId);
  }

  flushQueue() {
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

  sendTyping({ threadId, isTyping, participantIds = [] }) {
    return this.send('chat:typing', {
      thread_id: Number(threadId),
      is_typing: Boolean(isTyping),
      participant_ids: participantIds,
    });
  }

  sendReadReceipt({ threadId, lastReadMessageId }) {
    return this.send('chat:read', {
      thread_id: Number(threadId),
      last_read_message_id: Number(lastReadMessageId),
    });
  }

  disconnect() {
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
