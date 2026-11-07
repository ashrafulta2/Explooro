/**
 * ShoppableReels.ts — Bandwidth-Conscious Vertical Short-Video Feed with Pinned Product Cards (Prompt 10.8).
 *
 * Implements Prompt 10.8 Requirement 3:
 * - Vertical feed with pinned product card overlay and 1-tap checkout.
 * - Bandwidth-conscious: Preloads ONLY the next item, detects navigator.connection.saveData,
 *   and provides a Data Saver mode toggle (crucial on Bangladeshi mobile networks).
 */

import { listReels, likeReel } from '../../services/content.api.ts';
import { Button } from '../ui/Button.ts';
import { t, getLanguage } from '../../services/i18n.ts';
import { toast } from '../../services/toast.ts';
import '../../styles/components/shoppable-reels.css';

/** A shoppable video clip with the product it sells. */
export interface Reel {
  id: number | string;
  author_name?: string;
  caption_en?: string;
  caption_bn?: string;
  likes_count?: number;
  thumbnail_url?: string;
  video_url?: string;
  product?: { title_en?: string; title_bn?: string; [field: string]: unknown } | null;
}

/** The reels page root plus the two steppers keyboard and swipe handlers call. */
export interface ShoppableReelsParts {
  element: HTMLDivElement;
  next(): void;
  prev(): void;
}

export function ShoppableReels({ onBuyProduct = null }: { onBuyProduct?: ((product: unknown) => void) | null } = {}): ShoppableReelsParts {
  const container = document.createElement('div');
  container.className = 'shoppable-reels-container reels';

  let reels: Reel[] = [];
  let currentIndex = 0;
  let isDataSaver = Boolean((navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData);

  // Top Bar with Data Saver Toggle
  const topBar = document.createElement('div');
  topBar.className = 'reels__top';
  topBar.innerHTML = `
    <div class="reels__brand">
      <span aria-hidden="true">🎬</span>
      <span>Explooro Reels</span>
    </div>
    <button type="button" class="data-saver-toggle badge badge--md reels__saver ${isDataSaver ? 'reels__saver--on' : ''}" title="Toggle Data Saver Mode">
      📶 ${isDataSaver ? 'Data Saver: ON' : 'Data Saver: OFF'}
    </button>
  `;
  container.append(topBar);

  topBar.querySelector('.data-saver-toggle')?.addEventListener('click', () => {
    isDataSaver = !isDataSaver;
    const btn = topBar.querySelector('.data-saver-toggle');
    if (btn) {
      btn.className = `data-saver-toggle badge badge--md reels__saver ${isDataSaver ? 'reels__saver--on' : ''}`;
      btn.textContent = `📶 ${isDataSaver ? 'Data Saver: ON' : 'Data Saver: OFF'}`;
    }
    toast.info(isDataSaver ? t('content.data_saver_on') : t('content.data_saver_off'));
    renderCurrentReel();
  });

  // Reel Stage
  const stage = document.createElement('div');
  stage.className = 'reels__stage';
  container.append(stage);

  // Navigation Arrows (Vertical Prev / Next)
  const navOverlay = document.createElement('div');
  navOverlay.className = 'reels__nav';
  navOverlay.innerHTML = `
    <button type="button" class="nav-up-btn reels__nav-btn" title="Previous Reel" aria-label="Previous Reel">
      ▲
    </button>
    <button type="button" class="nav-down-btn reels__nav-btn" title="Next Reel" aria-label="Next Reel">
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
      stage.innerHTML = `<p class="reels__status">Loading Shoppable Reels...</p>`;
      const res = await listReels({ limit: 10 });
      reels = res?.data || [];
      if (reels.length === 0) {
        stage.innerHTML = `<p class="reels__status">No reels available.</p>`;
        return;
      }
      renderCurrentReel();
    } catch {
      stage.innerHTML = `<p class="reels__status reels__status--error">Failed to load reels.</p>`;
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
    videoWrap.className = 'reels__media';

    if (isDataSaver) {
      // Data saver mode: Show poster thumbnail with Play Button
      videoWrap.innerHTML = `
        <img src="${reel.thumbnail_url}" alt="${caption}" />
        <div class="reels__shade">
          <button type="button" class="play-media-btn reels__play" aria-label="Play">
            ▶
          </button>
        </div>
      `;
      videoWrap.querySelector('.play-media-btn')?.addEventListener('click', () => {
        videoWrap.innerHTML = `
          <video src="${reel.video_url}" autoplay playsinline loop preload="metadata"></video>
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
    actionsCol.className = 'reels__actions';
    actionsCol.innerHTML = `
      <button type="button" class="like-btn reels__action" aria-label="Like">
        <span class="reels__action-icon">❤️</span>
        <span class="like-count">${reel.likes_count || 0}</span>
      </button>
      <button type="button" class="share-btn reels__action" aria-label="Share">
        <span class="reels__action-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M9 17H7A5 5 0 0 1 7 7h2"></path><path d="M15 7h2a5 5 0 1 1 0 10h-2"></path><line x1="8" y1="12" x2="16" y2="12"></line></svg></span>
        <span>Share</span>
      </button>
    `;

    actionsCol.querySelector('.like-btn')?.addEventListener('click', async () => {
      try {
        const res = await likeReel(reel.id);
        reel.likes_count = res?.data?.likes_count || reel.likes_count + 1;
        const countSpan = actionsCol.querySelector('.like-count');
        if (countSpan) countSpan.textContent = String(reel.likes_count);
      } catch {}
    });

    actionsCol.querySelector('.share-btn')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(window.location.origin + `/stories`);
      toast.success(t('content.link_copied'));
    });

    // Bottom Overlay (Caption & Pinned Product)
    const bottomOverlay = document.createElement('div');
    bottomOverlay.className = 'reels__bottom';

    let productCardHtml = '';
    if (prod) {
      const media = Array.isArray(prod.media) ? prod.media[0] : null;
      const imgSrc = media?.url || 'https://placehold.co/100x100';
      productCardHtml = `
        <div class="pinned-product-card reels__product">
          <img src="${imgSrc}" alt="${prodTitle}" class="reels__product-img" />
          <div class="reels__product-body">
            <h5 class="reels__product-title">${prodTitle}</h5>
            <div class="reels__product-price">৳${prod.retail_price?.toLocaleString()}</div>
          </div>
          <button type="button" class="buy-now-btn btn btn--sm btn--primary reels__buy">
            ⚡ ${t('common.buy_now')}
          </button>
        </div>
      `;
    }

    bottomOverlay.innerHTML = `
      <div class="reels__meta">
        <div class="reels__author">@${reel.author_name || 'Artisan Explooro Partner'}</div>
        <p class="reels__caption">${caption}</p>
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
