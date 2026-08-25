/**
 * ShoppableReels.js — Bandwidth-Conscious Vertical Short-Video Feed with Pinned Product Cards (Prompt 10.8).
 *
 * Implements Prompt 10.8 Requirement 3:
 * - Vertical feed with pinned product card overlay and 1-tap checkout.
 * - Bandwidth-conscious: Preloads ONLY the next item, detects navigator.connection.saveData,
 *   and provides a Data Saver mode toggle (crucial on Bangladeshi mobile networks).
 */

import { listReels, likeReel } from '../../services/content.api.js';
import { Button } from '../ui/Button.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export function ShoppableReels({ onBuyProduct = null } = {}) {
  const container = document.createElement('div');
  container.className = 'shoppable-reels-container relative w-full max-w-md mx-auto h-[85vh] max-h-[780px] bg-black rounded-2xl overflow-hidden shadow-2xl flex flex-col select-none';

  let reels = [];
  let currentIndex = 0;
  let isDataSaver = Boolean(navigator.connection?.saveData);

  // Top Bar with Data Saver Toggle
  const topBar = document.createElement('div');
  topBar.className = 'absolute top-0 left-0 right-0 z-30 flex-between p-4 bg-gradient-to-b from-black/80 to-transparent';
  topBar.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-xl">🎬</span>
      <span class="font-bold text-white text-sm tracking-wide">Explooro Reels</span>
    </div>
    <div class="flex items-center gap-2">
      <button class="data-saver-toggle badge text-xs font-mono cursor-pointer ${isDataSaver ? 'badge-warning' : 'badge-neutral bg-white/20 text-white border-0'}" title="Toggle Data Saver Mode">
        📶 ${isDataSaver ? 'Data Saver: ON' : 'Data Saver: OFF'}
      </button>
    </div>
  `;
  container.append(topBar);

  topBar.querySelector('.data-saver-toggle')?.addEventListener('click', () => {
    isDataSaver = !isDataSaver;
    const btn = topBar.querySelector('.data-saver-toggle');
    if (btn) {
      btn.className = `data-saver-toggle badge text-xs font-mono cursor-pointer ${isDataSaver ? 'badge-warning' : 'badge-neutral bg-white/20 text-white border-0'}`;
      btn.textContent = `📶 ${isDataSaver ? 'Data Saver: ON' : 'Data Saver: OFF'}`;
    }
    toast.info(isDataSaver ? t('content.data_saver_on') : t('content.data_saver_off'));
    renderCurrentReel();
  });

  // Reel Stage
  const stage = document.createElement('div');
  stage.className = 'relative flex-1 w-full h-full flex items-center justify-center bg-black overflow-hidden';
  container.append(stage);

  // Navigation Arrows (Vertical Prev / Next)
  const navOverlay = document.createElement('div');
  navOverlay.className = 'absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3';
  navOverlay.innerHTML = `
    <button class="nav-up-btn w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center text-lg backdrop-blur-sm transition-transform active:scale-95" title="Previous Reel">
      ▲
    </button>
    <button class="nav-down-btn w-10 h-10 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center text-lg backdrop-blur-sm transition-transform active:scale-95" title="Next Reel">
      ▼
    </button>
  `;
  container.append(navOverlay);

  navOverlay.querySelector('.nav-up-btn')?.addEventListener('click', () => {
    if (currentIndex > 0) {
      currentIndex--;
      renderCurrentReel();
    }
  });

  navOverlay.querySelector('.nav-down-btn')?.addEventListener('click', () => {
    if (currentIndex < reels.length - 1) {
      currentIndex++;
      renderCurrentReel();
    }
  });

  // Swipe / Wheel handlers
  let touchStartY = 0;
  container.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    const touchEndY = e.changedTouches[0].clientY;
    const diff = touchStartY - touchEndY;
    if (diff > 50 && currentIndex < reels.length - 1) {
      currentIndex++;
      renderCurrentReel();
    } else if (diff < -50 && currentIndex > 0) {
      currentIndex--;
      renderCurrentReel();
    }
  }, { passive: true });

  async function loadReels() {
    try {
      stage.innerHTML = `<div class="text-white text-xs animate-pulse">Loading Shoppable Reels...</div>`;
      const res = await listReels({ limit: 10 });
      reels = res?.data || [];
      if (reels.length === 0) {
        stage.innerHTML = `<div class="text-white/60 text-xs">No reels available.</div>`;
        return;
      }
      renderCurrentReel();
    } catch {
      stage.innerHTML = `<div class="text-danger text-xs">Failed to load reels.</div>`;
    }
  }

  function renderCurrentReel() {
    stage.innerHTML = '';
    const reel = reels[currentIndex];
    if (!reel) return;

    const lang = getLanguage();
    const caption = lang === 'bn' ? (reel.caption_bn || reel.caption_en) : (reel.caption_en || reel.caption_bn);
    const prod = reel.product;
    const prodTitle = prod ? (lang === 'bn' ? (prod.title_bn || prod.title_en) : (prod.title_en || prod.title_bn)) : '';

    // Video Container
    const videoWrap = document.createElement('div');
    videoWrap.className = 'w-full h-full relative flex items-center justify-center';

    if (isDataSaver) {
      // Data saver mode: Show poster thumbnail with Play Button
      videoWrap.innerHTML = `
        <img src="${reel.thumbnail_url}" alt="${caption}" class="w-full h-full object-cover" />
        <div class="absolute inset-0 bg-black/30 flex items-center justify-center">
          <button class="play-media-btn w-16 h-16 rounded-full bg-primary/90 text-white text-2xl flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
            ▶
          </button>
        </div>
      `;
      videoWrap.querySelector('.play-media-btn')?.addEventListener('click', () => {
        videoWrap.innerHTML = `
          <video src="${reel.video_url}" autoplay playsinline loop class="w-full h-full object-cover" preload="metadata"></video>
        `;
      });
    } else {
      // Standard mode: Video autoplay with metadata preload
      const videoEl = document.createElement('video');
      videoEl.src = reel.video_url;
      videoEl.poster = reel.thumbnail_url;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.loop = true;
      videoEl.muted = true; // allow autoplay
      videoEl.preload = 'metadata';
      videoEl.className = 'w-full h-full object-cover';

      // Tap to toggle sound / pause
      videoEl.addEventListener('click', () => {
        if (videoEl.muted) {
          videoEl.muted = false;
          toast.info('Audio unmuted');
        } else if (videoEl.paused) {
          videoEl.play();
        } else {
          videoEl.pause();
        }
      });

      videoWrap.append(videoEl);
    }

    // Preload next video metadata ONLY (Bandwidth-conscious check)
    if (currentIndex + 1 < reels.length) {
      const nextReel = reels[currentIndex + 1];
      const preloader = document.createElement('link');
      preloader.rel = 'preload';
      preloader.as = 'video';
      preloader.href = nextReel.video_url;
      document.head.appendChild(preloader);
    }

    // Right Action Column (Likes & Share)
    const actionsCol = document.createElement('div');
    actionsCol.className = 'absolute right-4 bottom-24 z-20 flex flex-col items-center gap-4';
    actionsCol.innerHTML = `
      <button class="like-btn flex flex-col items-center text-white gap-1 active:scale-125 transition-transform">
        <span class="text-2xl drop-shadow-md">❤️</span>
        <span class="text-xs font-mono font-bold like-count">${reel.likes_count || 0}</span>
      </button>
      <button class="share-btn flex flex-col items-center text-white gap-1 active:scale-125 transition-transform">
        <span class="text-2xl drop-shadow-md">🔗</span>
        <span class="text-[10px] font-mono">Share</span>
      </button>
    `;

    actionsCol.querySelector('.like-btn')?.addEventListener('click', async () => {
      try {
        const res = await likeReel(reel.id);
        reel.likes_count = res?.data?.likes_count || reel.likes_count + 1;
        const countSpan = actionsCol.querySelector('.like-count');
        if (countSpan) countSpan.textContent = reel.likes_count;
      } catch {}
    });

    actionsCol.querySelector('.share-btn')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(window.location.origin + `/stories`);
      toast.success(t('content.link_copied'));
    });

    // Bottom Overlay (Caption & Pinned Product)
    const bottomOverlay = document.createElement('div');
    bottomOverlay.className = 'absolute bottom-0 left-0 right-0 z-20 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent space-y-3';

    let productCardHtml = '';
    if (prod) {
      const media = Array.isArray(prod.media) ? prod.media[0] : null;
      const imgSrc = media?.url || 'https://placehold.co/100x100';
      productCardHtml = `
        <div class="pinned-product-card bg-white/95 backdrop-blur-md p-2.5 rounded-xl flex items-center justify-between gap-3 shadow-lg border border-white/20">
          <img src="${imgSrc}" alt="${prodTitle}" class="w-12 h-12 object-cover rounded-lg shrink-0" />
          <div class="flex-1 min-w-0">
            <h5 class="text-xs font-bold text-slate-900 truncate m-0">${prodTitle}</h5>
            <div class="font-mono text-xs font-bold text-primary">৳${prod.retail_price?.toLocaleString()}</div>
          </div>
          <button class="buy-now-btn btn btn-sm btn-primary text-xs shrink-0 py-1.5 px-3">
            ⚡ ${t('common.buy_now')}
          </button>
        </div>
      `;
    }

    bottomOverlay.innerHTML = `
      <div class="text-white space-y-1 pr-12">
        <div class="font-bold text-xs flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-success inline-block"></span>
          @${reel.author_name || 'Artisan Seller'}
        </div>
        <p class="text-xs text-white/90 line-clamp-2 m-0">${caption}</p>
      </div>
      ${productCardHtml}
    `;

    bottomOverlay.querySelector('.buy-now-btn')?.addEventListener('click', () => {
      if (onBuyProduct) {
        onBuyProduct(prod);
      } else {
        window.location.href = `/products/${prod.id}`;
      }
    });

    stage.append(videoWrap, actionsCol, bottomOverlay);
  }

  loadReels();

  return {
    element: container,
    next: () => {
      if (currentIndex < reels.length - 1) {
        currentIndex++;
        renderCurrentReel();
      }
    },
    prev: () => {
      if (currentIndex > 0) {
        currentIndex--;
        renderCurrentReel();
      }
    },
  };
}
