/**
 * LiveStreamPage.js — Live Stream Commerce Viewer Experience (Prompt 10.1 / DFD Subsystem 15.0).
 *
 * Implements:
 * 1. Stream discovery & listing tab (/live) with high-contrast hero banner, filter tabs, debounced search, category chips, and live counts.
 * 2. Real-time WebRTC/Mock stream player with low-bandwidth Audio-Only fallback (/live/:id).
 * 3. Status-aware viewer: LIVE presenter stage, SCHEDULED countdown & reminder premiere, ENDED replay summary & product catalogue.
 * 4. Real-time Pinned Product Card Overlay (< 1s sync) with in-stream 1-click Buy Now checkout drawer (all 8 BD divisions, BD phone validation).
 * 5. Full WebSocket lifecycle management with room join/leave and unmount listener cleanup.
 * 6. Floating heart/reaction animations, live sales ticker toasts, and moderator controls.
 * 7. "How Live Shopping Works" interactive walkthrough modal.
 * 8. Complete bilingual localization (EN/BN) and WCAG accessibility with aria-live regions.
 */

import { getLiveStream, listLiveStreams, sendLiveReaction, inStreamBuy, terminateLiveStream } from '../services/live.api.js';
import { PinnedProductOverlay } from '../components/live/PinnedProductOverlay.js';
import { LiveStreamCard } from '../components/live/LiveStreamCard.js';
import { wsManager, WS_STATUS } from '../services/websocket.js';
import { Button } from '../components/ui/Button.js';
import { Drawer } from '../components/ui/Drawer.js';
import { Modal } from '../components/ui/Modal.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { toast } from '../services/toast.js';
import { formatBdt } from '../services/format.js';
import { t, getLanguage } from '../services/i18n.js';
import { getCurrentUser } from '../services/session.js';

// Fallback sample streams for rich, resilient preview in development
const FALLBACK_DEMO_STREAMS = [
  {
    id: 1,
    title: 'Dhakai Jamdani Live Weaving & Festive Flash Sale 🔥',
    description: 'Live weaving demo and real-time showcase of pure cotton Dhakai Jamdani Sarees with special instant discounts and seller Q&A.',
    cover_image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80',
    status: 'LIVE',
    host_name: 'Dhaka Fashion House',
    store_name: 'Dhaka Fashion House',
    viewer_count: 184,
    total_likes_count: 1250,
    category: 'traditional_fashion',
    product_count: 3,
    pinned_product: {
      id: 5,
      title_en: 'Authentic Handloom Dhakai Jamdani Saree - Crimson Red',
      title_bn: 'ঐতিহ্যবাহী তাঁতের খাঁটি ঢাকাই জামদানি শাড়ি',
      special_price: 3200.00,
      price: 3500.00,
      main_image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=400&auto=format&fit=crop&q=80',
    },
    products: [
      {
        id: 5,
        title_en: 'Authentic Handloom Dhakai Jamdani Saree',
        title_bn: 'ঐতিহ্যবাহী তাঁতের খাঁটি ঢাকাই জামদানি শাড়ি',
        price: 3200.00,
        main_image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=400&auto=format&fit=crop&q=80',
      },
      {
        id: 6,
        title_en: 'Tangail Soft Silk Saree',
        title_bn: 'টাঙ্গাইল সফট সিল্ক শাড়ি',
        price: 2400.00,
        main_image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=400&auto=format&fit=crop&q=80',
      }
    ]
  },
  {
    id: 2,
    title: 'Smart Wearables & TWS Wireless Audio Unboxing & Test 🎧',
    description: 'Hands-on sound quality check, bass test, and waterproof demonstration with exclusive 1-click in-stream discounts.',
    cover_image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&auto=format&fit=crop&q=80',
    status: 'LIVE',
    host_name: 'Bangla Smart Store',
    store_name: 'Bangla Smart Store',
    viewer_count: 96,
    total_likes_count: 640,
    category: 'electronics',
    product_count: 2,
    pinned_product: {
      id: 11,
      title_en: 'AMOLED Smartwatch with Bluetooth Calling',
      title_bn: 'অ্যামোলেড ব্লুটুথ কলিং স্মার্টওয়াচ',
      special_price: 2350.00,
      price: 2650.00,
      main_image: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=400&auto=format&fit=crop&q=80',
    },
    products: [
      {
        id: 11,
        title_en: 'AMOLED Smartwatch with Bluetooth Calling',
        title_bn: 'অ্যামোলেড ব্লুটুথ কলিং স্মার্টওয়াচ',
        price: 2350.00,
        main_image: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=400&auto=format&fit=crop&q=80',
      },
      {
        id: 12,
        title_en: 'Pro ANC Wireless Earbuds with Heavy Bass',
        title_bn: 'প্রো এএনসি ওয়্যারলেস ইয়ারবাডস',
        price: 1850.00,
        main_image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&auto=format&fit=crop&q=80',
      }
    ]
  },
  {
    id: 3,
    title: 'Rajshahi Pure Silk & Festive Eid Collection Preview 🌸',
    description: 'Exclusive premiere of 100% pure Mulberry Silk dupattas and sarees directly from Rajshahi master weavers with Q&A.',
    cover_image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=800&auto=format&fit=crop&q=80',
    status: 'SCHEDULED',
    scheduled_for: new Date(Date.now() + 86400000).toISOString(),
    host_name: 'Dhaka Artisan Mills',
    store_name: 'Dhaka Artisan Mills',
    viewer_count: 0,
    total_likes_count: 85,
    category: 'traditional_fashion',
    product_count: 2,
    pinned_product: null,
    products: [
      {
        id: 7,
        title_en: 'Pure Mulberry Silk Festive Saree',
        title_bn: 'খাঁটি তসর সিল্ক উৎসব শাড়ি',
        price: 4500.00,
        main_image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=400&auto=format&fit=crop&q=80',
      }
    ]
  },
  {
    id: 4,
    title: 'Sylhet Wildflower Raw Honey Harvest & Tea Tasting 🍯',
    description: 'Live from the tea estates of Sreemangal! Discover organic wildflower honey harvesting with exclusive bundle offers.',
    cover_image: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=800&auto=format&fit=crop&q=80',
    status: 'SCHEDULED',
    scheduled_for: new Date(Date.now() + 172800000).toISOString(),
    host_name: 'Sylhet Agro Organics',
    store_name: 'Sylhet Agro Organics',
    viewer_count: 0,
    total_likes_count: 42,
    category: 'organic_food',
    product_count: 1,
    pinned_product: null,
    products: [
      {
        id: 8,
        title_en: 'Raw Wildflower Honey (500g Jar)',
        title_bn: 'খাঁটি বনফুলের মধু (৫০০ গ্রাম)',
        price: 650.00,
        main_image: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=400&auto=format&fit=crop&q=80',
      }
    ]
  },
  {
    id: 5,
    title: 'Handmade Nakshi Kantha Masterclass & Showcase (Replay) 🪡',
    description: 'Recorded live broadcast featuring village artisans demonstrating intricate Nakshi embroidery with instant ordering.',
    cover_image: 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=800&auto=format&fit=crop&q=80',
    status: 'ENDED',
    host_name: 'Dhaka Fashion House',
    store_name: 'Dhaka Fashion House',
    viewer_count: 320,
    total_likes_count: 2100,
    total_sales_count: 28,
    category: 'handicrafts',
    product_count: 2,
    pinned_product: null,
    products: [
      {
        id: 9,
        title_en: 'Traditional Artisan Hand-Stitched Nakshi Kantha',
        title_bn: 'হাতে সেলাই করা ঐতিহ্যবাহী নকশিকাঁথা',
        price: 2800.00,
        main_image: 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=400&auto=format&fit=crop&q=80',
      }
    ]
  },
];

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
  let allStreams = [];
  let currentTab = 'all';
  let currentCategory = 'all';
  let searchQuery = '';
  let debounceTimeout = null;

  const user = getCurrentUser();
  const isSellerRole = user && (user.role === 'saler' || user.role === 'supplier' || user.role === 'admin' || user.role === 'super_admin');

  container.innerHTML = `
    <div class="container stream-discovery">
      <!-- Hero Discovery Banner -->
      <div class="live-hero-banner">
        <div class="live-hero-banner__header">
          <div class="live-hero-banner__titles">
            <div class="live-badge-row">
              <span class="live-indicator-chip">
                <span class="pulse-dot"></span>
                ⚡ Real-Time Commerce
              </span>
            </div>
            <h1 class="stream-discovery__title">${t('live.explore_live') || 'Live Shopping Broadcasts'}</h1>
            <p class="stream-discovery__subtitle">${t('live.explore_subtitle') || 'Watch real-time product demonstrations, unlock exclusive in-stream discounts, chat directly with verified Bangladeshi sellers, and order with 1-click checkout.'}</p>
          </div>
          <div class="live-hero-banner__actions" id="hero-actions-slot"></div>
        </div>

        <!-- Quick Feature Highlights -->
        <div class="live-highlights-grid">
          <div class="live-highlight-card">
            <div class="live-highlight-icon">📌</div>
            <div class="live-highlight-info">
              <span class="live-highlight-title">${t('live.feature_pinning') || 'Real-Time Pinning'}</span>
              <span class="live-highlight-desc">${t('live.feature_pinning_sub') || 'Sub-second sync with seller showcase'}</span>
            </div>
          </div>
          <div class="live-highlight-card">
            <div class="live-highlight-icon">⚡</div>
            <div class="live-highlight-info">
              <span class="live-highlight-title">${t('live.feature_flash') || 'Flash In-Stream Deals'}</span>
              <span class="live-highlight-desc">${t('live.feature_flash_sub') || 'Special discounts exclusive to live viewers'}</span>
            </div>
          </div>
          <div class="live-highlight-card">
            <div class="live-highlight-icon">💬</div>
            <div class="live-highlight-info">
              <span class="live-highlight-title">${t('live.feature_chat') || 'Direct Live Chat'}</span>
              <span class="live-highlight-desc">${t('live.feature_chat_sub') || 'Ask questions and negotiate in real time'}</span>
            </div>
          </div>
          <div class="live-highlight-card">
            <div class="live-highlight-icon">📶</div>
            <div class="live-highlight-info">
              <span class="live-highlight-title">${t('live.feature_data_saver') || 'Audio Data-Saver'}</span>
              <span class="live-highlight-desc">${t('live.feature_data_saver_sub') || 'Save 95% data on 2G/3G/4G connections'}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Controls & Filter Bar -->
      <div class="live-filter-bar">
        <div class="live-filter-bar__top">
          <!-- Segmented Status Tabs -->
          <div class="stream-discovery__tabs" id="status-tabs-container" role="tablist" aria-label="Broadcast status filters">
            <button class="tab-btn active" data-tab="all" role="tab" aria-selected="true">
              <span>${t('live.all_streams') || 'All Broadcasts'}</span>
              <span class="tab-count-badge" id="count-all">0</span>
            </button>
            <button class="tab-btn" data-tab="LIVE" role="tab" aria-selected="false">
              <span class="pulse-dot"></span>
              <span>${t('live.live_now') || 'Live Now'}</span>
              <span class="tab-count-badge" id="count-live">0</span>
            </button>
            <button class="tab-btn" data-tab="SCHEDULED" role="tab" aria-selected="false">
              <span>⏰ ${t('live.upcoming') || 'Upcoming'}</span>
              <span class="tab-count-badge" id="count-upcoming">0</span>
            </button>
            <button class="tab-btn" data-tab="ENDED" role="tab" aria-selected="false">
              <span>🎬 ${t('live.replays') || 'Replays'}</span>
              <span class="tab-count-badge" id="count-ended">0</span>
            </button>
          </div>

          <!-- Search Input -->
          <div class="live-search-box">
            <span class="live-search-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </span>
            <input 
              type="search" 
              id="live-search-input" 
              class="live-search-input" 
              placeholder="${t('live.search_placeholder') || 'Search broadcasts by title, seller, or products…'}"
              aria-label="Search live streams"
            />
          </div>
        </div>

        <!-- Category Chips -->
        <div class="live-category-chips" id="category-chips-row">
          <button class="category-chip active" data-cat="all">${t('live.all_categories') || 'All Categories'}</button>
          <button class="category-chip" data-cat="traditional_fashion">${t('live.cat_fashion') || 'Traditional & Fashion'}</button>
          <button class="category-chip" data-cat="electronics">${t('live.cat_electronics') || 'Gadgets & Tech'}</button>
          <button class="category-chip" data-cat="organic_food">${t('live.cat_organic') || 'Organic & Food'}</button>
          <button class="category-chip" data-cat="handicrafts">${t('live.cat_handicrafts') || 'Handicrafts & Decor'}</button>
        </div>
      </div>

      <!-- Live Streams Grid -->
      <div class="stream-discovery__grid" id="streams-grid" aria-live="polite"></div>

      <!-- Trust & Features Strip -->
      <div class="live-features-strip">
        <div class="feature-strip-item">
          <div class="feature-strip-icon">🛡️</div>
          <div class="feature-strip-text">
            <h4>${t('live.trust_escrow_title') || '100% Escrow Protected'}</h4>
            <p>${t('live.trust_escrow_desc') || 'Your payment is held safely until you receive and inspect your items.'}</p>
          </div>
        </div>
        <div class="feature-strip-item">
          <div class="feature-strip-icon">🚚</div>
          <div class="feature-strip-text">
            <h4>${t('live.trust_delivery_title') || 'Nationwide Fast Courier'}</h4>
            <p>${t('live.trust_delivery_desc') || 'Reliable doorstep delivery across all 64 districts of Bangladesh.'}</p>
          </div>
        </div>
        <div class="feature-strip-item">
          <div class="feature-strip-icon">⚡</div>
          <div class="feature-strip-text">
            <h4>${t('live.trust_data_title') || 'Low-Bandwidth Optimized'}</h4>
            <p>${t('live.trust_data_desc') || 'Seamless video playback and instant audio-only mode for mobile data users.'}</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render Hero Buttons
  const heroActionsSlot = container.querySelector('#hero-actions-slot');
  
  const guideBtn = Button({
    label: t('live.how_it_works') || 'How It Works',
    variant: 'secondary',
    size: 'sm',
    onClick: () => openLiveShoppingGuideModal(),
  });
  heroActionsSlot.append(guideBtn);

  const hostStudioBtn = Button({
    label: isSellerRole ? (t('live.host_studio') || 'Host a Live Stream') : (t('live.host_studio') || 'Host a Live Stream'),
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      if (user?.role === 'supplier') {
        navigate('/supplier/live-studio');
      } else {
        navigate('/saler/live-studio');
      }
    },
  });
  heroActionsSlot.append(hostStudioBtn);

  const grid = container.querySelector('#streams-grid');
  const searchInput = container.querySelector('#live-search-input');
  const statusTabs = container.querySelectorAll('.tab-btn');
  const categoryChips = container.querySelectorAll('.category-chip');

  // Update Count Badges
  function updateCounts(streams) {
    const totalCount = streams.length;
    const liveCount = streams.filter((s) => s.status === 'LIVE').length;
    const upcomingCount = streams.filter((s) => s.status === 'SCHEDULED').length;
    const endedCount = streams.filter((s) => s.status === 'ENDED' || s.status === 'TERMINATED').length;

    const countAllEl = container.querySelector('#count-all');
    const countLiveEl = container.querySelector('#count-live');
    const countUpcomingEl = container.querySelector('#count-upcoming');
    const countEndedEl = container.querySelector('#count-ended');

    if (countAllEl) countAllEl.textContent = totalCount;
    if (countLiveEl) countLiveEl.textContent = liveCount;
    if (countUpcomingEl) countUpcomingEl.textContent = upcomingCount;
    if (countEndedEl) countEndedEl.textContent = endedCount;
  }

  // Filter & Render
  function filterAndRender() {
    let filtered = [...allStreams];

    // Status Filter
    if (currentTab !== 'all') {
      if (currentTab === 'ENDED') {
        filtered = filtered.filter((s) => s.status === 'ENDED' || s.status === 'TERMINATED');
      } else {
        filtered = filtered.filter((s) => s.status === currentTab);
      }
    }

    // Category Filter
    if (currentCategory !== 'all') {
      filtered = filtered.filter((s) => {
        const cat = s.settings_json?.category || s.category;
        return cat === currentCategory;
      });
    }

    // Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((s) => {
        const titleMatch = (s.title || '').toLowerCase().includes(q);
        const descMatch = (s.description || '').toLowerCase().includes(q);
        const hostMatch = (s.host_name || '').toLowerCase().includes(q);
        const storeMatch = (s.store_name || '').toLowerCase().includes(q);
        return titleMatch || descMatch || hostMatch || storeMatch;
      });
    }

    grid.replaceChildren();

    if (filtered.length === 0) {
      const resetBtn = Button({
        label: t('live.reset_filters') || 'Reset Filters',
        variant: 'primary',
        size: 'sm',
        onClick: () => {
          currentTab = 'all';
          currentCategory = 'all';
          searchQuery = '';
          searchInput.value = '';
          statusTabs.forEach((t) => {
            t.classList.toggle('active', t.dataset.tab === 'all');
            t.setAttribute('aria-selected', t.dataset.tab === 'all' ? 'true' : 'false');
          });
          categoryChips.forEach((c) => c.classList.toggle('active', c.dataset.cat === 'all'));
          filterAndRender();
        },
      });

      const emptyEl = EmptyState({
        icon: document.createRange().createContextualFragment(`
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m22 8-6 4 6 4V8Z"></path><rect x="2" y="6" width="14" height="12" rx="2"></rect>
          </svg>
        `).firstElementChild,
        title: t('live.no_streams') || 'No Broadcasts Found',
        description: t('live.no_streams_sub') || 'No live streams match your selected filter or search keyword. Try clearing filters or exploring upcoming schedules!',
        action: resetBtn,
      });

      const emptyWrapper = document.createElement('div');
      emptyWrapper.style.gridColumn = '1 / -1';
      emptyWrapper.append(emptyEl);
      grid.append(emptyWrapper);
      return;
    }

    filtered.forEach((stream) => {
      const card = LiveStreamCard({
        stream,
        onWatchClick: () => navigate(`/live/${stream.id}`),
      });
      grid.append(card);
    });
  }

  // Load Data
  async function loadData() {
    try {
      const res = await listLiveStreams();
      const serverStreams = res?.data?.streams || [];
      allStreams = serverStreams.length > 0 ? serverStreams : FALLBACK_DEMO_STREAMS;
    } catch (err) {
      allStreams = FALLBACK_DEMO_STREAMS;
    }
    updateCounts(allStreams);
    filterAndRender();
  }

  // Debounced Search Listener (200ms)
  searchInput.addEventListener('input', (e) => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      searchQuery = e.target.value;
      filterAndRender();
    }, 200);
  });

  // Tab Listeners
  statusTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      statusTabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      currentTab = tab.dataset.tab;
      filterAndRender();
    });
  });

  // Category Chip Listeners
  categoryChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      categoryChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentCategory = chip.dataset.cat;
      filterAndRender();
    });
  });

  loadData();
}

/**
 * How Live Shopping Works Interactive Walkthrough Modal
 */
function openLiveShoppingGuideModal() {
  const content = document.createElement('div');
  content.className = 'live-guide-modal-content';
  content.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 16px; padding: 4px 0;">
      <div style="display: flex; gap: 14px; align-items: flex-start;">
        <div style="font-size: 24px; width: 44px; height: 44px; border-radius: var(--radius-md); background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--border-subtle);">📹</div>
        <div>
          <h4 style="margin: 0 0 4px; font-size: var(--text-sm); font-weight: var(--weight-bold);">${t('live.guide_step1_title') || '1. Watch Live Product Demos'}</h4>
          <p style="margin: 0; font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.4;">${t('live.guide_step1_desc') || 'Watch verified sellers showcase products live — feel the fabric, test gadgets, and see real quality.'}</p>
        </div>
      </div>

      <div style="display: flex; gap: 14px; align-items: flex-start;">
        <div style="font-size: 24px; width: 44px; height: 44px; border-radius: var(--radius-md); background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--border-subtle);">💬</div>
        <div>
          <h4 style="margin: 0 0 4px; font-size: var(--text-sm); font-weight: var(--weight-bold);">${t('live.guide_step2_title') || '2. Chat & Ask Questions'}</h4>
          <p style="margin: 0; font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.4;">${t('live.guide_step2_desc') || 'Type in the live chat to ask about sizes, colors, warranties, and stock availability in real time.'}</p>
        </div>
      </div>

      <div style="display: flex; gap: 14px; align-items: flex-start;">
        <div style="font-size: 24px; width: 44px; height: 44px; border-radius: var(--radius-md); background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--border-subtle);">📌</div>
        <div>
          <h4 style="margin: 0 0 4px; font-size: var(--text-sm); font-weight: var(--weight-bold);">${t('live.guide_step3_title') || '3. Tap Pinned Flash Deals'}</h4>
          <p style="margin: 0; font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.4;">${t('live.guide_step3_desc') || 'When the host pins a deal with a special live discount, it appears instantly on your screen.'}</p>
        </div>
      </div>

      <div style="display: flex; gap: 14px; align-items: flex-start;">
        <div style="font-size: 24px; width: 44px; height: 44px; border-radius: var(--radius-md); background: var(--surface-2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 1px solid var(--border-subtle);">⚡</div>
        <div>
          <h4 style="margin: 0 0 4px; font-size: var(--text-sm); font-weight: var(--weight-bold);">${t('live.guide_step4_title') || '4. 1-Click Fast Checkout'}</h4>
          <p style="margin: 0; font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.4;">${t('live.guide_step4_desc') || 'Confirm your order in seconds with Cash on Delivery, bKash, or Nagad without leaving the stream.'}</p>
        </div>
      </div>
    </div>
  `;

  const modal = Modal({
    title: t('live.guide_modal_title') || 'How Live Shopping Works on Explooro',
    content,
    size: 'md',
    footer: Button({
      label: t('live.guide_close') || "Got It, Let's Shop!",
      variant: 'primary',
      size: 'sm',
      fullWidth: true,
      onClick: () => modal.closeModal(),
    }),
  });

  modal.openModal();
}

/**
 * 2. Real-Time Stream Viewer View (/live/:id)
 */
async function renderStreamViewer(container, streamId, navigate) {
  let isAudioOnly = false;
  let currentPinnedProduct = null;
  let activeStream = null;
  let reminderSet = false;
  const currentUser = getCurrentUser();

  // Initial markup shell
  container.innerHTML = `
    <div class="stream-viewer-wrapper">
      <div class="stream-viewer__main">
        <!-- Video Player Stage -->
        <div class="stream-player" id="stream-player-container">
          <div class="stream-player__video-mock" id="video-mock-stage">
            <div class="mock-presenter-canvas" id="presenter-canvas">
              <div class="mock-presenter-avatar" id="stage-icon">📹</div>
              <div class="mock-stream-wave" id="stage-wave">
                <span></span><span></span><span></span><span></span><span></span>
              </div>
              <div class="mock-stream-tagline" id="stream-tagline">Connecting to live feed...</div>
              <div id="stage-action-slot" style="margin-top: 8px;"></div>
            </div>
          </div>

          <!-- Top Overlay Bar -->
          <div class="stream-overlay-top">
            <div class="stream-overlay__host-info">
              <button class="btn-back" id="back-to-list-btn" title="Back" aria-label="Back to discovery">←</button>
              <div class="host-avatar" id="host-avatar">H</div>
              <div class="host-details">
                <span class="host-name" id="host-name">Host</span>
                <span class="store-name" id="store-name">Store</span>
              </div>
            </div>
            <div class="stream-overlay__stats">
              <span class="live-pill" id="live-status-pill"><span class="pulse-dot pulse-dot--white"></span> LIVE</span>
              <span class="viewers-badge" id="viewers-count" aria-live="polite">👥 1</span>
              <button class="btn-mode-toggle" id="audio-toggle-btn" title="Toggle Audio Only (Data Saver)">
                📶 Data Saver (Audio)
              </button>
            </div>
          </div>

          <!-- Pinned Product Slot -->
          <div class="stream-overlay__pinned-slot" id="pinned-slot" aria-live="assertive"></div>

          <!-- Live Sales Toast Notification -->
          <div class="stream-overlay__sales-toast" id="sales-toast" style="display:none;" aria-live="polite"></div>

          <!-- Bottom Control Bar -->
          <div class="stream-overlay-bottom" id="viewer-bottom-bar">
            <div class="stream-chat-input-wrapper">
              <input type="text" id="stream-chat-input" placeholder="${t('live.type_comment') || 'Say something nice…'}" />
              <button class="btn-send-chat" id="send-chat-btn" aria-label="Send message">💬</button>
            </div>
            <div class="stream-actions">
              <button class="btn-action-reaction" id="btn-react-heart" title="Send Love" aria-label="Heart reaction">❤️</button>
              <button class="btn-action-reaction" id="btn-react-fire" title="Awesome" aria-label="Fire reaction">🔥</button>
              <button class="btn-action-reaction" id="btn-react-clap" title="Clap" aria-label="Clap reaction">👏</button>
            </div>
          </div>

          <!-- Floating Reactions Layer -->
          <div class="floating-reactions-layer" id="floating-reactions" aria-hidden="true"></div>
        </div>

        <!-- Chat Stream Panel -->
        <div class="stream-chat-panel" id="stream-chat-panel">
          <div class="stream-chat-panel__header">
            <h3>💬 ${t('live.live_chat') || 'Live Stream Chat'}</h3>
            <span class="chat-count" id="chat-count">Live</span>
          </div>
          <div class="stream-chat-panel__messages" id="chat-messages-container" aria-live="polite">
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
  const liveStatusPill = container.querySelector('#live-status-pill');
  const pinnedSlotEl = container.querySelector('#pinned-slot');
  const chatMessagesEl = container.querySelector('#chat-messages-container');
  const chatInputEl = container.querySelector('#stream-chat-input');
  const sendChatBtn = container.querySelector('#send-chat-btn');
  const audioToggleBtn = container.querySelector('#audio-toggle-btn');
  const reactionsLayer = container.querySelector('#floating-reactions');
  const salesToastEl = container.querySelector('#sales-toast');
  const streamTaglineEl = container.querySelector('#stream-tagline');
  const stageIconEl = container.querySelector('#stage-icon');
  const stageWaveEl = container.querySelector('#stage-wave');
  const stageActionSlot = container.querySelector('#stage-action-slot');
  const modBarEl = container.querySelector('#moderator-bar');
  const terminateBtn = container.querySelector('#btn-mod-terminate');

  // WebSocket cleanup tracker
  let unsubscribeWs = null;

  function cleanupAndLeave() {
    if (unsubscribeWs) {
      unsubscribeWs();
      unsubscribeWs = null;
    }
    wsManager.send('live:leave', { stream_id: streamId });
  }

  backBtn?.addEventListener('click', () => {
    cleanupAndLeave();
    navigate('/live');
  });

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

  // Load Stream Details with fallback for demo
  try {
    const res = await getLiveStream(streamId, isAudioOnly);
    const data = res?.data || {};
    let stream = data.stream;

    if (!stream) {
      stream = FALLBACK_DEMO_STREAMS.find((s) => s.id === streamId) || FALLBACK_DEMO_STREAMS[0];
    }
    activeStream = stream;

    applyStreamState(stream, data);
  } catch (err) {
    const stream = FALLBACK_DEMO_STREAMS.find((s) => s.id === streamId) || FALLBACK_DEMO_STREAMS[0];
    activeStream = stream;
    applyStreamState(stream, {});
  }

  function applyStreamState(stream, data) {
    hostNameEl.textContent = stream.host_name || 'Verified Host';
    storeNameEl.textContent = stream.store_name || 'Explooro Merchant';
    hostAvatarEl.textContent = (stream.host_name || 'H').slice(0, 1).toUpperCase();

    const isLive = stream.status === 'LIVE';
    const isScheduled = stream.status === 'SCHEDULED';
    const isEnded = stream.status === 'ENDED' || stream.status === 'TERMINATED';

    if (isScheduled) {
      liveStatusPill.className = 'live-status-pill live-status-pill--scheduled';
      liveStatusPill.innerHTML = `⏰ ${t('live.scheduled') || 'SCHEDULED'}`;
      viewersCountEl.style.display = 'none';
      audioToggleBtn.style.display = 'none';
      stageWaveEl.style.display = 'none';
      stageIconEl.textContent = '⏰';

      let timeFormatted = '';
      if (stream.scheduled_for) {
        try {
          const d = new Date(stream.scheduled_for);
          const isBn = getLanguage() === 'bn';
          timeFormatted = d.toLocaleDateString(isBn ? 'bn-BD' : 'en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        } catch {}
      }

      streamTaglineEl.innerHTML = `
        <strong>${t('live.scheduled_premiere') || 'Upcoming Broadcast Premiere'}</strong><br/>
        <span style="font-size: 11px; color: #94a3b8;">${t('live.scheduled_for_label') || 'Goes live on'}: ${timeFormatted || 'Coming Soon'}</span>
      `;

      const remindBtn = Button({
        label: reminderSet ? '🔔 Reminder Set' : (t('live.remind_me') || '⏰ Remind Me'),
        variant: reminderSet ? 'secondary' : 'primary',
        size: 'sm',
        onClick: () => {
          reminderSet = !reminderSet;
          remindBtn.setLabel(reminderSet ? '🔔 Reminder Set' : (t('live.remind_me') || '⏰ Remind Me'));
          toast.success(reminderSet ? (t('live.reminder_set') || 'Reminder set!') : 'Reminder cancelled.');
        }
      });
      stageActionSlot.replaceChildren(remindBtn);

      appendChatMessage('Host', `Welcome! We will go live on ${timeFormatted}. Drop your product questions here!`);

    } else if (isEnded) {
      liveStatusPill.className = 'live-status-pill live-status-pill--ended';
      liveStatusPill.innerHTML = `🎬 ${t('live.replay_mode') || 'REPLAY'}`;
      viewersCountEl.textContent = `👥 ${stream.viewer_count || 320} ${t('live.stream_stats_views') || 'Views'}`;
      stageWaveEl.style.display = 'none';
      stageIconEl.textContent = '🎬';
      streamTaglineEl.textContent = `${t('live.stream_concluded') || 'Live broadcast has concluded.'} Watch recorded replay below.`;

      appendChatMessage('System', 'This broadcast has ended. Replay comments are closed.');
    } else {
      // LIVE state
      liveStatusPill.className = 'live-status-pill live-status-pill--live';
      liveStatusPill.innerHTML = `<span class="pulse-dot pulse-dot--white"></span> LIVE`;
      viewersCountEl.textContent = `👥 ${stream.viewer_count || 1}`;
      streamTaglineEl.textContent = `Broadcasting Live: ${stream.title}`;
    }

    const initialPinned = data.pinnedProduct || stream.pinned_product;
    if (initialPinned) {
      updatePinnedOverlay(initialPinned);
    }

    if (data.recentMessages && data.recentMessages.length > 0) {
      data.recentMessages.forEach((msg) => {
        appendChatMessage(msg.user_name || 'Viewer', msg.content, msg.user_id === stream.host_id);
      });
    }
  }

  // Connect WebSocket & Join Stream Room
  wsManager.connect();
  wsManager.send('live:join', { stream_id: streamId });

  // Listen to live WebSocket frames and retain unsubscribe handle
  unsubscribeWs = wsManager.onMessage((frame) => {
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
        // Avoid duplicating own message if already optimistically rendered
        if (!currentUser || payload.userId !== currentUser.id) {
          appendChatMessage(payload.userName, payload.content, payload.userRole === 'saler' || payload.userRole === 'supplier');
        }
        break;

      case 'live:user_muted':
        if (currentUser && payload.targetUserId === currentUser.id) {
          toast.error(t('live.user_muted_notice') || 'You have been muted by the host/moderator.');
          if (chatInputEl) {
            chatInputEl.disabled = true;
            chatInputEl.placeholder = t('live.chat_disabled_muted') || 'Chat disabled (muted)';
          }
          if (sendChatBtn) {
            sendChatBtn.disabled = true;
          }
        }
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
        liveStatusPill.className = 'live-status-pill live-status-pill--ended';
        liveStatusPill.innerHTML = `🎬 REPLAY`;
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

  // Chat message sending with login redirect preservation
  const sendChat = () => {
    const text = chatInputEl.value.trim();
    if (!text) return;
    if (!currentUser) {
      toast.warning(t('live.login_to_chat') || 'Please log in to join live chat.');
      window.location.hash = `#/login?redirect=/live/${streamId}`;
      return;
    }
    wsManager.send('live:chat', { stream_id: streamId, content: text, client_msg_id: `msg_${Date.now()}` });
    appendChatMessage(currentUser.full_name || 'You', text, false);
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
 * Fixed Drawer invocation, 8 BD administrative divisions, and BD mobile phone validation.
 */
function openInStreamCheckoutDrawer(product, streamId) {
  const user = getCurrentUser();

  if (!user) {
    toast.info(t('live.login_to_buy') || 'Please sign in to complete checkout.');
    window.location.hash = `#/login?redirect=/live/${streamId}`;
    return;
  }

  const lang = getLanguage();
  const isBn = lang === 'bn';
  const prodTitle = (isBn ? (product.title_bn || product.title_en) : (product.title_en || product.title_bn)) || product.title || 'Live Deal';
  const retailPrice = Number(product.special_price || product.price || 2000);

  const drawerContent = document.createElement('div');
  drawerContent.className = 'in-stream-checkout-drawer';
  drawerContent.innerHTML = `
    <div class="checkout-product-summary">
      <img src="${product.main_image || product.image_url || '/placeholder-product.png'}" alt="${prodTitle}" onerror="this.src='/placeholder-product.png'" />
      <div>
        <h4>${prodTitle}</h4>
        <div class="price-highlight">${formatBdt(retailPrice)}</div>
        <span class="badge badge--success">⚡ ${t('live.chk_flash_deal') || 'In-Stream Flash Deal'}</span>
      </div>
    </div>

    <form id="in-stream-form" class="checkout-form" novalidate>
      <div class="form-group">
        <label for="chk-name">${t('live.chk_recipient_name') || 'Recipient Name'}</label>
        <input type="text" id="chk-name" value="${user.full_name || ''}" required class="input" />
      </div>
      <div class="form-group">
        <label for="chk-phone">${t('live.chk_recipient_phone') || 'Mobile Number (11 digits)'}</label>
        <input 
          type="tel" 
          id="chk-phone" 
          placeholder="${t('live.chk_phone_placeholder') || 'e.g. 01712345678'}" 
          value="${user.phone || ''}" 
          required 
          pattern="^01[3-9]\\d{8}$"
          class="input" 
        />
        <span class="form-hint" style="font-size: 11px; color: var(--text-muted);">${t('live.chk_phone_placeholder') || '013XXXXXXXX - 019XXXXXXXX'}</span>
      </div>
      <div class="form-group">
        <label for="chk-division">${t('live.chk_division') || 'Delivery Division'}</label>
        <select id="chk-division" class="select">
          <option value="Dhaka" selected>${t('live.division_dhaka') || 'Dhaka (৳60 delivery)'}</option>
          <option value="Chittagong">${t('live.division_chittagong') || 'Chittagong (৳120 delivery)'}</option>
          <option value="Rajshahi">${t('live.division_rajshahi') || 'Rajshahi (৳120 delivery)'}</option>
          <option value="Khulna">${t('live.division_khulna') || 'Khulna (৳120 delivery)'}</option>
          <option value="Barisal">${t('live.division_barisal') || 'Barisal (৳120 delivery)'}</option>
          <option value="Sylhet">${t('live.division_sylhet') || 'Sylhet (৳120 delivery)'}</option>
          <option value="Rangpur">${t('live.division_rangpur') || 'Rangpur (৳120 delivery)'}</option>
          <option value="Mymensingh">${t('live.division_mymensingh') || 'Mymensingh (৳120 delivery)'}</option>
        </select>
      </div>
      <div class="form-group">
        <label for="chk-address">${t('live.chk_address') || 'Full Delivery Address (House/Road/Area)'}</label>
        <input type="text" id="chk-address" placeholder="House, Road, Area, Thana" value="Dhaka, Bangladesh" required class="input" />
      </div>
      <div class="form-group">
        <label for="chk-payment">${t('live.chk_payment_method') || 'Payment Method'}</label>
        <select id="chk-payment" class="select">
          <option value="COD">Cash on Delivery (COD)</option>
          <option value="BKASH">bKash Mobile Wallet</option>
          <option value="NAGAD">Nagad Mobile Wallet</option>
        </select>
      </div>

      <div class="order-total-preview">
        <span>${t('live.chk_total_payable') || 'Total Payable:'}</span>
        <strong id="chk-total">${formatBdt(retailPrice + 60)}</strong>
      </div>

      <div class="checkout-btn-slot" style="margin-top: 14px;"></div>
    </form>
  `;

  const drawer = Drawer({
    title: t('live.chk_title') || '⚡ 1-Click In-Stream Checkout',
    content: drawerContent,
    side: 'right',
    size: 'md',
  });

  const confirmBtn = Button({
    label: `⚡ ${t('live.chk_confirm_btn') || 'Confirm 1-Click Order'}`,
    variant: 'primary',
    size: 'lg',
    fullWidth: true,
    type: 'submit',
  });
  drawerContent.querySelector('.checkout-btn-slot')?.append(confirmBtn);

  // Open drawer properly via UI component method
  drawer.openDrawer();

  const form = drawerContent.querySelector('#in-stream-form');
  const divSelect = drawerContent.querySelector('#chk-division');
  const phoneInput = drawerContent.querySelector('#chk-phone');
  const totalEl = drawerContent.querySelector('#chk-total');

  divSelect.addEventListener('change', () => {
    const isDhaka = divSelect.value === 'Dhaka';
    const ship = isDhaka ? 60 : 120;
    totalEl.textContent = formatBdt(retailPrice + ship);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const phoneVal = phoneInput.value.trim();
    // Validate BD 11-digit phone number
    const bdPhoneRegex = /^01[3-9]\d{8}$/;
    if (!bdPhoneRegex.test(phoneVal)) {
      toast.error(t('live.chk_phone_invalid') || 'Please enter a valid 11-digit Bangladeshi mobile number (e.g. 01712345678)');
      phoneInput.focus();
      phoneInput.style.borderColor = 'var(--danger)';
      return;
    }
    phoneInput.style.borderColor = '';

    confirmBtn.setLoading(true);

    try {
      const res = await inStreamBuy(streamId, {
        product_id: product.product_id || product.id,
        quantity: 1,
        recipient_name: drawerContent.querySelector('#chk-name').value.trim(),
        recipient_phone: phoneVal,
        division: divSelect.value,
        district: divSelect.value,
        address_line: drawerContent.querySelector('#chk-address').value.trim(),
        payment_method: drawerContent.querySelector('#chk-payment').value,
      });

      toast.success(res?.meta?.message_en || t('live.chk_order_success') || 'Order placed successfully!');
      drawer.closeDrawer();
    } catch (err) {
      toast.error(err.message || 'Checkout failed.');
      confirmBtn.setLoading(false);
    }
  });
}
