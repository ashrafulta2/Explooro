/**
 * SourcingCatalogPage.js — Saler Supplier Catalog, Sourcing Opportunity Feed &
 * Interactive Profit Calculator (Prompt 4.7).
 *
 * Route: /saler/sourcing
 * Gated by: `sourcing` module flag, `saler.sourcing.view` permission, and `can_sell` restriction.
 */
import { listSourcingCatalog } from '../../services/catalog.api.js';
import { ProfitCalculator } from '../../components/saler/ProfitCalculator.js';
import { MarginProjection } from '../../components/saler/MarginProjection.js';
import { AddToStoreDrawer } from '../../components/saler/AddToStoreDrawer.js';
import { Modal } from '../../components/ui/Modal.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { appStore } from '../../state/appStore.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { formatCurrency } from '../../services/format.js';
import { t, getLanguage } from '../../services/i18n.js';
import { resolveProductImage } from '../../components/product/ProductCard.js';
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

const MARGIN_FILTERS = [
  { value: '0', label: 'All Margins' },
  { value: '15', label: '15%+' },
  { value: '20', label: '20%+' },
  { value: '25', label: '25%+' },
  { value: '30', label: '30%+' },
];

const SORT_OPTIONS = [
  { value: 'margin_desc', label_en: 'Highest Margin', label_bn: 'সর্বোচ্চ মার্জিন' },
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
    minMarginPct: '0',
    verificationTier: 'all',
    shippingSpeed: 'all',
    inStock: true,
    sortBy: 'margin_desc',
    products: [],
    loading: true,
  };

  // AddToStore Drawer instance
  const addToStoreDrawer = AddToStoreDrawer({
    onSuccess: () => {
      // Re-fetch or update stats if needed
    },
  });

  // Profit Calculator Modal instance
  let calcModalBody = document.createElement('div');
  calcModalBody.className = 'flex flex-col gap-6';

  const modalCalc = ProfitCalculator({
    initialBaseCost: 500,
    initialWholesaleMargin: 0,
    initialRetailPrice: 700,
    onChange: (breakdown) => {
      if (modalProjection && breakdown?.saler_earning !== undefined) {
        modalProjection.setUnitProfit(breakdown.saler_earning);
      }
    },
  });

  const modalProjection = MarginProjection({
    unitProfit: 80,
    initialVolume: 50,
  });

  calcModalBody.append(modalCalc, modalProjection);

  const calcModal = Modal({
    title: t('sourcing.calc.modal_title'),
    description: t('sourcing.calc.modal_desc'),
    content: calcModalBody,
    size: 'lg',
  });

  // 1. Hero / Header with quick stats & standalone Calculator trigger
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

  const calcLauncherBtn = Button({
    label: `🧮 ${t('sourcing.hero.open_calc_btn')}`,
    variant: 'secondary',
    size: 'sm',
    onClick: (e) => {
      modalCalc.setValues(500, 0, 700);
      calcModal.openModal(e.currentTarget);
    },
  });

  const askAiBtn = Button({
    label: `✨ ${t('ai.sourcing_trigger')}`,
    variant: 'secondary',
    size: 'sm',
    onClick: (e) => openAssistantPanel({ agentType: 'sourcing', trigger: e.currentTarget }),
  });

  heroHeader.append(heroTitle, heroSubtitle, askAiBtn, calcLauncherBtn);

  const heroStats = document.createElement('div');
  heroStats.className = 'sourcing-hero__stats';

  const statSuppliers = createStatCard(t('sourcing.stats.suppliers'), '48+');
  const statAvgMargin = createStatCard(t('sourcing.stats.avg_margin'), '22.4%');
  const statMaxProfit = createStatCard(t('sourcing.stats.top_opportunity'), '৳ 850');

  heroStats.append(statSuppliers, statAvgMargin, statMaxProfit);
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

  // Secondary Filter Row: Margins, Verification, Shipping, Sort
  const secondaryRow = document.createElement('div');
  secondaryRow.className = 'sourcing-filter-row';

  // Margin % Pills
  const marginGroup = document.createElement('div');
  marginGroup.className = 'sourcing-filter-group';
  const marginLabel = document.createElement('span');
  marginLabel.className = 'sourcing-filter-label';
  marginLabel.textContent = t('sourcing.filters.margin');
  marginGroup.append(marginLabel);

  const marginPills = MARGIN_FILTERS.map((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sourcing-pill-btn ${m.value === state.minMarginPct ? 'active' : ''}`;
    btn.textContent = m.label;
    btn.addEventListener('click', () => {
      state.minMarginPct = m.value;
      marginPills.forEach((p) => p.btn.classList.toggle('active', p.value === state.minMarginPct));
      loadProducts();
    });
    marginGroup.append(btn);
    return { value: m.value, btn };
  });

  // Verification Tier Select
  const tierGroup = document.createElement('div');
  tierGroup.className = 'sourcing-filter-group';
  const tierLabel = document.createElement('span');
  tierLabel.className = 'sourcing-filter-label';
  tierLabel.textContent = t('sourcing.filters.tier');

  const tierSelect = document.createElement('select');
  tierSelect.className = 'sourcing-select';
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
  const sortLabel = document.createElement('span');
  sortLabel.className = 'sourcing-filter-label';
  sortLabel.textContent = t('sourcing.filters.sort_by');

  const sortSelect = document.createElement('select');
  sortSelect.className = 'sourcing-select';
  sortSelect.innerHTML = SORT_OPTIONS.map((opt) => `
    <option value="${opt.value}">${isBn ? opt.label_bn : opt.label_en}</option>
  `).join('');
  sortSelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    loadProducts();
  });
  sortGroup.append(sortLabel, sortSelect);

  secondaryRow.append(marginGroup, tierGroup, sortGroup);
  filterBar.append(catRow, secondaryRow);

  // 3. Grid Container for Sourcing Cards
  const grid = document.createElement('section');
  grid.className = 'sourcing-grid';

  container.append(hero, filterBar, grid);

  async function loadProducts() {
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
        minMarginPct: state.minMarginPct !== '0' ? state.minMarginPct : undefined,
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
              state.minMarginPct = '0';
              state.verificationTier = 'all';
              tierSelect.value = 'all';
              catPills.forEach((p) => p.btn.classList.toggle('active', p.key === 'all'));
              marginPills.forEach((p) => p.btn.classList.toggle('active', p.value === '0'));
              loadProducts();
            },
          }),
        });
        grid.append(empty);
        return;
      }

      state.products.forEach((product) => {
        grid.append(createSourcingCard(product, {
          onCalculate: (p, btn) => {
            const initialBase = p.pricing?.base_cost ?? p.base_cost ?? 500;
            const initialWholesale = p.pricing?.wholesale_margin ?? p.wholesale_margin ?? 0;
            const initialRetail = parseFloat(p.price || 700);
            modalCalc.setValues(initialBase, initialWholesale, initialRetail);
            calcModal.openModal(btn);
          },
          onAddToStore: (p, btn) => {
            addToStoreDrawer.openForProduct(p, btn);
          },
          isSellRestricted,
        }));
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
  return () => {};
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

function createSourcingCard(product, { onCalculate, onAddToStore, isSellRestricted = false }) {
  const card = document.createElement('article');
  card.className = 'sourcing-card';

  const isBn = getLanguage() === 'bn';
  const title = (isBn && product.title_bn) ? product.title_bn : (product.title_en || product.title);
  const price = parseFloat(product.price || 0);
  const wholesaleCost = product.pricing?.wholesale_cost ?? product.sourcing_opportunity?.wholesale_cost ?? (price * 0.7);
  const salerProfit = product.pricing?.saler_earning ?? product.sourcing_opportunity?.potential_profit ?? (price * 0.15);
  const marginPct = product.margin_pct ?? product.pricing?.saler_margin_pct ?? 18;
  const tier = product.supplier_tier || 'standard';

  // Media
  const media = document.createElement('div');
  media.className = 'sourcing-card__media';

  const placeholder = document.createElement('div');
  placeholder.className = 'sourcing-card__placeholder';
  placeholder.textContent = title ? title.slice(0, 2).toUpperCase() : 'PR';

  const imageUrl = resolveProductImage(product);
  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'sourcing-card__img';
    img.src = imageUrl;
    img.alt = title || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(placeholder), { once: true });
    media.append(img);
  } else {
    media.append(placeholder);
  }

  // Badges
  const badges = document.createElement('div');
  badges.className = 'sourcing-card__badges';

  const marginBadge = document.createElement('span');
  marginBadge.className = 'sourcing-card__margin-badge';
  marginBadge.textContent = `+${marginPct}% ${t('sourcing.card.margin')}`;

  const tierBadge = document.createElement('span');
  tierBadge.className = `sourcing-card__tier-badge sourcing-card__tier-badge--${tier}`;
  tierBadge.textContent = tier.toUpperCase();

  badges.append(marginBadge, tierBadge);
  media.append(badges);

  // Dispatch Speed Tag
  const dispatch = document.createElement('span');
  dispatch.className = 'sourcing-card__dispatch';
  dispatch.textContent = tier === 'elite' ? `⚡ 24h ${t('sourcing.card.dispatch')}` : `📦 48h ${t('sourcing.card.dispatch')}`;
  media.append(dispatch);

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

  header.append(cat, hTitle);

  // Pricing Matrix
  const matrix = document.createElement('div');
  matrix.className = 'sourcing-card__pricing-matrix';

  matrix.innerHTML = `
    <div class="sourcing-card__pricing-row">
      <span class="sourcing-card__pricing-label">${t('sourcing.calc.wholesale_cost')}</span>
      <span class="sourcing-card__pricing-val">${formatCurrency(wholesaleCost)}</span>
    </div>
    <div class="sourcing-card__pricing-row">
      <span class="sourcing-card__pricing-label">${t('sourcing.card.suggested_retail')}</span>
      <span class="sourcing-card__pricing-val">${formatCurrency(price)}</span>
    </div>
    <div class="sourcing-card__pricing-row sourcing-card__pricing-row--profit">
      <span class="sourcing-card__pricing-label font-bold">${t('sourcing.card.profit_per_sale')}</span>
      <span class="sourcing-card__profit-val">+${formatCurrency(salerProfit)}</span>
    </div>
  `;

  // Actions
  const actions = document.createElement('div');
  actions.className = 'sourcing-card__actions';

  const calcBtn = Button({
    label: `🧮 ${t('sourcing.card.btn_calc')}`,
    variant: 'secondary',
    size: 'sm',
    onClick: (e) => onCalculate(product, e.currentTarget),
  });

  const addBtn = Button({
    label: `+ ${t('sourcing.card.btn_add_store')}`,
    variant: 'primary',
    size: 'sm',
    disabled: isSellRestricted,
    onClick: (e) => onAddToStore(product, e.currentTarget),
  });

  if (isSellRestricted) {
    addBtn.title = t('sourcing.restricted_can_sell_tooltip');
  }

  actions.append(calcBtn, addBtn);
  content.append(header, matrix, actions);
  card.append(media, content);

  return card;
}
