/**
 * UnifiedInboxPage.js — Saler Unified Multi-Channel Commerce Inbox (Prompt 8.3 / DFD Subsystem 20.0).
 *
 * Two-pane layout on purpose: conversations on the left, ONE conversation on the right. Everything
 * the old third "customer context" pane carried is folded into the chat header (who, which channel)
 * or shown only when it matters (a closed reply window). Fewer things on screen = faster decisions.
 *
 * Implements:
 * - Multi-channel conversation aggregation (WhatsApp, Messenger, In-Platform) with filter tabs.
 * - Real-time WebSocket arrival listener & optimistic message dispatch.
 * - Catalog-driven Product Card selector modal with 1-tap single-use checkout link generation.
 * - Quick reply shortcuts, hidden behind one button until asked for.
 * - Phone: list → conversation navigation with a Back button (one pane at a time).
 */

import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { api } from '../../core/api.js';
import { wsManager } from '../../services/websocket.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';
import { escapeHtml as esc } from '../../services/html.js';
import { toast } from '../../services/toast.js';

const ICON_CHAT =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
const ICON_BACK =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>';
const ICON_SEND =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"></path><path d="M22 2l-7 20-4-9-9-4 20-7z"></path></svg>';

const CHANNELS = {
  WHATSAPP: { label: 'WhatsApp', cls: 'tag-whatsapp' },
  MESSENGER: { label: 'Messenger', cls: 'tag-messenger' },
  IN_PLATFORM: { label: 'Direct', cls: 'tag-inplatform' },
};

function channelMeta(channel) {
  return CHANNELS[channel] || CHANNELS.IN_PLATFORM;
}

function threadName(thread) {
  return thread.other_participant_name || thread.customerPhone || `#${thread.ref || thread.id}`;
}

export default function UnifiedInboxPage(root) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'unified-inbox-page';

  let threads = [];
  let selectedThreadId = null;
  let messages = [];
  let searchFilter = '';
  let activeChannel = 'ALL';
  let catalogProducts = null;
  let isSending = false;
  let draft = '';
  let quickOpen = false;

  container.innerHTML = `
    <div class="inbox-header-row">
      <h2>${ICON_CHAT}<span>${esc(t('saler_inbox.page_title') || 'Unified Commerce Inbox')}</span></h2>
      <div class="inbox-channel-filters" id="channel-filters-bar" role="tablist">
        <button type="button" role="tab" class="channel-filter-pill active" data-channel="ALL">
          <span>${esc(t('saler_inbox.filter_all') || 'All')}</span>
          <span class="pill-count" id="count-all">0</span>
        </button>
        <button type="button" role="tab" class="channel-filter-pill" data-channel="WHATSAPP">
          <span class="channel-dot dot-whatsapp"></span>
          <span>${esc(t('saler_inbox.filter_whatsapp') || 'WhatsApp')}</span>
          <span class="pill-count" id="count-whatsapp">0</span>
        </button>
        <button type="button" role="tab" class="channel-filter-pill" data-channel="MESSENGER">
          <span class="channel-dot dot-messenger"></span>
          <span>${esc(t('saler_inbox.filter_messenger') || 'Messenger')}</span>
          <span class="pill-count" id="count-messenger">0</span>
        </button>
        <button type="button" role="tab" class="channel-filter-pill" data-channel="IN_PLATFORM">
          <span class="channel-dot dot-inplatform"></span>
          <span>${esc(t('saler_inbox.filter_direct') || 'Direct')}</span>
          <span class="pill-count" id="count-direct">0</span>
        </button>
      </div>
    </div>

    <div class="unified-inbox-layout" id="inbox-layout">
      <div class="inbox-threads-pane">
        <div class="thread-search-box">
          <input
            type="search"
            class="input"
            id="inbox-search"
            aria-label="${esc(t('saler_inbox.search_placeholder') || 'Search conversations...')}"
            placeholder="${esc(t('saler_inbox.search_placeholder') || 'Search conversations...')}"
          />
        </div>
        <div class="thread-list-scroll" id="threads-list">
          <div class="inbox-note">${esc(t('saler_inbox.loading') || 'Loading...')}</div>
        </div>
      </div>

      <div class="inbox-chat-pane" id="chat-pane">
        <div class="chat-placeholder">
          <span class="placeholder-icon">${ICON_CHAT}</span>
          <p>${esc(t('saler_inbox.select_conversation') || 'Select a conversation to start chatting.')}</p>
        </div>
      </div>
    </div>
  `;

  const layout = container.querySelector('#inbox-layout');

  const quickReplies = [1, 2, 3, 4].map((n) => t(`saler_inbox.quick_reply_${n}`)).filter(Boolean);

  // 1. Fetch Threads
  async function fetchThreads() {
    try {
      const res = await api.get('/saler/inbox/threads');
      threads = res?.data?.items || [];
      updateChannelCounts();
      renderThreads();

      // Desktop opens the newest conversation straight away; on a phone the list is the landing view.
      if (threads.length > 0 && !selectedThreadId && !window.matchMedia('(max-width: 768px)').matches) {
        selectThread(getFilteredThreads()[0] || threads[0]);
      }
    } catch (err) {
      const list = container.querySelector('#threads-list');
      if (list) list.innerHTML = `<div class="inbox-note inbox-note--error">${esc(err.message)}</div>`;
    }
  }

  // 2. Filter Threads Helper
  function getFilteredThreads() {
    const q = searchFilter.trim().toLowerCase();
    return threads.filter((th) => {
      if (activeChannel !== 'ALL' && th.channel !== activeChannel) return false;
      if (!q) return true;
      return [th.customerPhone, th.other_participant_name, th.ref, th.last_message_preview].some((v) =>
        String(v || '').toLowerCase().includes(q)
      );
    });
  }

  // 3. Update Channel Counts
  function updateChannelCounts() {
    const count = (ch) => threads.filter((th) => th.channel === ch).length;
    const set = (id, n) => {
      const el = container.querySelector(id);
      if (el) el.textContent = String(n);
    };
    set('#count-all', threads.length);
    set('#count-whatsapp', count('WHATSAPP'));
    set('#count-messenger', count('MESSENGER'));
    set('#count-direct', count('IN_PLATFORM'));
  }

  // 4. Render Thread List
  function renderThreads() {
    const list = container.querySelector('#threads-list');
    if (!list) return;
    list.innerHTML = '';

    const filtered = getFilteredThreads();
    if (filtered.length === 0) {
      list.innerHTML = `<div class="inbox-note">${esc(t('saler_inbox.empty_threads') || 'No conversations found.')}</div>`;
      return;
    }

    filtered.forEach((th) => {
      const unread = Number(th.unread_count) || 0;
      const meta = channelMeta(th.channel);
      const name = threadName(th);

      const item = document.createElement('button');
      item.type = 'button';
      item.className = `thread-card${th.id === selectedThreadId ? ' selected' : ''}${unread ? ' unread' : ''}`;
      item.innerHTML = `
        <span class="thread-avatar ${meta.cls}" title="${esc(meta.label)}">${esc(name.charAt(0).toUpperCase())}</span>
        <span class="thread-body">
          <span class="thread-card-header">
            <span class="thread-name">${esc(name)}</span>
            <span class="thread-time">${esc(formatDate(th.last_message_at))}</span>
          </span>
          <span class="thread-preview-row">
            <span class="thread-preview">${esc(th.last_message_preview || t('saler_inbox.empty_messages') || '')}</span>
            ${unread ? `<span class="thread-unread-pill">${unread}</span>` : ''}
          </span>
        </span>
      `;
      item.addEventListener('click', () => selectThread(th));
      list.appendChild(item);
    });
  }

  // 5. Select Thread Action
  function selectThread(thread) {
    if (thread.id !== selectedThreadId) {
      draft = '';
      quickOpen = false;
    }
    selectedThreadId = thread.id;

    if (thread.unread_count > 0) {
      thread.unread_count = 0;
      api.post(`/chat/threads/${thread.id}/read`).catch(() => {});
    }

    layout.classList.add('show-chat');
    renderThreads();
    loadActiveChat(thread);
  }

  // 6. Load Active Chat Messages
  async function loadActiveChat(thread) {
    const chatPane = container.querySelector('#chat-pane');
    if (!chatPane) return;

    messages = [];
    renderChatShell(thread);
    const box = chatPane.querySelector('#chat-messages-box');
    box.innerHTML = `<div class="inbox-note">${esc(t('saler_inbox.loading') || 'Loading...')}</div>`;

    try {
      const res = await api.get(`/chat/threads/${thread.id}/messages`);
      if (selectedThreadId !== thread.id) return; // user already moved to another thread
      messages = res?.data?.items || [];
      renderMessages(thread);

      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        wsManager.sendReadReceipt({ threadId: thread.id, lastReadMessageId: lastMsg.id });
      }
    } catch (err) {
      if (selectedThreadId !== thread.id) return;
      box.innerHTML = `<div class="inbox-note inbox-note--error">${esc(err.message)}</div>`;
    }
  }

  // 7a. Chat shell (header + feed container + composer) — built once per thread so typing is never lost.
  function renderChatShell(thread) {
    const chatPane = container.querySelector('#chat-pane');
    const meta = channelMeta(thread.channel);
    const name = threadName(thread);
    const needsWindow = thread.channel === 'WHATSAPP' || thread.channel === 'MESSENGER';
    const windowClosed = needsWindow && !thread.inside24h;
    const subtitle = [meta.label, thread.customerPhone].filter(Boolean).join(' · ');

    chatPane.innerHTML = `
      <div class="chat-header">
        <button type="button" class="chat-back-btn" id="btn-back" aria-label="${esc(t('saler_inbox.btn_back') || 'Back')}">${ICON_BACK}</button>
        <span class="thread-avatar ${meta.cls}">${esc(name.charAt(0).toUpperCase())}</span>
        <div class="chat-header-info">
          <h4>${esc(name)}</h4>
          <span class="chat-header-sub">${esc(subtitle)}</span>
        </div>
      </div>

      ${
        windowClosed
          ? `<div class="chat-window-notice" role="status">⚠️ ${esc(t('saler_inbox.window_closed_notice') || 'This customer last wrote more than 24 hours ago, so your reply may not be delivered.')}</div>`
          : ''
      }

      <div class="chat-messages-scroll" id="chat-messages-box"></div>

      <div class="chat-composer">
        <div class="quick-replies-panel" id="quick-replies-row" ${quickOpen ? '' : 'hidden'}></div>
        <div class="chat-composer-tools">
          <button type="button" class="composer-tool" id="btn-quick-toggle" aria-expanded="${quickOpen}">
            <span aria-hidden="true">⚡</span><span>${esc(t('saler_inbox.btn_quick_replies') || 'Quick replies')}</span>
          </button>
          <button type="button" class="composer-tool" id="btn-open-prod-modal">
            <span aria-hidden="true">🛍️</span><span>${esc(t('saler_inbox.btn_send_product_card') || 'Send Product Card')}</span>
          </button>
        </div>
        <div class="chat-composer-row">
          <textarea
            class="chat-input"
            id="chat-input"
            rows="2"
            autocomplete="off"
            aria-label="${esc(t('saler_inbox.type_reply_placeholder') || 'Type a reply to customer...')}"
            placeholder="${esc(t('saler_inbox.type_reply_placeholder') || 'Type a reply to customer...')}"
          ></textarea>
          <button type="button" class="btn btn--primary chat-send-btn" id="btn-send-reply">
            ${ICON_SEND}<span>${esc(t('saler_inbox.btn_send') || 'Send')}</span>
          </button>
        </div>
      </div>
    `;

    const input = chatPane.querySelector('#chat-input');
    const qrRow = chatPane.querySelector('#quick-replies-row');
    input.value = draft;
    autosizeInput(input);
    input.addEventListener('input', () => {
      draft = input.value;
      autosizeInput(input);
    });

    quickReplies.forEach((text) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'quick-reply-chip';
      chip.textContent = text;
      chip.addEventListener('click', () => {
        input.value = text;
        draft = text;
        autosizeInput(input);
        quickOpen = false;
        qrRow.hidden = true;
        chatPane.querySelector('#btn-quick-toggle').setAttribute('aria-expanded', 'false');
        input.focus();
      });
      qrRow.appendChild(chip);
    });

    chatPane.querySelector('#btn-quick-toggle').addEventListener('click', (e) => {
      quickOpen = !quickOpen;
      qrRow.hidden = !quickOpen;
      e.currentTarget.setAttribute('aria-expanded', String(quickOpen));
    });

    chatPane.querySelector('#btn-back').addEventListener('click', () => {
      layout.classList.remove('show-chat');
    });

    chatPane.querySelector('#btn-open-prod-modal').addEventListener('click', () => {
      openProductPickerModal(thread);
    });

    chatPane.querySelector('#btn-send-reply').addEventListener('click', () => sendReply(thread));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendReply(thread);
      }
    });
  }

  // 7b. Message feed only — safe to call on every incoming/outgoing message.
  function renderMessages(thread) {
    const box = container.querySelector('#chat-messages-box');
    if (!box) return;
    box.innerHTML = '';

    if (messages.length === 0) {
      box.innerHTML = `<div class="inbox-note">${esc(t('saler_inbox.empty_messages') || 'No messages yet in this conversation.')}</div>`;
      return;
    }

    messages.forEach((msg) => {
      const row = document.createElement('div');
      const isSaler =
        msg.sender_role === 'saler' || msg.msg_type === 'PRODUCT_CARD' || msg.sender_id === thread.participant_ids?.[1];
      row.className = `chat-bubble-row ${isSaler ? 'outgoing' : 'incoming'}`;

      if (msg.msg_type === 'PRODUCT_CARD') {
        const payload = msg.payload_json || {};
        const title = esc(payload.productTitle || msg.content || 'Featured Product');
        const price = esc(payload.price || '0.00');
        const imgUrl = esc(
          payload.imageUrl ||
            payload.image_url ||
            'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=60'
        );
        const noteText = payload.note ? `<div class="prod-bubble-note">💡 ${esc(payload.note)}</div>` : '';

        row.innerHTML = `
          <div class="product-card-bubble">
            <img src="${imgUrl}" alt="${title}" class="prod-bubble-img" />
            <h5>${title}</h5>
            <div class="prod-bubble-price">৳${price}</div>
            ${noteText}
            <a href="${esc(payload.checkoutUrl || '#')}" target="_blank" rel="noopener" class="btn btn--primary btn--sm btn-1tap">
              ⚡ Buy Now / অর্ডার করুন
            </a>
            <div class="bubble-meta"><span class="bubble-time">${esc(formatDate(msg.created_at))}</span><span title="Delivered">✓✓</span></div>
          </div>
        `;
      } else {
        row.innerHTML = `
          <div class="chat-bubble ${isSaler ? 'bubble-saler' : 'bubble-customer'}">
            <p>${esc(msg.content || '')}</p>
            <div class="bubble-meta">
              <span class="bubble-time">${esc(formatDate(msg.created_at))}</span>
              ${isSaler ? '<span title="Delivered">✓✓</span>' : ''}
            </div>
          </div>
        `;
      }
      box.appendChild(row);
    });

    box.scrollTop = box.scrollHeight;
  }

  // WHY: the reply box starts at two lines and grows with the text (capped by CSS max-height, then
  // it scrolls) so a long reply is never hidden behind a one-line slot.
  function autosizeInput(el) {
    el.style.height = 'auto';
    // border-box height = content + padding (scrollHeight) + borders (offset - client)
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }

  async function sendReply(thread) {
    const input = container.querySelector('#chat-input');
    if (isSending || !input) return;
    const text = (input.value || '').trim();
    if (!text) return;

    isSending = true;
    input.value = '';
    draft = '';
    autosizeInput(input);

    const optimisticMsg = {
      id: `tmp-${Date.now()}`,
      thread_id: thread.id,
      sender_role: 'saler',
      content: text,
      msg_type: 'TEXT',
      created_at: new Date().toISOString(),
    };
    messages.push(optimisticMsg);
    thread.last_message_preview = text;
    thread.last_message_at = optimisticMsg.created_at;
    renderMessages(thread);
    renderThreads();
    input.focus();

    try {
      const res = await api.post(`/saler/inbox/threads/${thread.id}/send`, { content: text });
      const idx = messages.findIndex((m) => m.id === optimisticMsg.id);
      if (idx >= 0 && res?.data?.message) messages[idx] = res.data.message;
      if (selectedThreadId === thread.id) renderMessages(thread);
    } catch (err) {
      // Roll back the bubble and hand the text back so nothing the user typed is lost.
      messages = messages.filter((m) => m.id !== optimisticMsg.id);
      if (selectedThreadId === thread.id) {
        renderMessages(thread);
        const again = container.querySelector('#chat-input');
        if (again && !again.value) {
          again.value = text;
          draft = text;
          autosizeInput(again);
        }
      }
      toast.error(err.message || t('saler_inbox.send_failed') || 'Failed to send message.');
    } finally {
      isSending = false;
    }
  }

  // 9. Interactive Product Picker Modal
  async function openProductPickerModal(thread) {
    const modalContent = document.createElement('div');
    modalContent.className = 'product-picker-modal';
    modalContent.innerHTML = `<div class="inbox-note">${esc(t('saler_inbox.loading') || 'Loading...')}</div>`;

    const modal = Modal({
      title: t('saler_inbox.modal_send_product_title') || 'Insert WhatsApp Product Card',
      content: modalContent,
      footer: Button({
        label: t('saler_inbox.btn_confirm_send_card') || 'Send 1-Tap Checkout Card',
        variant: 'primary',
        onClick: async () => {
          const selectedRadio = modalContent.querySelector('input[name="selected_prod"]:checked');
          if (!selectedRadio) {
            toast.error(t('saler_inbox.select_product_error') || 'Please select a product from the list.');
            return;
          }

          const prodId = parseInt(selectedRadio.value, 10);
          const note = modalContent.querySelector('#modal-prod-note')?.value || '';

          try {
            const res = await api.post(`/saler/inbox/threads/${thread.id}/send-product`, {
              product_id: prodId,
              note,
            });

            toast.success(t('saler_inbox.card_sent_success') || 'Product card sent to customer!');
            modal.close();

            if (res?.data?.message) {
              messages.push(res.data.message);
              thread.last_message_preview = res.data.message.content || 'Product Card';
              thread.last_message_at = res.data.message.created_at;
              if (selectedThreadId === thread.id) renderMessages(thread);
              renderThreads();
            }
          } catch (err) {
            toast.error(err.message || 'Failed to send product card.');
          }
        },
      }),
    });

    modal.open();

    try {
      if (!catalogProducts) {
        const prodRes = await api.get('/saler/products');
        catalogProducts = prodRes?.data?.products || [];
      }

      if (catalogProducts.length === 0) {
        modalContent.innerHTML = `<p class="inbox-note">No curated products in your store catalog yet.</p>`;
        return;
      }

      const listHtml = catalogProducts
        .map((p, idx) => {
          const title = esc(isBn && p.title_bn ? p.title_bn : p.title_en);
          const price = (p.custom_retail_price || p.default_retail_price || 3500).toFixed(2);
          const img = esc(p.image_url || '/demo-product.jpg');
          return `
            <label class="product-picker-item ${idx === 0 ? 'selected' : ''}">
              <input type="radio" name="selected_prod" value="${esc(p.id)}" ${idx === 0 ? 'checked' : ''} />
              <img src="${img}" alt="${title}" class="product-picker-thumb" />
              <div class="product-picker-info">
                <span class="product-picker-title">${title}</span>
                <div class="product-picker-meta">
                  <span class="product-picker-price">৳${price}</span>
                  <span class="product-picker-stock">• ${p.stock_qty || 10} in stock</span>
                </div>
              </div>
            </label>
          `;
        })
        .join('');

      modalContent.innerHTML = `
        <p class="text-xs text-secondary mb-2">${esc(t('saler_inbox.modal_product_desc') || 'Choose a product from your catalog to generate an instant 1-tap checkout link for this customer.')}</p>
        <div class="product-picker-list">${listHtml}</div>
        <div class="form-group mt-2">
          <label class="form-label text-xs">${esc(t('saler_inbox.custom_note_label') || 'Custom Offer / Discount Note (Optional)')}</label>
          <input
            type="text"
            class="input input--sm w-full"
            id="modal-prod-note"
            placeholder="${esc(t('saler_inbox.custom_note_placeholder') || 'e.g. Special 10% discount for you!')}"
          />
        </div>
      `;

      modalContent.querySelectorAll('.product-picker-item').forEach((item) => {
        item.addEventListener('click', () => {
          modalContent.querySelectorAll('.product-picker-item').forEach((i) => i.classList.remove('selected'));
          item.classList.add('selected');
        });
      });
    } catch (err) {
      modalContent.innerHTML = `<div class="inbox-note inbox-note--error">${esc(err.message)}</div>`;
    }
  }

  // 10. Channel Filter Tabs
  const filterPills = container.querySelectorAll('.channel-filter-pill');
  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      activeChannel = pill.getAttribute('data-channel') || 'ALL';
      renderThreads();
    });
  });

  // 11. Search Filter Listener
  container.querySelector('#inbox-search')?.addEventListener('input', (e) => {
    searchFilter = e.target.value;
    renderThreads();
  });

  // 12. WebSocket Real-Time Inbound Listener
  const unsubMsg = wsManager.onMessage((frame) => {
    const { type } = frame;
    const threadId = frame.threadId !== undefined ? Number(frame.threadId) : null;

    if (type === 'chat:message' && frame.message) {
      const incoming = frame.message;
      const th = threads.find((item) => Number(item.id) === threadId);
      if (!th) return;

      th.last_message_preview = incoming.content || 'New message';
      th.last_message_at = incoming.created_at || new Date().toISOString();

      if (selectedThreadId === threadId) {
        messages.push(incoming);
        renderMessages(th);
        wsManager.sendReadReceipt({ threadId, lastReadMessageId: incoming.id });
      } else {
        th.unread_count = (Number(th.unread_count) || 0) + 1;
      }
      renderThreads();
      updateChannelCounts();
    }

    if (type === 'chat:ack' && frame.clientMsgId) {
      const msg = messages.find((m) => m.client_msg_id === frame.clientMsgId);
      if (msg) msg.id = frame.messageId;
    }
  });

  wsManager.connect();
  fetchThreads();

  root.append(container);
  return () => {
    if (typeof unsubMsg === 'function') unsubMsg();
  };
}
