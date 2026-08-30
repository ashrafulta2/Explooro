/**
 * ChatPage.js — Real-Time Chat Workspace (Prompt 8.4 / DFD Subsystem 7.0 & PRD Gap #7).
 *
 * Implements:
 * - Thread list with search, unread badges, and role indicators.
 * - Optimistic message sending with client_msg_id deduplication.
 * - WebSocket live sync, typing indicators, and read receipts.
 * - Connection status pill (🟢 Connected / 🟡 Reconnecting / 🔴 Offline).
 * - Offline queue support surviving page reloads via IndexedDB.
 */

import { ThreadList } from '../components/chat/ThreadList.js';
import { MessageBubble } from '../components/chat/MessageBubble.js';
import { MessageComposer } from '../components/chat/MessageComposer.js';
import { Modal } from '../components/ui/Modal.js';
import { Button } from '../components/ui/Button.js';
import { api } from '../core/api.js';
import { getCurrentUser } from '../services/session.js';
import { wsManager, WS_STATUS } from '../services/websocket.js';
import { t } from '../services/i18n.js';
import { toast } from '../services/toast.js';

export default function ChatPage(root) {
  const container = document.createElement('div');
  container.className = 'chat-page-container flex flex-col h-[calc(100vh-64px)] overflow-hidden bg-base';

  let currentUserId = 1;
  let threads = [];
  let selectedThread = null;
  let messages = [];
  let isTyping = false;
  let typingUser = null;
  let typingTimer = null;
  let connectionStatus = WS_STATUS.DISCONNECTED;

  // Initialize layout skeleton
  container.innerHTML = `
    <!-- Top Bar: Connection State & Title -->
    <div class="chat-topbar flex items-center justify-between px-4 py-2.5 bg-surface border-b shrink-0">
      <div class="flex items-center gap-3">
        <h3 class="font-bold text-base m-0">${t('chat.page_title') || 'Messages & Real-Time Chat'}</h3>
        <span class="text-xs text-secondary hidden sm:inline">|</span>
        <span class="text-xs text-secondary hidden sm:inline" id="active-thread-subtitle">No active conversation</span>
      </div>
      <div class="flex items-center gap-2" id="ws-status-badge">
        <span class="status-pill status-connecting text-xxs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
          Connecting...
        </span>
      </div>
    </div>

    <!-- Main 2-Pane Chat Body -->
    <div class="chat-main-body flex flex-1 overflow-hidden">
      <!-- Left Pane: Thread List -->
      <div class="chat-threads-sidebar w-80 sm:w-96 border-r bg-surface flex flex-col shrink-0" id="threads-sidebar-box">
        <div class="p-4 text-center text-xs text-muted">Loading conversations...</div>
      </div>

      <!-- Center Pane: Message Feed & Composer -->
      <div class="chat-conversation-area flex-1 flex flex-col bg-base overflow-hidden" id="chat-conversation-box">
        <div class="flex-1 flex flex-col items-center justify-center text-muted p-8 text-center" id="no-thread-placeholder">
          <span class="text-4xl mb-2">💬</span>
          <p class="text-sm font-semibold">${t('chat.select_thread_prompt') || 'Select a conversation from the left to start messaging.'}</p>
        </div>
      </div>
    </div>
  `;

  // 1. Update Connection Status Badge
  function updateConnectionBadge(status) {
    connectionStatus = status;
    const badge = container.querySelector('#ws-status-badge');
    if (!badge) return;

    if (status === WS_STATUS.CONNECTED) {
      badge.innerHTML = `<span class="status-pill text-xxs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">🟢 Connected</span>`;
    } else if (status === WS_STATUS.RECONNECTING || status === WS_STATUS.CONNECTING) {
      badge.innerHTML = `<span class="status-pill text-xxs font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">🟡 Reconnecting...</span>`;
    } else if (status === WS_STATUS.OFFLINE) {
      badge.innerHTML = `<span class="status-pill text-xxs font-semibold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800">🔴 Offline (Queued)</span>`;
    } else {
      badge.innerHTML = `<span class="status-pill text-xxs font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800">⚪ Disconnected</span>`;
    }
  }

  // 2. Fetch User & Thread List
  async function loadData() {
    try {
      // WHY the session store and not a request: this used to GET /me, which is not a route —
      // me.routes.js mounts at /api/v1/me and registers only /permissions, so there has never
      // been a bare /me endpoint to call. initSession() already holds the authenticated user,
      // so read it there rather than round-tripping for something we have.
      currentUserId = getCurrentUser()?.id ?? currentUserId;

      const threadsRes = await api.get('/chat/threads');
      threads = threadsRes?.data?.items || [];
      renderThreadList();
    } catch (err) {
      const sidebar = container.querySelector('#threads-sidebar-box');
      if (sidebar) sidebar.innerHTML = `<div class="p-4 text-xs text-rose-500">${err.message}</div>`;
    }
  }

  function renderThreadList() {
    const sidebar = container.querySelector('#threads-sidebar-box');
    if (!sidebar) return;
    sidebar.innerHTML = '';

    const listComponent = ThreadList({
      threads,
      selectedThreadId: selectedThread?.id,
      onSelectThread: (th) => {
        selectedThread = th;
        renderThreadList();
        loadMessages(th);
      },
    });

    sidebar.appendChild(listComponent);
  }

  // 3. Load Messages for Active Thread
  async function loadMessages(thread) {
    const convoBox = container.querySelector('#chat-conversation-box');
    if (!convoBox) return;

    const subTitle = container.querySelector('#active-thread-subtitle');
    if (subTitle) {
      subTitle.textContent = thread.customerPhone || `Ref: ${thread.ref}`;
    }

    convoBox.innerHTML = `<div class="p-8 text-center text-xs text-muted">Loading messages...</div>`;

    try {
      const res = await api.get(`/chat/threads/${thread.id}/messages`);
      messages = res?.data?.items || [];
      renderActiveConversation();

      // Mark read over HTTP and WebSocket
      api.post(`/chat/threads/${thread.id}/read`).catch(() => {});
      if (messages.length > 0) {
        const lastId = messages[messages.length - 1].id;
        wsManager.sendReadReceipt({ threadId: thread.id, lastReadMessageId: lastId });
      }
    } catch (err) {
      convoBox.innerHTML = `<div class="p-8 text-center text-xs text-rose-500">${err.message}</div>`;
    }
  }

  // The gateway's live payload is camelCase and nested under `message`; every other code path
  // here (HTTP load, optimistic send) uses the snake_case row shape chat.service.js returns over
  // HTTP. Normalise once at the boundary so MessageBubble only ever sees one shape.
  function normalizeWireMessage(threadId, m) {
    return {
      id: m.id,
      client_msg_id: m.clientMsgId ?? null,
      thread_id: threadId,
      sender_id: m.senderId,
      sender_name: m.senderName,
      content: m.content,
      msg_type: m.msgType || 'TEXT',
      payload_json: m.payloadJson || {},
      flagged_for_moderation: Boolean(m.flaggedForModeration),
      created_at: m.createdAt || new Date().toISOString(),
      status: 'DELIVERED',
    };
  }

  // 4. Render Active Conversation Pane
  function renderActiveConversation() {
    const convoBox = container.querySelector('#chat-conversation-box');
    if (!convoBox || !selectedThread) return;

    convoBox.innerHTML = `
      <!-- Messages Stream -->
      <div class="chat-messages-stream flex-1 overflow-y-auto p-4 space-y-2" id="messages-stream-box"></div>

      <!-- Typing Indicator -->
      <div class="typing-banner px-4 py-1 text-xxs text-secondary italic hidden" id="typing-indicator-box">
        <span>Someone is typing...</span>
      </div>

      <!-- Composer Box -->
      <div id="composer-mount-box"></div>
    `;

    const streamBox = convoBox.querySelector('#messages-stream-box');
    messages.forEach((msg) => {
      const isOutgoing = msg.sender_id === currentUserId;
      const bubble = MessageBubble({
        message: msg,
        isOutgoing,
        currentUserId,
        onRetry: (failedMsg) => handleSendMessage(failedMsg.content, failedMsg.client_msg_id),
      });
      streamBox.appendChild(bubble);
    });

    streamBox.scrollTop = streamBox.scrollHeight;

    // Mount Composer
    const composerMount = convoBox.querySelector('#composer-mount-box');
    const composer = MessageComposer({
      isOffline: connectionStatus === WS_STATUS.OFFLINE,
      onSendMessage: (text) => handleSendMessage(text),
      onSendTyping: (isTypingNow) => {
        wsManager.sendTyping({
          threadId: selectedThread.id,
          isTyping: isTypingNow,
          participantIds: selectedThread.participant_ids || [],
        });
      },
      onOpenProductModal: () => openInsertProductModal(),
    });
    composerMount.appendChild(composer);
  }

  // 5. Handle Optimistic Send
  async function handleSendMessage(content, existingClientMsgId = null) {
    if (!selectedThread) return;

    const clientMsgId = existingClientMsgId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Optimistic message entry
    const optimisticMsg = {
      id: null,
      client_msg_id: clientMsgId,
      thread_id: selectedThread.id,
      sender_id: currentUserId,
      content,
      msg_type: 'TEXT',
      status: 'SENDING',
      created_at: new Date().toISOString(),
    };

    // Replace if retry, else append
    const idx = messages.findIndex((m) => m.client_msg_id === clientMsgId);
    if (idx >= 0) {
      messages[idx] = optimisticMsg;
    } else {
      messages.push(optimisticMsg);
    }

    renderActiveConversation();

    try {
      await wsManager.sendMessage({
        threadId: selectedThread.id,
        content,
        clientMsgId,
        msgType: 'TEXT',
      });
    } catch {
      optimisticMsg.status = 'FAILED';
      renderActiveConversation();
    }
  }

  // 6. Insert Product Card Modal
  function openInsertProductModal() {
    if (!selectedThread) return;

    const modalBody = document.createElement('div');
    modalBody.className = 'p-4 space-y-4';
    modalBody.innerHTML = `
      <p class="text-xs text-secondary">Insert a shoppable product card with a 1-tap Buy Now button into this thread.</p>
      <div class="form-group">
        <label class="form-label text-xs">Product ID</label>
        <input type="number" class="input input--sm w-full" id="modal-prod-id" value="1" />
      </div>
      <div class="form-group">
        <label class="form-label text-xs">Note / Promotion</label>
        <input type="text" class="input input--sm w-full" id="modal-prod-note" placeholder="e.g. Free shipping included!" />
      </div>
    `;

    const modal = Modal({
      title: t('chat.modal_insert_product') || 'Insert Product Card',
      content: modalBody,
      footer: Button({
        label: t('chat.btn_insert_card') || 'Insert Product Card',
        variant: 'primary',
        onClick: async () => {
          const prodId = parseInt(modalBody.querySelector('#modal-prod-id').value, 10);
          const note = modalBody.querySelector('#modal-prod-note').value;

          if (!prodId) {
            toast.error('Invalid product ID');
            return;
          }

          modal.close();

          try {
            const res = await api.post(`/saler/inbox/threads/${selectedThread.id}/send-product`, {
              product_id: prodId,
              note,
            });

            if (res?.data?.message) {
              messages.push(res.data.message);
              renderActiveConversation();
            }
          } catch (err) {
            toast.error(err.message);
          }
        },
      }),
    });

    modal.open();
  }

  // 7. WebSocket Event Listeners
  const unsubStatus = wsManager.onStatusChange((status) => {
    updateConnectionBadge(status);
  });

  // WHY the flat camelCase reads below: server/src/sockets/chat.handler.js and
  // chat.service.js send frames as { type, clientMsgId, messageId, threadId } and
  // { type, threadId, message: {...} } — never wrapped in a `payload` object. This handler
  // destructured `payload` off the frame, so it was undefined on every live frame and the whole
  // real-time half of the page (acks, inbound messages, typing) silently did nothing.
  const unsubMsg = wsManager.onMessage((frame) => {
    const { type } = frame;
    const threadId = frame.threadId !== undefined ? Number(frame.threadId) : null;

    // Message Ack -> update optimistic message to delivered
    if (type === 'chat:ack') {
      const msg = messages.find((m) => m.client_msg_id === frame.clientMsgId);
      if (msg) {
        msg.id = frame.messageId;
        msg.status = 'DELIVERED';
        renderActiveConversation();
      }
    }

    // Send rejected (restriction, empty content, thread gone) -> offer the retry affordance
    // rather than leaving the bubble stuck on ⏳ forever.
    if (type === 'chat:error') {
      const msg = messages.find((m) => m.client_msg_id === frame.clientMsgId);
      if (msg) {
        msg.status = 'FAILED';
        renderActiveConversation();
      }
      toast.error(frame.reasonEn || frame.message || t('chat.send_failed') || 'Message could not be sent.');
    }

    // Inbound Message
    if (type === 'chat:message' && frame.message) {
      const incoming = normalizeWireMessage(threadId, frame.message);

      if (selectedThread && threadId === Number(selectedThread.id)) {
        // Prevent duplicate append
        const exists = messages.some(
          (m) => (incoming.id && m.id === incoming.id) || (m.client_msg_id && m.client_msg_id === incoming.client_msg_id)
        );
        if (!exists) {
          messages.push(incoming);
          renderActiveConversation();
          wsManager.sendReadReceipt({ threadId: selectedThread.id, lastReadMessageId: incoming.id });
        }
      }
      // Update preview in thread list
      const th = threads.find((item) => Number(item.id) === threadId);
      if (th) {
        th.last_message_preview = incoming.content;
        th.last_message_at = incoming.created_at;
        if (!selectedThread || Number(selectedThread.id) !== threadId) {
          th.unread_count = (Number(th.unread_count) || 0) + 1;
        }
        renderThreadList();
      }
    }

    // Typing Event
    if (type === 'chat:typing' && selectedThread && threadId === Number(selectedThread.id)) {
      const banner = container.querySelector('#typing-indicator-box');
      if (banner) {
        const who = frame.userName || 'Someone';
        if (frame.isTyping) {
          banner.innerHTML = `<span>${who} ${t('chat.is_typing') || 'is typing…'}</span>`;
          banner.classList.remove('hidden');
          if (typingTimer) clearTimeout(typingTimer);
          typingTimer = setTimeout(() => banner.classList.add('hidden'), 3000);
        } else {
          banner.classList.add('hidden');
        }
      }
    }
  });

  // Connect WebSocket & fetch data
  wsManager.connect();
  loadData();

  root.append(container);
}
