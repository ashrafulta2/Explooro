/**
 * FollowingFeedPage.js — Activity Feed & Product Drops from Followed Sellers (Prompt 11.3 / idea §AL.3).
 *
 * Implements:
 * 1. Product drops feed from followed merchant storefronts.
 * 2. Active & upcoming live-stream broadcasts with 1-click watch triggers.
 * 3. Merchant stories & UGC reels with shoppable tags.
 * 4. Followed shops manager and popular store discovery recommendations.
 * 5. Search, category filtering, shareable filter state, and a keyboard-navigable BEM layout.
 *
 * Route: /account/following
 */

import { customerApi } from '../../services/customer.api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatBdt, formatNumber, formatRelativeTime, formatDate } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';
import { resolveProductImage } from '../../components/product/ProductCard.js';
import { bindBackControl } from '../../core/navBack.js';

const TAB_KEYS = ['all', 'drops', 'live', 'stores', 'discover'];
const SEARCH_DEBOUNCE_MS = 200;

/**
 * Escapes text before it is interpolated into an innerHTML template.
 * WHY: shop names, bios and product titles are merchant-authored free text that reaches this page
 * straight from the database. Unescaped, a stray quote breaks the surrounding attribute and a
 * `<script>` in a bio executes. Every dynamic value below goes through this.
 */
function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Plural-aware translation. The i18n engine picks `<key>.one` / `<key>.other` from the numeric
 * `count`, so "1 shops saved" — which this page used to render literally — cannot happen.
 *
 * WHY two params: `count` must stay a Number for `Intl.PluralRules` to select the right variant,
 * while `{{n}}` carries the display string so Bangla renders Bangla numerals (১, ২, ৩) instead of
 * ASCII digits inside an otherwise Bangla sentence.
 */
function tn(key, count, fallback) {
  const n = Number(count) || 0;
  return t(key, fallback, { count: n, n: formatNumber(n) });
}

/**
 * A star rating to one decimal place, in the reader's numerals.
 * WHY not plain `formatNumber`: it pads every fraction to two decimals (money formatting), so a
 * 4.9-star store advertised itself as "4.90". Ratings arrive from the server already rounded to
 * one decimal, so a single trailing zero — Latin or Bengali — is the only thing to trim.
 */
function formatRating(value) {
  return formatNumber(value).replace(/[০0]$/, '');
}

/** Localised title for a record carrying `title_en` / `title_bn`. */
function localTitle(record, { enKey = 'title_en', bnKey = 'title_bn', fallbackKey = 'title' } = {}) {
  const isBn = getLanguage() === 'bn';
  const primary = isBn ? record[bnKey] : record[enKey];
  const secondary = isBn ? record[enKey] : record[bnKey];
  return primary || secondary || record[fallbackKey] || '';
}

export default function FollowingFeedPage(root, { navigate } = {}) {
  const nav = (url, opts = {}) => {
    if (typeof navigate === 'function') navigate(url, opts);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'following-page';

  // ---------------------------------------------------------------------------------------------
  // State — seeded from the URL so a filtered view is shareable and survives a reload.
  // ---------------------------------------------------------------------------------------------
  const initialParams = new URLSearchParams(window.location.search);
  const state = {
    tab: TAB_KEYS.includes(initialParams.get('tab')) ? initialParams.get('tab') : 'all',
    category: initialParams.get('cat') || 'all',
    query: initialParams.get('q') || '',
  };

  let feedData = null;
  let searchTimer = null;
  const pendingFollows = new Set();

  /**
   * WHY replaceState and not pushState: the app router re-renders the page on `popstate`, so
   * pushing a history entry per tab click would tear down and rebuild this view on Back. The URL
   * still updates, so the view is bookmarkable and shareable — it just isn't part of history.
   */
  function syncUrl() {
    const params = new URLSearchParams(window.location.search);
    const set = (key, value, fallback) => {
      if (value && value !== fallback) params.set(key, value);
      else params.delete(key);
    };
    set('tab', state.tab, 'all');
    set('cat', state.category, 'all');
    set('q', state.query, '');
    const qs = params.toString();
    history.replaceState(history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }

  // ---------------------------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------------------------
  const header = document.createElement('header');
  header.className = 'following-page__header';
  header.innerHTML = `
    <a href="/account" class="following-page__back">
      ← ${esc(t('customer.following.back_to_account', 'Account Dashboard'))}
    </a>
    <div class="following-page__title-wrap">
      <div>
        <h1 class="following-page__title">
          <span aria-hidden="true">🏪</span>
          ${esc(t('customer.following.title', 'Followed Stores & Activity Feed'))}
        </h1>
        <p class="following-page__subtitle">
          ${esc(t('customer.following.subtitle', 'Fresh product drops, live streams, stories & exclusive discounts from your favorite sellers.'))}
        </p>
      </div>
      <div class="following-page__header-actions">
        <button type="button" id="hdr-explore-live" class="btn btn--secondary btn--sm">
          <span aria-hidden="true">🔴</span> ${esc(t('customer.following.tab_live', 'Live Streams'))}
        </button>
        <button type="button" id="hdr-discover-stores" class="btn btn--primary btn--sm">
          <span aria-hidden="true">🌟</span> ${esc(t('customer.following.tab_discover', 'Discover Sellers'))}
        </button>
      </div>
    </div>
  `;
  container.append(header);

  bindBackControl(header.querySelector('.following-page__back'), nav, '/account');

  const contentSlot = document.createElement('div');
  contentSlot.className = 'following-content-slot';
  container.append(contentSlot);

  /**
   * Screen-reader announcement for filter results.
   * WHY: filtering rewrites the grid silently. Without a live region a keyboard/screen-reader user
   * types into search and gets no feedback that anything happened.
   */
  const liveRegion = document.createElement('p');
  liveRegion.className = 'sr-only';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  container.append(liveRegion);

  root.append(container);

  header.querySelector('#hdr-explore-live')?.addEventListener('click', () => switchTab('live'));
  header.querySelector('#hdr-discover-stores')?.addEventListener('click', () => switchTab('discover'));

  // ---------------------------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------------------------
  async function loadFeed({ showSkeleton = true } = {}) {
    if (showSkeleton) {
      contentSlot.replaceChildren(
        Skeleton({ width: '100%', height: '100px' }),
        Skeleton({ width: '100%', height: '48px' }),
        Skeleton({ width: '100%', height: '280px' })
      );
    }

    try {
      const res = await customerApi.getFollowingFeed();
      feedData = res.data || {};
      renderFeed();
    } catch {
      renderLoadError();
    }
  }

  function renderLoadError() {
    contentSlot.replaceChildren();
    const box = document.createElement('div');
    box.className = 'following-empty-card';
    box.innerHTML = `
      <div class="following-empty-card__icon-box" aria-hidden="true">⚠️</div>
      <h2 class="following-empty-card__title">
        ${esc(t('customer.following.load_failed', 'Failed to load your activity feed.'))}
      </h2>
    `;
    box.append(
      Button({
        label: t('customer.following.btn_retry', 'Try Again'),
        variant: 'primary',
        size: 'sm',
        onClick: () => loadFeed(),
      })
    );
    contentSlot.append(box);
  }

  function switchTab(tabKey) {
    state.tab = tabKey;
    syncUrl();
    renderFeed();
  }

  // ---------------------------------------------------------------------------------------------
  // Derived collections
  // ---------------------------------------------------------------------------------------------
  function collections() {
    return {
      followedStores: feedData?.followed_stores || [],
      suggestedStores: feedData?.suggested_stores || [],
      drops: feedData?.product_drops || [],
      liveStreams: feedData?.live_streams || [],
      stories: feedData?.stories || [],
    };
  }

  /**
   * Category options derived from the data the server actually returned.
   * WHY: the page used to hardcode five Bangla-market categories (fashion/handloom/electronics/
   * food) that no API response ever set, so selecting any of them matched nothing and blanked the
   * page. Options are now built from the categories present in the feed and always match something.
   */
  function categoryOptions() {
    const { followedStores, suggestedStores, drops, liveStreams } = collections();
    const isBn = getLanguage() === 'bn';
    const seen = new Map();

    const record = (key, labelEn, labelBn) => {
      if (!key) return;
      if (!seen.has(key)) {
        const label = (isBn ? labelBn : labelEn) || humanizeCategory(key);
        seen.set(key, label);
      }
    };

    drops.forEach((d) => record(d.category, d.category_name_en, d.category_name_bn));
    [...followedStores, ...suggestedStores, ...liveStreams].forEach((s) => record(s.category));

    return [
      { key: 'all', label: t('customer.following.cat_all', 'All Categories') },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([key, label]) => ({ key, label })),
    ];
  }

  function humanizeCategory(slug) {
    return String(slug)
      .split(/[-_.]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /** Search + category predicate applied to every collection. */
  function makeFilter() {
    const query = state.query.trim().toLowerCase();
    return (item) => {
      if (state.category !== 'all' && item.category !== state.category) return false;
      if (!query) return true;
      const haystack = [
        item.title_en,
        item.title_bn,
        item.title,
        item.shop_name,
        item.bio,
        item.slug,
        item.store_slug,
        item.category_name_en,
        item.category_name_bn,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    };
  }

  /** Counts shown on the tab badges — filtered, so a badge never contradicts what is on screen. */
  function filteredCounts() {
    const filter = makeFilter();
    const { followedStores, suggestedStores, drops, liveStreams } = collections();
    return {
      drops: drops.filter(filter).length,
      live: liveStreams.filter(filter).length,
      stores: followedStores.filter(filter).length,
      discover: suggestedStores.filter(filter).length,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------------------------
  let mainViewSlot = null;

  function renderFeed() {
    if (!feedData) return;

    // WHY: a tab change rebuilds the toolbar, which destroys the element the user is standing on.
    // Without this, arrowing along the tab strip moved the selection but dumped keyboard focus back
    // to the top of the page, and a follow/unfollow mid-search stole the caret out of the search box.
    const active = document.activeElement;
    const restoreTabFocus = !!active && contentSlot.contains(active) && active.getAttribute('role') === 'tab';
    const restoreSearchFocus = !!active && active.id === 'following-search-input';
    const caret = restoreSearchFocus ? active.selectionStart : null;

    contentSlot.replaceChildren();

    contentSlot.append(createKpiBar(feedData, switchTab));

    contentSlot.append(
      createToolbar({
        tabs: buildTabs(),
        categories: categoryOptions(),
        activeTab: state.tab,
        activeCategory: state.category,
        query: state.query,
        onTabChange: switchTab,
        onCategoryChange: (cat) => {
          state.category = cat;
          syncUrl();
          renderFeed();
        },
        onQueryChange: (value) => {
          state.query = value;
          syncUrl();
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => {
            renderActiveView();
            refreshTabBadges();
          }, SEARCH_DEBOUNCE_MS);
        },
      })
    );

    mainViewSlot = document.createElement('div');
    mainViewSlot.className = 'following-main-view';
    contentSlot.append(mainViewSlot);

    renderActiveView();

    if (restoreTabFocus) {
      contentSlot.querySelector('[role="tab"][aria-selected="true"]')?.focus();
    } else if (restoreSearchFocus) {
      const input = contentSlot.querySelector('#following-search-input');
      input?.focus();
      if (input && caret != null) input.setSelectionRange(caret, caret);
    }
  }

  function buildTabs() {
    const counts = filteredCounts();
    return [
      { key: 'all', label: t('customer.following.tab_all', 'All Activity'), count: null },
      { key: 'drops', label: t('customer.following.tab_drops', 'Product Drops'), count: counts.drops },
      { key: 'live', label: t('customer.following.tab_live', 'Live Streams'), count: counts.live },
      { key: 'stores', label: t('customer.following.tab_stores', 'Followed Stores'), count: counts.stores },
      { key: 'discover', label: t('customer.following.tab_discover', 'Discover Sellers'), count: counts.discover },
    ];
  }

  function refreshTabBadges() {
    const counts = filteredCounts();
    const map = { drops: counts.drops, live: counts.live, stores: counts.stores, discover: counts.discover };
    contentSlot.querySelectorAll('[data-tab-badge]').forEach((el) => {
      const key = el.getAttribute('data-tab-badge');
      if (key in map) el.textContent = formatNumber(map[key]);
    });
  }

  function announce(count) {
    liveRegion.textContent = state.query || state.category !== 'all'
      ? tn('customer.following.results_count', count, `${count} results`)
      : '';
  }

  function renderActiveView() {
    if (!mainViewSlot) return;
    mainViewSlot.replaceChildren();

    const filter = makeFilter();
    const { followedStores, suggestedStores, drops, liveStreams, stories } = collections();

    const filteredStores = followedStores.filter(filter);
    const filteredSuggestions = suggestedStores.filter(filter);
    const filteredDrops = drops.filter(filter);
    const filteredStreams = liveStreams.filter(filter);
    const filteredStories = stories.filter(filter);

    if (state.tab === 'all') {
      if (followedStores.length === 0) {
        renderEmptyOnboarding(mainViewSlot, suggestedStores);
        announce(filteredSuggestions.length);
        return;
      }

      const total =
        filteredStories.length + filteredStreams.length + filteredDrops.length + filteredStores.length;

      if (total === 0) {
        mainViewSlot.append(createNoResultsPlaceholder());
        announce(0);
        return;
      }

      if (filteredStories.length) mainViewSlot.append(createStoriesStrip(filteredStories, nav));
      if (filteredStreams.length) mainViewSlot.append(createLiveStreamsSection(filteredStreams, nav));
      if (filteredDrops.length) mainViewSlot.append(createProductDropsSection(filteredDrops, nav));
      if (filteredStores.length) {
        mainViewSlot.append(createFollowedStoresSection(filteredStores, nav, handleToggleFollow));
      }
      if (filteredSuggestions.length) {
        mainViewSlot.append(createDiscoverStoresSection(filteredSuggestions, nav, handleToggleFollow));
      }
      announce(total);
      return;
    }

    const views = {
      drops: [filteredDrops, () => createProductDropsSection(filteredDrops, nav)],
      live: [filteredStreams, () => createLiveStreamsSection(filteredStreams, nav)],
      stores: [filteredStores, () => createFollowedStoresSection(filteredStores, nav, handleToggleFollow)],
      discover: [
        filteredSuggestions,
        () => createDiscoverStoresSection(filteredSuggestions, nav, handleToggleFollow),
      ],
    };

    const [items, build] = views[state.tab] || views.drops;

    if (items.length === 0) {
      if (state.tab === 'stores' && followedStores.length === 0) {
        renderEmptyOnboarding(mainViewSlot, suggestedStores);
      } else if (state.tab === 'discover' && suggestedStores.length === 0) {
        mainViewSlot.append(createNoSuggestionsPlaceholder(nav));
      } else {
        mainViewSlot.append(createNoResultsPlaceholder());
      }
    } else {
      mainViewSlot.append(build());
    }
    announce(items.length);
  }

  // ---------------------------------------------------------------------------------------------
  // Follow / unfollow
  // ---------------------------------------------------------------------------------------------
  /**
   * WHY the optimistic swap instead of `loadFeed()`: refetching replaced the whole page with
   * skeletons on every follow click, throwing away scroll position and the user's place in the
   * list. The store now moves between the two local arrays immediately and the network call only
   * has to confirm it; a failure puts it back.
   */
  async function handleToggleFollow(store, triggerButton) {
    const storeId = store.id;
    if (pendingFollows.has(storeId)) return;

    const wasFollowing = (feedData.followed_stores || []).some((s) => s.id === storeId);

    if (wasFollowing) {
      const confirmed = await confirmDialog({
        title: t('customer.following.unfollow_confirm', 'Stop following {{shop}}?', {
          shop: store.shop_name,
        }),
        confirmLabel: t('customer.following.unfollow_confirm_ok', 'Unfollow'),
        // ConfirmDialog defaults to a hardcoded English "Cancel"; a Bangla dialog must not mix.
        cancelLabel: t('common.cancel', 'Cancel'),
        variant: 'danger',
        trigger: triggerButton || null,
      });
      if (!confirmed) return;
    }

    pendingFollows.add(storeId);
    if (triggerButton) {
      triggerButton.disabled = true;
      triggerButton.setAttribute('aria-busy', 'true');
    }

    const snapshot = {
      followed: [...(feedData.followed_stores || [])],
      suggested: [...(feedData.suggested_stores || [])],
    };

    // Optimistic move between the two lists.
    if (wasFollowing) {
      feedData.followed_stores = snapshot.followed.filter((s) => s.id !== storeId);
      feedData.suggested_stores = [{ ...store, is_following: false }, ...snapshot.suggested];
    } else {
      feedData.suggested_stores = snapshot.suggested.filter((s) => s.id !== storeId);
      feedData.followed_stores = [
        { ...store, is_following: true, followed_at: new Date().toISOString() },
        ...snapshot.followed,
      ];
    }
    renderFeed();

    try {
      const res = await customerApi.toggleFollow(storeId);
      const isNowFollowing = res.data?.is_following;
      const shopName = res.data?.shop_name || store.shop_name;

      toast.success(
        isNowFollowing
          ? t('customer.following.follow_toast', 'Now following {{shop}}', { shop: shopName })
          : t('customer.following.unfollow_toast', 'Unfollowed {{shop}}', { shop: shopName })
      );

      // Reconcile in the background — counts and suggestions are recomputed server-side.
      loadFeed({ showSkeleton: false });
    } catch {
      feedData.followed_stores = snapshot.followed;
      feedData.suggested_stores = snapshot.suggested;
      renderFeed();
      toast.error(t('customer.following.action_failed', 'Could not update. Please try again.'));
    } finally {
      pendingFollows.delete(storeId);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Empty states
  // ---------------------------------------------------------------------------------------------
  function renderEmptyOnboarding(targetSlot, suggestions) {
    const wrap = document.createElement('div');
    wrap.className = 'space-y-6';

    const card = document.createElement('div');
    card.className = 'following-empty-card';
    card.innerHTML = `
      <div class="following-empty-card__icon-box" aria-hidden="true">🏪</div>
      <h2 class="following-empty-card__title">
        ${esc(t('customer.following.no_stores_title', "You haven't followed any stores yet"))}
      </h2>
      <p class="following-empty-card__desc">
        ${esc(t('customer.following.no_stores_desc', 'Follow your favorite verified sellers to get notified of new product drops, exclusive flash discounts, and interactive live shopping streams.'))}
      </p>

      <div class="following-benefits-list">
        <div class="following-benefit-item">
          <span class="following-benefit-item__icon" aria-hidden="true">✨</span>
          <span class="following-benefit-item__text">${esc(t('customer.following.benefit_drops', 'Instant alerts on fresh product drops & restocks'))}</span>
        </div>
        <div class="following-benefit-item">
          <span class="following-benefit-item__icon" aria-hidden="true">🔴</span>
          <span class="following-benefit-item__text">${esc(t('customer.following.benefit_live', '1-click access to exclusive in-stream flash sales'))}</span>
        </div>
        <div class="following-benefit-item">
          <span class="following-benefit-item__icon" aria-hidden="true">🏷️</span>
          <span class="following-benefit-item__text">${esc(t('customer.following.benefit_discounts', 'Special follower-only vouchers & discounts'))}</span>
        </div>
      </div>
    `;

    // WHY: the old empty state listed three benefits and then stopped — no way forward from it.
    card.append(
      Button({
        label: t('customer.following.btn_explore_all', 'Explore All Sellers'),
        variant: 'primary',
        size: 'md',
        onClick: () => (suggestions.length ? switchTab('discover') : nav('/')),
      })
    );
    wrap.append(card);

    if (suggestions.length > 0) {
      wrap.append(createDiscoverStoresSection(suggestions, nav, handleToggleFollow));
    }

    targetSlot.append(wrap);
  }

  function createNoSuggestionsPlaceholder(navigateTo) {
    const box = document.createElement('div');
    box.className = 'following-empty-card';
    box.innerHTML = `
      <div class="following-empty-card__icon-box" aria-hidden="true">🌟</div>
      <h3 class="following-empty-card__title">
        ${esc(t('customer.following.no_suggestions_title', 'No sellers to suggest right now'))}
      </h3>
      <p class="following-empty-card__desc">
        ${esc(t('customer.following.no_suggestions_desc', 'Browse the marketplace and follow any storefront to start building your feed.'))}
      </p>
    `;
    box.append(
      Button({
        label: t('customer.following.browse_marketplace', 'Browse Marketplace'),
        variant: 'primary',
        size: 'sm',
        onClick: () => navigateTo('/'),
      })
    );
    return box;
  }

  function createNoResultsPlaceholder() {
    const box = document.createElement('div');
    box.className = 'following-empty-card';
    box.innerHTML = `
      <div class="following-empty-card__icon-box" aria-hidden="true">🔍</div>
      <h3 class="following-empty-card__title">
        ${esc(t('customer.following.no_filter_results_title', 'No matches found'))}
      </h3>
      <p class="following-empty-card__desc">
        ${esc(t('customer.following.no_filter_results_desc', 'Try a different search term, or switch to another category.'))}
      </p>
    `;
    box.append(
      Button({
        label: t('customer.following.btn_reset_filters', 'Reset Filters'),
        variant: 'secondary',
        size: 'sm',
        onClick: () => {
          state.query = '';
          state.category = 'all';
          syncUrl();
          renderFeed();
        },
      })
    );
    return box;
  }

  loadFeed();

  return () => {
    clearTimeout(searchTimer);
    container.remove();
  };
}

/* ================================================================================================
 * Section builders
 * ============================================================================================= */

/**
 * KPI telemetry tiles.
 * WHY these are <button>s: they were clickable <div>s with an onclick handler, which meant no Tab
 * stop, no Enter/Space activation and nothing announced to a screen reader.
 */
function createKpiBar(data, onCardClick) {
  const followedCount = (data.followed_stores || []).length;
  const dropsCount = (data.product_drops || []).length;
  const liveCount = (data.live_streams || []).length;
  const storiesCount = (data.stories || []).length;

  const kpis = [
    {
      label: t('customer.following.stat_followed_stores', 'Followed Stores'),
      value: followedCount,
      icon: '🏪',
      tab: 'stores',
      sub: tn('customer.following.stat_followed_stores_sub', followedCount, `${followedCount} shops saved`),
    },
    {
      label: t('customer.following.stat_new_drops', 'New Drops'),
      value: dropsCount,
      icon: '✨',
      tab: 'drops',
      sub: t('customer.following.stat_new_drops_sub', 'Freshly curated arrivals'),
    },
    {
      label: t('customer.following.stat_live_now', 'Live Broadcasts'),
      value: liveCount,
      icon: '🔴',
      tab: 'live',
      sub: t('customer.following.stat_live_now_sub', 'Interactive shopping'),
    },
    {
      label: t('customer.following.stat_stories', 'Merchant Stories'),
      value: storiesCount,
      icon: '📖',
      tab: 'all',
      sub: t('customer.following.stat_stories_sub', 'Short video updates'),
    },
  ];

  const grid = document.createElement('div');
  grid.className = 'following-kpis';

  kpis.forEach((k) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'following-kpi-card';
    card.setAttribute('aria-label', t('customer.following.kpi_hint', 'Show {{section}}', { section: k.label }));
    card.innerHTML = `
      <span class="following-kpi-card__head">
        <span class="following-kpi-card__label">${esc(k.label)}</span>
        <span class="following-kpi-card__icon" aria-hidden="true">${k.icon}</span>
      </span>
      <span class="following-kpi-card__val">${esc(formatNumber(k.value))}</span>
      <span class="following-kpi-card__sub">${esc(k.sub)}</span>
    `;
    card.addEventListener('click', () => onCardClick(k.tab));
    grid.append(card);
  });

  return grid;
}

/**
 * Tab strip, search box and category chips.
 * The tab strip is a real ARIA tablist with roving arrow-key focus.
 */
function createToolbar({
  tabs,
  categories,
  activeTab,
  activeCategory,
  query,
  onTabChange,
  onCategoryChange,
  onQueryChange,
}) {
  const wrap = document.createElement('div');
  wrap.className = 'following-toolbar';

  const tabStrip = document.createElement('div');
  tabStrip.className = 'following-tabs';
  tabStrip.setAttribute('role', 'tablist');
  tabStrip.setAttribute('aria-label', t('customer.following.tabs_label', 'Activity feed sections'));

  const tabButtons = tabs.map((tab) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(activeTab === tab.key));
    // Roving tabindex: only the selected tab is in the tab order; arrows move between them.
    btn.tabIndex = activeTab === tab.key ? 0 : -1;
    btn.className = `following-tab-btn ${activeTab === tab.key ? 'following-tab-btn--active' : ''}`;
    btn.innerHTML = `
      <span>${esc(tab.label)}</span>
      ${
        tab.count !== null
          ? `<span class="following-tab-badge" data-tab-badge="${esc(tab.key)}">${esc(formatNumber(tab.count))}</span>`
          : ''
      }
    `;
    btn.addEventListener('click', () => onTabChange(tab.key));
    tabStrip.append(btn);
    return btn;
  });

  tabStrip.addEventListener('keydown', (e) => {
    const currentIndex = tabButtons.indexOf(document.activeElement);
    if (currentIndex === -1) return;
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabButtons.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    tabButtons[nextIndex].focus();
    onTabChange(tabs[nextIndex].key);
  });

  wrap.append(tabStrip);

  const controlsRow = document.createElement('div');
  controlsRow.className = 'following-controls-row';

  // --- Search -----------------------------------------------------------------------------------
  const searchWrap = document.createElement('div');
  searchWrap.className = 'following-search-wrap';

  const searchId = 'following-search-input';
  const searchLabel = t('customer.following.search_label', 'Search your following feed');
  searchWrap.innerHTML = `
    <span class="following-search-icon" aria-hidden="true">🔍</span>
    <label class="sr-only" for="${searchId}">${esc(searchLabel)}</label>
    <input
      id="${searchId}"
      type="search"
      class="following-search-input"
      autocomplete="off"
      placeholder="${esc(t('customer.following.search_placeholder', 'Search followed stores, products, or tags...'))}"
      value="${esc(query || '')}"
    />
  `;
  const searchInput = searchWrap.querySelector('input');
  searchInput.addEventListener('input', (e) => onQueryChange(e.target.value));
  controlsRow.append(searchWrap);

  // --- Category chips ---------------------------------------------------------------------------
  const catPills = document.createElement('div');
  catPills.className = 'following-category-chips';
  catPills.setAttribute('role', 'group');
  catPills.setAttribute('aria-label', t('customer.following.categories_label', 'Filter by category'));

  categories.forEach((c) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `category-chip ${activeCategory === c.key ? 'category-chip--active' : ''}`;
    pill.setAttribute('aria-pressed', String(activeCategory === c.key));
    pill.textContent = c.label;
    pill.addEventListener('click', () => onCategoryChange(c.key));
    catPills.append(pill);
  });
  controlsRow.append(catPills);

  wrap.append(controlsRow);
  return wrap;
}

/** Section header with a decorative icon and an optional "view all" link. */
function sectionHeader({ icon, title, subtitle, linkHref, linkLabel, blockClass }) {
  const head = document.createElement('div');
  head.className = `${blockClass}__header`;
  head.innerHTML = `
    <div>
      <h3 class="${blockClass}__title">
        <span aria-hidden="true">${icon}</span> ${esc(title)}
      </h3>
      ${subtitle ? `<p class="text-xs text-muted mt-0.5">${esc(subtitle)}</p>` : ''}
    </div>
    ${
      linkHref
        ? `<a href="${esc(linkHref)}" class="text-xs font-bold text-primary hover:underline">${esc(linkLabel)}</a>`
        : ''
    }
  `;
  return head;
}

function createStoriesStrip(stories, nav) {
  const section = document.createElement('section');
  section.className = 'stories-section';
  section.append(
    sectionHeader({
      icon: '📖',
      title: t('customer.following.stories_title', 'Merchant Stories & Reels'),
      linkHref: '/stories',
      linkLabel: t('customer.following.all_stories_link', 'View All Stories →'),
      blockClass: 'stories-section',
    })
  );

  const strip = document.createElement('div');
  strip.className = 'stories-strip';

  stories.forEach((st) => {
    const title = localTitle(st);
    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'story-bubble-card';
    bubble.setAttribute(
      'aria-label',
      `${title} — ${st.shop_name || ''} · ${tn('customer.following.story_views', st.view_count || 0, `${st.view_count || 0} views`)}`
    );
    bubble.addEventListener('click', () => nav(st.slug ? `/stories/${st.slug}` : '/stories'));

    const cover = st.cover_image_url || resolveProductImage(st);
    bubble.innerHTML = `
      <span class="story-bubble-ring">
        <img src="${esc(cover)}" alt="" class="story-bubble-thumb" loading="lazy" onerror="this.src='/placeholder-product.svg'"/>
      </span>
      <span class="story-bubble-name">${esc(st.shop_name || title)}</span>
    `;
    strip.append(bubble);
  });

  section.append(strip);
  return section;
}

function createLiveStreamsSection(streams, nav) {
  const section = document.createElement('section');
  section.className = 'live-feed-section';
  section.append(
    sectionHeader({
      icon: '🔴',
      title: t('customer.following.live_title', 'Active Live Broadcasts'),
      linkHref: '/live',
      linkLabel: t('customer.following.all_live_link', 'View All Live →'),
      blockClass: 'live-feed-section',
    })
  );

  const grid = document.createElement('div');
  grid.className = 'live-broadcasts-grid';

  streams.forEach((stream) => {
    const isLive = stream.status === 'LIVE';
    const title = localTitle(stream);
    const card = document.createElement('article');
    card.className = `following-live-card ${isLive ? '' : 'following-live-card--scheduled'}`;

    // WHY scheduled_at is rendered: a "SCHEDULED" badge with no time told the customer nothing
    // actionable. The server already returned the timestamp; it was simply never displayed.
    const whenLabel = isLive
      ? tn('customer.following.live_viewers', stream.viewer_count || 0, `${stream.viewer_count || 0} watching`)
      : stream.scheduled_at
        ? t('customer.following.live_starts', 'Starts {{when}}', {
            when: formatRelativeTime(stream.scheduled_at, { lang: getLanguage() }),
          })
        : t('customer.following.live_starts_unknown', 'Time to be announced');

    card.innerHTML = `
      <div>
        <div class="following-live-card__head">
          <span class="following-live-badge ${isLive ? '' : 'following-live-badge--scheduled'}">
            ${isLive ? '<span class="pulse-dot-red" aria-hidden="true"></span>' : '<span aria-hidden="true">⏰</span>'}
            ${esc(
              isLive
                ? t('customer.following.live_badge_live', 'LIVE')
                : t('customer.following.live_badge_scheduled', 'SCHEDULED')
            )}
          </span>
          <span class="following-live-card__viewers">
            <span aria-hidden="true">${isLive ? '👥' : '🗓️'}</span> ${esc(whenLabel)}
          </span>
        </div>
        <div class="following-live-card__body mt-2">
          <h4 class="following-live-card__title">${esc(title)}</h4>
          <div class="following-live-card__store mt-1">
            <span aria-hidden="true">🏪</span>
            <span>${esc(stream.shop_name || '')}</span>
          </div>
          ${
            !isLive && stream.scheduled_at
              ? `<p class="following-live-card__schedule">${esc(formatDate(stream.scheduled_at, { lang: getLanguage(), dateStyle: 'medium' }))}</p>`
              : ''
          }
        </div>
      </div>
    `;

    card.append(
      Button({
        label: isLive
          ? t('customer.following.btn_watch_live', 'Watch & Order Live')
          : t('customer.following.btn_view_schedule', 'View Broadcast'),
        variant: isLive ? 'primary' : 'secondary',
        size: 'sm',
        fullWidth: true,
        onClick: () => nav(`/live/${stream.id}`),
      })
    );
    grid.append(card);
  });

  section.append(grid);
  return section;
}

function createProductDropsSection(drops, nav) {
  const section = document.createElement('section');
  section.className = 'drops-feed-section';
  section.append(
    sectionHeader({
      icon: '✨',
      title: t('customer.following.drops_title', 'Fresh Product Drops'),
      subtitle: t('customer.following.drops_subtitle', 'Recently curated arrivals from followed merchant storefronts.'),
      blockClass: 'drops-feed-section',
    })
  );

  const grid = document.createElement('div');
  grid.className = 'product-drops-grid';

  drops.forEach((drop) => {
    const card = document.createElement('article');
    card.className = 'product-drop-card';

    const title = localTitle(drop);
    // WHY computed here: the server sends `dropped_at`; the page used to expect a pre-baked
    // `drop_time_label` string that no API ever returned, so every card read a literal "New Drop".
    const dropTime = drop.dropped_at
      ? formatRelativeTime(drop.dropped_at, { lang: getLanguage() })
      : t('customer.following.card_new_drop', 'New drop');

    const outOfStock = drop.stock_status === 'OUT_OF_STOCK';

    card.innerHTML = `
      <div class="product-drop-card__media">
        <img src="${esc(resolveProductImage(drop))}" alt="${esc(title)}" class="product-drop-card__img" loading="lazy" onerror="this.src='/placeholder-product.svg'"/>
        <span class="product-drop-card__badge">${esc(dropTime)}</span>
        ${outOfStock ? `<span class="product-drop-card__stock">${esc(t('customer.following.card_out_of_stock', 'Out of stock'))}</span>` : ''}
      </div>
      <div class="product-drop-card__body">
        <div class="product-drop-card__store-row">
          <a href="/store/${esc(drop.store_slug)}" class="product-drop-card__store-link">
            <span aria-hidden="true">🏪</span> ${esc(drop.shop_name || '')}
          </a>
          ${
            drop.discount_pct
              ? `<span class="badge badge--warning product-drop-card__discount">${esc(
                  t('customer.following.card_discount', '{{pct}}% off', { pct: drop.discount_pct })
                )}</span>`
              : ''
          }
        </div>
        <h4 class="product-drop-card__title">${esc(title)}</h4>
        <div class="product-drop-card__pricing">
          <span class="product-drop-card__price">${esc(formatBdt(drop.retail_price))}</span>
          ${
            drop.original_price
              ? `<span class="product-drop-card__was">${esc(formatBdt(drop.original_price))}</span>`
              : ''
          }
        </div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.className = 'product-drop-card__footer';
    footer.append(
      Button({
        label: t('customer.following.btn_view_product', 'View Product →'),
        variant: 'primary',
        size: 'sm',
        fullWidth: true,
        ariaLabel: `${t('customer.following.btn_view_product', 'View Product →')} — ${title}`,
        onClick: () => nav(`/product/${drop.slug || drop.product_id}`),
      })
    );
    card.append(footer);
    grid.append(card);
  });

  section.append(grid);
  return section;
}

/**
 * Store trust metrics.
 * WHY every metric is conditional: the previous card printed `rating || '4.8'` and
 * `followers_count || 500`, so an unrated brand-new storefront advertised a 4.8-star rating and
 * 500+ followers it had never earned. A metric with no real value is now omitted, not invented.
 */
function storeMetaBar(store) {
  const items = [];

  items.push(
    `<span class="store-card__meta-item"><span aria-hidden="true">📦</span><span>${esc(
      tn('customer.following.card_products', store.total_products || 0, `${store.total_products || 0} products`)
    )}</span></span>`
  );

  if (store.rating != null && store.rating_count > 0) {
    items.push(
      `<span class="store-card__meta-item"><span aria-hidden="true">⭐</span><span>${esc(
        t('customer.following.card_rating', '{{rating}} ({{count}} reviews)', {
          rating: formatRating(store.rating),
          count: formatNumber(store.rating_count),
        })
      )}</span></span>`
    );
  } else {
    items.push(
      `<span class="store-card__meta-item store-card__meta-item--muted"><span aria-hidden="true">⭐</span><span>${esc(
        t('customer.following.card_rating_none', 'Not yet rated')
      )}</span></span>`
    );
  }

  if (typeof store.followers_count === 'number') {
    items.push(
      `<span class="store-card__meta-item"><span aria-hidden="true">👥</span><span>${esc(
        tn('customer.following.card_followers', store.followers_count, `${store.followers_count} followers`)
      )}</span></span>`
    );
  }

  if (store.has_physical_shop && store.open_status) {
    const isOpen = store.open_status === 'OPEN';
    items.push(
      `<span class="store-card__meta-item"><span aria-hidden="true">${isOpen ? '🟢' : '⚪'}</span><span>${esc(
        isOpen ? t('customer.following.card_open', 'Open now') : t('customer.following.card_closed', 'Closed')
      )}</span></span>`
    );
  }

  return `<div class="store-card__meta-bar mt-3">${items.join('')}</div>`;
}

function storeCardMarkup(store, { fallbackIcon }) {
  const verifiedLabel = t('customer.following.card_verified', 'Verified merchant');
  return `
    <div>
      <div class="store-card__header">
        <div class="store-card__avatar" aria-hidden="true">${esc(store.avatar_icon || fallbackIcon)}</div>
        <div class="store-card__info">
          <div class="store-card__name-row">
            <h4 class="store-card__name">${esc(store.shop_name || '')}</h4>
            ${
              store.is_verified
                ? `<span class="store-card__verified-badge" title="${esc(verifiedLabel)}"><span aria-hidden="true">✓</span><span class="sr-only">${esc(verifiedLabel)}</span></span>`
                : ''
            }
          </div>
          <div class="store-card__slug">@${esc(store.slug || '')}</div>
          <p class="store-card__bio">${esc(
            store.bio || t('customer.following.card_no_bio', 'This seller has not added a description yet.')
          )}</p>
        </div>
      </div>
      ${storeMetaBar(store)}
    </div>
  `;
}

function createFollowedStoresSection(stores, nav, onToggleFollow) {
  const section = document.createElement('section');
  section.className = 'stores-manager-section';
  section.append(
    sectionHeader({
      icon: '🏪',
      title: `${t('customer.following.stores_title', 'My Followed Stores')} (${formatNumber(stores.length)})`,
      subtitle: t('customer.following.stores_subtitle', 'Your saved and trusted Bangladeshi online shops.'),
      blockClass: 'stores-manager-section',
    })
  );

  const grid = document.createElement('div');
  grid.className = 'stores-grid';

  stores.forEach((st) => {
    const card = document.createElement('article');
    card.className = 'store-card';
    card.innerHTML = storeCardMarkup(st, { fallbackIcon: '🏪' });

    const actions = document.createElement('div');
    actions.className = 'store-card__actions';

    const visitBtn = Button({
      label: t('customer.following.btn_visit_store', 'Visit Storefront →'),
      variant: 'primary',
      size: 'sm',
      ariaLabel: `${t('customer.following.btn_visit_store', 'Visit Storefront →')} — ${st.shop_name}`,
      onClick: () => nav(`/store/${st.slug}`),
    });

    const unfollowBtn = Button({
      label: t('customer.following.btn_unfollow', 'Unfollow'),
      variant: 'secondary',
      size: 'sm',
      ariaLabel: `${t('customer.following.btn_unfollow', 'Unfollow')} — ${st.shop_name}`,
    });
    unfollowBtn.addEventListener('click', () => onToggleFollow(st, unfollowBtn));

    actions.append(visitBtn, unfollowBtn);
    card.append(actions);
    grid.append(card);
  });

  section.append(grid);
  return section;
}

function createDiscoverStoresSection(stores, nav, onToggleFollow) {
  const section = document.createElement('section');
  section.className = 'discover-sellers-section';
  section.append(
    sectionHeader({
      icon: '🌟',
      title: t('customer.following.discover_title', 'Discover Top Rated Sellers'),
      subtitle: t('customer.following.discover_subtitle', 'Verified stores with artisan goods, handloom sarees, gadgets & organics.'),
      blockClass: 'discover-sellers-section',
    })
  );

  const grid = document.createElement('div');
  grid.className = 'stores-grid';

  stores.forEach((st) => {
    const card = document.createElement('article');
    card.className = 'store-card';
    card.innerHTML = storeCardMarkup(st, { fallbackIcon: '✨' });

    const actions = document.createElement('div');
    actions.className = 'store-card__actions';

    const visitBtn = Button({
      label: t('customer.following.btn_visit_store', 'Visit Storefront →'),
      variant: 'secondary',
      size: 'sm',
      ariaLabel: `${t('customer.following.btn_visit_store', 'Visit Storefront →')} — ${st.shop_name}`,
      onClick: () => nav(`/store/${st.slug}`),
    });

    const followBtn = Button({
      label: t('customer.following.btn_follow', 'Follow Store'),
      variant: 'primary',
      size: 'sm',
      ariaLabel: `${t('customer.following.btn_follow', 'Follow Store')} — ${st.shop_name}`,
    });
    followBtn.addEventListener('click', () => onToggleFollow(st, followBtn));

    actions.append(visitBtn, followBtn);
    card.append(actions);
    grid.append(card);
  });

  section.append(grid);
  return section;
}
