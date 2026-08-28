/**
 * FollowingFeedPage.js — Activity Feed & Product Drops from Followed Sellers (Prompt 11.3 / idea §AL.3).
 *
 * Implements:
 * 1. Product drops feed from followed merchant storefronts.
 * 2. Active & upcoming live-stream broadcasts with 1-click watch triggers.
 * 3. Merchant stories & UGC reels with shoppable tags.
 * 4. Followed shops manager and popular store discovery recommendations.
 *
 * Route: /account/following
 */

import { customerApi } from '../../services/customer.api.js';
import { t } from '../../services/i18n.js';
import { formatCurrency, formatNumber } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { resolveProductImage } from '../../components/product/ProductCard.js';

export default function FollowingFeedPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'following-feed-page container mx-auto p-4 md:p-6 space-y-6 max-w-6xl';

  // 1. Header
  const header = document.createElement('div');
  header.className = 'flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-5';
  header.innerHTML = `
    <div>
      <div class="flex items-center gap-2 mb-1">
        <a href="/account" class="text-xs font-bold text-primary hover:underline flex items-center gap-1">
          ← ${t('customer.following.back_to_account', 'ড্যাশবোর্ড')}
        </a>
      </div>
      <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
        ${t('customer.following.title', 'পছন্দের দোকান ও নতুন পণ্যের ফিড')}
      </h1>
      <p class="text-xs md:text-sm text-muted mt-1">
        ${t('customer.following.subtitle', 'আপনার ফলো করা দোকানগুলোর নতুন পণ্য, লাইভ স্ট্রিম ও এক্সক্লুসিভ অফার।')}
      </p>
    </div>
  `;
  container.append(header);

  // Content Slot
  const contentSlot = document.createElement('div');
  contentSlot.className = 'space-y-6';
  container.append(contentSlot);
  root.append(container);

  async function loadFeed() {
    contentSlot.innerHTML = '';
    contentSlot.append(
      Skeleton({ width: '100%', height: '140px' }),
      Skeleton({ width: '100%', height: '240px' })
    );

    try {
      const res = await customerApi.getFollowingFeed();
      const feed = res.data || {};
      renderFollowingFeed(contentSlot, feed, nav, loadFeed);
    } catch (err) {
      contentSlot.innerHTML = '';
      const errBox = document.createElement('div');
      errBox.className = 'py-8 text-center text-danger';
      errBox.textContent = t('customer.following.load_failed', 'ফিড লোড করতে ব্যর্থ হয়েছে।');
      contentSlot.append(errBox);
    }
  }

  loadFeed();

  return () => {
    container.remove();
  };
}

/**
 * Renders complete Following Feed view.
 */
function renderFollowingFeed(container, feed, nav, refreshFeed) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'space-y-8';

  const followedStores = feed.followed_stores || [];
  const suggestedStores = feed.suggested_stores || [];
  const drops = feed.product_drops || [];
  const liveStreams = feed.live_streams || [];
  const stories = feed.stories || [];

  // 1. Live Broadcasts (if any)
  if (liveStreams.length > 0) {
    renderLiveStreamsSection(wrap, liveStreams, nav);
  }

  // 2. Product Drops Feed
  if (drops.length > 0) {
    renderProductDropsSection(wrap, drops, nav);
  }

  // 3. Merchant Stories & UGC Reels (if any)
  if (stories.length > 0) {
    renderStoriesSection(wrap, stories, nav);
  }

  // 4. Followed Stores List or Suggested Stores
  if (followedStores.length > 0) {
    renderFollowedStoresManager(wrap, followedStores, nav, refreshFeed);
  } else {
    renderSuggestedStoresDiscovery(wrap, suggestedStores, nav, refreshFeed);
  }

  container.append(wrap);
}

/**
 * 1. Live Streams Section
 */
function renderLiveStreamsSection(container, streams, nav) {
  const section = document.createElement('div');
  section.className = 'space-y-3';

  section.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
        <h3 class="text-base font-extrabold text-foreground">
          ${t('customer.following.live_title', '🔴 এখন লাইভ সম্প্রচার চলছে')}
        </h3>
      </div>
      <a href="/live" class="text-xs font-bold text-primary hover:underline">সব লাইভ দেখুন →</a>
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4';

  streams.forEach((stream) => {
    const card = document.createElement('div');
    card.className = 'p-4 rounded-2xl border border-red-500/30 bg-surface shadow-xs space-y-3 flex flex-col justify-between';
    card.innerHTML = `
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="badge badge--danger text-[10px] font-bold">🔴 LIVE</span>
          <span class="text-[11px] text-muted font-mono">👥 ${stream.viewer_count} watching</span>
        </div>
        <h4 class="text-sm font-bold text-foreground line-clamp-1">${stream.title}</h4>
        <div class="text-xs text-muted font-medium">🏪 ${stream.shop_name}</div>
      </div>
    `;

    const watchBtn = Button({
      label: '🎬 লাইভ দেখুন ও অর্ডার করুন',
      variant: 'primary',
      size: 'xs',
      className: 'w-full',
      onClick: () => nav(`/live/${stream.id}`),
    });

    card.append(watchBtn);
    grid.append(card);
  });

  section.append(grid);
  container.append(section);
}

/**
 * 2. Product Drops Section
 */
function renderProductDropsSection(container, drops, nav) {
  const section = document.createElement('div');
  section.className = 'space-y-3';

  section.innerHTML = `
    <div class="flex items-center justify-between border-b border-subtle pb-2">
      <div>
        <h3 class="text-base font-extrabold text-foreground">
          ✨ ${t('customer.following.drops_title', 'পছন্দের দোকানের নতুন পণ্য (Product Drops)')}
        </h3>
        <p class="text-xs text-muted">আপনার ফলো করা সেলারদের সদ্য যুক্ত হওয়া কালেকশন।</p>
      </div>
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4';

  drops.forEach((drop) => {
    const card = document.createElement('div');
    card.className = 'p-3 rounded-2xl border border-subtle bg-surface shadow-xs hover:border-primary/40 transition-all flex flex-col justify-between space-y-2';

    card.innerHTML = `
      <div class="space-y-2">
        <div class="w-full aspect-square rounded-xl bg-subtle overflow-hidden relative">
          <img src="${resolveProductImage(drop)}" alt="${drop.title_en || drop.title_bn || ''}" class="w-full h-full object-cover" onerror="this.src='/placeholder-product.svg'"/>
          <span class="absolute top-2 left-2 badge badge--primary text-[9px] font-bold">New</span>
        </div>
        <div>
          <div class="text-xs font-bold text-foreground line-clamp-1">${drop.title_bn || drop.title_en}</div>
          <div class="text-[11px] text-muted truncate">🏪 ${drop.shop_name}</div>
          <div class="text-sm font-extrabold text-foreground font-mono mt-1">৳${drop.retail_price}</div>
        </div>
      </div>
    `;

    const buyBtn = Button({
      label: 'পণ্য দেখুন →',
      variant: 'primary',
      size: 'xs',
      className: 'w-full',
      onClick: () => nav(`/product/${drop.slug || drop.product_id}`),
    });

    card.append(buyBtn);
    grid.append(card);
  });

  section.append(grid);
  container.append(section);
}

/**
 * 3. Merchant Stories Section
 */
function renderStoriesSection(container, stories, nav) {
  const section = document.createElement('div');
  section.className = 'space-y-3';

  section.innerHTML = `
    <div class="flex items-center justify-between">
      <h3 class="text-base font-extrabold text-foreground">
        📖 ${t('customer.following.stories_title', 'সেলারদের ভিডিও ও গল্প (Stories)')}
      </h3>
      <a href="/stories" class="text-xs font-bold text-primary hover:underline">সব গল্প দেখুন →</a>
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3';

  stories.forEach((st) => {
    const card = document.createElement('div');
    card.className = 'cursor-pointer group space-y-1.5';
    card.onclick = () => nav(`/stories`);

    card.innerHTML = `
      <div class="w-full aspect-[9/16] rounded-2xl bg-slate-900 border border-subtle overflow-hidden relative shadow-xs group-hover:border-primary transition-all">
        <img src="${st.cover_image_url}" alt="${st.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform" onerror="this.src='/placeholder-product.svg'"/>
        <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2">
          <div class="text-[11px] font-bold text-white leading-tight line-clamp-2">${st.title}</div>
        </div>
      </div>
      <div class="text-[10px] text-muted truncate text-center">${st.shop_name}</div>
    `;

    grid.append(card);
  });

  section.append(grid);
  container.append(section);
}

/**
 * 4. Followed Stores Manager
 */
function renderFollowedStoresManager(container, stores, nav, refreshFeed) {
  const section = document.createElement('div');
  section.className = 'space-y-3 border-t border-subtle pt-6';

  section.innerHTML = `
    <div>
      <h3 class="text-base font-extrabold text-foreground">
        🏪 ${t('customer.following.stores_title', 'আমার ফলো করা দোকানসমূহ')} (${stores.length} টি)
      </h3>
      <p class="text-xs text-muted">আপনার সংরক্ষিত প্রিয় অনলাইন দোকানগুলো।</p>
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4';

  stores.forEach((st) => {
    const card = document.createElement('div');
    card.className = 'p-4 rounded-2xl border border-subtle bg-surface shadow-xs space-y-3 flex flex-col justify-between';

    card.innerHTML = `
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs font-mono text-primary font-bold">@${st.slug}</span>
          <span class="badge badge--neutral text-[10px]">${st.total_products} SKUs</span>
        </div>
        <h4 class="text-sm font-bold text-foreground">${st.shop_name}</h4>
        <p class="text-xs text-muted line-clamp-2">${st.bio || 'Official verified reseller.'}</p>
      </div>
    `;

    const btnRow = document.createElement('div');
    btnRow.className = 'flex items-center justify-between gap-2 pt-2 border-t border-subtle';

    const visitBtn = Button({
      label: 'দোকান ভিজিট →',
      variant: 'primary',
      size: 'xs',
      onClick: () => nav(`/store/${st.slug}`),
    });

    const unfollowBtn = Button({
      label: 'আনফলো',
      variant: 'secondary',
      size: 'xs',
      onClick: async () => {
        try {
          await customerApi.toggleFollow(st.id);
          toast.info(`${st.shop_name} আনফলো করা হয়েছে।`);
          refreshFeed();
        } catch {
          toast.error('ব্যর্থ হয়েছে।');
        }
      },
    });

    btnRow.append(visitBtn, unfollowBtn);
    card.append(btnRow);
    grid.append(card);
  });

  section.append(grid);
  container.append(section);
}

/**
 * 5. Suggested Stores Discovery (when following 0 stores)
 */
function renderSuggestedStoresDiscovery(container, suggestions, nav, refreshFeed) {
  const card = document.createElement('div');
  card.className = 'p-6 rounded-3xl border border-primary/20 bg-primary/5 space-y-5 text-center';

  card.innerHTML = `
    <div class="max-w-md mx-auto space-y-1">
      <div class="text-3xl">🏪</div>
      <h3 class="text-base font-extrabold text-foreground">
        ${t('customer.following.no_stores_title', 'আপনি এখনো কোনো দোকান ফলো করেননি')}
      </h3>
      <p class="text-xs text-muted">
        জনপ্রিয় দোকানগুলো ফলো করুন এবং তাদের নতুন পণ্য ও লাইভ স্ট্রিমের নোটিফিকেশন পান।
      </p>
    </div>
  `;

  if (suggestions.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-left';

    suggestions.forEach((st) => {
      const item = document.createElement('div');
      item.className = 'p-4 rounded-2xl border border-subtle bg-surface shadow-xs space-y-2 flex flex-col justify-between';

      item.innerHTML = `
        <div>
          <span class="text-[10px] font-mono text-primary font-bold">@${st.slug}</span>
          <div class="text-xs font-bold text-foreground mt-0.5">${st.shop_name}</div>
          <div class="text-[11px] text-muted">${st.total_products} টি পণ্য</div>
        </div>
      `;

      const followBtn = Button({
        label: '+ ফলো করুন',
        variant: 'primary',
        size: 'xs',
        className: 'w-full',
        onClick: async () => {
          try {
            await customerApi.toggleFollow(st.id);
            toast.success(`${st.shop_name} ফলো করা হয়েছে!`);
            refreshFeed();
          } catch {
            toast.error('ব্যর্থ হয়েছে।');
          }
        },
      });

      item.append(followBtn);
      grid.append(item);
    });

    card.append(grid);
  }

  container.append(card);
}
