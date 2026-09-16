/**
 * DiscoverFeedPage — the /discover surface (Discovery feed, module `discovery_feed`).
 *
 * A full-screen, one-product-at-a-time vertical feed personalized to the shopper's interests. The
 * heavy lifting lives in components/product/ProductFeed.js; this page picks the audience from the
 * signed-in role (a saler gets the sourcing CTA set, everyone else the shopper set), owns the SEO
 * head, and wires the discovery controls: category pills, an in-page search box, and the shared
 * FilterPanel (live sidebar on desktop, drawer on mobile).
 *
 * All filter/search state lives in the URL query, so a filtered feed is shareable and back-safe;
 * any change re-ranks the feed from the first slide via `feed.reload(filtersFromUrl())`.
 *
 * The stylesheet is imported here, not from main.css, so Vite code-splits it into this route's
 * chunk and it never weighs on the entry bundle (see the CSS-budget note in styles/main.css).
 */
import '../styles/components/discover-feed.css';
import { appStore } from '../state/appStore.js';
import { t, getLanguage } from '../services/i18n.js';
import { updateHead } from '../services/seo.js';
import { ProductFeed } from '../components/product/ProductFeed.js';
import { CategoryPills } from '../components/product/CategoryPills.js';
import { FilterPanel, countActiveFilters } from '../components/product/FilterPanel.js';
import { Drawer } from '../components/ui/Drawer.js';

// Category ids are names (matching the catalog's mock filter + the marketplace home's own list).
// Kept local, like HomePage's KNOWN_CATEGORIES, rather than importing a page-private const.
const KNOWN_CATEGORIES = [
  { id: 'Clothing', label_en: 'Clothing', label_bn: 'পোশাক' },
  { id: 'Electronics', label_en: 'Electronics', label_bn: 'ইলেকট্রনিক্স' },
  { id: 'Bags', label_en: 'Bags', label_bn: 'ব্যাগ' },
  { id: 'Jewellery', label_en: 'Jewellery', label_bn: 'গহনা' },
  { id: 'Home & Kitchen', label_en: 'Home & Kitchen', label_bn: 'গৃহস্থালি' },
  { id: 'Footwear', label_en: 'Footwear', label_bn: 'জুতা' },
  { id: 'Kids', label_en: 'Kids', label_bn: 'শিশু পণ্য' },
  { id: 'Beauty & Health', label_en: 'Beauty & Health', label_bn: 'সৌন্দর্য ও স্বাস্থ্য' },
  { id: 'Food & Grocery', label_en: 'Food & Grocery', label_bn: 'খাদ্য ও মুদিখানা' },
  { id: 'Crafts', label_en: 'Crafts', label_bn: 'হস্তশিল্প' },
];

const SEARCH_DEBOUNCE_MS = 300;

/** The snake_case query object the feed sends, read from the current URL. */
function filtersFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  const f = {};
  const q = sp.get('q');
  if (q) f.q = q;
  const category = sp.get('category');
  if (category && category !== 'all') f.category = category;
  if (sp.get('min_price')) f.min_price = sp.get('min_price');
  if (sp.get('max_price')) f.max_price = sp.get('max_price');
  if (sp.get('in_stock') === '1') f.in_stock = '1';
  const tiers = sp.getAll('tier');
  if (tiers.length) f.supplier_tier = tiers.join(',');
  if (sp.get('district')) f.district = sp.get('district');
  if (sp.get('min_rating')) f.min_rating = sp.get('min_rating');
  if (sp.get('min_margin')) f.min_margin = sp.get('min_margin');
  return f;
}

function setUrlParam(key, value) {
  const sp = new URLSearchParams(window.location.search);
  if (value == null || value === '' || value === 'all') sp.delete(key);
  else sp.set(key, value);
  const qs = sp.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

export default function DiscoverFeedPage(root, { navigate }) {
  const lang = getLanguage();
  const { auth } = appStore.get();
  const role = auth?.role || 'customer';
  const audience = role === 'saler' ? 'saler' : 'customer';

  updateHead({
    title: t('discover.page.title'),
    description: t('discover.page.desc'),
    canonicalPath: '/discover',
    locale: lang,
    noIndex: true,
  });

  const page = document.createElement('div');
  page.className = 'discover-page';
  page.dataset.audience = audience;

  // ── Compact control bar: a single toggle that reveals the refinements ────
  // WHY: the category pills + search + filters used to occupy a permanent two-row band above the
  // feed, eating vertical space the product card needs. They now live in a dropdown revealed only
  // on demand, so the feed owns the full viewport by default and the controls never clutter it.
  const bar = document.createElement('div');
  bar.className = 'discover-page__bar';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'discover-page__toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const toggleIcon = document.createElement('span');
  toggleIcon.className = 'discover-page__toggle-icon';
  toggleIcon.setAttribute('aria-hidden', 'true');
  toggleIcon.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M7 12h10M11 18h2"></path></svg>';
  const toggleText = document.createElement('span');
  toggleText.className = 'discover-page__toggle-text';
  toggleText.textContent = t('discover.controls.toggle');
  const toggleActive = document.createElement('span');
  toggleActive.className = 'discover-page__toggle-active';
  toggleActive.hidden = true;
  const toggleBadge = document.createElement('span');
  toggleBadge.className = 'discover-page__toggle-badge';
  toggleBadge.hidden = true;
  const toggleChevron = document.createElement('span');
  toggleChevron.className = 'discover-page__toggle-chevron';
  toggleChevron.setAttribute('aria-hidden', 'true');
  toggleChevron.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>';
  toggle.append(toggleIcon, toggleText, toggleActive, toggleBadge, toggleChevron);
  bar.append(toggle);
  page.append(bar);

  // ── Toolbar (dropdown): category pills + search + filter trigger ────────
  const toolbar = document.createElement('div');
  toolbar.className = 'discover-page__toolbar';
  toolbar.hidden = true;

  const pills = CategoryPills({
    categories: KNOWN_CATEGORIES,
    selected: new URLSearchParams(window.location.search).get('category') || 'all',
    lang,
    onChange: (catId) => {
      setUrlParam('category', catId);
      reload();
      setControlsOpen(false); // picking a category reveals the filtered feed immediately
    },
  });
  toolbar.append(pills);

  const controls = document.createElement('div');
  controls.className = 'discover-page__controls';

  // Search box (in-page, filters the feed; distinct from the TopBar search which goes to /search).
  const searchForm = document.createElement('form');
  searchForm.className = 'discover-page__search';
  searchForm.setAttribute('role', 'search');
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'discover-page__search-input';
  searchInput.placeholder = t('discover.search.placeholder');
  searchInput.setAttribute('aria-label', t('discover.search.placeholder'));
  searchInput.autocomplete = 'off';
  searchInput.value = new URLSearchParams(window.location.search).get('q') || '';
  const searchIcon = document.createElement('span');
  searchIcon.className = 'discover-page__search-icon';
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  searchForm.append(searchIcon, searchInput);

  let searchTimer = null;
  function applySearch() {
    setUrlParam('q', searchInput.value.trim());
    reload();
  }
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, SEARCH_DEBOUNCE_MS);
  });
  searchInput.addEventListener('search', applySearch); // native clear "✕" + Escape
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    applySearch();
  });
  controls.append(searchForm);

  // Filter trigger button — opens the FilterPanel drawer on all devices. Carries active count badge.
  const filterBtn = document.createElement('button');
  filterBtn.type = 'button';
  filterBtn.className = 'discover-page__filter-btn';
  const filterBtnLabel = document.createElement('span');
  filterBtnLabel.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M7 12h10M11 18h2"></path></svg>';
  const filterBtnText = document.createElement('span');
  filterBtnText.textContent = t('discover.filters.title');
  filterBtn.append(filterBtnLabel, filterBtnText);
  const filterBadge = document.createElement('span');
  filterBadge.className = 'discover-page__filter-badge';
  filterBtn.append(filterBadge);
  controls.append(filterBtn);

  toolbar.append(controls);
  page.append(toolbar);

  // ── Body: full-width centered feed ───────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'discover-page__body';

  const filterResult = FilterPanel({
    role,
    lang,
    onChange: () => reload(),
  });

  filterBtn.addEventListener('click', () => {
    filterResult.openDrawer(filterBtn);
  });

  const feed = ProductFeed({
    audience,
    navigate,
    filters: filtersFromUrl(),
    onFirstPage: (products) => {
      const prices = products.map((p) => Number(p.price)).filter((n) => Number.isFinite(n) && n > 0);
      if (prices.length) filterResult.setPriceBounds?.(Math.min(...prices), Math.max(...prices));
    },
  });
  body.append(feed.el);
  page.append(body);

  // ── Toggle (show/hide the refinements dropdown) ──────────────────────────
  let controlsOpen = false;
  function setControlsOpen(open) {
    controlsOpen = open;
    toolbar.hidden = !open;
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) searchInput.focus();
  }
  toggle.addEventListener('click', () => setControlsOpen(!controlsOpen));

  const onDocPointerDown = (e) => {
    if (!controlsOpen) return;
    if (toolbar.contains(e.target) || toggle.contains(e.target)) return;
    setControlsOpen(false);
  };
  const onDocKeydown = (e) => {
    if (e.key === 'Escape' && controlsOpen) {
      setControlsOpen(false);
      toggle.focus();
    }
  };
  document.addEventListener('pointerdown', onDocPointerDown);
  document.addEventListener('keydown', onDocKeydown);

  function activeCategoryLabel() {
    const cat = new URLSearchParams(window.location.search).get('category');
    if (!cat || cat === 'all') return '';
    const found = KNOWN_CATEGORIES.find((c) => c.id === cat);
    if (!found) return cat;
    return lang === 'bn' ? found.label_bn || found.label_en : found.label_en;
  }

  function updateControlsState() {
    const filterCount = countActiveFilters();
    filterBadge.textContent = filterCount > 0 ? String(filterCount) : '';
    filterBadge.hidden = filterCount === 0;

    // The toggle summarizes every active refinement so the collapsed bar still shows what's applied.
    const sp = new URLSearchParams(window.location.search);
    const activeCount = filterCount + (activeCategoryLabel() ? 1 : 0) + (sp.get('q') ? 1 : 0);
    const catLabel = activeCategoryLabel();
    toggleActive.textContent = catLabel;
    toggleActive.hidden = !catLabel;
    toggleBadge.textContent = activeCount > 0 ? String(activeCount) : '';
    toggleBadge.hidden = activeCount === 0;
    toggle.classList.toggle('has-active', activeCount > 0);
  }

  function reload() {
    updateControlsState();
    feed.reload(filtersFromUrl());
  }

  updateControlsState();

  // Lock the outer shell to the viewport so the window never scrolls under the topbar.
  root.classList.add('app-shell__page--discover');

  // Forward wheel gestures on page margins/header to advance the feed.
  const onPageWheel = (e) => {
    if (e.target.closest('.category-pills') || e.target.closest('input') || e.target.closest('.discover-feed')) return;
    e.preventDefault();
    feed.step(e.deltaY > 0 ? 1 : -1);
  };
  page.addEventListener('wheel', onPageWheel, { passive: false });

  root.append(page);
  return () => {
    clearTimeout(searchTimer);
    page.removeEventListener('wheel', onPageWheel);
    document.removeEventListener('pointerdown', onDocPointerDown);
    document.removeEventListener('keydown', onDocKeydown);
    root.classList.remove('app-shell__page--discover');
    filterResult.cleanup();
    feed.cleanup();
  };
}
