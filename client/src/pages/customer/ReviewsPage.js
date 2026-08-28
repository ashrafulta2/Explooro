/**
 * ReviewsPage.js — Customer Reviews & UGC Video Hub (Prompt 11.3 / idea §AL.3).
 *
 * Routes: /account/reviews, /customer/reviews, /reviews
 *
 * Implements:
 * 1. Low-literacy friendly Bengali & English interfaces with 48px+ touch targets.
 * 2. Real-time KPI telemetry: Total Reviews, Coins Earned, Helpful Votes, Pending Reviews.
 * 3. 3-Tab workflow: "To Review" (pending delivered orders), "My Reviews", and "UGC & Videos".
 * 4. Interactive review creator/editor with photo/video uploaders and coin reward engine (+20/+40 Coins).
 * 5. Full search, rating filter, and sorting.
 */

import { customerApi } from '../../services/customer.api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';
import { Modal } from '../../components/ui/Modal.js';
import { PendingReviewCard } from '../../components/customer/PendingReviewCard.js';
import { CustomerReviewCard } from '../../components/customer/CustomerReviewCard.js';
import { openWriteReviewModal } from '../../components/customer/WriteReviewModal.js';

export default function ReviewsPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const isBn = getLanguage() === 'bn';

  const container = document.createElement('div');
  container.className = 'reviews-page container';

  let activeTab = 'pending'; // 'pending' | 'published' | 'media'
  let searchQuery = '';
  let ratingFilter = '';
  let sortBy = 'newest';

  let reviewsData = [];
  let pendingData = [];
  let kpis = { total_reviews: 0, coins_earned: 0, helpful_votes: 0, pending_count: 0 };
  let loading = true;

  // 1. Header Section
  const header = document.createElement('header');
  header.className = 'reviews-page__header';
  header.innerHTML = `
    <a href="/account" class="reviews-page__back">
      ← ${t('common.back') || 'Back to Account'}
    </a>
    <div class="reviews-page__title-wrap">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="badge badge--primary text-[10px] font-bold uppercase tracking-wider">
            ${t('customer_reviews.badge')}
          </span>
        </div>
        <h1 class="reviews-page__title">
          <span>⭐</span> ${t('customer_reviews.page_title')}
        </h1>
        <p class="reviews-page__subtitle">
          ${t('customer_reviews.page_subtitle')}
        </p>
      </div>
    </div>
  `;
  container.appendChild(header);

  // 2. KPI Summary Bar
  const kpiBar = document.createElement('div');
  kpiBar.className = 'reviews-kpis';
  container.appendChild(kpiBar);

  function renderKPIs() {
    kpiBar.innerHTML = `
      <div class="reviews-kpi-card">
        <div class="reviews-kpi-label">
          <span>${t('customer_reviews.kpi_total_reviews')}</span>
          <span>✍️</span>
        </div>
        <div class="reviews-kpi-val reviews-kpi-val--brand">${kpis.total_reviews}</div>
        <div class="reviews-kpi-sub">${isBn ? 'আপনার মোট প্রকাশিত রিভিউ' : 'Reviews submitted'}</div>
      </div>

      <div class="reviews-kpi-card">
        <div class="reviews-kpi-label">
          <span>${t('customer_reviews.kpi_coins_earned')}</span>
          <span>🪙</span>
        </div>
        <div class="reviews-kpi-val reviews-kpi-val--gold">+${kpis.coins_earned}</div>
        <div class="reviews-kpi-sub">${isBn ? 'রিভিউ থেকে প্রাপ্ত কয়েন' : 'Coins earned from reviews'}</div>
      </div>

      <div class="reviews-kpi-card">
        <div class="reviews-kpi-label">
          <span>${t('customer_reviews.kpi_helpful_votes')}</span>
          <span>👍</span>
        </div>
        <div class="reviews-kpi-val reviews-kpi-val--success">${kpis.helpful_votes}</div>
        <div class="reviews-kpi-sub">${isBn ? 'অন্যান্য ক্রেতাদের সমর্থন' : 'Upvotes by other shoppers'}</div>
      </div>

      <div class="reviews-kpi-card">
        <div class="reviews-kpi-label">
          <span>${t('customer_reviews.kpi_pending_reviews')}</span>
          <span>⏳</span>
        </div>
        <div class="reviews-kpi-val reviews-kpi-val--accent">${kpis.pending_count}</div>
        <div class="reviews-kpi-sub">${isBn ? 'ডেলিভারি হওয়া বাকি পণ্য' : 'Delivered items to review'}</div>
      </div>
    `;
  }

  // 3. Reward Incentive Banner
  const incentiveBanner = document.createElement('div');
  incentiveBanner.className = 'reviews-incentive-banner';
  incentiveBanner.innerHTML = `
    <div class="reviews-incentive-banner__content">
      <span class="reviews-incentive-banner__icon">🎁</span>
      <div>
        <h4 class="reviews-incentive-banner__title">${t('customer_reviews.pending_banner_title')}</h4>
        <p class="reviews-incentive-banner__desc">${t('customer_reviews.pending_banner_desc')}</p>
      </div>
    </div>
    <a href="/account/coins" class="btn btn--secondary btn--sm font-bold text-xs">
      🪙 ${isBn ? 'আমার কয়েন ওয়ালেট' : 'Coin Wallet'}
    </a>
  `;
  container.appendChild(incentiveBanner);

  // 4. Tabs Navigation
  const tabsBar = document.createElement('div');
  tabsBar.className = 'reviews-tabs';
  tabsBar.innerHTML = `
    <button class="reviews-tab-btn ${activeTab === 'pending' ? 'reviews-tab-btn--active' : ''}" data-tab="pending" type="button">
      <span>📝 ${t('customer_reviews.tab_to_review')}</span>
      <span class="reviews-tab-badge" id="badge-pending">${kpis.pending_count}</span>
    </button>
    <button class="reviews-tab-btn ${activeTab === 'published' ? 'reviews-tab-btn--active' : ''}" data-tab="published" type="button">
      <span>⭐ ${t('customer_reviews.tab_my_reviews')}</span>
      <span class="reviews-tab-badge" id="badge-published">${kpis.total_reviews}</span>
    </button>
    <button class="reviews-tab-btn ${activeTab === 'media' ? 'reviews-tab-btn--active' : ''}" data-tab="media" type="button">
      <span>🎥 ${t('customer_reviews.tab_ugc_media')}</span>
      <span class="reviews-tab-badge" id="badge-media">0</span>
    </button>
  `;
  container.appendChild(tabsBar);

  tabsBar.querySelectorAll('.reviews-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      tabsBar.querySelectorAll('.reviews-tab-btn').forEach((b) => b.classList.remove('reviews-tab-btn--active'));
      btn.classList.add('reviews-tab-btn--active');
      renderContent();
    });
  });

  // 5. Search & Filter Toolbar (Visible on published/media tabs)
  const toolbar = document.createElement('div');
  toolbar.className = 'reviews-toolbar';
  toolbar.innerHTML = `
    <div class="reviews-search-wrap">
      <span class="reviews-search-icon">🔍</span>
      <input
        type="text"
        class="reviews-search-input"
        placeholder="${t('customer_reviews.search_placeholder')}"
        value="${searchQuery}"
      />
    </div>
    <div class="flex items-center gap-2">
      <select class="reviews-filter-select" id="filter-rating">
        <option value="">${t('customer_reviews.filter_all_ratings')}</option>
        <option value="5">⭐⭐⭐⭐⭐ ${t('customer_reviews.filter_stars', { count: 5 })}</option>
        <option value="4">⭐⭐⭐⭐ ${t('customer_reviews.filter_stars', { count: 4 })}</option>
        <option value="3">⭐⭐⭐ ${t('customer_reviews.filter_stars', { count: 3 })}</option>
        <option value="2">⭐⭐ ${t('customer_reviews.filter_stars', { count: 2 })}</option>
        <option value="1">⭐ ${t('customer_reviews.filter_stars', { count: 1 })}</option>
      </select>

      <select class="reviews-filter-select" id="filter-sort">
        <option value="newest">${t('customer_reviews.sort_newest')}</option>
        <option value="highest">${t('customer_reviews.sort_highest')}</option>
        <option value="helpful">${t('customer_reviews.sort_helpful')}</option>
        <option value="oldest">${t('customer_reviews.sort_oldest')}</option>
      </select>
    </div>
  `;
  container.appendChild(toolbar);

  const searchInput = toolbar.querySelector('.reviews-search-input');
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderContent();
  });

  const ratingSelect = toolbar.querySelector('#filter-rating');
  ratingSelect.addEventListener('change', (e) => {
    ratingFilter = e.target.value;
    renderContent();
  });

  const sortSelect = toolbar.querySelector('#filter-sort');
  sortSelect.addEventListener('change', (e) => {
    sortBy = e.target.value;
    renderContent();
  });

  // 6. Dynamic Content Area
  const contentArea = document.createElement('div');
  contentArea.className = 'reviews-list';
  container.appendChild(contentArea);

  root.appendChild(container);

  function openMediaLightbox(mediaItem) {
    const content = document.createElement('div');
    content.className = 'review-lightbox-modal';

    if (mediaItem.media_kind === 'VIDEO') {
      const video = document.createElement('video');
      video.src = mediaItem.url || '/media/sample-unboxing.mp4';
      video.controls = true;
      video.autoplay = true;
      video.style.maxWidth = '100%';
      video.style.maxHeight = '70vh';
      video.style.borderRadius = 'var(--radius-xl)';
      content.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = mediaItem.url || '/media/placeholder.webp';
      img.alt = 'Customer Review Photo';
      content.appendChild(img);
    }

    const modal = Modal({
      title: mediaItem.media_kind === 'VIDEO' ? '🎥 Video Unboxing' : '📸 Review Photo',
      content,
    });
    modal.open();
  }

  // Render content based on activeTab
  function renderContent() {
    contentArea.innerHTML = '';

    // Show toolbar only on published & media tabs
    toolbar.style.display = activeTab === 'pending' ? 'none' : 'flex';

    if (loading) {
      contentArea.append(
        Skeleton({ width: '100%', height: '100px' }),
        Skeleton({ width: '100%', height: '160px' }),
        Skeleton({ width: '100%', height: '160px' })
      );
      return;
    }

    if (activeTab === 'pending') {
      if (pendingData.length === 0) {
        contentArea.appendChild(
          EmptyState({
            title: t('customer_reviews.empty_pending_title'),
            description: t('customer_reviews.empty_pending_desc'),
          })
        );
        return;
      }

      pendingData.forEach((item) => {
        const card = PendingReviewCard({
          item,
          onWriteReview: (it) => {
            openWriteReviewModal({
              item: it,
              onSaved: () => loadAllData(),
            });
          },
        });
        contentArea.appendChild(card);
      });
      return;
    }

    if (activeTab === 'published') {
      let filtered = [...reviewsData];

      if (ratingFilter) {
        filtered = filtered.filter((r) => r.rating === Number(ratingFilter));
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        filtered = filtered.filter((r) => {
          return (
            (r.title && r.title.toLowerCase().includes(q)) ||
            (r.body && r.body.toLowerCase().includes(q)) ||
            (r.product_title_en && r.product_title_en.toLowerCase().includes(q)) ||
            (r.product_title_bn && r.product_title_bn.includes(q)) ||
            (r.product_ref && r.product_ref.toLowerCase().includes(q))
          );
        });
      }

      if (sortBy === 'highest') filtered.sort((a, b) => b.rating - a.rating);
      else if (sortBy === 'lowest') filtered.sort((a, b) => a.rating - b.rating);
      else if (sortBy === 'helpful') filtered.sort((a, b) => (b.helpful_count || 0) - (a.helpful_count || 0));
      else if (sortBy === 'oldest') filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      else filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      if (filtered.length === 0) {
        contentArea.appendChild(
          EmptyState({
            title: t('customer_reviews.empty_reviews_title'),
            description: t('customer_reviews.empty_reviews_desc'),
          })
        );
        return;
      }

      filtered.forEach((review) => {
        const card = CustomerReviewCard({
          review,
          onEdit: (rev) => {
            openWriteReviewModal({
              existingReview: rev,
              onSaved: () => loadAllData(),
            });
          },
          onDelete: (rev) => {
            confirmDialog({
              title: t('customer_reviews.delete_confirm_title'),
              description: t('customer_reviews.delete_confirm_desc'),
              confirmLabel: t('common.delete'),
              danger: true,
              onConfirm: async () => {
                try {
                  await customerApi.deleteReview(rev.id);
                  toast.success(t('customer_reviews.toast_deleted'));
                  loadAllData();
                } catch {
                  toast.error(t('customer_reviews.toast_error'));
                }
              },
            });
          },
        });
        contentArea.appendChild(card);
      });
      return;
    }

    if (activeTab === 'media') {
      // Gather all media from published reviews
      const allMedia = [];
      reviewsData.forEach((rev) => {
        (rev.media || []).forEach((m) => {
          allMedia.push({
            ...m,
            review_id: rev.id,
            product_title_en: rev.product_title_en,
            product_title_bn: rev.product_title_bn,
            product_ref: rev.product_ref,
            rating: rev.rating,
          });
        });
      });

      if (allMedia.length === 0) {
        contentArea.appendChild(
          EmptyState({
            title: t('customer_reviews.empty_ugc_title'),
            description: t('customer_reviews.empty_ugc_desc'),
          })
        );
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'ugc-media-grid';

      allMedia.forEach((m) => {
        const card = document.createElement('div');
        card.className = 'ugc-media-card';

        const title = (isBn && m.product_title_bn) ? m.product_title_bn : (m.product_title_en || 'Product');

        card.innerHTML = `
          <div class="ugc-media-card__media-wrap">
            <img class="ugc-media-card__img" src="${m.url || '/media/placeholder.webp'}" alt="${title}" loading="lazy" />
            <div class="ugc-media-card__badge">
              ${m.media_kind === 'VIDEO' ? '🎥 Video' : '📸 Photo'}
            </div>
          </div>
          <div class="ugc-media-card__info">
            <h4 class="ugc-media-card__title">${title}</h4>
            <div class="ugc-media-card__footer">
              <span>⭐ ${m.rating}.0</span>
              <a href="/product/${m.product_ref}" class="text-primary font-bold text-xs hover:underline">
                ${isBn ? 'পণ্য দেখুন →' : 'View Product →'}
              </a>
            </div>
          </div>
        `;

        card.querySelector('.ugc-media-card__media-wrap')?.addEventListener('click', () => {
          openMediaLightbox(m);
        });

        grid.appendChild(card);
      });

      contentArea.appendChild(grid);
    }
  }

  // Fetch all review and pending review data
  async function loadAllData() {
    loading = true;
    renderContent();

    try {
      const [reviewsRes, pendingRes] = await Promise.all([
        customerApi.getReviews().catch(() => ({ data: { reviews: [], kpis: {} } })),
        customerApi.getPendingReviews().catch(() => ({ data: { pending: [] } })),
      ]);

      reviewsData = reviewsRes?.data?.reviews || [];
      pendingData = pendingRes?.data?.pending || [];

      // Update KPI metrics
      kpis = reviewsRes?.data?.kpis || {
        total_reviews: reviewsData.length,
        coins_earned: reviewsData.reduce((sum, r) => sum + (r.coins_earned || 10), 0),
        helpful_votes: reviewsData.reduce((sum, r) => sum + (r.helpful_count || 0), 0),
        pending_count: pendingData.length,
      };

      if (kpis.pending_count === undefined) {
        kpis.pending_count = pendingData.length;
      }

      // Update Tab Badges
      const badgePending = container.querySelector('#badge-pending');
      if (badgePending) badgePending.textContent = kpis.pending_count;

      const badgePublished = container.querySelector('#badge-published');
      if (badgePublished) badgePublished.textContent = kpis.total_reviews;

      const badgeMedia = container.querySelector('#badge-media');
      const mediaCount = reviewsData.reduce((sum, r) => sum + (r.media ? r.media.length : 0), 0);
      if (badgeMedia) badgeMedia.textContent = mediaCount;

      // Auto default tab to published if no pending reviews
      if (pendingData.length === 0 && reviewsData.length > 0 && activeTab === 'pending') {
        activeTab = 'published';
        tabsBar.querySelectorAll('.reviews-tab-btn').forEach((b) => {
          b.classList.toggle('reviews-tab-btn--active', b.dataset.tab === 'published');
        });
      }

      // Check URL query parameters for tab and deep-linking
      const urlParams = new URLSearchParams(window.location.search);
      const requestedTab = urlParams.get('tab');
      const orderRef = urlParams.get('order_ref');
      const writeProductRef = urlParams.get('write_product_ref');

      if (requestedTab) {
        if (['pending', 'to_review'].includes(requestedTab)) activeTab = 'pending';
        else if (['published', 'my_reviews'].includes(requestedTab)) activeTab = 'published';
        else if (['media', 'ugc'].includes(requestedTab)) activeTab = 'media';
        
        tabsBar.querySelectorAll('.reviews-tab-btn').forEach((b) => {
          b.classList.toggle('reviews-tab-btn--active', b.dataset.tab === activeTab);
        });
      }

      // Deep link to automatically open review modal for requested order or product
      if (writeProductRef || orderRef) {
        const targetItem = pendingData.find(
          (p) => (writeProductRef && p.product_ref === writeProductRef) ||
                 (orderRef && (p.order_ref === orderRef || p.order_item_id === orderRef))
        );
        if (targetItem) {
          setTimeout(() => {
            openWriteReviewModal({
              item: targetItem,
              onSaved: () => loadAllData(),
            });
          }, 150);
        }
      }

      renderKPIs();
    } catch (err) {
      toast.error(t('customer_reviews.toast_error'));
    } finally {
      loading = false;
      renderContent();
    }
  }

  loadAllData();

  return () => {
    container.remove();
  };
}
