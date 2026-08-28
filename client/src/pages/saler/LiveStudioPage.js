/**
 * LiveStudioPage.js — Saler & Supplier Live Streaming Studio (Prompt 10.1 / DFD Subsystem 15.0).
 *
 * Implements:
 * 1. Stream creation, scheduling & catalog showcase product selection.
 * 2. Real-time broadcast control monitor (Go Live / End Stream).
 * 3. Dynamic Product Pinning manager with instant WebSocket sync (< 1s latency).
 * 4. Real-time Live Analytics bar (viewers, likes, revenue, order count).
 * 5. Host live chat console and participant moderation controls.
 */

import { scheduleLiveStream, startLiveStream, endLiveStream, pinLiveProduct, unpinLiveProduct, getLiveStream, muteLiveParticipant } from '../../services/live.api.js';
import { wsManager } from '../../services/websocket.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Modal } from '../../components/ui/Modal.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { toast } from '../../services/toast.js';
import { formatBdt } from '../../services/format.js';
import { t, getLanguage } from '../../services/i18n.js';

export default function LiveStudioPage(root, { navigate }) {
  const container = document.createElement('div');
  container.className = 'container live-studio-page';
  root.append(container);

  let activeStream = null;
  let productsList = [];
  let pinnedProductId = null;
  let viewerCount = 0;
  let totalLikes = 0;
  let totalSales = 0;
  let totalRevenue = 0;

  renderStudioHome();

  function renderStudioHome() {
    container.innerHTML = `
      <div class="studio-header">
        <div>
          <h1 class="studio-title">📹 ${t('live.studio_title') || 'Saler Live Streaming Studio'}</h1>
          <p class="studio-subtitle">${t('live.studio_subtitle') || 'Host interactive live shopping events, pin products, and sell directly to live viewers.'}</p>
        </div>
        <div class="studio-header__actions">
          <button class="btn btn--secondary" id="view-streams-btn">
            🌐 ${t('live.view_public_feed') || 'View Public Live Feed'}
          </button>
          <button class="btn btn--primary" id="schedule-new-btn">
            ➕ ${t('live.schedule_broadcast') || 'Schedule New Stream'}
          </button>
        </div>
      </div>

      <div class="studio-body" id="studio-main-stage">
        <div class="studio-setup-card">
          <div class="setup-icon">🎥</div>
          <h2>${t('live.ready_to_broadcast') || 'Ready to Host Your Next Live Show?'}</h2>
          <p>${t('live.ready_desc') || 'Select your showcase products, enter your show title, and go live to thousands of buyers across Bangladesh.'}</p>
          <button class="btn btn--primary btn--lg" id="start-quick-stream-btn">
            🚀 ${t('live.start_live_session') || 'Start Live Session'}
          </button>
        </div>
      </div>
    `;

    container.querySelector('#view-streams-btn')?.addEventListener('click', () => navigate('/live'));
    container.querySelector('#schedule-new-btn')?.addEventListener('click', openScheduleModal);
    container.querySelector('#start-quick-stream-btn')?.addEventListener('click', openScheduleModal);
  }

  function openScheduleModal() {
    const modalContent = document.createElement('div');
    modalContent.className = 'studio-schedule-form';
    modalContent.innerHTML = `
      <form id="schedule-stream-form">
        <div class="form-group">
          <label>Stream Title *</label>
          <input type="text" id="stream-title" required class="input" placeholder="e.g. Eid Saree Mega Flash Sale & Styling Demo" />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="stream-desc" class="textarea" rows="3" placeholder="Tell viewers what you will demonstrate and highlight exclusive discounts..."></textarea>
        </div>
        <div class="form-group">
          <label>Cover Banner Image URL</label>
          <input type="text" id="stream-cover" class="input" value="/placeholder-product.png" />
        </div>
        <div class="form-group">
          <label>Featured Showcase Products (Select at least 1)</label>
          <div class="product-selector-list" id="product-picker">
            <label class="prod-item-check"><input type="checkbox" value="1" checked /> Traditional Tangail Cotton Saree (৳1,250)</label>
            <label class="prod-item-check"><input type="checkbox" value="2" checked /> Hand-Embroidered Jamdani Kurti (৳1,850)</label>
            <label class="prod-item-check"><input type="checkbox" value="3" checked /> Premium Rajshahi Silk Dupatta (৳950)</label>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn--secondary" id="modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn--primary" id="modal-submit-btn">Create & Enter Studio</button>
        </div>
      </form>
    `;

    const modal = Modal({
      title: '📹 Schedule Live Broadcast Session',
      content: modalContent,
    });
    modal.openModal();

    modalContent.querySelector('#modal-cancel-btn')?.addEventListener('click', () => modal.closeModal());

    modalContent.querySelector('#schedule-stream-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = modalContent.querySelector('#stream-title').value;
      const desc = modalContent.querySelector('#stream-desc').value;
      const cover = modalContent.querySelector('#stream-cover').value;

      const checkedProds = Array.from(modalContent.querySelectorAll('#product-picker input:checked')).map((el) => ({
        product_id: Number(el.value),
        special_price: null,
      }));

      try {
        const res = await scheduleLiveStream({
          title,
          description: desc,
          cover_image: cover,
          products: checkedProds,
        });

        const created = res?.data?.stream;
        toast.success('Live stream session created!');
        modal.closeModal();
        loadAndRenderLiveDashboard(created.id);
      } catch (err) {
        toast.error(err.message || 'Failed to create stream.');
      }
    });
  }

  async function loadAndRenderLiveDashboard(streamId) {
    const stage = container.querySelector('#studio-main-stage');
    stage.innerHTML = `<div class="loading-spinner">Entering Live Studio...</div>`;

    try {
      const res = await getLiveStream(streamId);
      const data = res?.data || {};
      activeStream = data.stream;
      productsList = data.products || [];
      pinnedProductId = data.pinnedProduct?.product_id || null;

      renderBroadcastMonitor();
    } catch (err) {
      stage.innerHTML = `<div class="alert alert--danger">Error loading studio: ${err.message}</div>`;
    }
  }

  function renderBroadcastMonitor() {
    const stage = container.querySelector('#studio-main-stage');
    const isLive = activeStream?.status === 'LIVE';

    stage.innerHTML = `
      <div class="studio-grid">
        <!-- Left: Live Broadcast Canvas & Controls -->
        <div class="studio-left-col">
          <div class="studio-monitor">
            <div class="studio-monitor__screen ${isLive ? 'is-live' : 'is-standby'}">
              <div class="monitor-live-tag">
                ${isLive ? '<span class="pulse-dot"></span> ON AIR' : '⏹️ STANDBY'}
              </div>
              <div class="monitor-driver-tag">
                STREAM_DRIVER: MOCK SFU
              </div>
              <div class="monitor-center-icon">
                ${isLive ? '🔴 BROADCASTING HD' : '📹 CAMERA READY'}
              </div>
              <div class="monitor-title">${activeStream.title}</div>
            </div>

            <!-- Host Action Controls -->
            <div class="studio-controls-bar">
              ${!isLive ? `
                <button class="btn btn--success btn--lg" id="btn-go-live">
                  🔴 GO LIVE NOW
                </button>
              ` : `
                <button class="btn btn--danger btn--lg" id="btn-end-live">
                  ⏹️ END STREAM
                </button>
              `}
              <button class="btn btn--secondary" id="btn-share-link">
                🔗 Copy Viewer Link
              </button>
            </div>
          </div>

          <!-- Real-Time Metrics -->
          <div class="studio-metrics-row">
            <div class="metric-box">
              <span class="metric-label">👥 Active Viewers</span>
              <strong class="metric-value" id="studio-viewers">${viewerCount || activeStream.viewer_count || 0}</strong>
            </div>
            <div class="metric-box">
              <span class="metric-label">❤️ Reactions</span>
              <strong class="metric-value" id="studio-likes">${totalLikes || activeStream.total_likes_count || 0}</strong>
            </div>
            <div class="metric-box">
              <span class="metric-label">🛍️ Live Orders</span>
              <strong class="metric-value" id="studio-sales">${totalSales || activeStream.total_sales_count || 0}</strong>
            </div>
            <div class="metric-box">
              <span class="metric-label">💰 Live Revenue</span>
              <strong class="metric-value" id="studio-revenue">${formatBdt(totalRevenue || activeStream.total_sales_amount || 0)}</strong>
            </div>
          </div>

          <!-- Product Pinning Manager -->
          <div class="studio-product-manager">
            <div class="studio-card-header">
              <h3>🛍️ Showcase Products (${productsList.length})</h3>
              <span class="badge badge--info">Click PIN to broadcast card to all viewers (< 1s)</span>
            </div>
            <div class="studio-products-list" id="studio-products-list"></div>
          </div>
        </div>

        <!-- Right: Real-time Host Chat Console -->
        <div class="studio-right-col">
          <div class="studio-chat-box">
            <div class="studio-chat-header">
              <h3>💬 Live Viewer Chat</h3>
              <span class="badge badge--success">Connected</span>
            </div>
            <div class="studio-chat-messages" id="studio-chat-messages">
              <div class="chat-notice">You are connected as Host. Your messages are highlighted with a Host badge.</div>
            </div>
            <div class="studio-chat-input-bar">
              <input type="text" id="host-chat-input" placeholder="Reply to viewers..." class="input" />
              <button class="btn btn--primary" id="host-send-chat-btn">Send</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Render Product Pinning Items
    const prodsListEl = stage.querySelector('#studio-products-list');
    prodsListEl.replaceChildren();

    productsList.forEach((prod) => {
      const pId = prod.product_id || prod.id;
      const isPinned = pinnedProductId === pId;

      const itemEl = document.createElement('div');
      itemEl.className = `studio-product-item ${isPinned ? 'is-pinned-active' : ''}`;
      itemEl.innerHTML = `
        <img src="${prod.main_image || '/placeholder-product.png'}" alt="${prod.title_en}" class="prod-thumb" />
        <div class="prod-info">
          <div class="prod-title">${prod.title_en || 'Showcase Product'}</div>
          <div class="prod-price">${formatBdt(Number(prod.base_cost || 1000) + Number(prod.wholesale_margin || 200) + 150)}</div>
        </div>
        <div class="prod-actions">
          ${isPinned ? `
            <button class="btn btn--warning btn--sm btn-unpin" data-id="${pId}">
              ⭐ PINNED (Unpin)
            </button>
          ` : `
            <button class="btn btn--primary btn--sm btn-pin" data-id="${pId}">
              📌 PIN TO VIEWERS
            </button>
          `}
        </div>
      `;

      itemEl.querySelector('.btn-pin')?.addEventListener('click', async () => {
        try {
          await pinLiveProduct(activeStream.id, pId);
          pinnedProductId = pId;
          wsManager.send('live:pin', { stream_id: activeStream.id, product_id: pId });
          toast.success(`Pinned "${prod.title_en}" to all viewers!`);
          renderBroadcastMonitor();
        } catch (e) {
          toast.error(e.message);
        }
      });

      itemEl.querySelector('.btn-unpin')?.addEventListener('click', async () => {
        try {
          await unpinLiveProduct(activeStream.id, pId);
          pinnedProductId = null;
          wsManager.send('live:unpin', { stream_id: activeStream.id });
          toast.info('Product unpinned.');
          renderBroadcastMonitor();
        } catch (e) {
          toast.error(e.message);
        }
      });

      prodsListEl.append(itemEl);
    });

    // Control Handlers
    stage.querySelector('#btn-go-live')?.addEventListener('click', async () => {
      try {
        await startLiveStream(activeStream.id);
        activeStream.status = 'LIVE';
        toast.success('You are now LIVE! Broadcasting to followers.');
        renderBroadcastMonitor();
      } catch (e) {
        toast.error(e.message);
      }
    });

    stage.querySelector('#btn-end-live')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to end this live broadcast?')) {
        try {
          await endLiveStream(activeStream.id);
          activeStream.status = 'ENDED';
          toast.info('Live stream ended. Recording saved for replay.');
          renderBroadcastMonitor();
        } catch (e) {
          toast.error(e.message);
        }
      }
    });

    stage.querySelector('#btn-share-link')?.addEventListener('click', () => {
      const url = `${window.location.origin}/#/live/${activeStream.id}`;
      navigator.clipboard?.writeText(url);
      toast.success('Public stream link copied to clipboard!');
    });

    // Host Chat
    const hostInput = stage.querySelector('#host-chat-input');
    const sendBtn = stage.querySelector('#host-send-chat-btn');
    const chatBox = stage.querySelector('#studio-chat-messages');

    const sendHostMessage = () => {
      const text = hostInput.value.trim();
      if (!text) return;
      wsManager.send('live:chat', { stream_id: activeStream.id, content: text, client_msg_id: `host_${Date.now()}` });
      hostInput.value = '';
    };

    sendBtn?.addEventListener('click', sendHostMessage);
    hostInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendHostMessage();
    });

    // Connect WebSocket
    wsManager.connect();
    wsManager.send('live:join', { stream_id: activeStream.id });

    wsManager.onMessage((frame) => {
      const { type, payload } = frame;
      if (payload?.streamId && Number(payload.streamId) !== activeStream.id) return;

      if (type === 'live:viewer_count') {
        viewerCount = payload.viewerCount;
        const el = stage.querySelector('#studio-viewers');
        if (el) el.textContent = viewerCount;
      } else if (type === 'live:reaction_broadcast') {
        totalLikes = payload.totalLikes;
        const el = stage.querySelector('#studio-likes');
        if (el) el.textContent = totalLikes;
      } else if (type === 'live:sale_event') {
        totalSales = payload.totalSalesCount;
        totalRevenue = payload.totalSalesAmount;
        const sEl = stage.querySelector('#studio-sales');
        const rEl = stage.querySelector('#studio-revenue');
        if (sEl) sEl.textContent = totalSales;
        if (rEl) rEl.textContent = formatBdt(totalRevenue);
        toast.success(`🎉 New Live Sale: ৳${payload.orderAmount} (${payload.productTitle})`);
      } else if (type === 'live:chat_message') {
        const msg = document.createElement('div');
        msg.className = 'studio-chat-msg';
        msg.innerHTML = `
          <strong>${payload.userName}:</strong> <span>${payload.content}</span>
          <button class="btn-mute-user" data-uid="${payload.userId}" title="Mute user for 15 mins">🔇</button>
        `;
        msg.querySelector('.btn-mute-user')?.addEventListener('click', async () => {
          try {
            await muteLiveParticipant(activeStream.id, payload.userId, 15);
            wsManager.send('live:mute', { stream_id: activeStream.id, target_user_id: payload.userId });
            toast.info(`Muted ${payload.userName} for 15 minutes.`);
          } catch (e) {
            toast.error(e.message);
          }
        });
        chatBox.append(msg);
        chatBox.scrollTop = chatBox.scrollHeight;
      }
    });
  }
}
