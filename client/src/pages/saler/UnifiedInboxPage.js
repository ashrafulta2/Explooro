/**
 * UnifiedInboxPage.js — Saler Unified Multi-Channel Commerce Inbox (Prompt 8.3 / DFD Subsystem 20.0).
 *
 * Implements:
 * - 3-pane unified commerce workstation (Thread list, Active conversation feed, Customer context).
 * - Multi-channel conversation aggregation (WhatsApp, Messenger, In-Platform).
 * - Interactive channel filtering pills with live count badges.
 * - Real-time WebSocket arrival listener & optimistic message dispatch.
 * - Catalog-driven Product Card selector modal with 1-tap single-use checkout link generation.
 * - Meta 24-hour customer service window status tracking.
 * - Quick reply shortcut chips with EN/BN bilingual support.
 */

import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { api } from '../../core/api.js';
import { wsManager } from '../../services/websocket.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';
import { toast } from '../../services/toast.js';

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

  container.innerHTML = `
    <div class="inbox-header-row">
      <div>
        <h2>💬 ${t('saler_inbox.page_title') || 'Unified Commerce Inbox'}</h2>
        <p class="page-subtitle">${t('saler_inbox.page_subtitle') || 'Manage WhatsApp, Messenger, and in-platform customer chats in one place.'}</p>
      </div>
      <div class="inbox-channel-filters" id="channel-filters-bar">
        <button type="button" class="channel-filter-pill active" data-channel="ALL">
          <span>${t('saler_inbox.filter_all') || 'All'}</span>
          <span class="pill-count" id="count-all">0</span>
        </button>
        <button type="button" class="channel-filter-pill" data-channel="WHATSAPP">
          <span>🟢 ${t('saler_inbox.filter_whatsapp') || 'WhatsApp'}</span>
          <span class="pill-count" id="count-whatsapp">0</span>
        </button>
        <button type="button" class="channel-filter-pill" data-channel="MESSENGER">
          <span>🔵 ${t('saler_inbox.filter_messenger') || 'Messenger'}</span>
          <span class="pill-count" id="count-messenger">0</span>
        </button>
        <button type="button" class="channel-filter-pill" data-channel="IN_PLATFORM">
          <span>🟣 ${t('saler_inbox.filter_direct') || 'Direct'}</span>
          <span class="pill-count" id="count-direct">0</span>
        </button>
      </div>
    </div>

    <div class="unified-inbox-layout">
      <!-- Left: Thread List Pane -->
      <div class="inbox-threads-pane">
        <div class="thread-search-box">
          <input
            type="text"
            class="input input--sm"
            id="inbox-search"
            placeholder="${t('saler_inbox.search_placeholder') || 'Search conversations...'}"
          />
        </div>
        <div class="thread-list-scroll" id="threads-list">
          <div class="p-6 text-center text-xs text-muted">Loading conversations...</div>
        </div>
      </div>

      <!-- Center: Active Chat Pane -->
      <div class="inbox-chat-pane" id="chat-pane">
        <div class="chat-placeholder">
          <span class="placeholder-icon">💬</span>
          <h4>${t('saler_inbox.page_title') || 'Unified Commerce Inbox'}</h4>
          <p>${t('saler_inbox.select_conversation') || 'Select a conversation to start chatting.'}</p>
        </div>
      </div>

      <!-- Right: Customer Profile & Order Context Pane -->
      <div class="inbox-context-pane" id="context-pane">
        <div class="context-empty-state">
          <p>${t('saler_inbox.customer_context_title') || 'Customer Profile'}</p>
          <span class="text-xxs text-muted">Customer details and order context will appear here when a thread is active.</span>
        </div>
      </div>
    </div>
  `;

  // Quick replies definition
  const quickReplies = [
    {
      en: t('saler_inbox.quick_reply_1') || 'Product is available in stock.',
      bn: t('saler_inbox.quick_reply_1') || 'পণ্যটি স্টকে এভেইলেবল আছে।',
    },
    {
      en: t('saler_inbox.quick_reply_2') || 'Delivery takes 2-3 business days.',
      bn: t('saler_inbox.quick_reply_2') || 'ডেলিভারি হতে ২-৩ কার্যদিবস লাগবে।',
    },
    {
      en: t('saler_inbox.quick_reply_3') || 'Inside Dhaka delivery ৳60, outside Dhaka ৳120.',
      bn: t('saler_inbox.quick_reply_3') || 'ঢাকার ভিতরে ডেলিভারি ৳৬০, ঢাকার বাইরে ৳১২০।',
    },
    {
      en: t('saler_inbox.quick_reply_4') || 'Sending your instant 1-tap checkout link now!',
      bn: t('saler_inbox.quick_reply_4') || 'আপনার অর্ডার করার ১-ট্যাপ লিংক দিচ্ছি!',
    },
  ];

  // 1. Fetch Threads
  async function fetchThreads(autoSelectFirst = true) {
    try {
      const res = await api.get('/saler/inbox/threads');
      threads = res?.data?.items || [];
      updateChannelCounts();
      renderThreads();

      if (autoSelectFirst && threads.length > 0 && !selectedThreadId) {
        const first = getFilteredThreads()[0] || threads[0];
        if (first) {
          selectThread(first);
        }
      }
    } catch (err) {
      const list = container.querySelector('#threads-list');
      if (list) {
        list.innerHTML = `<div class="p-4 text-center text-xs text-rose-500">${err.message}</div>`;
      }
    }
  }

  // 2. Filter Threads Helper
  function getFilteredThreads() {
    return threads.filter((t) => {
      // Channel filter
      if (activeChannel !== 'ALL' && t.channel !== activeChannel) {
        return false;
      }
      // Search text filter
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const phone = (t.customerPhone || '').toLowerCase();
        const name = (t.other_participant_name || '').toLowerCase();
        const ref = (t.ref || '').toLowerCase();
        const preview = (t.last_message_preview || '').toLowerCase();
        return phone.includes(q) || name.includes(q) || ref.includes(q) || preview.includes(q);
      }
      return true;
    });
  }

  // 3. Update Channel Counts
  function updateChannelCounts() {
    const allCount = threads.length;
    const waCount = threads.filter((t) => t.channel === 'WHATSAPP').length;
    const msCount = threads.filter((t) => t.channel === 'MESSENGER').length;
    const dpCount = threads.filter((t) => t.channel === 'IN_PLATFORM').length;

    const countAll = container.querySelector('#count-all');
    const countWa = container.querySelector('#count-whatsapp');
    const countMs = container.querySelector('#count-messenger');
    const countDp = container.querySelector('#count-direct');

    if (countAll) countAll.textContent = String(allCount);
    if (countWa) countWa.textContent = String(waCount);
    if (countMs) countMs.textContent = String(msCount);
    if (countDp) countDp.textContent = String(dpCount);
  }

  // 4. Render Thread List
  function renderThreads() {
    const list = container.querySelector('#threads-list');
    if (!list) return;
    list.innerHTML = '';

    const filtered = getFilteredThreads();

    if (filtered.length === 0) {
      list.innerHTML = `<div class="p-6 text-center text-xs text-muted">${t('saler_inbox.empty_threads') || 'No conversations found.'}</div>`;
      return;
    }

    filtered.forEach((t) => {
      const item = document.createElement('div');
      const isSelected = t.id === selectedThreadId;
      const isUnread = (Number(t.unread_count) || 0) > 0;
      item.className = `thread-card ${isSelected ? 'selected' : ''} ${isUnread ? 'unread' : ''}`;

      const channelBadge =
        t.channel === 'WHATSAPP'
          ? '<span class="channel-tag tag-whatsapp">WhatsApp</span>'
          : t.channel === 'MESSENGER'
          ? '<span class="channel-tag tag-messenger">Messenger</span>'
          : '<span class="channel-tag tag-inplatform">Direct</span>';

      const displayName = t.other_participant_name || t.customerPhone || `User #${t.id}`;
      const subPhone = t.customerPhone && t.other_participant_name ? t.customerPhone : `Ref: ${t.ref || t.id}`;

      item.innerHTML = `
        <div class="thread-card-header">
          <div class="thread-title-wrap">
            <span class="thread-name">${displayName}</span>
            ${channelBadge}
          </div>
          <span class="thread-time">${formatDate(t.last_message_at)}</span>
        </div>
        <div class="thread-preview-row">
          <p class="thread-preview">${t.last_message_preview || t('saler_inbox.empty_messages') || 'No messages yet'}</p>
          ${isUnread ? `<span class="thread-unread-pill">${t.unread_count}</span>` : ''}
        </div>
        <span class="thread-phone">${subPhone}</span>
      `;

      item.addEventListener('click', () => {
        selectThread(t);
      });

      list.appendChild(item);
    });
  }

  // 5. Select Thread Action
  function selectThread(thread) {
    selectedThreadId = thread.id;

    // Clear unread count locally
    if (thread.unread_count > 0) {
      thread.unread_count = 0;
      api.post(`/chat/threads/${thread.id}/read`).catch(() => {});
    }

    renderThreads();
    loadActiveChat(thread);
    renderContext(thread);
  }

  // 6. Load Active Chat Messages
  async function loadActiveChat(thread) {
    const chatPane = container.querySelector('#chat-pane');
    if (!chatPane) return;

    chatPane.innerHTML = `<div class="p-8 text-center text-xs text-muted">Loading messages...</div>`;

    try {
      const res = await api.get(`/chat/threads/${thread.id}/messages`);
      messages = res?.data?.items || [];
      renderChat(thread);

      // Send read receipt over WebSocket if messages exist
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        wsManager.sendReadReceipt({ threadId: thread.id, lastReadMessageId: lastMsg.id });
      }
    } catch (err) {
      chatPane.innerHTML = `<div class="p-6 text-center text-xs text-rose-500">${err.message}</div>`;
    }
  }

  // 7. Render Chat Feed & Composer
  function renderChat(thread) {
    const chatPane = container.querySelector('#chat-pane');
    if (!chatPane) return;

    const inside24h = thread.inside24h;
    const windowNotice =
      thread.channel === 'WHATSAPP' || thread.channel === 'MESSENGER'
        ? inside24h
          ? `<span class="session-pill session-active" title="Standard messaging allowed within 24 hours of customer inbound">🟢 ${t('saler_inbox.session_window_active') || '24h Meta Window Active'}</span>`
          : `<span class="session-pill session-expired" title="Customer service window closed; template message required">⚠️ ${t('saler_inbox.session_window_expired') || 'Window Expired (Template Mode)'}</span>`
        : `<span class="session-pill session-active">🟣 In-Platform Direct</span>`;

    const channelTag =
      thread.channel === 'WHATSAPP'
        ? '<span class="channel-tag tag-whatsapp">WhatsApp</span>'
        : thread.channel === 'MESSENGER'
        ? '<span class="channel-tag tag-messenger">Messenger</span>'
        : '<span class="channel-tag tag-inplatform">Direct</span>';

    chatPane.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-info">
          <div class="chat-header-title-row">
            <h4>${thread.other_participant_name || thread.customerPhone || `Conversation #${thread.ref}`}</h4>
            ${channelTag}
          </div>
          <span class="text-xs text-muted font-mono">${thread.customerPhone || `Ref: ${thread.ref}`}</span>
        </div>
        <div>${windowNotice}</div>
      </div>

      <div class="chat-messages-scroll" id="chat-messages-box"></div>

      <div class="chat-quick-replies" id="quick-replies-row"></div>

      <div class="chat-composer-row">
        <button type="button" class="btn btn--secondary btn--sm btn-send-prod" id="btn-open-prod-modal">
          <span>🛍️</span>
          <span>${t('saler_inbox.btn_send_product_card') || 'Send Product Card'}</span>
        </button>
        <input
          type="text"
          class="input input--sm flex-1"
          id="chat-input"
          placeholder="${t('saler_inbox.type_reply_placeholder') || 'Type a reply to customer...'}"
        />
        <button type="button" class="btn btn--primary btn--sm" id="btn-send-reply">
          ${t('saler_inbox.btn_send') || 'Send'}
        </button>
      </div>
    `;

    // Render quick reply chips
    const qrRow = chatPane.querySelector('#quick-replies-row');
    quickReplies.forEach((qr) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'quick-reply-chip';
      chip.textContent = isBn ? qr.bn : qr.en;
      chip.addEventListener('click', () => {
        const inp = chatPane.querySelector('#chat-input');
        if (inp) {
          inp.value = chip.textContent;
          inp.focus();
        }
      });
      qrRow.appendChild(chip);
    });

    // Render message bubbles
    const box = chatPane.querySelector('#chat-messages-box');
    if (messages.length === 0) {
      box.innerHTML = `<div class="p-6 text-center text-xs text-muted">${t('saler_inbox.empty_messages') || 'No messages yet in this conversation.'}</div>`;
    } else {
      messages.forEach((msg) => {
        const row = document.createElement('div');
        const isSaler = msg.sender_role === 'saler' || msg.msg_type === 'PRODUCT_CARD' || msg.sender_id === thread.participant_ids?.[1];
        row.className = `chat-bubble-row ${isSaler ? 'outgoing' : 'incoming'}`;

        if (msg.msg_type === 'PRODUCT_CARD') {
          const payload = msg.payload_json || {};
          const title = payload.productTitle || msg.content || 'Featured Product';
          const price = payload.price || '0.00';
          const imgUrl = payload.imageUrl || payload.image_url || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=500&auto=format&fit=crop&q=60';
          const noteText = payload.note ? `<div class="prod-bubble-note">💡 ${payload.note}</div>` : '';

          row.innerHTML = `
            <div class="product-card-bubble">
              <div class="prod-bubble-header">
                <span class="badge badge--emerald text-xxs font-semibold">🛍️ 1-Tap Checkout Card</span>
                <span class="channel-tag tag-whatsapp">${thread.channel}</span>
              </div>
              <img src="${imgUrl}" alt="${title}" class="prod-bubble-img" />
              <h5>${title}</h5>
              <div class="prod-bubble-price">৳${price}</div>
              ${noteText}
              <a href="${payload.checkoutUrl || '#'}" target="_blank" class="btn btn--primary btn--sm btn-1tap">
                ⚡ Buy Now / অর্ডার করুন
              </a>
              <div class="bubble-meta">
                <span class="bubble-time">${formatDate(msg.created_at)}</span>
                <span title="Delivered">✓✓</span>
              </div>
            </div>
          `;
        } else {
          row.innerHTML = `
            <div class="chat-bubble ${isSaler ? 'bubble-saler' : 'bubble-customer'}">
              <p>${msg.content || ''}</p>
              <div class="bubble-meta">
                <span class="bubble-time">${formatDate(msg.created_at)}</span>
                ${isSaler ? '<span title="Delivered">✓✓</span>' : ''}
              </div>
            </div>
          `;
        }

        box.appendChild(row);
      });
    }

    // Scroll to bottom
    box.scrollTop = box.scrollHeight;

    // Send reply action
    const sendBtn = chatPane.querySelector('#btn-send-reply');
    const input = chatPane.querySelector('#chat-input');

    async function sendReply() {
      if (isSending) return;
      const text = (input.value || '').trim();
      if (!text) return;
      input.value = '';
      isSending = true;

      // Optimistic message
      const optimisticMsg = {
        id: Date.now(),
        thread_id: thread.id,
        sender_role: 'saler',
        content: text,
        msg_type: 'TEXT',
        created_at: new Date().toISOString(),
      };

      messages.push(optimisticMsg);
      thread.last_message_preview = text;
      thread.last_message_at = optimisticMsg.created_at;
      renderChat(thread);
      renderThreads();

      try {
        const res = await api.post(`/saler/inbox/threads/${thread.id}/send`, { content: text });
        if (res?.data?.message) {
          const idx = messages.findIndex((m) => m.id === optimisticMsg.id);
          if (idx >= 0) {
            messages[idx] = res.data.message;
            renderChat(thread);
          }
        }
      } catch (err) {
        toast.error(err.message || 'Failed to send message.');
      } finally {
        isSending = false;
      }
    }

    sendBtn.addEventListener('click', sendReply);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendReply();
      }
    });

    // Product Card modal trigger
    chatPane.querySelector('#btn-open-prod-modal').addEventListener('click', () => {
      openProductPickerModal(thread);
    });
  }

  // 8. Render Right Customer Profile & Commerce Context
  function renderContext(thread) {
    const contextPane = container.querySelector('#context-pane');
    if (!contextPane) return;

    const channelTag =
      thread.channel === 'WHATSAPP'
        ? '<span class="channel-tag tag-whatsapp">WhatsApp</span>'
        : thread.channel === 'MESSENGER'
        ? '<span class="channel-tag tag-messenger">Messenger</span>'
        : '<span class="channel-tag tag-inplatform">Direct</span>';

    const initial = (thread.other_participant_name || thread.customerPhone || 'U')[0].toUpperCase();

    contextPane.innerHTML = `
      <div class="context-card">
        <h4>${t('saler_inbox.customer_context_title') || 'Customer Profile'}</h4>

        <div class="context-profile-box">
          <div class="context-avatar">${initial}</div>
          <div class="flex-1 min-w-0">
            <div class="font-bold text-sm truncate">${thread.other_participant_name || 'Customer'}</div>
            <div class="text-xs text-muted font-mono truncate">${thread.customerPhone || 'N/A'}</div>
          </div>
        </div>

        <div class="context-field">
          <label>${t('saler_inbox.channel_source') || 'Channel Source'}</label>
          <div>${channelTag}</div>
        </div>

        <div class="context-field">
          <label>${t('saler_inbox.session_status') || 'Session Window Status'}</label>
          <div class="context-box-alert ${thread.inside24h ? 'context-box-alert--active' : 'context-box-alert--expired'}">
            <strong>${thread.inside24h ? '🟢 24h Window Active' : '⚠️ 24h Window Closed'}</strong>
            <p class="m-0 mt-1 text-xxs">
              ${thread.inside24h ? (t('saler_inbox.session_active_desc') || 'Active 24h Customer Service Window') : (t('saler_inbox.session_expired_desc') || 'Expired (>24h since last inbound message)')}
            </p>
          </div>
        </div>

        <div class="context-quick-action">
          <div class="font-bold text-xs">⚡ ${t('saler_inbox.instant_checkout_title') || '1-Tap Checkout Generator'}</div>
          <p>${t('saler_inbox.instant_checkout_desc') || 'Insert shoppable product cards with instant checkout tokens directly into this chat.'}</p>
          <button type="button" class="btn btn--primary btn--sm w-full" id="btn-context-send-prod">
            🛍️ ${t('saler_inbox.btn_send_product_card') || 'Send Product Card'}
          </button>
        </div>

        <div class="context-field pt-2 border-t text-xxs text-muted">
          <span>Ref ID: <strong class="font-mono">${thread.ref || thread.id}</strong></span>
          <span>Created: ${formatDate(thread.created_at)}</span>
        </div>
      </div>
    `;

    contextPane.querySelector('#btn-context-send-prod')?.addEventListener('click', () => {
      openProductPickerModal(thread);
    });
  }

  // 9. Interactive Product Picker Modal
  async function openProductPickerModal(thread) {
    const modalContent = document.createElement('div');
    modalContent.className = 'product-picker-modal';
    modalContent.innerHTML = `<div class="p-4 text-center text-xs text-muted">Loading your catalog products...</div>`;

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

            toast.success(t('saler_inbox.card_sent_success') || 'Product card sent to customer via WhatsApp!');
            modal.close();

            if (res?.data?.message) {
              messages.push(res.data.message);
              thread.last_message_preview = res.data.message.content || 'Product Card';
              thread.last_message_at = res.data.message.created_at;
              renderChat(thread);
              renderThreads();
            }
          } catch (err) {
            toast.error(err.message || 'Failed to send product card.');
          }
        },
      }),
    });

    modal.open();

    // Fetch catalog products
    try {
      if (!catalogProducts) {
        const prodRes = await api.get('/saler/products');
        catalogProducts = prodRes?.data?.products || [];
      }

      if (catalogProducts.length === 0) {
        modalContent.innerHTML = `
          <p class="text-xs text-muted text-center py-4">No curated products in your store catalog yet.</p>
        `;
        return;
      }

      let listHtml = '';
      catalogProducts.forEach((p, idx) => {
        const isChecked = idx === 0 ? 'checked' : '';
        const title = isBn && p.title_bn ? p.title_bn : p.title_en;
        const price = (p.custom_retail_price || p.default_retail_price || 3500).toFixed(2);
        const img = p.image_url || '/demo-product.jpg';

        listHtml += `
          <label class="product-picker-item ${idx === 0 ? 'selected' : ''}">
            <input type="radio" name="selected_prod" value="${p.id}" ${isChecked} />
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
      });

      modalContent.innerHTML = `
        <p class="text-xs text-secondary mb-2">${t('saler_inbox.modal_product_desc') || 'Choose a product from your catalog to generate an instant 1-tap checkout link for this customer.'}</p>
        
        <div class="product-picker-list">
          ${listHtml}
        </div>

        <div class="form-group mt-2">
          <label class="form-label text-xs">${t('saler_inbox.custom_note_label') || 'Custom Offer / Discount Note (Optional)'}</label>
          <input
            type="text"
            class="input input--sm w-full"
            id="modal-prod-note"
            placeholder="${t('saler_inbox.custom_note_placeholder') || 'e.g. Special 10% discount for you!'}"
          />
        </div>
      `;

      // Highlight selected radio item
      modalContent.querySelectorAll('.product-picker-item').forEach((item) => {
        item.addEventListener('click', () => {
          modalContent.querySelectorAll('.product-picker-item').forEach((i) => i.classList.remove('selected'));
          item.classList.add('selected');
        });
      });
    } catch (err) {
      modalContent.innerHTML = `<div class="p-4 text-center text-xs text-rose-500">${err.message}</div>`;
    }
  }

  // 10. Channel Filter Buttons Event Listeners
  const filterPills = container.querySelectorAll('.channel-filter-pill');
  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      activeChannel = pill.getAttribute('data-channel') || 'ALL';
      renderThreads();

      // If active thread is not in filtered list, select the first visible thread
      const filtered = getFilteredThreads();
      if (!filtered.some((t) => t.id === selectedThreadId)) {
        if (filtered.length > 0) {
          selectThread(filtered[0]);
        }
      }
    });
  });

  // 11. Search Filter Listener
  const searchInput = container.querySelector('#inbox-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchFilter = e.target.value;
      renderThreads();
    });
  }

  // 12. WebSocket Real-Time Inbound Listener
  const unsubMsg = wsManager.onMessage((frame) => {
    const { type } = frame;
    const threadId = frame.threadId !== undefined ? Number(frame.threadId) : null;

    // Inbound Message
    if (type === 'chat:message' && frame.message) {
      const incoming = frame.message;
      const th = threads.find((item) => Number(item.id) === threadId);

      if (th) {
        th.last_message_preview = incoming.content || 'New message';
        th.last_message_at = incoming.created_at || new Date().toISOString();

        if (selectedThreadId === threadId) {
          messages.push(incoming);
          renderChat(th);
          wsManager.sendReadReceipt({ threadId, lastReadMessageId: incoming.id });
        } else {
          th.unread_count = (Number(th.unread_count) || 0) + 1;
        }
        renderThreads();
        updateChannelCounts();
      }
    }

    // Message Ack
    if (type === 'chat:ack' && frame.clientMsgId) {
      const msg = messages.find((m) => m.client_msg_id === frame.clientMsgId);
      if (msg) {
        msg.id = frame.messageId;
        renderChat(threads.find((t) => t.id === selectedThreadId));
      }
    }
  });

  // Connect WebSocket & fetch initial data
  wsManager.connect();
  fetchThreads(true);

  root.append(container);
}
