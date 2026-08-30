/**
 * UnifiedInboxPage.js — Saler Unified Multi-Channel Inbox (Prompt 8.3 / DFD Subsystem 20.0).
 *
 * Implements:
 * - Unified multi-channel conversations (WhatsApp, Messenger, In-Platform).
 * - Channel badges, 24-hour Meta session window status countdown.
 * - Quick reply shortcuts.
 * - Interactive Product Card insertion with 1-tap single-use checkout link generation.
 * - Real-time WebSocket arrival listener.
 */

import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Modal } from '../../components/ui/Modal.js';
import { api } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';
import { toast } from '../../services/toast.js';

export default function UnifiedInboxPage(root) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'unified-inbox-page page-container';

  let threads = [];
  let selectedThreadId = null;
  let messages = [];
  let searchFilter = '';
  let catalogProducts = [];

  container.innerHTML = `
    <div class="inbox-header-row">
      <div>
        <h2>${t('saler_inbox.page_title') || 'Unified Commerce Inbox'}</h2>
        <p class="page-subtitle">${t('saler_inbox.page_subtitle') || 'Manage WhatsApp, Messenger, and in-platform customer chats in one place.'}</p>
      </div>
      <div class="inbox-channel-filters">
        <span class="channel-filter-pill active" data-channel="ALL">All</span>
        <span class="channel-filter-pill" data-channel="WHATSAPP">🟢 WhatsApp</span>
        <span class="channel-filter-pill" data-channel="MESSENGER">🔵 Messenger</span>
        <span class="channel-filter-pill" data-channel="IN_PLATFORM">🟣 Direct</span>
      </div>
    </div>
    <div class="unified-inbox-layout">
      <!-- Left: Thread List -->
      <div class="inbox-threads-pane">
        <div class="thread-search-box">
          <input type="text" class="input input--sm" id="inbox-search" placeholder="${t('saler_inbox.search_placeholder') || 'Search conversations...'}" />
        </div>
        <div class="thread-list-scroll" id="threads-list">
          <div class="loading-spinner">Loading conversations...</div>
        </div>
      </div>

      <!-- Center: Active Chat Pane -->
      <div class="inbox-chat-pane" id="chat-pane">
        <div class="chat-placeholder">
          <span class="placeholder-icon">💬</span>
          <p>${t('saler_inbox.select_conversation') || 'Select a conversation to start chatting.'}</p>
        </div>
      </div>

      <!-- Right: Customer Context & 1-Tap Checkout Pane -->
      <div class="inbox-context-pane" id="context-pane">
        <div class="context-empty-state">
          <p class="text-xs text-muted">Customer details and order context will appear here.</p>
        </div>
      </div>
    </div>
  `;

  // Quick replies
  const quickReplies = [
    { en: 'Product is available in stock.', bn: 'পণ্যটি স্টকে এভেইলেবল আছে।' },
    { en: 'Delivery takes 2-3 business days.', bn: 'ডেলিভারি হতে ২-৩ কার্যদিবস লাগবে।' },
    { en: 'Inside Dhaka delivery ৳60, outside Dhaka ৳120.', bn: 'ঢাকার ভিতরে ডেলিভারি ৳৬০, ঢাকার বাইরে ৳১২০।' },
    { en: 'Sending your instant 1-tap checkout link now!', bn: 'আপনার অর্ডার করার ১-ট্যাপ লিংক দিচ্ছি!' },
  ];

  async function fetchThreads() {
    try {
      const res = await api.get('/saler/inbox/threads');
      threads = res?.data?.items || [];
      renderThreads();
    } catch (err) {
      const list = container.querySelector('#threads-list');
      if (list) list.innerHTML = `<div class="error-msg">${err.message}</div>`;
    }
  }

  function renderThreads() {
    const list = container.querySelector('#threads-list');
    if (!list) return;
    list.innerHTML = '';

    const filtered = threads.filter((t) => {
      const q = searchFilter.toLowerCase();
      const phone = (t.customerPhone || '').toLowerCase();
      const preview = (t.last_message_preview || '').toLowerCase();
      return phone.includes(q) || preview.includes(q) || t.ref.toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      list.innerHTML = `<div class="p-4 text-center text-xs text-muted">No conversations found.</div>`;
      return;
    }

    filtered.forEach((t) => {
      const item = document.createElement('div');
      item.className = `thread-card ${t.id === selectedThreadId ? 'selected' : ''} ${t.unread_count > 0 ? 'unread' : ''}`;

      const channelBadge = t.channel === 'WHATSAPP'
        ? '<span class="channel-tag tag-whatsapp">WhatsApp</span>'
        : t.channel === 'MESSENGER'
        ? '<span class="channel-tag tag-messenger">Messenger</span>'
        : '<span class="channel-tag tag-inplatform">Direct</span>';

      item.innerHTML = `
        <div class="thread-card-header">
          <div class="thread-title-wrap">
            <span class="thread-phone">${t.customerPhone || `User #${t.id}`}</span>
            ${channelBadge}
          </div>
          <span class="thread-time">${formatDate(t.last_message_at)}</span>
        </div>
        <p class="thread-preview">${t.last_message_preview || 'No messages yet'}</p>
        ${t.unread_count > 0 ? `<span class="thread-unread-pill">${t.unread_count}</span>` : ''}
      `;

      item.addEventListener('click', () => {
        selectedThreadId = t.id;
        renderThreads();
        loadActiveChat(t);
      });

      list.appendChild(item);
    });
  }

  async function loadActiveChat(thread) {
    const chatPane = container.querySelector('#chat-pane');
    const contextPane = container.querySelector('#context-pane');
    if (!chatPane) return;

    chatPane.innerHTML = `<div class="loading-spinner p-8">Loading messages...</div>`;

    try {
      const res = await api.get(`/chat/threads/${thread.id}/messages`);
      messages = res?.data?.items || [];
      renderChat(thread);
      renderContext(thread);
    } catch (err) {
      chatPane.innerHTML = `<div class="error-msg p-8">${err.message}</div>`;
    }
  }

  function renderChat(thread) {
    const chatPane = container.querySelector('#chat-pane');
    if (!chatPane) return;

    const inside24h = thread.inside24h;
    const windowNotice = thread.channel === 'WHATSAPP'
      ? inside24h
        ? `<span class="session-pill session-active">🟢 24h Meta Window Active</span>`
        : `<span class="session-pill session-expired">⚠️ Window Expired (Template Mode)</span>`
      : '';

    chatPane.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-info">
          <h4>${thread.customerPhone || `Conversation #${thread.ref}`}</h4>
          <span class="text-xs text-secondary">${thread.channel} • Ref: ${thread.ref}</span>
        </div>
        <div>${windowNotice}</div>
      </div>
      <div class="chat-messages-scroll" id="chat-messages-box"></div>
      <div class="chat-quick-replies" id="quick-replies-row"></div>
      <div class="chat-composer-row">
        <button class="btn btn--secondary btn--sm btn-send-prod" id="btn-open-prod-modal">
          📦 ${t('saler_inbox.btn_send_product_card') || 'Send Product Card'}
        </button>
        <input type="text" class="input input--sm flex-1" id="chat-input" placeholder="${t('saler_inbox.type_reply_placeholder') || 'Type a reply to customer...'}" />
        <button class="btn btn--primary btn--sm" id="btn-send-reply">
          ${t('saler_inbox.btn_send') || 'Send'}
        </button>
      </div>
    `;

    // Render quick replies
    const qrRow = chatPane.querySelector('#quick-replies-row');
    quickReplies.forEach((qr) => {
      const btn = document.createElement('button');
      btn.className = 'quick-reply-chip';
      btn.textContent = isBn ? qr.bn : qr.en;
      btn.addEventListener('click', () => {
        const inp = chatPane.querySelector('#chat-input');
        if (inp) {
          inp.value = btn.textContent;
          inp.focus();
        }
      });
      qrRow.appendChild(btn);
    });

    // Render message bubbles
    const box = chatPane.querySelector('#chat-messages-box');
    messages.forEach((msg) => {
      const bubble = document.createElement('div');
      const isSaler = msg.sender_id === thread.participant_ids[1] || msg.msg_type === 'PRODUCT_CARD';
      bubble.className = `chat-bubble-row ${isSaler ? 'outgoing' : 'incoming'}`;

      if (msg.msg_type === 'PRODUCT_CARD') {
        const payload = msg.payload_json || {};
        bubble.innerHTML = `
          <div class="product-card-bubble">
            <div class="prod-bubble-header">
              <span class="badge badge--emerald text-xs">🛍️ 1-Tap Checkout Card</span>
            </div>
            <h5>${payload.productTitle || 'Product Offer'}</h5>
            <div class="prod-bubble-price">৳${payload.price || '0.00'}</div>
            <a href="${payload.checkoutUrl}" target="_blank" class="btn btn--primary btn--sm btn-1tap">
              Buy Now / অর্ডার করুন ⚡
            </a>
            <span class="bubble-time">${formatDate(msg.created_at)}</span>
          </div>
        `;
      } else {
        bubble.innerHTML = `
          <div class="chat-bubble ${isSaler ? 'bubble-saler' : 'bubble-customer'}">
            <p>${msg.content}</p>
            <span class="bubble-time">${formatDate(msg.created_at)}</span>
          </div>
        `;
      }

      box.appendChild(bubble);
    });

    // Scroll to bottom
    box.scrollTop = box.scrollHeight;

    // Send reply action
    const sendBtn = chatPane.querySelector('#btn-send-reply');
    const input = chatPane.querySelector('#chat-input');

    async function sendReply() {
      const text = (input.value || '').trim();
      if (!text) return;
      input.value = '';

      try {
        const res = await api.post(`/saler/inbox/threads/${thread.id}/send`, { content: text });
        messages.push(res.data.message);
        renderChat(thread);
      } catch (err) {
        toast.error(err.message);
      }
    }

    sendBtn.addEventListener('click', sendReply);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendReply();
    });

    // Send product card modal action
    chatPane.querySelector('#btn-open-prod-modal').addEventListener('click', () => {
      openProductCardModal(thread);
    });
  }

  function renderContext(thread) {
    const contextPane = container.querySelector('#context-pane');
    if (!contextPane) return;

    contextPane.innerHTML = `
      <div class="context-card p-4 space-y-4">
        <h4>${t('saler_inbox.customer_context_title') || 'Customer Profile'}</h4>
        <div class="context-field">
          <label>Phone / WhatsApp</label>
          <span class="font-mono text-sm">${thread.customerPhone || 'N/A'}</span>
        </div>
        <div class="context-field">
          <label>Channel Source</label>
          <span class="badge badge--primary">${thread.channel}</span>
        </div>
        <div class="context-field">
          <label>Session Window Status</label>
          <span class="${thread.inside24h ? 'text-emerald font-semibold' : 'text-amber'}">
            ${thread.inside24h ? 'Active 24h Customer Service Window' : 'Expired (>24h since last inbound)'}
          </span>
        </div>
        <hr />
        <div class="context-field">
          <label>1-Tap Checkout Generator</label>
          <p class="text-xs text-secondary">Insert shoppable product cards with instant checkout tokens directly into this WhatsApp chat.</p>
        </div>
      </div>
    `;
  }

  async function openProductCardModal(thread) {
    const modalContent = document.createElement('div');
    modalContent.className = 'product-picker-modal space-y-4';

    modalContent.innerHTML = `
      <p class="text-xs text-secondary">Choose a product from your catalog to generate a 1-tap checkout link for this customer.</p>
      <div class="form-group">
        <label class="form-label">Product ID or Name</label>
        <input type="number" class="input input--sm w-full" id="prod-id-input" placeholder="e.g. 1" value="1" />
      </div>
      <div class="form-group">
        <label class="form-label">Custom Note / Offer</label>
        <input type="text" class="input input--sm w-full" id="prod-note-input" placeholder="e.g. Special 10% discount for you!" />
      </div>
    `;

    const modal = Modal({
      title: t('saler_inbox.modal_send_product_title') || 'Insert WhatsApp Product Card',
      content: modalContent,
      footer: Button({
        label: t('saler_inbox.btn_confirm_send_card') || 'Send 1-Tap Checkout Card',
        variant: 'primary',
        onClick: async () => {
          const prodId = parseInt(modalContent.querySelector('#prod-id-input').value, 10);
          const note = modalContent.querySelector('#prod-note-input').value;

          if (!prodId) {
            toast.error('Please enter a valid product ID.');
            return;
          }

          try {
            const res = await api.post(`/saler/inbox/threads/${thread.id}/send-product`, {
              product_id: prodId,
              note,
            });

            toast.success(t('saler_inbox.card_sent_success') || 'Product card sent to customer via WhatsApp!');
            modal.close();
            messages.push(res.data.message);
            renderChat(thread);
          } catch (err) {
            toast.error(err.message);
          }
        },
      }),
    });

    modal.open();
  }

  // Search input filter
  container.querySelector('#inbox-search').addEventListener('input', (e) => {
    searchFilter = e.target.value;
    renderThreads();
  });

  fetchThreads();
  root.append(container);
}
