/**
 * HomePage — the real marketplace home page, wired to the catalog API (Prompt 4.5).
 *
 * Replaces HomeStub.js (Prompt 1.5 temp page). This is the first "it looks like a product" moment.
 *
 * Architecture:
 *  - Reads role and module flags from appStore reactively — role changes update badge visibility
 *    without a page reload by re-rendering the grid on store subscription.
 *  - URL-backed state: `?feed=`, `?category=`, `?min_price=`, etc. Back button restores view.
 *  - Four feed tabs: All / Verified Supplier / Top Reseller / Flash Sales.
 *  - CategoryPills → filters the product grid.
 *  - FlashSaleWidget → only mounted when modules.flash_sale is on.
 *  - FilterPanel sidebar (desktop) / drawer (mobile).
 *  - ProductGrid → infinite scroll cursor pagination via GET /products.
 *
 * ACCEPTANCE gate:
 *  - 60 seeded products render with Bengali titles and ৳ formatting.
 *  - Switching to Saler role reveals margin badges without reload.
 *  - Turning off flash_sale module removes the widget instantly (re-render path).
 */

import { appStore } from '../state/appStore.js';
import { listProducts } from '../services/catalog.api.js';
import { adsApi } from '../services/ads.api.js';
import { t, getLanguage, subscribe as subscribeLang } from '../services/i18n.js';
import { isFeatureEnabled } from '../services/featureFlags.js';
import { Button } from '../components/ui/Button.js';
import { ProductGrid } from '../components/product/ProductGrid.js';
import { resolveProductImage } from '../components/product/ProductCard.js';
import { addToCart } from '../services/cart.js';
import { openQuickBuyModal } from '../components/cart/QuickBuyModal.js';
import { CategoryPills } from '../components/product/CategoryPills.js';
import { FlashSaleWidget } from '../components/product/FlashSaleWidget.js';
import { FilterPanel, countActiveFilters } from '../components/product/FilterPanel.js';
import { updateHead, buildWebsiteJsonLd } from '../services/seo.js';

// All categories derived from the product fixture — populated lazily from the first API response
const KNOWN_CATEGORIES = [
  { id: 'Clothing',        label_en: 'Clothing',        label_bn: 'পোশাক' },
  { id: 'Electronics',     label_en: 'Electronics',     label_bn: 'ইলেকট্রনিক্স' },
  { id: 'Bags',            label_en: 'Bags',            label_bn: 'ব্যাগ' },
  { id: 'Jewellery',       label_en: 'Jewellery',       label_bn: 'গহনা' },
  { id: 'Home & Kitchen',  label_en: 'Home & Kitchen',  label_bn: 'গৃহস্থালি' },
  { id: 'Footwear',        label_en: 'Footwear',        label_bn: 'জুতা' },
  { id: 'Kids',            label_en: 'Kids',            label_bn: 'শিশু পণ্য' },
  { id: 'Beauty & Health', label_en: 'Beauty & Health', label_bn: 'সৌন্দর্য ও স্বাস্থ্য' },
  { id: 'Food & Grocery',  label_en: 'Food & Grocery',  label_bn: 'খাদ্য ও মুদিখানা' },
  { id: 'Crafts',          label_en: 'Crafts',          label_bn: 'হস্তশিল্প' },
  { id: 'Wholesale',       label_en: 'Wholesale',       label_bn: 'পাইকারি' },
  { id: 'Furniture',       label_en: 'Furniture',       label_bn: 'আসবাবপত্র' },
];

const FEEDS = [
  { id: 'all',       i18n: 'marketplace.feed.all' },
  { id: 'verified',  i18n: 'marketplace.feed.verified' },
  { id: 'reseller',  i18n: 'marketplace.feed.reseller' },
  { id: 'flash',     i18n: 'marketplace.feed.flash' },
];

/** Read current URL state. */
function readURLState() {
  const sp = new URLSearchParams(window.location.search);
  return {
    feed: sp.get('feed') || 'all',
    category: sp.get('category') || 'all',
  };
}

/** Patch a single URL param without disturbing others, no history push. */
function setURLParam(key, value) {
  const sp = new URLSearchParams(window.location.search);
  if (value && value !== 'all') sp.set(key, value);
  else sp.delete(key);
  const newUrl = `${window.location.pathname}${sp.toString() ? '?' + sp.toString() : ''}`;
  window.history.replaceState(null, '', newUrl);
}

export default function HomePage(root, { navigate }) {
  const cleanups = [];

  const lang = getLanguage();
  const { auth, modules } = appStore.get();
  const role = auth.role || 'customer';

  // Prompt 11.5: Dynamic SEO Head & WebSite JSON-LD
  updateHead({
    title: t('marketplace.hero.tagline', 'Explooro — Bangladesh\'s #1 Social Commerce Platform'),
    description: t('marketplace.hero.sub', 'Buy from verified suppliers. Sell from your own branded store with zero upfront capital.'),
    canonicalPath: '/',
    locale: lang,
    jsonLd: buildWebsiteJsonLd(),
  });

  // ── Page root ───────────────────────────────────────────────────────────
  const page = document.createElement('div');
  page.className = 'home-page';

  // ── Hero banner ─────────────────────────────────────────────────────────
  const hero = document.createElement('div');
  hero.className = 'home-hero';
  const heroText = document.createElement('div');
  heroText.className = 'home-hero__text';
  const heroTagline = document.createElement('h1');
  heroTagline.className = 'home-hero__tagline';
  heroTagline.textContent = t('marketplace.hero.tagline');
  const heroSub = document.createElement('p');
  heroSub.className = 'home-hero__sub';
  heroSub.textContent = t('marketplace.hero.sub');
  const heroCta = Button({
    label: t('marketplace.hero.cta'),
    variant: 'secondary',
    onClick: () => navigate('/auth/register'),
  });
  heroText.append(heroTagline, heroSub, heroCta);
  hero.append(heroText);
  page.append(hero);

  // ── Feed switcher ───────────────────────────────────────────────────────
  let { feed: activeFeed, category: activeCategory } = readURLState();

  const feedBar = document.createElement('div');
  feedBar.className = 'feed-switcher';
  feedBar.setAttribute('role', 'tablist');
  feedBar.setAttribute('aria-label', t('marketplace.feed.label'));

  function syncFeed(feedId) {
    if (activeFeed === feedId) return;
    activeFeed = feedId;
    setURLParam('feed', activeFeed);
    for (const t of page.querySelectorAll('.feed-switcher__tab, .home-floating-toolbar__feed-tab')) {
      t.setAttribute('aria-selected', t.dataset.id === activeFeed ? 'true' : 'false');
    }
    rebuildGrid();
  }

  const feedTabs = [];
  for (const feedDef of FEEDS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'feed-switcher__tab';
    tab.setAttribute('role', 'tab');
    tab.dataset.id = feedDef.id;
    tab.textContent = t(feedDef.i18n);
    tab.setAttribute('aria-selected', feedDef.id === activeFeed ? 'true' : 'false');
    tab.addEventListener('click', () => syncFeed(feedDef.id));
    feedTabs.push(tab);
    feedBar.append(tab);
  }
  page.append(feedBar);

  // ── Category pills ──────────────────────────────────────────────────────
  const catLang = getLanguage();
  function syncCategory(catId) {
    activeCategory = catId;
    setURLParam('category', catId);
    for (const p of page.querySelectorAll('.category-pills__pill')) {
      p.setAttribute('aria-selected', p.dataset.id === catId ? 'true' : 'false');
    }
    rebuildGrid();
  }

  let pillsEl = CategoryPills({
    categories: KNOWN_CATEGORIES,
    selected: activeCategory,
    lang: catLang,
    onChange: (catId) => syncCategory(catId),
  });
  page.append(pillsEl);

  // ── Flash sale widget (module-gated) ────────────────────────────────────
  let flashWidgetCleanup = null;
  let flashSection = null;
  let flashMounting = false; // synchronous guard: set before the first await, closes the race gap

  async function mountFlashWidget(allProducts) {
    if (!isFeatureEnabled('flash_sale')) return;
    if (flashSection || flashMounting) return; // already mounted or mid-mount
    flashMounting = true;

    let flashList = allProducts?.filter((p) => p.is_flash_sale) || [];
    try {
      const [flashRes, adsRes] = await Promise.all([
        flashList.length === 0 ? listProducts({ flash_sale: '1', limit: 12 }).catch(() => null) : Promise.resolve(null),
        adsApi.listReservedPlacements('FLASH_STRIP').catch(() => ({ data: [] }))
      ]);

      if (flashRes?.products?.length > 0) {
        flashList = flashRes.products;
      }
      
      const reservedAds = adsRes?.data || [];
      if (reservedAds.length > 0) {
        const adProducts = reservedAds.map(ad => ({
          id: `ad_${ad.campaign_id}`,
          ref: ad.creative?.target_url?.split('/').pop() || '',
          title_en: ad.campaign_name || 'Sponsored Deal',
          title_bn: ad.campaign_name || 'Sponsored Deal',
          price: 999.00,
          special_price: 799.00,
          main_image: ad.creative?.image_url || 'https://placehold.co/400x400?text=AD',
          isSponsored: true,
          is_flash_sale: true,
          store: { shop_name: 'Sponsored Store' }
        }));
        flashList = [...adProducts, ...flashList];
      }
    } catch {
      // Fallback
    }

    if (flashList.length === 0) {
      flashList = allProducts || [];
    }

    const sec = document.createElement('div');
    sec.className = 'home-section';
    sec.setAttribute('data-module', 'flash_sale');

    // Flash sale ends at a fixed 4h window for demo; real data would come from API
    const { el, cleanup } = FlashSaleWidget({
      products: flashList,
      endsAt: Date.now() + 4 * 60 * 60 * 1000,
      role,
      modules,
      lang: getLanguage(),
      onNavigate: navigate,
      onAction: handleAction,
      onViewAll: () => {
        if (activeFeed !== 'flash') {
          syncFeed('flash');
        }
        catalogSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    });
    sec.append(el);

    // Insert before the catalog section
    if (catalogSection && catalogSection.parentNode === page) {
      page.insertBefore(sec, catalogSection);
    } else {
      page.append(sec);
    }
    flashSection = sec;
    flashWidgetCleanup = cleanup;
    cleanups.push(cleanup);
  }

  function unmountFlashWidget() {
    flashWidgetCleanup && flashWidgetCleanup();
    flashWidgetCleanup = null;
    flashSection && flashSection.remove();
    flashSection = null;
    flashMounting = false;
  }

  // ── Product catalog section ──────────────────────────────────────────────
  const catalogSection = document.createElement('div');
  catalogSection.className = 'home-catalog';
  page.append(catalogSection);

  // Filter panel (opened on-demand via the expandable drawer)
  const filterResult = FilterPanel({ role, lang: getLanguage(), onChange: () => rebuildGrid() });
  cleanups.push(filterResult.cleanup);

  // Grid column (full width uncluttered)
  const gridColumn = document.createElement('div');
  gridColumn.className = 'home-catalog__grid-col';
  catalogSection.append(gridColumn);

  // Toolbar (count + filter trigger button)
  const toolbar = document.createElement('div');
  toolbar.className = 'product-grid-toolbar';

  const toolbarLeft = document.createElement('div');
  toolbarLeft.className = 'product-grid-toolbar__left';

  const countLabel = document.createElement('span');
  countLabel.className = 'product-grid-toolbar__count';
  countLabel.textContent = '';
  toolbarLeft.append(countLabel);

  const searchPillWrap = document.createElement('div');
  searchPillWrap.className = 'product-grid-toolbar__search-pill-wrap';
  toolbarLeft.append(searchPillWrap);

  toolbar.append(toolbarLeft);

  const toolbarRight = document.createElement('div');
  toolbarRight.className = 'product-grid-toolbar__right';

  // Filter trigger button (convenient, uncluttered, expands drawer on demand)
  const filterTriggerBtn = document.createElement('button');
  filterTriggerBtn.type = 'button';
  filterTriggerBtn.className = 'filter-trigger';
  const filterIcon = document.createElement('span');
  filterIcon.setAttribute('aria-hidden', 'true');
  filterIcon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M7 12h10M11 18h2"/></svg>';
  const filterText = document.createElement('span');
  filterText.textContent = t('marketplace.filter.title');
  filterTriggerBtn.append(filterIcon, filterText);

  const filterBadge = document.createElement('span');
  filterBadge.className = 'filter-trigger__badge';
  filterTriggerBtn.append(filterBadge);

  function updateFilterBadge() {
    const activeCount = countActiveFilters();
    filterBadge.textContent = activeCount > 0 ? String(activeCount) : '';
    filterBadge.hidden = activeCount === 0;
  }
  updateFilterBadge();

  filterTriggerBtn.addEventListener('click', () => filterResult.openDrawer(filterTriggerBtn));
  toolbarRight.append(filterTriggerBtn);
  toolbar.append(toolbarRight);
  gridColumn.append(toolbar);

  // ── Product grid ─────────────────────────────────────────────────────────
  let currentGridCleanup = null;
  let currentGridEl = null;
  let allLoadedProducts = []; // collect for flash widget
  // WHY: rebuildGrid() can fire twice in quick succession (initial mount + the appStore
  // subscription firing once /modules resolves). Each builds a ProductGrid whose async first-page
  // fetch is still in flight when the next rebuild tears the grid down — but cleanup() only
  // disconnects the observer, it can't cancel that fetch. Both fetches then resolve and each calls
  // mountFlashWidget(), whose `if (flashSection) return` guard sits *before* an await, so both slip
  // through and two flash strips render. A monotonic generation stamps each rebuild; only the
  // latest generation's fetch runs the first-page side effects (flash mount, count, price bounds).
  let gridGeneration = 0;

  function updateSearchPill() {
    searchPillWrap.replaceChildren();
    const sp = new URLSearchParams(window.location.search);
    const activeSearch = sp.get('q');
    if (activeSearch) {
      const pill = document.createElement('span');
      pill.className = 'product-search-pill';
      pill.innerHTML = `
        <span>${t('marketplace.search_results_for', { query: activeSearch })}</span>
        <button type="button" class="product-search-pill__clear" aria-label="${t('marketplace.clear_search')}">✕</button>
      `;
      pill.querySelector('.product-search-pill__clear').addEventListener('click', () => {
        sp.delete('q');
        const newUrl = `${window.location.pathname}${sp.toString() ? '?' + sp.toString() : ''}`;
        window.history.replaceState(null, '', newUrl);
        const topSearch = document.querySelector('.topbar__product-search-input');
        if (topSearch) topSearch.value = '';
        rebuildGrid();
      });
      searchPillWrap.append(pill);
    }
  }

  function buildFetchPage(generation) {
    const sp = new URLSearchParams(window.location.search);

    /** Returns the mock-compatible query object from current URL state. */
    function buildQuery(cursor) {
      const q = {};
      if (cursor) q.cursor = cursor;
      q.limit = 20;
      const searchKeyword = sp.get('q');
      if (searchKeyword) q.q = searchKeyword;
      if (activeCategory && activeCategory !== 'all') q.category = activeCategory;
      if (activeFeed === 'flash') q.flash_sale = '1';
      else if (activeFeed === 'verified') q.supplier_tier = 'verified,elite';
      const minPrice = sp.get('min_price');
      const maxPrice = sp.get('max_price');
      if (minPrice) q.min_price = minPrice;
      if (maxPrice) q.max_price = maxPrice;
      if (sp.get('in_stock') === '1') q.in_stock = '1';
      const tiers = sp.getAll('tier');
      if (tiers.length) q.tier = tiers.join(',');
      if (sp.get('district')) q.district = sp.get('district');
      if (sp.get('min_rating')) q.min_rating = sp.get('min_rating');
      if (sp.get('min_margin')) q.min_margin = sp.get('min_margin');
      if (sp.get('sort')) q.sort = sp.get('sort');
      return q;
    }

    return async (cursor) => {
      const result = await listProducts(buildQuery(cursor));
      
      // Inject CATEGORY_BANNER ads on the first page if a category is selected
      if (!cursor && activeCategory && activeCategory !== 'all') {
        try {
          const adsRes = await adsApi.listReservedPlacements('CATEGORY_BANNER', activeCategory);
          const reservedAds = adsRes?.data || [];
          if (reservedAds.length > 0 && result?.products) {
            const adProducts = reservedAds.map(ad => ({
              id: `ad_${ad.campaign_id}`,
              ref: ad.creative?.target_url?.split('/').pop() || '',
              title_en: ad.campaign_name || 'Sponsored Category Ad',
              title_bn: ad.campaign_name || 'Sponsored Category Ad',
              price: 999.00,
              special_price: 799.00,
              main_image: ad.creative?.image_url || 'https://placehold.co/400x400?text=Category+AD',
              isSponsored: true,
              store: { shop_name: 'Sponsored Store' }
            }));
            result.products = [...adProducts, ...result.products];
          }
        } catch (err) {
          // Fallback
        }
      }

      // Collect products for flash widget on first page — but only for the newest grid. A stale
      // grid's in-flight fetch (see gridGeneration note above) must not mount a second flash strip
      // or clobber the count/price bounds the current grid already set.
      if (!cursor && result?.products && generation === gridGeneration) {
        allLoadedProducts = result.products;
        // Derive the price-slider bounds from the catalog. setPriceBounds only ever widens, so
        // successive (price-filtered) loads can't collapse the slider's range.
        const prices = allLoadedProducts
          .flatMap((p) => [p.price, p.special_price])
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0);
        if (prices.length) {
          filterResult.setPriceBounds(Math.min(...prices), Math.max(...prices));
        }
        mountFlashWidget(allLoadedProducts);
        const total = result.meta?.total ?? allLoadedProducts.length;
        countLabel.textContent = t('marketplace.product_count', { count: total });
      }
      return result;
    };
  }

  function rebuildGrid() {
    updateSearchPill();
    updateFilterBadge();
    updateFloatingBarState && updateFloatingBarState();

    // Tear down old grid
    if (currentGridCleanup) { currentGridCleanup(); currentGridCleanup = null; }
    currentGridEl && currentGridEl.remove();

    const generation = ++gridGeneration;
    const { el, cleanup } = ProductGrid({
      fetchPage: buildFetchPage(generation),
      role,
      modules,
      lang: getLanguage(),
      onNavigate: navigate,
      onAction: handleAction,
    });

    currentGridEl = el;
    currentGridCleanup = cleanup;
    gridColumn.append(el);
  }

  function handleAction(product, actionType) {
    if (actionType === 'quick_buy') {
      openQuickBuyModal({
        product,
        initialQty: 1,
        navigate,
      });
    } else {
      navigate(`/product/${product.ref || product.slug || product.id}`);
    }
  }

  // ── Floating Draggable "Browse & filter" Bar & Dropdown ────────────────────
  const floatingBar = document.createElement('div');
  floatingBar.className = 'home-floating-bar';
  floatingBar.title = t('discover.controls.drag_hint', 'Drag to move');

  const floatingToggle = document.createElement('button');
  floatingToggle.type = 'button';
  floatingToggle.className = 'home-floating-bar__toggle';
  floatingToggle.setAttribute('aria-expanded', 'false');

  const floatingIcon = document.createElement('span');
  floatingIcon.className = 'home-floating-bar__toggle-icon';
  floatingIcon.setAttribute('aria-hidden', 'true');
  floatingIcon.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M7 12h10M11 18h2"/></svg>';

  const floatingText = document.createElement('span');
  floatingText.className = 'home-floating-bar__toggle-text';
  floatingText.textContent = t('discover.controls.toggle', 'Browse & filter');

  const floatingActive = document.createElement('span');
  floatingActive.className = 'home-floating-bar__toggle-active';
  floatingActive.hidden = true;

  const floatingBadge = document.createElement('span');
  floatingBadge.className = 'home-floating-bar__toggle-badge';
  floatingBadge.hidden = true;

  const floatingChevron = document.createElement('span');
  floatingChevron.className = 'home-floating-bar__toggle-chevron';
  floatingChevron.setAttribute('aria-hidden', 'true');
  floatingChevron.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  floatingToggle.append(floatingIcon, floatingText, floatingActive, floatingBadge, floatingChevron);
  floatingBar.append(floatingToggle);
  page.append(floatingBar);

  // ── Floating Toolbar (Dropdown Panel) ──────────────────────────────────────
  const floatingToolbar = document.createElement('div');
  floatingToolbar.className = 'home-floating-toolbar';
  floatingToolbar.hidden = true;

  // 1. Feeds switcher row
  const feedsRow = document.createElement('div');
  feedsRow.className = 'home-floating-toolbar__feeds';
  for (const feedDef of FEEDS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'home-floating-toolbar__feed-tab';
    tab.dataset.id = feedDef.id;
    tab.textContent = t(feedDef.i18n);
    tab.setAttribute('aria-selected', feedDef.id === activeFeed ? 'true' : 'false');
    tab.addEventListener('click', () => syncFeed(feedDef.id));
    feedsRow.append(tab);
  }
  floatingToolbar.append(feedsRow);

  // 2. Category pills scroller
  const floatingPills = CategoryPills({
    categories: KNOWN_CATEGORIES,
    selected: activeCategory,
    lang: catLang,
    onChange: (catId) => {
      syncCategory(catId);
      setControlsOpen(false);
    },
  });
  floatingToolbar.append(floatingPills);

  // 3. Controls row (Search, Sort, Filters, Clear)
  const controlsRow = document.createElement('div');
  controlsRow.className = 'home-floating-toolbar__controls';

  // In-page quick search
  const searchForm = document.createElement('form');
  searchForm.className = 'home-floating-toolbar__search';
  searchForm.setAttribute('role', 'search');
  const searchIcon = document.createElement('span');
  searchIcon.className = 'home-floating-toolbar__search-icon';
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'home-floating-toolbar__search-input';
  searchInput.placeholder = t('marketplace.search_placeholder', 'Filter products...');
  searchInput.setAttribute('aria-label', t('marketplace.search_placeholder', 'Filter products...'));
  searchInput.autocomplete = 'off';
  searchInput.value = new URLSearchParams(window.location.search).get('q') || '';
  searchForm.append(searchIcon, searchInput);

  let searchTimer = null;
  function applyFloatingSearch() {
    setURLParam('q', searchInput.value.trim());
    rebuildGrid();
  }
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFloatingSearch, 300);
  });
  searchInput.addEventListener('search', applyFloatingSearch);
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    applyFloatingSearch();
  });
  controlsRow.append(searchForm);

  // Sort dropdown
  const sortWrap = document.createElement('div');
  sortWrap.className = 'home-floating-toolbar__sort';
  const sortIcon = document.createElement('span');
  sortIcon.setAttribute('aria-hidden', 'true');
  sortIcon.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>';
  const sortSelect = document.createElement('select');
  sortSelect.setAttribute('aria-label', t('product_detail.review.sort_label', 'Sort by'));
  const currentSort = new URLSearchParams(window.location.search).get('sort') || '';
  const sortOptions = [
    { value: '', label: t('marketplace.sort_featured', 'Featured') },
    { value: 'price_asc', label: t('marketplace.sort_price_asc', 'Price: Low to High') },
    { value: 'price_desc', label: t('marketplace.sort_price_desc', 'Price: High to Low') },
    { value: 'rating', label: t('marketplace.sort_rating', 'Highest Rated') },
    { value: 'newest', label: t('marketplace.sort_newest', 'Newest') },
  ];
  for (const opt of sortOptions) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === currentSort) o.selected = true;
    sortSelect.append(o);
  }
  sortSelect.addEventListener('change', () => {
    setURLParam('sort', sortSelect.value);
    rebuildGrid();
  });
  sortWrap.append(sortIcon, sortSelect);
  controlsRow.append(sortWrap);

  // Filter drawer button
  const filterBtn = document.createElement('button');
  filterBtn.type = 'button';
  filterBtn.className = 'home-floating-toolbar__filter-btn';
  const filterBtnIcon = document.createElement('span');
  filterBtnIcon.setAttribute('aria-hidden', 'true');
  filterBtnIcon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M7 12h10M11 18h2"/></svg>';
  const filterBtnText = document.createElement('span');
  filterBtnText.textContent = t('discover.filters.title', 'Filters');
  filterBtn.append(filterBtnIcon, filterBtnText);
  const filterBtnBadge = document.createElement('span');
  filterBtnBadge.className = 'home-floating-toolbar__filter-badge';
  filterBtn.append(filterBtnBadge);
  filterBtn.addEventListener('click', () => {
    filterResult.openDrawer(filterBtn);
  });
  controlsRow.append(filterBtn);

  // Clear all button
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'home-floating-toolbar__clear-btn';
  clearBtn.innerHTML = '<span>&#10005;</span> <span>' + t('marketplace.clear_all', 'Clear all') + '</span>';
  clearBtn.addEventListener('click', () => {
    const sp = new URLSearchParams(window.location.search);
    for (const key of ['category', 'q', 'sort', 'min_price', 'max_price', 'in_stock', 'tier', 'district', 'min_rating', 'min_margin']) {
      sp.delete(key);
    }
    const newUrl = window.location.pathname + (sp.toString() ? '?' + sp.toString() : '');
    window.history.replaceState(null, '', newUrl);
    activeCategory = 'all';
    searchInput.value = '';
    sortSelect.value = '';
    syncCategory('all');
    setControlsOpen(false);
  });
  controlsRow.append(clearBtn);

  floatingToolbar.append(controlsRow);
  page.append(floatingToolbar);

  // ── Toggle, Positioning & Dragging ─────────────────────────────────────────
  let controlsOpen = false;
  function setControlsOpen(open) {
    controlsOpen = open;
    floatingToolbar.hidden = !open;
    floatingToggle.classList.toggle('is-open', open);
    floatingToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      positionFloatingToolbar();
      searchInput.focus();
    }
  }

  floatingToggle.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    setControlsOpen(!controlsOpen);
  });

  const DRAG_THRESHOLD = 4;
  const DROPDOWN_GUTTER = 10;
  let userMoved = false;
  let suppressClick = false;
  let press = null;

  function positionFloatingToolbar() {
    if (floatingToolbar.hidden || !userMoved) return;
    const vw = window.innerWidth;
    const left = floatingBar.offsetLeft + floatingBar.offsetWidth / 2 - floatingToolbar.offsetWidth / 2;
    const clamped = Math.max(DROPDOWN_GUTTER, Math.min(left, vw - floatingToolbar.offsetWidth - DROPDOWN_GUTTER));
    floatingToolbar.style.left = clamped + 'px';
    floatingToolbar.style.top = (floatingBar.offsetTop + floatingBar.offsetHeight + DROPDOWN_GUTTER) + 'px';
    floatingToolbar.style.transform = 'none';
  }

  function setBarPos(left, top) {
    const maxLeft = window.innerWidth - floatingBar.offsetWidth;
    const maxTop = window.innerHeight - floatingBar.offsetHeight;
    const l = Math.max(0, Math.min(left, maxLeft));
    const tp = Math.max(56, Math.min(top, maxTop));
    floatingBar.style.left = l + 'px';
    floatingBar.style.top = tp + 'px';
    floatingBar.style.transform = 'none';
    positionFloatingToolbar();
  }

  function onBarPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    press = { startX: e.clientX, startY: e.clientY, baseLeft: 0, baseTop: 0, dragging: false };
  }
  function onBarPointerMove(e) {
    if (!press) return;
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!press.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      press.dragging = true;
      userMoved = true;
      floatingBar.classList.add('is-dragging');
      const barRect = floatingBar.getBoundingClientRect();
      press.baseLeft = barRect.left;
      press.baseTop = barRect.top;
      try { floatingToggle.setPointerCapture(e.pointerId); } catch {}
    }
    e.preventDefault();
    setBarPos(press.baseLeft + dx, press.baseTop + dy);
  }
  function onBarPointerUp() {
    if (!press) return;
    if (press.dragging) suppressClick = true;
    floatingBar.classList.remove('is-dragging');
    press = null;
  }

  floatingToggle.addEventListener('pointerdown', onBarPointerDown);
  window.addEventListener('pointermove', onBarPointerMove);
  window.addEventListener('pointerup', onBarPointerUp);
  cleanups.push(() => {
    window.removeEventListener('pointermove', onBarPointerMove);
    window.removeEventListener('pointerup', onBarPointerUp);
  });

  const onWindowResize = () => {
    if (!userMoved) return;
    setBarPos(floatingBar.offsetLeft, floatingBar.offsetTop);
  };
  window.addEventListener('resize', onWindowResize);
  cleanups.push(() => window.removeEventListener('resize', onWindowResize));

  const onDocPointerDown = (e) => {
    if (!controlsOpen) return;
    if (floatingToolbar.contains(e.target) || floatingToggle.contains(e.target)) return;
    if (e.target.closest && (e.target.closest('.drawer') || e.target.closest('.modal'))) return;
    setControlsOpen(false);
  };
  const onDocKeydown = (e) => {
    if (e.key === 'Escape' && controlsOpen) {
      setControlsOpen(false);
      floatingToggle.focus();
    }
  };
  document.addEventListener('pointerdown', onDocPointerDown);
  document.addEventListener('keydown', onDocKeydown);
  cleanups.push(() => {
    document.removeEventListener('pointerdown', onDocPointerDown);
    document.removeEventListener('keydown', onDocKeydown);
  });

  function updateFloatingBarState() {
    const sp = new URLSearchParams(window.location.search);
    const activeFiltersCount = countActiveFilters();
    const hasCategory = activeCategory && activeCategory !== 'all';
    const hasSearch = Boolean(sp.get('q'));
    const hasSort = Boolean(sp.get('sort'));

    if (hasCategory) {
      const catObj = KNOWN_CATEGORIES.find((c) => c.id === activeCategory);
      const label = catObj ? (getLanguage() === 'bn' ? (catObj.label_bn || catObj.id) : (catObj.label_en || catObj.id)) : activeCategory;
      floatingActive.textContent = label;
      floatingActive.hidden = false;
    } else {
      floatingActive.hidden = true;
    }

    floatingBadge.textContent = activeFiltersCount > 0 ? String(activeFiltersCount) : '';
    floatingBadge.hidden = activeFiltersCount === 0;
    filterBtnBadge.textContent = activeFiltersCount > 0 ? String(activeFiltersCount) : '';
    filterBtnBadge.hidden = activeFiltersCount === 0;

    const hasAnyActive = hasCategory || hasSearch || hasSort || activeFiltersCount > 0;
    floatingToggle.classList.toggle('has-active', hasAnyActive);
    clearBtn.style.display = hasAnyActive ? 'inline-flex' : 'none';

    searchInput.value = sp.get('q') || '';
    sortSelect.value = sp.get('sort') || '';
  }

  // Initial grid render
  rebuildGrid();


  // Listen to custom search events dispatched by TopBar
  const onSearchEvent = () => rebuildGrid();
  window.addEventListener('explooro:search', onSearchEvent);
  cleanups.push(() => window.removeEventListener('explooro:search', onSearchEvent));

  const onPopState = () => rebuildGrid();
  window.addEventListener('popstate', onPopState);
  cleanups.push(() => window.removeEventListener('popstate', onPopState));

  // ── Reactive role/module updates ─────────────────────────────────────────
  // When the store changes (e.g. role switcher in /dev/gallery), re-render the grid
  // so margin badges appear/disappear without reload.
  const unsubStore = appStore.subscribe((next) => {
    const newRole = next.auth?.role || 'customer';
    const newModules = next.modules || {};
    const flashChanged = !!newModules.flash_sale !== !!modules.flash_sale;

    // Mutate local role/modules reference so ProductCard picks them up on the next render
    Object.assign(modules, newModules);

    if (flashChanged && !newModules.flash_sale) {
      unmountFlashWidget();
    }

    // Re-build grid so new role's badge visibility is reflected
    rebuildGrid();
  });
  cleanups.push(unsubStore);

  // ── Language change ──────────────────────────────────────────────────────
  // main.js's subscribeLang fires router.refresh() on lang change, which remounts this page.
  // We don't need a separate subscription here — the router already handles it.

  root.append(page);

  // ── Cleanup (returned to router) ─────────────────────────────────────────
  return () => {
    currentGridCleanup && currentGridCleanup();
    for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
  };
}
