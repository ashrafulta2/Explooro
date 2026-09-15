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

  // ── Header ──────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'discover-page__header';
  const heading = document.createElement('h1');
  heading.className = 'discover-page__heading';
  heading.textContent = t('discover.page.title');
  const hint = document.createElement('span');
  hint.className = 'discover-page__hint';
  hint.textContent = t('discover.page.subtitle');
  header.append(heading, hint);
  page.append(header);

  // ── Toolbar: category pills + search + filter trigger ───────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'discover-page__toolbar';

  const pills = CategoryPills({
    categories: KNOWN_CATEGORIES,
    selected: new URLSearchParams(window.location.search).get('category') || 'all',
    lang,
    onChange: (catId) => {
      setUrlParam('category', catId);
      reload();
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

  // Filter trigger — opens the FilterPanel drawer on mobile (the sidebar is always visible on
  // desktop). Carries a badge with the active-filter count.
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

  // ── Body: filter sidebar + feed ─────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'discover-page__body';

  const filterResult = FilterPanel({
    role,
    lang,
    onChange: () => reload(),
  });
  body.append(filterResult.el);
  // Mobile: hand the drawer the LIVE panel (not FilterPanel.openDrawer's read-only clone), so
  // filters stay interactive on phones — then return it to the sidebar slot on close so a resize
  // to desktop still finds it. onClose fires on every dismiss path (button, scrim, Esc, drag).
  let filterInDrawer = false;
  filterBtn.addEventListener('click', () => {
    if (filterInDrawer) return;
    filterInDrawer = true;
    Drawer({
      title: t('discover.filters.title'),
      content: filterResult.el,
      side: 'left',
      onClose: () => {
        body.insertBefore(filterResult.el, feed.el);
        filterInDrawer = false;
      },
    });
  });

  const feed = ProductFeed({
    audience,
    navigate,
    filters: filtersFromUrl(),
    onFilterHint: (meta) => {
      hint.textContent = meta?.personalized ? t('discover.page.personalized') : t('discover.page.subtitle');
    },
    onFirstPage: (products) => {
      const prices = products.map((p) => Number(p.price)).filter((n) => Number.isFinite(n) && n > 0);
      if (prices.length) filterResult.setPriceBounds?.(Math.min(...prices), Math.max(...prices));
    },
  });
  body.append(feed.el);
  page.append(body);

  function updateFilterBadge() {
    const count = countActiveFilters();
    filterBadge.textContent = count > 0 ? String(count) : '';
    filterBadge.hidden = count === 0;
  }

  function reload() {
    updateFilterBadge();
    feed.reload(filtersFromUrl());
  }

  updateFilterBadge();

  root.append(page);
  return () => {
    clearTimeout(searchTimer);
    filterResult.cleanup();
    feed.cleanup();
  };
}
