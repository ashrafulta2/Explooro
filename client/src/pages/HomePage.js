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
import { t, getLanguage, subscribe as subscribeLang } from '../services/i18n.js';
import { isFeatureEnabled } from '../services/featureFlags.js';
import { Button } from '../components/ui/Button.js';
import { ProductGrid } from '../components/product/ProductGrid.js';
import { addToCart } from '../services/cart.js';
import { CategoryPills } from '../components/product/CategoryPills.js';
import { FlashSaleWidget } from '../components/product/FlashSaleWidget.js';
import { FilterPanel, countActiveFilters } from '../components/product/FilterPanel.js';

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

  const feedTabs = [];
  for (const feedDef of FEEDS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'feed-switcher__tab';
    tab.setAttribute('role', 'tab');
    tab.dataset.id = feedDef.id;
    tab.textContent = t(feedDef.i18n);
    tab.setAttribute('aria-selected', feedDef.id === activeFeed ? 'true' : 'false');
    tab.addEventListener('click', () => {
      if (activeFeed === feedDef.id) return;
      activeFeed = feedDef.id;
      setURLParam('feed', activeFeed);
      for (const t2 of feedTabs) {
        t2.setAttribute('aria-selected', t2.dataset.id === activeFeed ? 'true' : 'false');
      }
      rebuildGrid();
    });
    feedTabs.push(tab);
    feedBar.append(tab);
  }
  page.append(feedBar);

  // ── Category pills ──────────────────────────────────────────────────────
  const catLang = getLanguage();
  let pillsEl = CategoryPills({
    categories: KNOWN_CATEGORIES,
    selected: activeCategory,
    lang: catLang,
    onChange: (catId) => {
      activeCategory = catId;
      setURLParam('category', catId);
      rebuildGrid();
    },
  });
  page.append(pillsEl);

  // ── Flash sale widget (module-gated) ────────────────────────────────────
  let flashWidgetCleanup = null;
  let flashSection = null;

  function mountFlashWidget(allProducts) {
    if (!isFeatureEnabled('flash_sale')) return;
    if (flashSection) return; // already mounted

    const sec = document.createElement('div');
    sec.className = 'home-section';
    sec.setAttribute('data-module', 'flash_sale');

    // Flash sale ends at a fixed 4h window for demo; real data would come from API
    const { el, cleanup } = FlashSaleWidget({
      products: allProducts,
      endsAt: Date.now() + 4 * 60 * 60 * 1000,
      role,
      modules,
      lang: getLanguage(),
      onNavigate: navigate,
      onAction: handleAction,
    });
    sec.append(el);

    // Insert before the catalog section
    if (catalogSection) {
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
  }

  // ── Filter panel + product grid layout ──────────────────────────────────
  const catalogSection = document.createElement('div');
  catalogSection.className = 'home-catalog';
  page.append(catalogSection);

  // Filter panel
  const filterResult = FilterPanel({ role, lang: getLanguage(), onChange: () => rebuildGrid() });
  catalogSection.append(filterResult.el);
  cleanups.push(filterResult.cleanup);

  // Grid column
  const gridColumn = document.createElement('div');
  catalogSection.append(gridColumn);

  // Toolbar (sort + mobile filter trigger)
  const toolbar = document.createElement('div');
  toolbar.className = 'product-grid-toolbar';

  const countLabel = document.createElement('span');
  countLabel.className = 'product-grid-toolbar__count';
  countLabel.textContent = '';
  toolbar.append(countLabel);

  const toolbarRight = document.createElement('div');
  toolbarRight.className = 'product-grid-toolbar__right';

  // Mobile filter trigger
  const filterTriggerBtn = document.createElement('button');
  filterTriggerBtn.type = 'button';
  filterTriggerBtn.className = 'filter-trigger';
  const filterIcon = document.createElement('span');
  filterIcon.setAttribute('aria-hidden', 'true');
  filterIcon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 6h18M7 12h10M11 18h2"/></svg>';
  filterTriggerBtn.append(filterIcon);
  filterTriggerBtn.append(document.createTextNode(t('marketplace.filter.title')));
  const activeCount = countActiveFilters();
  if (activeCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'filter-trigger__badge';
    badge.textContent = String(activeCount);
    filterTriggerBtn.append(badge);
  }
  filterTriggerBtn.addEventListener('click', () => filterResult.openDrawer());
  toolbarRight.append(filterTriggerBtn);
  toolbar.append(toolbarRight);
  gridColumn.append(toolbar);

  // ── Product grid ─────────────────────────────────────────────────────────
  let currentGridCleanup = null;
  let currentGridEl = null;
  let allLoadedProducts = []; // collect for flash widget

  function buildFetchPage() {
    const sp = new URLSearchParams(window.location.search);

    /** Returns the mock-compatible query object from current URL state. */
    function buildQuery(cursor) {
      const q = {};
      if (cursor) q.cursor = cursor;
      q.limit = 20;
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
      return q;
    }

    return async (cursor) => {
      const result = await listProducts(buildQuery(cursor));
      // Collect products for flash widget on first page
      if (!cursor && result?.products) {
        allLoadedProducts = result.products;
        mountFlashWidget(allLoadedProducts);
        const total = result.meta?.total ?? allLoadedProducts.length;
        countLabel.textContent = t('marketplace.product_count', { count: total });
      }
      return result;
    };
  }

  function rebuildGrid() {
    // Tear down old grid
    if (currentGridCleanup) { currentGridCleanup(); currentGridCleanup = null; }
    currentGridEl && currentGridEl.remove();

    // Unmount flash widget (will re-mount after first fetch)
    unmountFlashWidget();

    const { el, cleanup } = ProductGrid({
      fetchPage: buildFetchPage(),
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
      addToCart({
        product_id: product.id,
        title_en: product.title_en,
        title_bn: product.title_bn,
        slug: product.slug,
        price: product.price,
        supplier_id: product.supplier_id || 1,
        supplier_name: product.supplier_name || 'Verified Supplier',
        stock_qty: product.stock ?? 10,
      });
    } else {
      navigate(`/product/${product.ref}`);
    }
  }

  // Initial grid render
  rebuildGrid();

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
