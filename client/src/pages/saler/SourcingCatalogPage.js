/**
 * SourcingCatalogPage.js — Shop Partner Supplier Catalog & Sourcing Opportunity Feed (Prompt 4.7).
 *
 * Route: /saler/sourcing
 * Gated by: `sourcing` module flag, `saler.sourcing.view` permission, and `can_sell` restriction.
 *
 * WHY no profit calculator or margin filters: since migration 085 the supplier sets the price and a
 * partner is paid monthly from the partner reward pool by score, so there is no per-sale profit to
 * calculate. A card shows the supplier's price and what one sale adds to the pool.
 */
import { listSourcingCatalog } from '../../services/catalog.api.ts';
import { AddToStoreDrawer, poolContributionOf } from '../../components/saler/AddToStoreDrawer.js';
import { SupplierScorecardBadge } from '../../components/saler/SupplierScorecardBadge.ts';
import { SponsoredTag } from '../../components/saler/SponsoredTag.ts';
import { fetchSponsored, trackImpression, clickReporter } from '../../services/sponsoredSourcing.ts';
import { Button } from '../../components/ui/Button.ts';
import { Skeleton } from '../../components/ui/Skeleton.ts';
import { EmptyState } from '../../components/ui/EmptyState.ts';
import { appStore } from '../../state/appStore.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { formatCurrency } from '../../services/format.js';
import { t, getLanguage } from '../../services/i18n.js';
import { resolveProductImage } from '../../components/product/ProductCard.ts';
import { openAssistantPanel } from '../../components/ai/AssistantPanel.js';

const CATEGORIES = [
  { key: 'all', en: 'All Categories', bn: 'সব বিভাগ' },
  { key: 'Clothing', en: 'Clothing', bn: 'পোশাক' },
  { key: 'Electronics', en: 'Electronics', bn: 'ইলেকট্রনিক্স' },
  { key: 'Home & Kitchen', en: 'Home & Kitchen', bn: 'গৃহস্থালি' },
  { key: 'Food & Grocery', en: 'Food & Grocery', bn: 'খাদ্য ও মুদিখানা' },
  { key: 'Footwear', en: 'Footwear', bn: 'জুতা' },
  { key: 'Kids', en: 'Kids', bn: 'শিশু পণ্য' },
  { key: 'Bags', en: 'Bags', bn: 'ব্যাগ' },
  { key: 'Crafts', en: 'Crafts', bn: 'হস্তশিল্প' },
  { key: 'Jewellery', en: 'Jewellery', bn: 'গহনা' },
];

const SORT_OPTIONS = [
  { value: 'popularity', label_en: 'Most Popular', label_bn: 'সর্বাধিক জনপ্রিয়' },
  { value: 'newest', label_en: 'Newest Arrivals', label_bn: 'নতুন আগমন' },
  { value: 'price_asc', label_en: 'Price: Low to High', label_bn: 'দাম: কম থেকে বেশি' },
  { value: 'price_desc', label_en: 'Price: High to Low', label_bn: 'দাম: বেশি থেকে কম' },
];

export default function SourcingCatalogPage(root) {
  const container = document.createElement('div');
  container.className = 'sourcing-page';
  container.setAttribute('data-module', 'sourcing');

  // Check module enabled state
  if (!isFeatureEnabled('sourcing')) {
    const disabledState = EmptyState({
      title: t('sourcing.module_disabled_title'),
      description: t('sourcing.module_disabled_desc'),
    });
    container.append(disabledState);
    root.append(container);
    return () => {};
  }

  // Active filters state
  const state = {
    category: 'all',
    verificationTier: 'all',
    shippingSpeed: 'all',
    inStock: true,
    sortBy: 'popularity',
    products: [],
    loading: true,
  };

  // AddToStore Drawer instance
  const addToStoreDrawer = AddToStoreDrawer({
    onSuccess: () => {
      // Re-fetch or update stats if needed
    },
  });

  // 1. Hero / Header with quick stats
  const hero = document.createElement('section');
  hero.className = 'sourcing-hero';

  const heroHeader = document.createElement('div');
  heroHeader.className = 'sourcing-hero__header';

  const heroTitle = document.createElement('h1');
  heroTitle.className = 'sourcing-hero__title';
  heroTitle.textContent = t('sourcing.hero.title');

  const heroSubtitle = document.createElement('p');
  heroSubtitle.className = 'sourcing-hero__subtitle';
  heroSubtitle.textContent = t('sourcing.hero.subtitle');

  const askAiBtn = Button({
    label: `✨ ${t('ai.sourcing_trigger')}`,
    variant: 'secondary',
    size: 'sm',
    onClick: (e) => openAssistantPanel({ agentType: 'sourcing', trigger: e.currentTarget }),
  });

  heroHeader.append(heroTitle, heroSubtitle, askAiBtn);

  const heroStats = document.createElement('div');
  heroStats.className = 'sourcing-hero__stats';

  const statSuppliers = createStatCard(t('sourcing.stats.suppliers'), '48+');

  heroStats.append(statSuppliers);
  hero.append(heroHeader, heroStats);

  // Check user restriction (can_sell)
  const auth = appStore.get()?.auth || {};
  const restrictions = auth.restrictions || [];
  const isSellRestricted = restrictions.some((r) => r.capability === 'can_sell' && r.mode === 'BLOCK');

  if (isSellRestricted) {
    const restrictionBanner = document.createElement('div');
    restrictionBanner.className = 'profit-calc__error mb-4';
    restrictionBanner.textContent = `🚫 ${t('sourcing.restricted_can_sell_banner')}`;
    container.append(restrictionBanner);
  }

  // 2. Filter Bar
  const filterBar = document.createElement('section');
  filterBar.className = 'sourcing-filter-bar';

  // Category Pills Row
  const catRow = document.createElement('div');
  catRow.className = 'sourcing-filter-row';

  const catLabel = document.createElement('span');
  catLabel.className = 'sourcing-filter-label';
  catLabel.textContent = t('sourcing.filters.category');
  catRow.append(catLabel);

  const isBn = getLanguage() === 'bn';
  const catPills = CATEGORIES.map((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sourcing-pill-btn ${cat.key === state.category ? 'active' : ''}`;
    btn.setAttribute('aria-pressed', cat.key === state.category ? 'true' : 'false');
    btn.textContent = isBn ? cat.bn : cat.en;
    btn.addEventListener('click', () => {
      state.category = cat.key;
      catPills.forEach((p) => {
        const isActive = p.key === state.category;
        p.btn.classList.toggle('active', isActive);
        p.btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      loadProducts();
    });
    catRow.append(btn);
    return { key: cat.key, btn };
  });

  // Secondary Filter Row: Verification, Sort
  const secondaryRow = document.createElement('div');
  secondaryRow.className = 'sourcing-filter-row';

  // Verification Tier Select
  const tierGroup = document.createElement('div');
  tierGroup.className = 'sourcing-filter-group';
  const tierLabel = document.createElement('label');
  tierLabel.className = 'sourcing-filter-label';
  tierLabel.setAttribute('for', 'sourcing-tier-select');
  tierLabel.textContent = t('sourcing.filters.tier');

  const tierSelect = document.createElement('select');
  tierSelect.id = 'sourcing-tier-select';
  tierSelect.className = 'sourcing-select';
  tierSelect.setAttribute('aria-label', t('sourcing.filters.tier'));
  tierSelect.innerHTML = `
    <option value="all">${t('sourcing.filters.all_tiers')}</option>
    <option value="elite">${t('sourcing.filters.tier_elite')}</option>
    <option value="verified">${t('sourcing.filters.tier_verified')}</option>
    <option value="standard">${t('sourcing.filters.tier_standard')}</option>
  `;
  tierSelect.addEventListener('change', (e) => {
    state.verificationTier = e.target.value;
    loadProducts();
  });
  tierGroup.append(tierLabel, tierSelect);

  // Sort By Select
  const sortGroup = document.createElement('div');
  sortGroup.className = 'sourcing-filter-group ml-auto';
  const sortLabel = document.createElement('label');
  sortLabel.className = 'sourcing-filter-label';
  sortLabel.setAttribute('for', 'sourcing-sort-select');
  sortLabel.textContent = t('sourcing.filters.sort_by');

  const sortSelect = document.createElement('select');
  sortSelect.id = 'sourcing-sort-select';
  sortSelect.className = 'sourcing-select';
  sortSelect.setAttribute('aria-label', t('sourcing.filters.sort_by'));
  sortSelect.innerHTML = SORT_OPTIONS.map((opt) => `
    <option value="${opt.value}">${isBn ? opt.label_bn : opt.label_en}</option>
  `).join('');
  sortSelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    loadProducts();
  });
  sortGroup.append(sortLabel, sortSelect);

  secondaryRow.append(tierGroup, sortGroup);
  filterBar.append(catRow, secondaryRow);

  // 3. Grid Container for Sourcing Cards
  const grid = document.createElement('section');
  grid.className = 'sourcing-grid';
  grid.setAttribute('aria-label', t('sourcing.catalog_heading', 'Available Wholesale Products'));

  // Paid placements sit above the ranked results, never inside them, so the grid below stays an
  // honest ordering of the shop partner's chosen sort.
  const sponsoredWrap = document.createElement('section');
  sponsoredWrap.className = 'sourcing-grid__sponsored';
  sponsoredWrap.setAttribute('aria-label', t('sourcing.sponsored.heading'));
  sponsoredWrap.hidden = true;
  let stopTracking = [];
  let sponsoredRequest = 0;

  container.append(hero, filterBar, sponsoredWrap, grid);

  const cardActions = {
    onAddToStore: (p, btn) => {
      addToStoreDrawer.openForProduct(p, btn);
    },
    isSellRestricted,
  };

  async function loadSponsored() {
    const request = ++sponsoredRequest;
    stopTracking.forEach((stop) => stop());
    stopTracking = [];
    sponsoredWrap.replaceChildren();
    sponsoredWrap.hidden = true;

    const ads = await fetchSponsored();
    if (request !== sponsoredRequest || ads.length === 0) return; // a newer load superseded this one

    for (const ad of ads) {
      const reportClick = clickReporter(ad);
      const card = createSourcingCard(ad.product, {
        ...cardActions,
        onAddToStore: (p, btn) => { reportClick(); cardActions.onAddToStore(p, btn); },
        sponsored: true,
      });
      sponsoredWrap.append(card);
      stopTracking.push(trackImpression(card, ad));
    }
    sponsoredWrap.hidden = false;
  }

  async function loadProducts() {
    loadSponsored();
    state.loading = true;
    grid.innerHTML = '';

    // Render loading skeletons
    for (let i = 0; i < 8; i++) {
      const skelCard = document.createElement('div');
      skelCard.className = 'sourcing-card';
      skelCard.append(
        Skeleton({ width: '100%', height: '220px' }),
        Skeleton({ width: '80%', height: '20px', className: 'm-3' }),
        Skeleton({ width: '50%', height: '16px', className: 'mx-3 mb-3' })
      );
      grid.append(skelCard);
    }

    try {
      const res = await listSourcingCatalog({
        category: state.category,
        verificationTier: state.verificationTier,
        sortBy: state.sortBy,
        inStock: state.inStock,
        limit: 40,
      });

      state.products = res.catalog || [];
      state.loading = false;
      grid.innerHTML = '';

      if (state.products.length === 0) {
        const empty = EmptyState({
          title: t('sourcing.empty_title'),
          description: t('sourcing.empty_desc'),
          action: Button({
            label: t('sourcing.clear_filters'),
            variant: 'secondary',
            onClick: () => {
              state.category = 'all';
              state.verificationTier = 'all';
              tierSelect.value = 'all';
              catPills.forEach((p) => p.btn.classList.toggle('active', p.key === 'all'));
              loadProducts();
            },
          }),
        });
        grid.append(empty);
        return;
      }

      state.products.forEach((product) => {
        grid.append(createSourcingCard(product, cardActions));
      });
    } catch (err) {
      grid.innerHTML = '';
      grid.append(
        EmptyState({
          title: t('sourcing.load_error_title'),
          description: err?.message || t('sourcing.load_error_desc'),
          action: Button({
            label: t('sourcing.retry_btn'),
            variant: 'primary',
            onClick: () => loadProducts(),
          }),
        })
      );
    }
  }

  // Initial load
  loadProducts();

  root.append(container);
  return () => {
    sponsoredRequest += 1;
    stopTracking.forEach((stop) => stop());
  };
}

function createStatCard(label, value) {
  const card = document.createElement('div');
  card.className = 'sourcing-stat-card';

  const lbl = document.createElement('span');
  lbl.className = 'sourcing-stat-card__label';
  lbl.textContent = label;

  const val = document.createElement('span');
  val.className = 'sourcing-stat-card__value';
  val.textContent = value;

  card.append(lbl, val);
  return card;
}

const CATEGORY_META = {
  'Clothing': { icon: '🥻', bg: 'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)', color: '#9d174d' },
  'Jewellery': { icon: '💍', bg: 'linear-gradient(135deg, #fae8ff 0%, #f5d0fe 100%)', color: '#86198f' },
  'Crafts': { icon: '🏺', bg: 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)', color: '#166534' },
  'Electronics': { icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>', bg: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)', color: '#1e40af' },
  'Home & Kitchen': { icon: '🍳', bg: 'linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%)', color: '#9a3412' },
  'Food & Grocery': { icon: '🍯', bg: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', color: '#92400e' },
  'Footwear': { icon: '👟', bg: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)', color: '#334155' },
  'Bags': { icon: '👜', bg: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)', color: '#5b21b6' },
  'Beauty & Health': { icon: '✨', bg: 'linear-gradient(135deg, #ffe4e6 0%, #fecdd3 100%)', color: '#9f1239' },
  'Kids': { icon: '🧸', bg: 'linear-gradient(135deg, #ecfdf5 0%, #a7f3d0 100%)', color: '#065f46' },
  default: { icon: '📦', bg: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)', color: '#374151' },
};

function createSourcingCard(product, { onAddToStore, isSellRestricted = false, sponsored = false }) {
  const card = document.createElement('article');
  card.className = sponsored ? 'sourcing-card sourcing-card--sponsored' : 'sourcing-card';

  const isBn = getLanguage() === 'bn';
  const title = (isBn && product.title_bn) ? product.title_bn : (product.title_en || product.title);
  const price = parseFloat(product.price ?? product.pricing?.retail_price ?? product.default_retail_price ?? 0);
  const poolShare = poolContributionOf(product);
  const tier = product.supplier_tier || 'standard';

  // Media
  const media = document.createElement('div');
  media.className = 'sourcing-card__media';

  function createPlaceholder() {
    const catName = product.category || 'Crafts';
    const meta = CATEGORY_META[catName] || CATEGORY_META.default;
    const ph = document.createElement('div');
    ph.className = 'sourcing-card__placeholder';
    ph.style.background = meta.bg;
    ph.style.color = meta.color;
    ph.innerHTML = `
      <span class="sourcing-card__placeholder-icon" aria-hidden="true">${meta.icon}</span>
      <span class="sourcing-card__placeholder-cat">${isBn ? (product.category_bn || catName) : catName}</span>
      <span class="sourcing-card__placeholder-title">${title || ''}</span>
    `;
    return ph;
  }

  const imageUrl = resolveProductImage(product);
  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'sourcing-card__img';
    img.src = imageUrl;
    img.alt = title || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.replaceWith(createPlaceholder());
    }, { once: true });
    media.append(img);
  } else {
    media.append(createPlaceholder());
  }

  // Badges
  const badges = document.createElement('div');
  badges.className = 'sourcing-card__badges';

  const tierBadge = document.createElement('span');
  tierBadge.className = `sourcing-card__tier-badge sourcing-card__tier-badge--${tier}`;
  const tierIcon = tier === 'elite' ? '🏆 ' : tier === 'verified' ? '✓ ' : '';
  tierBadge.textContent = `${tierIcon}${tier.toUpperCase()}`;

  badges.append(tierBadge);
  media.append(badges);

  // Content
  const content = document.createElement('div');
  content.className = 'sourcing-card__content';

  const header = document.createElement('div');
  header.className = 'sourcing-card__header';

  const cat = document.createElement('span');
  cat.className = 'sourcing-card__category';
  cat.textContent = isBn ? (product.category_bn || product.category) : product.category;

  const hTitle = document.createElement('h3');
  hTitle.className = 'sourcing-card__title';
  hTitle.textContent = title;

  // WHY measured, not tier-derived: this slot used to print "24h dispatch" for Elite and "48h" for
  // everyone else, a promise nothing checked. The scorecard is the supplier's actual track record.
  if (sponsored) {
    const row = document.createElement('div');
    row.className = 'sourcing-card__sponsored-row';
    row.append(cat, SponsoredTag());
    header.append(row, hTitle, SupplierScorecardBadge(product.supplier_scorecard));
  } else {
    header.append(cat, hTitle, SupplierScorecardBadge(product.supplier_scorecard));
  }

  // Pricing Matrix: the supplier's fixed price and what one sale adds to the partner reward pool
  const matrix = document.createElement('div');
  matrix.className = 'sourcing-card__pricing-matrix';

  matrix.innerHTML = `
    <div class="sourcing-card__pricing-row">
      <span class="sourcing-card__pricing-label">${t('sourcing.card.price')}</span>
      <span class="sourcing-card__pricing-val">${formatCurrency(price)}</span>
    </div>
    ${poolShare == null ? '' : `
    <div class="sourcing-card__pricing-row sourcing-card__pricing-row--profit">
      <span class="sourcing-card__pricing-label sourcing-card__pricing-label--profit">${t('sourcing.card.pool_per_sale')}</span>
      <span class="sourcing-card__profit-val">+${formatCurrency(poolShare)}</span>
    </div>`}
  `;

  // Actions
  const actions = document.createElement('div');
  actions.className = 'sourcing-card__actions';

  const addBtn = Button({
    label: `+ ${t('sourcing.card.btn_add_store', 'Add to Store')}`,
    variant: 'primary',
    size: 'sm',
    disabled: isSellRestricted,
    ariaLabel: `${t('sourcing.card.btn_add_store', 'Add to Store')}: ${title}`,
    onClick: (e) => onAddToStore(product, e.currentTarget),
  });
  addBtn.classList.add('sourcing-card__add-btn');

  if (isSellRestricted) {
    addBtn.title = t('sourcing.restricted_can_sell_tooltip');
  }

  actions.append(addBtn);
  content.append(header, matrix, actions);
  card.append(media, content);

  return card;
}
