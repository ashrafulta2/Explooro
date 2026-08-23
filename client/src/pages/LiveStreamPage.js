/**
 * LiveStreamPage.js — Live Stream Commerce Viewer Experience (Prompt 10.1 / DFD Subsystem 15.0).
 *
 * Implements:
 * 1. Stream discovery & listing tab (/live).
 * 2. Real-time WebRTC/Mock stream player with low-bandwidth Audio-Only fallback (/live/:id).
 * 3. Real-time Pinned Product Card Overlay (< 1s sync) with in-stream 1-click Buy Now checkout drawer.
 * 4. Real-time live chat overlay reusing WebSocket gateway.
 * 5. Floating heart/reaction animations.
 * 6. Live sales ticker toasts & moderator controls.
 */

import { getLiveStream, listLiveStreams, sendLiveReaction, inStreamBuy, terminateLiveStream } from '../services/live.api.js';
import { PinnedProductOverlay } from '../components/live/PinnedProductOverlay.js';
import { LiveStreamCard } from '../components/live/LiveStreamCard.js';
import { wsManager, WS_STATUS } from '../services/websocket.js';
import { Button } from '../components/ui/Button.js';
import { Drawer } from '../components/ui/Drawer.js';
import { Input } from '../components/ui/Input.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { toast } from '../services/toast.js';
import { formatBdt } from '../services/format.js';
import { t, getLanguage } from '../services/i18n.js';
import { getCurrentUser } from '../services/session.js';

export default function LiveStreamPage(root, { params, navigate }) {
  const container = document.createElement('div');
  container.className = 'live-stream-page';
  root.append(container);

  const streamId = params?.id ? Number(params.id) : null;

  if (!streamId) {
    renderStreamDiscoveryList(container, navigate);
  } else {
    renderStreamViewer(container, streamId, navigate);
  }
}

/**
 * 1. Stream Discovery & Listing View (/live)
 */
async function renderStreamDiscoveryList(container, navigate) {
  container.innerHTML = `
    <div class="container stream-discovery">
      <div class="stream-discovery__header">
        <div>
          <h1 class="stream-discovery__title">🔴 ${t('live.explore_live') || 'Live Shopping Broadcasts'}</h1>
          <p class="stream-discovery__subtitle">${t('live.explore_subtitle') || 'Watch live product demonstrations, get exclusive flash deals, and chat with sellers.'}</p>
        </div>
        <button class="btn btn--primary" id="go-to-studio-btn">
          📹 ${t('live.host_studio') || 'Host a Live Stream'}
        </button>
      </div>

      <div class="stream-discovery__tabs">
        <button class="tab-btn active" data-tab="all">${t('live.all_streams') || 'All Broadcasts'}</button>
        <button class="tab-btn" data-tab="LIVE">🔴 ${t('live.live_now') || 'Live Now'}</button>
        <button class="tab-btn" data-tab="SCHEDULED">⏰ ${t('live.upcoming') || 'Upcoming'}</button>
      </div>

      <div class="stream-discovery__grid" id="streams-grid">
        <div class="loading-grid">
          ${Skeleton({ variant: 'block', width: '100%', height: 260 }).outerHTML}
          ${Skeleton({ variant: 'block', width: '100%', height: 260 }).outerHTML}
          ${Skeleton({ variant: 'block', width: '100%', height: 260 }).outerHTML}
        </div>
      </div>
    </div>
  `;

  container.querySelector('#go-to-studio-btn')?.addEventListener('click', () => {
    navigate('/saler/live-studio');
  });

  const grid = container.querySelector('#streams-grid');

  async function loadStreams(statusFilter = null) {
    grid.innerHTML = `<div class="loading-spinner">Loading streams...</div>`;
    try {
      const res = await listLiveStreams(statusFilter ? { status: statusFilter } : {});
      const streams = res?.data?.streams || [];

      grid.replaceChildren();

      if (streams.length === 0) {
        grid.innerHTML = `
          <div class="empty-streams">
            <div class="empty-streams__icon">📹</div>
            <h3>${t('live.no_streams') || 'No Live Streams Found'}</h3>
            <p>${t('live.no_streams_sub') || 'There are no active broadcasts right now. Be the first to start one!'}</p>
            <button class="btn btn--primary" id="empty-start-btn">Start Live Stream</button>
          </div>
        `;
        grid.querySelector('#empty-start-btn')?.addEventListener('click', () => navigate('/saler/live-studio'));
        return;
      }

      streams.forEach((stream) => {
        const card = LiveStreamCard({
          stream,
          onWatchClick: () => navigate(`/live/${stream.id}`),
        });
        grid.append(card);
      });
    } catch (err) {
      grid.innerHTML = `<div class="alert alert--danger">Failed to load live streams: ${err.message}</div>`;
    }
  }

  // Tab switching
  const tabs = container.querySelectorAll('.tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.dataset.tab === 'all' ? null : tab.dataset.tab;
      loadStreams(filter);
    });
  });

  loadStreams();
}

/**
 * 2. Real-Time Stream Viewer View (/live/:id)
 */
async function renderStreamViewer(container, streamId, navigate) {
  container.innerHTML = `
    <div class="stream-viewer-wrapper">
      <div class="stream-viewer__main">
        <!-- Video Player Stage -->
        <div class="stream-player" id="stream-player-container">
          <div class="stream-player__video-mock" id="video-mock-stage">
            <div class="mock-presenter-canvas" id="presenter-canvas">
              <div class="mock-presenter-avatar">📹</div>
              <div class="mock-stream-wave">
                <span></span><span></span><span></span><span></span><span></span>
              </div>
              <div class="mock-stream-tagline" id="stream-tagline">Connecting to live feed...</div>
            </div>
          </div>

          <!-- Top Overlay Bar -->
          <div class="stream-overlay-top">
            <div class="stream-overlay__host-info">
              <button class="btn-back" id="back-to-list-btn" title="Back">←</button>
              <div class="host-avatar" id="host-avatar">H</div>
              <div class="host-details">
                <span class="host-name" id="host-name">Host</span>
                <span class="store-name" id="store-name">Store</span>
              </div>
            </div>
            <div class="stream-overlay__stats">
              <span class="live-pill"><span class="pulse-dot"></span> LIVE</span>
              <span class="viewers-badge" id="viewers-count">👥 0</span>
              <button class="btn-mode-toggle" id="audio-toggle-btn" title="Toggle Audio Only (Data Saver)">
                📶 Data Saver (Audio)
              </button>
            </div>
          </div>

          <!-- Pinned Product Slot -->
          <div class="stream-overlay__pinned-slot" id="pinned-slot"></div>

          <!-- Live Sales Toast Notification -->
          <div class="stream-overlay__sales-toast" id="sales-toast" style="display:none;"></div>

          <!-- Bottom Control Bar -->
          <div class="stream-overlay-bottom">
            <div class="stream-chat-input-wrapper">
              <input type="text" id="stream-chat-input" placeholder="${t('live.type_comment') || 'Say something nice...'}" />
              <button class="btn-send-chat" id="send-chat-btn">💬</button>
            </div>
            <div class="stream-actions">
              <button class="btn-action-reaction" id="btn-react-heart" title="Send Love">❤️</button>
              <button class="btn-action-reaction" id="btn-react-fire" title="Awesome">🔥</button>
              <button class="btn-action-reaction" id="btn-react-clap" title="Clap">👏</button>
            </div>
          </div>

          <!-- Floating Reactions Layer -->
          <div class="floating-reactions-layer" id="floating-reactions"></div>
        </div>

        <!-- Chat Stream Panel -->
        <div class="stream-chat-panel">
          <div class="stream-chat-panel__header">
            <h3>💬 ${t('live.live_chat') || 'Live Stream Chat'}</h3>
            <span class="chat-count" id="chat-count">0 comments</span>
          </div>
          <div class="stream-chat-panel__messages" id="chat-messages-container">
            <div class="chat-notice">
              🔒 Welcome to Explooro Live! Keep the chat polite and respectful.
            </div>
          </div>
          <div class="stream-moderation-bar" id="moderator-bar" style="display: none;">
            <span class="badge badge--warning">🛡️ MODERATOR CONTROLS</span>
            <button class="btn btn--danger btn--xs" id="btn-mod-terminate">Force Terminate Stream</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // UI Element Refs
  const backBtn = container.querySelector('#back-to-list-btn');
  const hostNameEl = container.querySelector('#host-name');
  const storeNameEl = container.querySelector('#store-name');
  const hostAvatarEl = container.querySelector('#host-avatar');
  const viewersCountEl = container.querySelector('#viewers-count');
  const pinnedSlotEl = container.querySelector('#pinned-slot');
  const chatMessagesEl = container.querySelector('#chat-messages-container');
  const chatInputEl = container.querySelector('#stream-chat-input');
  const sendChatBtn = container.querySelector('#send-chat-btn');
  const audioToggleBtn = container.querySelector('#audio-toggle-btn');
  const reactionsLayer = container.querySelector('#floating-reactions');
  const salesToastEl = container.querySelector('#sales-toast');
  const streamTaglineEl = container.querySelector('#stream-tagline');
  const modBarEl = container.querySelector('#moderator-bar');
  const terminateBtn = container.querySelector('#btn-mod-terminate');

  backBtn?.addEventListener('click', () => navigate('/live'));

  let isAudioOnly = false;
  let currentPinnedProduct = null;
  const currentUser = getCurrentUser();

  // Check moderator role
  if (currentUser && (currentUser.roles?.includes('moderator') || currentUser.roles?.includes('admin') || currentUser.roles?.includes('super_admin'))) {
    modBarEl.style.display = 'flex';
    terminateBtn?.addEventListener('click', async () => {
      const reason = prompt('Enter termination reason:', 'Policy Violation / Inappropriate Content');
      if (reason) {
        try {
          await terminateLiveStream(streamId, reason);
          toast.success('Stream terminated.');
        } catch (e) {
          toast.error(e.message);
        }
      }
    });
  }

  // Load Stream Details
  try {
    const res = await getLiveStream(streamId, isAudioOnly);
    const data = res?.data || {};
    const stream = data.stream;

    if (!stream) {
      container.innerHTML = `<div class="alert alert--danger">Live stream not found.</div>`;
      return;
    }

    hostNameEl.textContent = stream.host_name || 'Host';
    storeNameEl.textContent = stream.store_name || 'Verified Store';
    hostAvatarEl.textContent = (stream.host_name || 'H').slice(0, 1).toUpperCase();
    streamTaglineEl.textContent = `Broadcasting: ${stream.title}`;
    viewersCountEl.textContent = `👥 ${stream.viewer_count || 1}`;

    // Render initial pinned product if exists
    if (data.pinnedProduct) {
      updatePinnedOverlay(data.pinnedProduct);
    }

    // Render previous messages
    if (data.recentMessages) {
      data.recentMessages.forEach((msg) => {
        appendChatMessage(msg.user_name || 'Viewer', msg.content, msg.user_id === stream.host_id);
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="alert alert--danger">Failed to connect to stream: ${err.message}</div>`;
    return;
  }

  // Connect WebSocket & Join Stream Room
  wsManager.connect();
  wsManager.send('live:join', { stream_id: streamId });

  // Listen to live WebSocket frames
  const unsub = wsManager.onMessage((frame) => {
    const { type, payload } = frame;
    if (payload?.streamId && Number(payload.streamId) !== streamId) return;

    switch (type) {
      case 'live:viewer_count':
        viewersCountEl.textContent = `👥 ${payload.viewerCount}`;
        break;

      case 'live:pinned_product':
        updatePinnedOverlay(payload.pinnedProduct);
        break;

      case 'live:chat_message':
        appendChatMessage(payload.userName, payload.content, payload.userRole === 'saler' || payload.userRole === 'supplier');
        break;

      case 'live:reaction_broadcast':
        spawnFloatingReaction(payload.emoji || '❤️');
        break;

      case 'live:sale_event':
        showSalesToast(payload);
        break;

      case 'live:stream_ended':
        toast.info('This live stream has ended. Thank you for watching!');
        streamTaglineEl.textContent = 'Stream Concluded';
        break;

      case 'live:stream_terminated':
        toast.error(`Stream terminated by moderator: ${payload.reason}`);
        streamTaglineEl.textContent = 'Stream Terminated';
        break;
    }
  });

  // Audio-only toggle (Bangladeshi mobile data saver)
  audioToggleBtn?.addEventListener('click', () => {
    isAudioOnly = !isAudioOnly;
    if (isAudioOnly) {
      audioToggleBtn.classList.add('active');
      audioToggleBtn.textContent = '🔊 Low-Data Mode ON (64kbps)';
      container.querySelector('#video-mock-stage')?.classList.add('audio-only-active');
      toast.info('Audio-only mode enabled: Video track muted to save 95%+ mobile data.');
    } else {
      audioToggleBtn.classList.remove('active');
      audioToggleBtn.textContent = '📶 Data Saver (Audio)';
      container.querySelector('#video-mock-stage')?.classList.remove('audio-only-active');
      toast.info('HD Video stream resumed.');
    }
  });

  // Reactions
  const triggerReaction = (emoji) => {
    spawnFloatingReaction(emoji);
    wsManager.send('live:reaction', { stream_id: streamId, emoji, delta: 1 });
  };

  container.querySelector('#btn-react-heart')?.addEventListener('click', () => triggerReaction('❤️'));
  container.querySelector('#btn-react-fire')?.addEventListener('click', () => triggerReaction('🔥'));
  container.querySelector('#btn-react-clap')?.addEventListener('click', () => triggerReaction('👏'));

  // Chat message sending
  const sendChat = () => {
    const text = chatInputEl.value.trim();
    if (!text) return;
    if (!currentUser) {
      toast.warning('Please log in to join live chat.');
      navigate('/login');
      return;
    }
    wsManager.send('live:chat', { stream_id: streamId, content: text, client_msg_id: `msg_${Date.now()}` });
    chatInputEl.value = '';
  };

  sendChatBtn?.addEventListener('click', sendChat);
  chatInputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  // Pinned Product Overlay & In-Stream Checkout Helper
  function updatePinnedOverlay(product) {
    currentPinnedProduct = product;
    pinnedSlotEl.replaceChildren();

    if (product) {
      const overlay = PinnedProductOverlay({
        product,
        onBuyClick: (p) => openInStreamCheckoutDrawer(p, streamId),
      });
      pinnedSlotEl.append(overlay);
    }
  }

  function appendChatMessage(sender, text, isHost = false) {
    const msgRow = document.createElement('div');
    msgRow.className = `chat-msg ${isHost ? 'chat-msg--host' : ''}`;
    msgRow.innerHTML = `
      <span class="chat-sender">${sender}${isHost ? ' (Host)' : ''}:</span>
      <span class="chat-text">${text}</span>
    `;
    chatMessagesEl.append(msgRow);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function spawnFloatingReaction(emoji) {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    el.style.left = `${Math.random() * 60 + 20}%`;
    reactionsLayer.append(el);
    setTimeout(() => el.remove(), 2500);
  }

  function showSalesToast(data) {
    salesToastEl.innerHTML = `
      <div class="sales-toast-content">
        <span class="toast-bag">🛍️</span>
        <span class="toast-text"><strong>${data.buyerName}</strong> just bought <em>${data.productTitle}</em>!</span>
      </div>
    `;
    salesToastEl.style.display = 'block';
    salesToastEl.classList.add('animate-slide-up');
    setTimeout(() => {
      salesToastEl.style.display = 'none';
    }, 4000);
  }
}

/**
 * 3. In-Stream 1-Click Buy Now Checkout Drawer
 */
function openInStreamCheckoutDrawer(product, streamId) {
  const user = getCurrentUser();

  if (!user) {
    toast.info('Please sign in to complete checkout.');
    window.location.hash = '#/login';
    return;
  }

  const retailPrice = Number(product.special_price || (Number(product.base_cost || 0) + Number(product.wholesale_margin || 0) + 150));

  const drawerContent = document.createElement('div');
  drawerContent.className = 'in-stream-checkout-drawer';
  drawerContent.innerHTML = `
    <div class="checkout-product-summary">
      <img src="${product.main_image || '/placeholder-product.png'}" alt="${product.title_en}" />
      <div>
        <h4>${product.title_en}</h4>
        <div class="price-highlight">${formatBdt(retailPrice)}</div>
        <span class="badge badge--success">⚡ In-Stream Flash Deal</span>
      </div>
    </div>

    <form id="in-stream-form" class="checkout-form">
      <div class="form-group">
        <label>Recipient Name</label>
        <input type="text" id="chk-name" value="${user.full_name || ''}" required class="input" />
      </div>
      <div class="form-group">
        <label>Phone Number</label>
        <input type="text" id="chk-phone" value="${user.phone || ''}" required class="input" />
      </div>
      <div class="form-group">
        <label>Delivery Division</label>
        <select id="chk-division" class="select">
          <option value="Dhaka">Dhaka (৳60 shipping)</option>
          <option value="Chittagong">Chittagong (৳120 shipping)</option>
          <option value="Sylhet">Sylhet (৳120 shipping)</option>
          <option value="Rajshahi">Rajshahi (৳120 shipping)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Delivery Address</label>
        <input type="text" id="chk-address" placeholder="House / Road / Area" value="Dhaka, Bangladesh" required class="input" />
      </div>
      <div class="form-group">
        <label>Payment Method</label>
        <select id="chk-payment" class="select">
          <option value="COD">Cash on Delivery (COD)</option>
          <option value="BKASH">bKash</option>
          <option value="NAGAD">Nagad</option>
        </select>
      </div>

      <div class="order-total-preview">
        <span>Total Payable:</span>
        <strong id="chk-total">${formatBdt(retailPrice + 60)}</strong>
      </div>

      <button type="submit" class="btn btn--primary btn--block btn--lg" id="submit-in-stream-btn">
        ⚡ Confirm 1-Click Order
      </button>
    </form>
  `;

  const drawer = Drawer({
    title: '⚡ 1-Click In-Stream Checkout',
    content: drawerContent,
    position: 'right',
  });

  document.body.append(drawer);

  const form = drawerContent.querySelector('#in-stream-form');
  const divSelect = drawerContent.querySelector('#chk-division');
  const totalEl = drawerContent.querySelector('#chk-total');

  divSelect.addEventListener('change', () => {
    const ship = divSelect.value === 'Dhaka' ? 60 : 120;
    totalEl.textContent = formatBdt(retailPrice + ship);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = drawerContent.querySelector('#submit-in-stream-btn');
    btn.disabled = true;
    btn.textContent = 'Processing Order...';

    try {
      const res = await inStreamBuy(streamId, {
        product_id: product.product_id || product.id,
        quantity: 1,
        recipient_name: drawerContent.querySelector('#chk-name').value,
        recipient_phone: drawerContent.querySelector('#chk-phone').value,
        division: divSelect.value,
        district: divSelect.value,
        address_line: drawerContent.querySelector('#chk-address').value,
        payment_method: drawerContent.querySelector('#chk-payment').value,
      });

      toast.success(res?.meta?.message_en || 'Order placed successfully!');
      drawer.remove();
    } catch (err) {
      toast.error(err.message || 'Checkout failed.');
      btn.disabled = false;
      btn.textContent = '⚡ Confirm 1-Click Order';
    }
  });
}
