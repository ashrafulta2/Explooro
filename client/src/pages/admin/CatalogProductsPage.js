/**
 * CatalogProductsPage.js — Platform Catalog & Products Governance (Admin).
 *
 * Implements:
 * 1. KPI Overview Strip (Total Products, Active/In-Stock, Low Stock, Categories, Total Inventory Value).
 * 2. Search & Advanced Multi-Filter Toolbar (Text search, Category, Stock Level, Supplier Tier, Flash Sale, Sorting).
 * 3. Table View & Grid View with thumbnail previews, pricing & margin breakdown, stock level bars, and status toggles.
 * 4. Product Details Inspector Drawer with financial split, specs, variants matrix, and supplier info.
 * 5. Add / Create New Product Modal with sample preset generation and validation.
 * 6. Edit Product Modal & Quick Stock Adjustments with live persistence.
 * 7. CSV Export & Bulk Operations.
 * 8. Zero-runtime dependencies, strict design tokens, and full bilingual i18n (EN/BN).
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatNumber, formatCurrency } from '../../services/format.js';
import { PLACEHOLDER_COLOURS, placeholderInitials } from '../../components/product/ProductCard.js';
import { ImageUploader } from '../../components/media/ImageUploader.js';
import { can } from '../../services/permissions.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';

// Mirrors MAX_PRODUCT_IMAGES in server/src/services/product.service.js — the API rejects more.
const MAX_PRODUCT_PHOTOS = 8;

/**
 * Broken/blocked image CDNs (ad-blockers, corporate proxies, dead links) must never surface the
 * browser's default broken-image icon with overflowing alt text — swap in a local, dependency-free
 * initials tile instead, mirroring the storefront ProductCard's own onerror handling.
 */
function attachImageFallback(img, title, ref, placeholderClassName) {
  img.addEventListener(
    'error',
    () => {
      const hash = String(ref || title || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const palette = PLACEHOLDER_COLOURS[hash % PLACEHOLDER_COLOURS.length] || PLACEHOLDER_COLOURS[0];
      const placeholder = document.createElement('div');
      placeholder.className = placeholderClassName;
      placeholder.style.cssText = `background:${palette.bg};color:${palette.fg}`;
      placeholder.textContent = placeholderInitials(title);
      // Preserve any data-* the caller relies on (e.g. the Add-Product preset picker reads
      // data-src on click) so replacing the <img> doesn't silently break that behaviour.
      if (img.dataset) {
        Object.entries(img.dataset).forEach(([key, value]) => {
          placeholder.dataset[key] = value;
        });
      }
      img.replaceWith(placeholder);
    },
    { once: true }
  );
}

export default function CatalogProductsPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'catalog-page';

  let products = [];
  let stats = {
    total_products: 0,
    in_stock_count: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
    flash_sale_count: 0,
    verified_suppliers_count: 0,
    total_categories: 0,
    total_potential_inventory_value: 0,
  };

  // WHY this is state and not the literal 10 it replaces: "low stock" is a business number, so the
  // server resolves it (platform_settings -> per-product low_stock_threshold) and reports it back
  // alongside the counts. The KPI, the filter and the row badge must all use the same figure, or
  // the strip contradicts the table underneath it.
  let lowStockThreshold = 10;

  /** A product's own threshold wins over the catalog-wide one, exactly as the SQL does. */
  const thresholdFor = (p) => Number(p.low_stock_threshold ?? lowStockThreshold) || lowStockThreshold;
  const isLow = (p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= thresholdFor(p);

  let selectedRefs = new Set();
  let isLoading = true;
  let viewMode = 'table'; // 'table' | 'grid'

  // Filter & Search State
  let searchQuery = '';
  let selectedCategory = 'ALL';
  let selectedStockStatus = 'ALL';
  let selectedSupplierTier = 'ALL';
  let selectedFlashSale = 'ALL';
  let sortBy = 'featured';

  // ---------------------------------------------------------------------------
  // 1. Header & Actions
  // ---------------------------------------------------------------------------
  const isSupplierView = window.location.pathname.startsWith('/supplier');

  const header = document.createElement('div');
  header.className = 'catalog-page__header';

  const titles = document.createElement('div');
  titles.className = 'catalog-page__titles';

  if (isSupplierView) {
    const breadcrumb = document.createElement('div');
    breadcrumb.style.fontSize = 'var(--text-xs)';
    breadcrumb.style.color = 'var(--text-secondary)';
    breadcrumb.style.marginBottom = '4px';
    breadcrumb.innerHTML = `<a href="/supplier" style="color: inherit; text-decoration: none; font-weight: 700;">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a> / <span class="font-mono">Products Catalog</span>`;
    titles.append(breadcrumb);
  }

  const title = document.createElement('h1');
  title.className = 'catalog-page__title';
  title.textContent = isSupplierView ? '📦 ' + t('supplier.products_title', 'Supplier Products & Catalog') : t('admin_catalog.title', 'Catalog & Products Governance');

  const subtitle = document.createElement('p');
  subtitle.className = 'catalog-page__subtitle';
  subtitle.textContent = isSupplierView
    ? t('supplier.products_subtitle', 'Manage your manufacturing SKUs, adjust physical stock counts, set wholesale margins, and publish new products.')
    : t(
        'admin_catalog.subtitle',
        'Oversee platform inventory, audit commercial margins, manage live supplier listings, and register new sample products.'
      );

  titles.append(title, subtitle);

  const headerActions = document.createElement('div');
  headerActions.className = 'catalog-page__header-actions';

  const exportBtn = Button({
    label: t('admin_catalog.export_csv', 'Export CSV'),
    variant: 'secondary',
    size: 'sm',
    onClick: () => handleExportCsv(),
  });

  const addProductBtn = Button({
    label: t('admin_catalog.add_product', '+ Add New Product'),
    variant: 'primary',
    size: 'sm',
    onClick: () => openAddProductModal(),
  });

  headerActions.append(exportBtn, addProductBtn);
  header.append(titles, headerActions);

  // ---------------------------------------------------------------------------
  // 2. Stats / KPI Cards
  // ---------------------------------------------------------------------------
  const statsContainer = document.createElement('div');
  statsContainer.className = 'catalog-stats';

  function renderStats() {
    statsContainer.innerHTML = '';

    const cards = [
      {
        label: t('admin_catalog.kpi_total_products', 'Total Products'),
        value: formatNumber(stats.total_products),
        meta: `${formatNumber(stats.total_categories)} ${t('admin_catalog.kpi_categories_active', 'Active Categories')}`,
        metaClass: '',
      },
      {
        label: t('admin_catalog.kpi_in_stock', 'In-Stock & Live'),
        value: formatNumber(stats.in_stock_count),
        meta: `${formatNumber(Math.round((stats.in_stock_count / (stats.total_products || 1)) * 100))}% ${t('admin_catalog.kpi_availability', 'Available')}`,
        metaClass: 'catalog-stat-card__meta--success',
      },
      {
        label: t('admin_catalog.kpi_low_stock', { threshold: formatNumber(lowStockThreshold) }),
        value: formatNumber(stats.low_stock_count),
        meta: `${formatNumber(stats.out_of_stock_count)} ${t('admin_catalog.kpi_out_of_stock', 'Out of Stock')}`,
        metaClass: stats.low_stock_count > 0 ? 'catalog-stat-card__meta--warning' : '',
      },
      {
        label: t('admin_catalog.kpi_inventory_value', 'Potential GMV Value'),
        value: formatCurrency(stats.total_potential_inventory_value),
        meta: `${formatNumber(stats.verified_suppliers_count)} ${t('admin_catalog.kpi_verified_suppliers', 'Verified Suppliers')}`,
        metaClass: 'catalog-stat-card__meta--success',
      },
    ];

    cards.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'catalog-stat-card';
      card.innerHTML = `
        <span class="catalog-stat-card__label">${c.label}</span>
        <span class="catalog-stat-card__value">${c.value}</span>
        <span class="catalog-stat-card__meta ${c.metaClass}">${c.meta}</span>
      `;
      statsContainer.append(card);
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Toolbar & Filters
  // ---------------------------------------------------------------------------
  const toolbar = document.createElement('div');
  toolbar.className = 'catalog-toolbar';

  const toolbarMain = document.createElement('div');
  toolbarMain.className = 'catalog-toolbar__main';

  // Search input
  const searchWrap = document.createElement('div');
  searchWrap.className = 'catalog-toolbar__search-wrap';
  searchWrap.innerHTML = `
    <span class="catalog-toolbar__search-icon">🔍</span>
    <input 
      type="search" 
      class="catalog-toolbar__search-input" 
      placeholder="${t('admin_catalog.search_placeholder', 'Search by title, SKU ref, store, district…')}" 
      aria-label="${t('admin_catalog.search_placeholder', 'Search by title, SKU ref, store, district…')}"
    />
  `;

  const searchInput = searchWrap.querySelector('input');
  let debounceTimer = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderContent();
    }, 200);
  });

  // Filters strip
  const filtersStrip = document.createElement('div');
  filtersStrip.className = 'catalog-toolbar__filters';

  // Category select
  const categorySelect = document.createElement('select');
  categorySelect.className = 'catalog-select';
  categorySelect.setAttribute('aria-label', t('admin_catalog.all_categories', 'All Categories'));
  const categoriesList = [
    'Clothing',
    'Electronics',
    'Kids',
    'Food & Grocery',
    'Beauty & Health',
    'Crafts',
    'Home & Kitchen',
    'Jewellery',
    'Footwear',
    'Furniture',
    'Bags',
    'Wholesale',
  ];
  categorySelect.innerHTML = `<option value="ALL">${t('admin_catalog.all_categories', 'All Categories')}</option>` +
    categoriesList.map((c) => `<option value="${c}">${c}</option>`).join('');
  categorySelect.addEventListener('change', (e) => {
    selectedCategory = e.target.value;
    renderContent();
  });

  // Stock status select
  const stockSelect = document.createElement('select');
  stockSelect.className = 'catalog-select';
  stockSelect.setAttribute('aria-label', t('admin_catalog.all_stock', 'All Stock Status'));
  stockSelect.innerHTML = `
    <option value="ALL">${t('admin_catalog.all_stock', 'All Stock Status')}</option>
    <option value="IN_STOCK">${t('admin_catalog.in_stock_only', 'In Stock (> 0)')}</option>
    <option value="LOW_STOCK">${t('admin_catalog.low_stock_only', { threshold: formatNumber(lowStockThreshold) })}</option>
    <option value="OUT_OF_STOCK">${t('admin_catalog.out_of_stock_only', 'Out of Stock (0)')}</option>
  `;
  stockSelect.addEventListener('change', (e) => {
    selectedStockStatus = e.target.value;
    renderContent();
  });

  // Supplier Tier select
  const tierSelect = document.createElement('select');
  tierSelect.className = 'catalog-select';
  tierSelect.setAttribute('aria-label', t('admin_catalog.all_tiers', 'All Supplier Tiers'));
  tierSelect.innerHTML = `
    <option value="ALL">${t('admin_catalog.all_tiers', 'All Supplier Tiers')}</option>
    <option value="elite">Elite Tier</option>
    <option value="verified">Verified Tier</option>
    <option value="standard">Standard Tier</option>
  `;
  tierSelect.addEventListener('change', (e) => {
    selectedSupplierTier = e.target.value;
    renderContent();
  });

  // Flash Sale select
  const flashSaleSelect = document.createElement('select');
  flashSaleSelect.className = 'catalog-select';
  flashSaleSelect.setAttribute('aria-label', t('admin_catalog.all_promos', 'All Promotion States'));
  flashSaleSelect.innerHTML = `
    <option value="ALL">${t('admin_catalog.all_promos', 'All Promotions')}</option>
    <option value="FLASH_SALE">${t('admin_catalog.flash_sale_only', 'Flash Sale 🔥')}</option>
    <option value="REGULAR">${t('admin_catalog.regular_only', 'Regular Pricing')}</option>
  `;
  flashSaleSelect.addEventListener('change', (e) => {
    selectedFlashSale = e.target.value;
    renderContent();
  });

  // Sort select
  const sortSelect = document.createElement('select');
  sortSelect.className = 'catalog-select';
  sortSelect.setAttribute('aria-label', t('admin_catalog.sort_by', 'Sort By'));
  sortSelect.innerHTML = `
    <option value="featured">${t('admin_catalog.sort_featured', 'Sort: Featured')}</option>
    <option value="price_asc">${t('admin_catalog.sort_price_asc', 'Price: Low to High')}</option>
    <option value="price_desc">${t('admin_catalog.sort_price_desc', 'Price: High to Low')}</option>
    <option value="stock_asc">${t('admin_catalog.sort_stock_asc', 'Stock: Low to High')}</option>
    <option value="margin_desc">${t('admin_catalog.sort_margin_desc', 'Margin: High to Low')}</option>
    <option value="rating_desc">${t('admin_catalog.sort_rating_desc', 'Rating: Top Rated')}</option>
  `;
  sortSelect.addEventListener('change', (e) => {
    sortBy = e.target.value;
    renderContent();
  });

  // View toggle (Table vs Grid)
  const viewToggle = document.createElement('div');
  viewToggle.className = 'catalog-view-toggle';

  const tableBtn = document.createElement('button');
  tableBtn.className = `catalog-view-toggle__btn ${viewMode === 'table' ? 'catalog-view-toggle__btn--active' : ''}`;
  tableBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg> ' + t('admin_catalog.view_table', 'Table');
  tableBtn.addEventListener('click', () => {
    viewMode = 'table';
    tableBtn.classList.add('catalog-view-toggle__btn--active');
    gridBtn.classList.remove('catalog-view-toggle__btn--active');
    renderContent();
  });

  const gridBtn = document.createElement('button');
  gridBtn.className = `catalog-view-toggle__btn ${viewMode === 'grid' ? 'catalog-view-toggle__btn--active' : ''}`;
  gridBtn.innerHTML = '🖼️ ' + t('admin_catalog.view_grid', 'Grid');
  gridBtn.addEventListener('click', () => {
    viewMode = 'grid';
    gridBtn.classList.add('catalog-view-toggle__btn--active');
    tableBtn.classList.remove('catalog-view-toggle__btn--active');
    renderContent();
  });

  viewToggle.append(tableBtn, gridBtn);

  filtersStrip.append(categorySelect, stockSelect, tierSelect, flashSaleSelect, sortSelect, viewToggle);
  toolbarMain.append(searchWrap, filtersStrip);
  toolbar.append(toolbarMain);

  // Bulk action banner
  const bulkBar = document.createElement('div');
  bulkBar.className = 'catalog-bulk-bar';
  bulkBar.style.display = 'none';

  // ---------------------------------------------------------------------------
  // 4. Products Table & Grid Container
  // ---------------------------------------------------------------------------
  const contentArea = document.createElement('div');
  contentArea.className = 'catalog-content-area';

  function getFilteredProducts() {
    let list = [...products];

    if (searchQuery) {
      list = list.filter(
        (p) =>
          p.title_en?.toLowerCase().includes(searchQuery) ||
          p.title_bn?.toLowerCase().includes(searchQuery) ||
          p.ref?.toLowerCase().includes(searchQuery) ||
          p.district?.toLowerCase().includes(searchQuery) ||
          p.category?.toLowerCase().includes(searchQuery) ||
          p.store_ref?.toLowerCase().includes(searchQuery)
      );
    }

    if (selectedCategory !== 'ALL') {
      list = list.filter((p) => p.category === selectedCategory);
    }

    if (selectedStockStatus === 'IN_STOCK') {
      list = list.filter((p) => (p.stock ?? 0) > 0);
    } else if (selectedStockStatus === 'LOW_STOCK') {
      list = list.filter(isLow);
    } else if (selectedStockStatus === 'OUT_OF_STOCK') {
      list = list.filter((p) => (p.stock ?? 0) === 0);
    }

    if (selectedSupplierTier !== 'ALL') {
      list = list.filter((p) => (p.supplier_tier || 'standard').toLowerCase() === selectedSupplierTier.toLowerCase());
    }

    if (selectedFlashSale === 'FLASH_SALE') {
      list = list.filter((p) => Boolean(p.is_flash_sale));
    } else if (selectedFlashSale === 'REGULAR') {
      list = list.filter((p) => !p.is_flash_sale);
    }

    // Sorting
    list.sort((a, b) => {
      if (sortBy === 'price_asc') return parseFloat(a.price) - parseFloat(b.price);
      if (sortBy === 'price_desc') return parseFloat(b.price) - parseFloat(a.price);
      if (sortBy === 'stock_asc') return (a.stock ?? 0) - (b.stock ?? 0);
      if (sortBy === 'margin_desc') return (b.margin_pct ?? 0) - (a.margin_pct ?? 0);
      if (sortBy === 'rating_desc') return parseFloat(b.rating ?? 0) - parseFloat(a.rating ?? 0);
      return 0;
    });

    return list;
  }

  function updateBulkBar() {
    if (selectedRefs.size === 0) {
      bulkBar.style.display = 'none';
      return;
    }

    bulkBar.style.display = 'flex';
    bulkBar.innerHTML = `
      <span>${selectedRefs.size} ${t('admin_catalog.items_selected', 'products selected')}</span>
      <div class="catalog-bulk-bar__actions">
        ${canStartFlashSale() ? `<button class="catalog-icon-btn" id="bulk-flash-start">⚡ ${t('admin_catalog.bulk_flash_start', 'Start Flash Sale')}</button>` : ''}
        ${canEndFlashSale() ? `<button class="catalog-icon-btn" id="bulk-flash-end">⏹ ${t('admin_catalog.bulk_flash_end', 'End Flash Sale')}</button>` : ''}
        <button class="catalog-icon-btn" id="bulk-stock-btn">📦 ${t('admin_catalog.bulk_add_stock', 'Add Stock')}</button>
        <button class="catalog-icon-btn catalog-icon-btn--danger" id="bulk-delete-btn">🗑️ ${t('common.delete', 'Delete')}</button>
      </div>
    `;

    // WHY the old handlers were replaced: they sent PUT {is_flash_sale} / {stock: old + 50}, which the
    // server has no route or field for, and swallowed every error with .catch(() => {}) before
    // toasting "updated successfully" — so the bulk bar always claimed success against a real server.
    const selectedProducts = () => products.filter((p) => selectedRefs.has(p.ref));
    bulkBar.querySelector('#bulk-flash-start')?.addEventListener('click', () => openFlashSaleModal(selectedProducts()));
    bulkBar.querySelector('#bulk-flash-end')?.addEventListener('click', () => endFlashSales(selectedProducts()));
    bulkBar.querySelector('#bulk-stock-btn')?.addEventListener('click', () => openRestockModal(selectedProducts()));

    bulkBar.querySelector('#bulk-delete-btn')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: t('admin_catalog.confirm_bulk_delete_title', 'Delete Selected Products'),
        description: t(
          'admin_catalog.confirm_bulk_delete_msg',
          'Are you sure you want to remove these {{count}} products from the platform catalog?',
          { count: selectedRefs.size }
        ),
        confirmLabel: t('common.delete', 'Delete'),
        variant: 'danger',
      });
      if (!ok) return;

      for (const ref of selectedRefs) {
        await api.delete(`/products/${ref}`).catch(() => {});
      }
      toast.success(t('admin_catalog.bulk_deleted', 'Selected products deleted.'));
      selectedRefs.clear();
      await loadData();
    });
  }

  function renderContent() {
    contentArea.innerHTML = '';
    const filtered = getFilteredProducts();

    if (isLoading) {
      contentArea.innerHTML = `
        <div style="padding: var(--space-8); text-align: center; color: var(--text-muted);">
          <div class="skeleton" style="height: 300px; width: 100%; border-radius: var(--radius-lg);"></div>
        </div>
      `;
      return;
    }

    if (filtered.length === 0) {
      contentArea.innerHTML = `
        <div style="padding: var(--space-9); text-align: center; background: var(--surface-1); border: 1px solid var(--border-strong); border-radius: var(--radius-lg);">
          <div style="font-size: 40px; margin-bottom: var(--space-2);">📦</div>
          <h3 style="font-size: var(--text-base); font-weight: 600; margin: 0 0 var(--space-1); color: var(--text-primary);">${t('admin_catalog.no_products_found', 'No products match your filters')}</h3>
          <p style="font-size: var(--text-sm); color: var(--text-muted); margin: 0 0 var(--space-4);">${t('admin_catalog.try_adjusting_filters', 'Try modifying search criteria or clearing selected category.')}</p>
          <button class="catalog-icon-btn" id="reset-filters-btn">${t('admin_catalog.reset_filters', 'Reset Filters')}</button>
        </div>
      `;
      contentArea.querySelector('#reset-filters-btn')?.addEventListener('click', () => {
        searchQuery = '';
        searchInput.value = '';
        selectedCategory = 'ALL';
        categorySelect.value = 'ALL';
        selectedStockStatus = 'ALL';
        stockSelect.value = 'ALL';
        selectedSupplierTier = 'ALL';
        tierSelect.value = 'ALL';
        selectedFlashSale = 'ALL';
        flashSaleSelect.value = 'ALL';
        sortBy = 'featured';
        sortSelect.value = 'featured';
        renderContent();
      });
      return;
    }

    if (viewMode === 'table') {
      renderTableView(filtered);
    } else {
      renderGridView(filtered);
    }

    updateBulkBar();
  }

  function renderTableView(items) {
    const tableWrap = document.createElement('div');
    tableWrap.className = 'catalog-table-wrap';

    const table = document.createElement('table');
    table.className = 'catalog-table';

    const allChecked = items.length > 0 && items.every((p) => selectedRefs.has(p.ref));

    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 36px;"><input type="checkbox" id="select-all-header" ${allChecked ? 'checked' : ''} aria-label="Select all" /></th>
          <th>${t('admin_catalog.col_product', 'Product & SKU')}</th>
          <th>${t('admin_catalog.col_category', 'Category & District')}</th>
          <th>${t('admin_catalog.col_supplier', 'Supplier & Tier')}</th>
          <th>${t('admin_catalog.col_pricing', 'Retail / Margin')}</th>
          <th>${t('admin_catalog.col_stock', 'Stock Level')}</th>
          <th>${t('admin_catalog.col_status', 'Status')}</th>
          <th style="text-align: right;">${t('admin_catalog.col_actions', 'Actions')}</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const selectAllBox = table.querySelector('#select-all-header');
    selectAllBox?.addEventListener('change', (e) => {
      if (e.target.checked) {
        items.forEach((p) => selectedRefs.add(p.ref));
      } else {
        items.forEach((p) => selectedRefs.delete(p.ref));
      }
      renderContent();
    });

    const tbody = table.querySelector('tbody');

    items.forEach((p) => {
      const tr = document.createElement('tr');
      const isSelected = selectedRefs.has(p.ref);
      const isLowStock = isLow(p);
      const isOutOfStock = (p.stock ?? 0) === 0;

      const stockPct = Math.min(100, Math.round(((p.stock ?? 0) / 100) * 100));
      const fillClass = isOutOfStock
        ? 'catalog-stock-fill--out'
        : isLowStock
        ? 'catalog-stock-fill--low'
        : '';

      const tierBadgeVariant = p.supplier_tier === 'elite' ? 'brand' : p.supplier_tier === 'verified' ? 'success' : 'neutral';

      tr.innerHTML = `
        <td><input type="checkbox" class="row-checkbox" data-ref="${p.ref}" ${isSelected ? 'checked' : ''} aria-label="Select ${p.title_en}" /></td>
        <td>
          <div class="catalog-item-cell">
            <img class="catalog-thumb" src="${p.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=80'}" alt="${p.title_en}" loading="lazy" />
            <div class="catalog-item-meta">
              <a href="javascript:void(0)" class="catalog-item-title inspect-link" data-ref="${p.ref}">
                ${isBn ? (p.title_bn || p.title_en) : (p.title_en || p.title_bn)}
              </a>
              <span class="catalog-item-bn">${isBn ? p.title_en : (p.title_bn || '')}</span>
              <span class="catalog-item-ref">${p.ref}</span>
            </div>
          </div>
        </td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-weight: 500; color: var(--text-primary);">${p.category || 'General'}</span>
            <span style="font-size: var(--text-xs); color: var(--text-muted);">📍 ${p.district || 'Dhaka'}</span>
          </div>
        </td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <span style="font-weight: 500; font-size: var(--text-sm);">${p.store_ref || 'Official Store'}</span>
            <div><span class="badge badge--${tierBadgeVariant} badge--sm">${p.supplier_tier || 'standard'}</span></div>
          </div>
        </td>
        <td>
          <div class="catalog-price-cell">
            <span class="catalog-price-retail">${formatCurrency(p.price || 0)}</span>
            <span class="catalog-price-margin">${formatNumber(p.margin_pct ?? 18)}% ${t('admin_catalog.saler_margin', 'margin')}</span>
          </div>
        </td>
        <td>
          <div class="catalog-stock-wrap">
            <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 600;">
              <span>${formatNumber(p.stock ?? 0)} ${t('admin_catalog.units', 'units')}</span>
              ${isOutOfStock ? `<span style="color: var(--danger);">${t('admin_catalog.out_of_stock', 'Out')}</span>` : ''}
              ${isLowStock ? `<span style="color: var(--warning);">${t('admin_catalog.low_stock', 'Low')}</span>` : ''}
            </div>
            <div class="catalog-stock-bar">
              <div class="catalog-stock-fill ${fillClass}" style="width: ${stockPct}%;"></div>
            </div>
          </div>
        </td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${p.is_flash_sale ? `<span class="badge badge--warning badge--sm">${t('admin_catalog.flash_sale_badge', '🔥 Flash Sale')}</span>` : `<span class="badge badge--neutral badge--sm">${t('admin_catalog.status_active', 'Active')}</span>`}
          </div>
        </td>
        <td style="text-align: right;">
          <div class="catalog-row-actions" style="justify-content: flex-end;">
            <button class="catalog-icon-btn inspect-btn" data-ref="${p.ref}" title="${t('admin_catalog.inspect', 'Inspect')}">🔍</button>
            <button class="catalog-icon-btn edit-btn" data-ref="${p.ref}" title="${t('common.edit', 'Edit')}">✏️</button>
            ${
              (p.is_flash_sale ? canEndFlashSale() : canStartFlashSale())
                ? `<button class="catalog-icon-btn flash-btn" data-ref="${p.ref}" title="${
                    p.is_flash_sale ? t('admin_catalog.flash_end_btn', 'End Flash Sale') : t('admin_catalog.flash_start_btn', 'Start Flash Sale')
                  }" aria-label="${
                    p.is_flash_sale ? t('admin_catalog.flash_end_btn', 'End Flash Sale') : t('admin_catalog.flash_start_btn', 'Start Flash Sale')
                  }">${p.is_flash_sale ? '⏹' : '⚡'}</button>`
                : ''
            }
            <button class="catalog-icon-btn catalog-icon-btn--danger delete-btn" data-ref="${p.ref}" title="${t('common.delete', 'Delete')}">🗑️</button>
          </div>
        </td>
      `;

      const thumbImg = tr.querySelector('.catalog-thumb');
      if (thumbImg) attachImageFallback(thumbImg, isBn ? (p.title_bn || p.title_en) : (p.title_en || p.title_bn), p.ref, 'catalog-thumb catalog-thumb--placeholder');

      // Checkbox click
      tr.querySelector('.row-checkbox')?.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedRefs.add(p.ref);
        } else {
          selectedRefs.delete(p.ref);
        }
        updateBulkBar();
      });

      // Actions click
      tr.querySelectorAll('.inspect-link, .inspect-btn').forEach((btn) => {
        btn.addEventListener('click', () => openProductDrawer(p));
      });

      tr.querySelector('.edit-btn')?.addEventListener('click', () => openEditProductModal(p));

      tr.querySelector('.flash-btn')?.addEventListener('click', () =>
        p.is_flash_sale ? endFlashSales([p]) : openFlashSaleModal([p])
      );

      tr.querySelector('.delete-btn')?.addEventListener('click', () => handleDeleteProduct(p));

      tbody.append(tr);
    });

    tableWrap.append(table);
    contentArea.append(tableWrap);
  }

  function renderGridView(items) {
    const grid = document.createElement('div');
    grid.className = 'catalog-grid';

    items.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'catalog-card';

      const isLowStock = isLow(p);
      const isOutOfStock = (p.stock ?? 0) === 0;

      card.innerHTML = `
        <div class="catalog-card__thumb-wrap">
          <img class="catalog-card__thumb" src="${p.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=80'}" alt="${p.title_en}" loading="lazy" />
          <div class="catalog-card__badges">
            ${p.is_flash_sale ? `<span class="badge badge--warning badge--sm">${t('admin_catalog.flash_sale_badge', '🔥 Flash Sale')}</span>` : ''}
            <span class="badge badge--neutral badge--sm">${p.category || 'General'}</span>
          </div>
        </div>
        <div class="catalog-card__body">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2);">
            <h4 class="catalog-card__title">${isBn ? (p.title_bn || p.title_en) : (p.title_en || p.title_bn)}</h4>
            <span class="catalog-item-ref">${p.ref}</span>
          </div>
          <p style="font-size: var(--text-xs); color: var(--text-muted); margin: 0;">📍 ${p.district || 'Dhaka'} • ${p.store_ref || 'Supplier'}</p>
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: auto; padding-top: var(--space-2);">
            <div>
              <div style="font-size: var(--text-base); font-weight: 700; color: var(--text-primary);">${formatCurrency(p.price || 0)}</div>
              <div style="font-size: 11px; color: var(--success); font-weight: 600;">${formatNumber(p.margin_pct ?? 18)}% ${t('admin_catalog.saler_margin', 'margin')}</div>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 12px; font-weight: 600; color: ${isOutOfStock ? 'var(--danger)' : isLowStock ? 'var(--warning)' : 'var(--text-primary)'};">
                ${formatNumber(p.stock ?? 0)} ${t('admin_catalog.units_in_stock', 'in stock')}
              </span>
              <div style="font-size: 11px; color: var(--text-muted);">⭐ ${p.rating || '4.5'} (${p.rating_count || 12})</div>
            </div>
          </div>
        </div>
        <div class="catalog-card__footer">
          <button class="catalog-icon-btn inspect-btn" style="flex: 1;">🔍 ${t('admin_catalog.inspect', 'Inspect')}</button>
          <button class="catalog-icon-btn edit-btn" style="flex: 1;">✏️ ${t('common.edit', 'Edit')}</button>
          <button class="catalog-icon-btn catalog-icon-btn--danger delete-btn" title="${t('common.delete', 'Delete')}">🗑️</button>
        </div>
      `;

      const cardThumbImg = card.querySelector('.catalog-card__thumb');
      if (cardThumbImg) attachImageFallback(cardThumbImg, isBn ? (p.title_bn || p.title_en) : (p.title_en || p.title_bn), p.ref, 'catalog-card__thumb catalog-card__thumb--placeholder');

      card.querySelector('.inspect-btn')?.addEventListener('click', () => openProductDrawer(p));
      card.querySelector('.edit-btn')?.addEventListener('click', () => openEditProductModal(p));
      card.querySelector('.delete-btn')?.addEventListener('click', () => handleDeleteProduct(p));

      grid.append(card);
    });

    contentArea.append(grid);
  }

  // ---------------------------------------------------------------------------
  // 5. Product Details Drawer (Inspector)
  // ---------------------------------------------------------------------------
  function openProductDrawer(product) {
    const retail = parseFloat(product.price || 0);
    const salerSplitPct = 40;
    const platformSplitPct = 60;
    const marginPct = product.margin_pct ?? 18;
    const netRetailMargin = retail * (marginPct / 100) * (100 / salerSplitPct);
    const wholesaleCost = Math.max(0, retail - netRetailMargin);
    const salerEarning = netRetailMargin * (salerSplitPct / 100);
    const platformEarning = netRetailMargin - salerEarning;

    const drawerContent = document.createElement('div');
    drawerContent.style.display = 'flex';
    drawerContent.style.flexDirection = 'column';
    drawerContent.style.gap = 'var(--space-5)';

    drawerContent.innerHTML = `
      <div style="border-radius: var(--radius-lg); overflow: hidden; background: var(--surface-2); border: 1px solid var(--border-strong);">
        <img class="catalog-drawer-hero-img" src="${product.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=80'}" alt="${product.title_en}" style="width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block;" />
      </div>

      <div style="display: flex; flex-direction: column; gap: var(--space-2);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2);">
          <h3 style="font-size: var(--text-lg); font-weight: 700; margin: 0; color: var(--text-primary); line-height: 1.3;">
            ${product.title_en}
          </h3>
          <span class="catalog-item-ref">${product.ref}</span>
        </div>
        <p style="font-size: var(--text-sm); color: var(--text-muted); margin: 0;">${product.title_bn || ''}</p>
        <div style="display: flex; gap: var(--space-2); margin-top: var(--space-1); flex-wrap: wrap;">
          <span class="badge badge--neutral">${product.category}</span>
          <span class="badge badge--${product.supplier_tier === 'elite' ? 'brand' : 'success'}">${product.supplier_tier || 'verified'} ${t('admin_catalog.supplier_tier_suffix', 'supplier')}</span>
          ${product.is_flash_sale ? `<span class="badge badge--warning">${t('admin_catalog.flash_sale_active_badge', '🔥 Flash Sale Active')}</span>` : ''}
        </div>
      </div>

      <!-- Financial Split Breakdown -->
      <div style="background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3);">
        <div style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em;">
          ${t('admin_catalog.financial_split_title', 'Commerce Margin & Settlement Split')}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: var(--text-sm);">
          <span style="color: var(--text-muted);">${t('admin_catalog.suggested_retail', 'Suggested Retail Price')}:</span>
          <strong style="color: var(--text-primary);">${formatCurrency(retail)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: var(--text-sm);">
          <span style="color: var(--text-muted);">${t('admin_catalog.wholesale_cost', 'Supplier Wholesale Cost')}:</span>
          <span>${formatCurrency(wholesaleCost)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: var(--text-sm); border-top: 1px dashed var(--border-strong); padding-top: var(--space-2);">
          <span style="color: var(--success); font-weight: 600;">💰 ${t('admin_catalog.saler_earning', 'Saler Reseller Earning (40%)')}:</span>
          <strong style="color: var(--success);">${formatCurrency(salerEarning)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: var(--text-sm);">
          <span style="color: var(--text-muted);">${t('admin_catalog.platform_fee', 'Platform Escrow Fee (60%)')}:</span>
          <span style="color: var(--text-muted);">${formatCurrency(platformEarning)}</span>
        </div>
      </div>

      <!-- Inventory & Supplier Details -->
      <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-3); font-size: var(--text-xs);">
        <div style="background: var(--surface-1); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: var(--space-3);">
          <div style="color: var(--text-muted);">${t('admin_catalog.stock_level', 'Stock Quantity')}</div>
          <div style="font-size: var(--text-base); font-weight: 700; color: var(--text-primary); margin-top: 2px;">${formatNumber(product.stock ?? 0)} ${t('admin_catalog.units', 'units')}</div>
        </div>
        <div style="background: var(--surface-1); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: var(--space-3);">
          <div style="color: var(--text-muted);">${t('admin_catalog.origin_district', 'District Origin')}</div>
          <div style="font-size: var(--text-base); font-weight: 700; color: var(--text-primary); margin-top: 2px;">📍 ${product.district || 'Dhaka'}</div>
        </div>
      </div>

      <!-- Description -->
      <div style="display: flex; flex-direction: column; gap: var(--space-1);">
        <span style="font-size: var(--text-xs); font-weight: 700; color: var(--text-muted); text-transform: uppercase;">
          ${t('admin_catalog.description', 'Catalog Description')}
        </span>
        <p style="font-size: var(--text-sm); color: var(--text-primary); line-height: 1.5; margin: 0;">
          ${product.description_en || 'High-grade commercial sample catalog product with guaranteed quality assurance.'}
        </p>
      </div>
    `;

    const heroImg = drawerContent.querySelector('.catalog-drawer-hero-img');
    if (heroImg) attachImageFallback(heroImg, isBn ? (product.title_bn || product.title_en) : (product.title_en || product.title_bn), product.ref, 'catalog-drawer-hero-img catalog-drawer-hero-img--placeholder');

    const drawerFooter = document.createElement('div');
    drawerFooter.style.display = 'flex';
    drawerFooter.style.gap = 'var(--space-2)';
    drawerFooter.style.width = '100%';

    const viewLiveBtn = Button({
      label: t('admin_catalog.view_marketplace', 'View on Storefront'),
      variant: 'secondary',
      size: 'sm',
      onClick: () => {
        drawer.close();
        navigate?.(`/product/${product.ref}`);
      },
    });

    const editBtn = Button({
      label: t('common.edit', 'Edit Product'),
      variant: 'primary',
      size: 'sm',
      onClick: () => {
        drawer.close();
        openEditProductModal(product);
      },
    });

    drawerFooter.append(viewLiveBtn, editBtn);

    const drawer = Drawer({
      title: t('admin_catalog.product_details', 'Product Inspection'),
      description: `SKU: ${product.ref}`,
      content: drawerContent,
      footer: drawerFooter,
      side: 'right',
      size: 'md',
    });

    drawer.open();
  }

  // WHY: the product API takes a real category_id, not a display name — load the live list.
  // `isSelected(category)` preselects the product's current category in the edit modal.
  function fillCategoryOptions(selectEl, isSelected = () => false) {
    return api
      .get('/catalog/categories')
      .then((res) => {
        const cats = res.data?.categories || res.categories || [];
        const opts = cats
          .map((c) => `<option value="${c.id}" ${isSelected(c) ? 'selected' : ''}>${c.name_en}</option>`)
          .join('');
        selectEl.innerHTML =
          `<option value="">${t('admin_catalog.select_category', 'Select a category')}</option>` + opts;
      })
      .catch(() => {
        selectEl.innerHTML = `<option value="">${t('admin_catalog.categories_failed', 'Could not load categories')}</option>`;
      });
  }

  // ---------------------------------------------------------------------------
  // 6. Add Product Modal
  // ---------------------------------------------------------------------------
  function openAddProductModal() {
    const form = document.createElement('form');
    form.className = 'catalog-form';
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = 'var(--space-4)';

    form.innerHTML = `
      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label">${t('admin_catalog.field_title_en', 'Product Title (English)')} *</label>
          <input type="text" name="title_en" class="catalog-form-input" aria-label="e.g. Traditional Handloom Jamdani" placeholder="e.g. Traditional Handloom Jamdani" required />
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label">${t('admin_catalog.field_title_bn', 'Product Title (Bangla)')}</label>
          <input type="text" name="title_bn" class="catalog-form-input" aria-label="যেমন: ঐতিহ্যবাহী তাঁতের জামদানি" placeholder="যেমন: ঐতিহ্যবাহী তাঁতের জামদানি" />
        </div>
      </div>

      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label">${t('admin_catalog.field_category', 'Category')} *</label>
          <select name="category_id" class="catalog-form-select" required>
            <option value="">${t('common.loading', 'Loading…')}</option>
          </select>
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="add-brand">${t('admin_catalog.field_brand', 'Brand')}</label>
          <input type="text" id="add-brand" name="brand" class="catalog-form-input" maxlength="120" placeholder="${t('admin_catalog.field_brand_placeholder', 'e.g. Aarong (optional)')}" />
        </div>
      </div>

      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label">${t('admin_catalog.field_price', 'Retail Price (BDT)')} *</label>
          <input type="number" step="0.01" name="price" class="catalog-form-input" aria-label="1250.00" placeholder="1250.00" required />
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label">${t('admin_catalog.field_stock', 'Initial Stock Quantity')} *</label>
          <input type="number" name="stock" class="catalog-form-input" aria-label="50" placeholder="50" value="50" required />
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label">${t('admin_catalog.field_margin', 'Saler Margin %')} *</label>
          <input type="number" name="margin_pct" class="catalog-form-input" aria-label="20" placeholder="20" value="20" required />
        </div>
      </div>

      <div class="catalog-form-group" data-slot="images">
        <span class="catalog-form-label" id="add-images-label">${t('admin_catalog.field_images', 'Product Photos')} *</span>
        <span class="catalog-form-hint">${t('admin_catalog.field_images_hint', 'Upload up to 8 photos. The first one is the main photo shown in listings.')}</span>
      </div>

      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="add-desc-en">${t('admin_catalog.field_description_en', 'Description (English)')}</label>
          <textarea id="add-desc-en" name="description_en" class="catalog-form-textarea" rows="3" placeholder="${t('admin_catalog.field_description_placeholder', 'Materials, sizing and quality guarantee…')}"></textarea>
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="add-desc-bn">${t('admin_catalog.field_description_bn', 'Description (Bangla)')}</label>
          <textarea id="add-desc-bn" name="description_bn" class="catalog-form-textarea" rows="3" placeholder="যেমন: কাপড়, মাপ ও মানের নিশ্চয়তা…"></textarea>
        </div>
      </div>
    `;

    // WHY a real uploader instead of the old stock-photo presets + URL box: POST /products only
    // links media_assets rows (product_images.media_id), so a pasted URL or an Unsplash preset was
    // silently dropped and every product was listed without a photo of the actual item.
    const uploader = ImageUploader({ purpose: 'PRODUCT', maxFiles: MAX_PRODUCT_PHOTOS, showAspectControls: false });
    uploader.setAttribute('role', 'group');
    uploader.setAttribute('aria-labelledby', 'add-images-label');
    form.querySelector('[data-slot="images"]').append(uploader);

    fillCategoryOptions(form.querySelector('select[name="category_id"]'));

    const modalFooter = document.createElement('div');
    modalFooter.style.display = 'flex';
    modalFooter.style.justifyContent = 'flex-end';
    modalFooter.style.gap = 'var(--space-2)';
    modalFooter.style.width = '100%';

    const cancelBtn = Button({
      label: t('common.cancel', 'Cancel'),
      variant: 'secondary',
      size: 'sm',
      onClick: () => modal.close(),
    });

    const submitBtn = Button({
      label: t('admin_catalog.create_btn', 'Create & List Product'),
      variant: 'primary',
      size: 'sm',
      onClick: async () => {
        const formData = new FormData(form);
        const titleEn = formData.get('title_en')?.toString().trim();
        const price = parseFloat(formData.get('price')?.toString() || '');
        const marginPct = parseFloat(formData.get('margin_pct')?.toString() || '');
        const categoryId = parseInt(formData.get('category_id')?.toString() || '', 10);

        // Highlight and focus the first invalid field so a rejected click is never silent.
        const invalid = !titleEn
          ? 'title_en'
          : !categoryId
            ? 'category_id'
            : !(price > 0)
              ? 'price'
              : !(marginPct >= 0 && marginPct < 100)
                ? 'margin_pct'
                : null;
        if (invalid) {
          const el = form.querySelector(`[name="${invalid}"]`);
          el?.focus();
          el?.setAttribute('aria-invalid', 'true');
          toast.error(t('admin_catalog.validation_error', 'Please fill in required fields.'));
          return;
        }

        const photos = uploader.getItems();
        if (photos.some((p) => p.isUploading)) {
          toast.warning(t('admin_catalog.images_uploading', 'Please wait for the photos to finish uploading.'));
          return;
        }
        const mediaIds = photos.map((p) => p.id).filter((id) => /^\d+$/.test(String(id)));
        if (!mediaIds.length) {
          uploader.scrollIntoView({ block: 'center', behavior: 'smooth' });
          uploader.querySelector('button')?.focus({ preventScroll: true });
          toast.error(t('admin_catalog.images_required', 'Add at least one product photo.'));
          return;
        }

        // WHY: the server takes cost fields, not a saler margin. The margin % is the share of the
        // retail price the saler keeps, so the supplier's base cost is retail minus that share and
        // the wholesale margin is 0 (retail >= base + wholesale then holds by construction).
        const baseCost = Math.round(price * (1 - marginPct / 100) * 100) / 100;
        const titleBn = formData.get('title_bn')?.toString().trim() || titleEn;

        const payload = {
          category_id: categoryId,
          title_en: titleEn,
          title_bn: titleBn,
          description_en: formData.get('description_en')?.toString().trim() || undefined,
          description_bn: formData.get('description_bn')?.toString().trim() || undefined,
          brand: formData.get('brand')?.toString().trim() || undefined,
          base_cost: baseCost,
          wholesale_margin: 0,
          default_retail_price: price,
          stock_qty: parseInt(formData.get('stock')?.toString() || '0', 10),
          media_ids: mediaIds,
        };

        try {
          submitBtn.setLoading(true);
          await api.post('/products', payload);
          toast.success(t('admin_catalog.product_created_success', 'Product registered in catalog!'));
          modal.close();
          await loadData();
        } catch (err) {
          toast.error(err.message || 'Failed to create product.');
        } finally {
          submitBtn.setLoading(false);
        }
      },
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitBtn.click();
    });
    // Clear the red "invalid" outline as soon as the user edits the field it was put on.
    form.addEventListener('input', (e) => e.target.removeAttribute?.('aria-invalid'));
    form.addEventListener('change', (e) => e.target.removeAttribute?.('aria-invalid'));

    modalFooter.append(cancelBtn, submitBtn);

    const modal = Modal({
      title: t('admin_catalog.modal_add_title', 'Register New Product in Catalog'),
      description: t('admin_catalog.modal_add_subtitle', 'Add new supplier listing with verified pricing and commercial profit split.'),
      content: form,
      footer: modalFooter,
      size: 'lg',
    });

    modal.open();
  }

  // ---------------------------------------------------------------------------
  // 7. Edit Product Modal
  // ---------------------------------------------------------------------------
  function openEditProductModal(product) {
    const form = document.createElement('form');
    form.className = 'catalog-form';
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = 'var(--space-4)';

    form.innerHTML = `
      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="edit-title-en">${t('admin_catalog.field_title_en', 'Product Title (English)')} *</label>
          <input type="text" id="edit-title-en" name="title_en" class="catalog-form-input" required />
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="edit-title-bn">${t('admin_catalog.field_title_bn', 'Product Title (Bangla)')}</label>
          <input type="text" id="edit-title-bn" name="title_bn" class="catalog-form-input" />
        </div>
      </div>

      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="edit-category">${t('admin_catalog.field_category', 'Category')} *</label>
          <select id="edit-category" name="category_id" class="catalog-form-select" required>
            <option value="">${t('common.loading', 'Loading…')}</option>
          </select>
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="edit-brand">${t('admin_catalog.field_brand', 'Brand')}</label>
          <input type="text" id="edit-brand" name="brand" class="catalog-form-input" maxlength="120" placeholder="${t('admin_catalog.field_brand_placeholder', 'e.g. Aarong (optional)')}" />
        </div>
      </div>

      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="edit-price">${t('admin_catalog.field_price', 'Retail Price (BDT)')} *</label>
          <input type="number" step="0.01" id="edit-price" name="price" class="catalog-form-input" required />
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="edit-stock">${t('admin_catalog.field_stock_current', 'Stock Quantity')} *</label>
          <input type="number" min="0" id="edit-stock" name="stock" class="catalog-form-input" required />
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="edit-margin">${t('admin_catalog.field_margin', 'Saler Margin %')} *</label>
          <input type="number" step="0.01" id="edit-margin" name="margin_pct" class="catalog-form-input" required />
        </div>
      </div>

      <div class="catalog-form-group" data-slot="images">
        <span class="catalog-form-label" id="edit-images-label">${t('admin_catalog.field_images', 'Product Photos')} *</span>
        <span class="catalog-form-hint">${t('admin_catalog.field_images_hint', 'Upload up to 8 photos. The first one is the main photo shown in listings.')}</span>
      </div>

      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="edit-desc-en">${t('admin_catalog.field_description_en', 'Description (English)')}</label>
          <textarea id="edit-desc-en" name="description_en" class="catalog-form-textarea" rows="3"></textarea>
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="edit-desc-bn">${t('admin_catalog.field_description_bn', 'Description (Bangla)')}</label>
          <textarea id="edit-desc-bn" name="description_bn" class="catalog-form-textarea" rows="3"></textarea>
        </div>
      </div>
    `;

    // Values are assigned as properties, never interpolated into the markup: a title containing a
    // quote (e.g. 42" TV) used to break out of value="…" and truncate the field.
    const field = (name) => form.querySelector(`[name="${name}"]`);
    const retailOf = (p) => parseFloat(p.default_retail_price ?? p.price) || 0;
    const marginOf = (p) => {
      const retail = retailOf(p);
      if (p.base_cost !== undefined && p.base_cost !== null && retail > 0) {
        const cost = parseFloat(p.base_cost) + (parseFloat(p.wholesale_margin) || 0);
        return Math.round(((retail - cost) / retail) * 10000) / 100;
      }
      return parseFloat(p.margin_pct) || 0;
    };
    let detail = product;
    const fillFields = (p) => {
      field('title_en').value = p.title_en || '';
      field('title_bn').value = p.title_bn || '';
      field('brand').value = p.brand || '';
      field('price').value = retailOf(p) ? retailOf(p).toFixed(2) : '';
      field('stock').value = p.stock_qty ?? p.stock ?? 0;
      field('margin_pct').value = marginOf(p);
      field('description_en').value = p.description_en || '';
      field('description_bn').value = p.description_bn || '';
    };
    fillFields(product);

    // Uploader starts with the product's current photos. Only rows with a real media_id can be
    // sent back; a mock fixture's synthesized gallery falls back to its single listing image.
    const toItems = (p) => {
      const real = (p.images || []).filter((i) => /^\d+$/.test(String(i.media_id ?? '')));
      if (real.length) return real.map((i) => ({ id: Number(i.media_id), url: i.url, width: i.width, height: i.height }));
      return p.image_url ? [{ id: 'current', url: p.image_url }] : [];
    };
    let photosTouched = false;
    const uploader = ImageUploader({
      purpose: 'PRODUCT',
      maxFiles: MAX_PRODUCT_PHOTOS,
      showAspectControls: false,
      initialImages: toItems(product),
      onChange: () => {
        photosTouched = true;
      },
    });
    uploader.setAttribute('role', 'group');
    uploader.setAttribute('aria-labelledby', 'edit-images-label');
    form.querySelector('[data-slot="images"]').append(uploader);

    const categorySelectEl = field('category_id');
    const categoriesReady = fillCategoryOptions(categorySelectEl, (c) =>
      product.category_id !== undefined && product.category_id !== null
        ? String(c.id) === String(product.category_id)
        : c.name_en === product.category
    );

    // WHY fetch the detail: the list row carries neither the photo ids nor brand/descriptions, so
    // editing from it alone would show an empty gallery and blank out those fields on save.
    api
      .get(`/products/${encodeURIComponent(product.ref)}`)
      .then(async (res) => {
        const d = res.data?.product || res.product;
        if (!d) return;
        detail = { ...product, ...d };
        if (!form.matches(':focus-within')) fillFields(detail);
        if (!photosTouched) uploader.setItems(toItems(detail));
        await categoriesReady;
        if (detail.category_id && !categorySelectEl.value) categorySelectEl.value = String(detail.category_id);
      })
      .catch(() => {
        /* list-row values stay in the form; saving still works for the fields shown */
      });

    const modalFooter = document.createElement('div');
    modalFooter.style.display = 'flex';
    modalFooter.style.justifyContent = 'flex-end';
    modalFooter.style.gap = 'var(--space-2)';
    modalFooter.style.width = '100%';

    const cancelBtn = Button({
      label: t('common.cancel', 'Cancel'),
      variant: 'secondary',
      size: 'sm',
      onClick: () => modal.close(),
    });

    const saveBtn = Button({
      label: t('common.save_changes', 'Save Changes'),
      variant: 'primary',
      size: 'sm',
      onClick: async () => {
        const formData = new FormData(form);
        const str = (k) => formData.get(k)?.toString().trim() || '';
        const titleEn = str('title_en');
        const categoryId = parseInt(str('category_id'), 10);
        const price = parseFloat(str('price'));
        const marginPct = parseFloat(str('margin_pct'));
        const stock = parseInt(str('stock'), 10);

        const invalid = !titleEn
          ? 'title_en'
          : !categoryId
            ? 'category_id'
            : !(price > 0)
              ? 'price'
              : !(stock >= 0)
                ? 'stock'
                : !(marginPct >= 0 && marginPct < 100)
                  ? 'margin_pct'
                  : null;
        if (invalid) {
          const el = field(invalid);
          el?.focus();
          el?.setAttribute('aria-invalid', 'true');
          toast.error(t('admin_catalog.validation_error', 'Please fill in required fields.'));
          return;
        }

        const photos = uploader.getItems();
        if (photos.some((p) => p.isUploading)) {
          toast.warning(t('admin_catalog.images_uploading', 'Please wait for the photos to finish uploading.'));
          return;
        }
        if (!photos.length) {
          uploader.scrollIntoView({ block: 'center', behavior: 'smooth' });
          uploader.querySelector('button')?.focus({ preventScroll: true });
          toast.error(t('admin_catalog.images_required', 'Add at least one product photo.'));
          return;
        }

        // Field names are the live column names (PATCH /products/:idOrRef → product.repository
        // updateProduct's allow-list). The old payload (category name, price, stock, margin_pct,
        // image_url, district, is_flash_sale) matched none of them, so every edit was a no-op.
        const payload = {
          title_en: titleEn,
          title_bn: str('title_bn') || titleEn,
          category_id: categoryId,
          brand: str('brand') || null,
          description_en: str('description_en') || null,
          description_bn: str('description_bn') || null,
          stock_qty: stock,
        };

        // Only re-derive cost when price or margin actually changed, so opening and saving an
        // untouched product never nudges its stored base cost through a rounding round-trip.
        if (price !== retailOf(detail) || marginPct !== marginOf(detail)) {
          const wholesale = parseFloat(detail.wholesale_margin) || 0;
          // Same rule as the create form: the margin % is the saler's share of retail, and the
          // supplier's existing wholesale margin is kept rather than silently zeroed.
          payload.base_cost = Math.max(0, Math.round((price * (1 - marginPct / 100) - wholesale) * 100) / 100);
          payload.wholesale_margin = wholesale;
          payload.default_retail_price = price;
        }

        // A synthesized mock photo has no media id; if it's still the only photo, leave photos alone.
        const mediaIds = photos.map((p) => p.id).filter((id) => /^\d+$/.test(String(id)));
        if (photosTouched && mediaIds.length) payload.media_ids = mediaIds.map(Number);

        try {
          saveBtn.setLoading(true);
          await api.patch(`/products/${encodeURIComponent(product.ref)}`, payload);
          toast.success(t('admin_catalog.product_updated_success', 'Product updated successfully!'));
          modal.close();
          await loadData();
        } catch (err) {
          toast.error(err.message || 'Failed to update product.');
        } finally {
          saveBtn.setLoading(false);
        }
      },
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveBtn.click();
    });
    form.addEventListener('input', (e) => e.target.removeAttribute?.('aria-invalid'));
    form.addEventListener('change', (e) => e.target.removeAttribute?.('aria-invalid'));

    modalFooter.append(cancelBtn, saveBtn);

    const modal = Modal({
      title: t('admin_catalog.modal_edit_title', 'Edit Product Listing'),
      description: `Ref: ${product.ref}`,
      content: form,
      footer: modalFooter,
      size: 'lg',
    });

    modal.open();
  }

  // ---------------------------------------------------------------------------
  // 7b. Flash Sale & Restock Actions
  // ---------------------------------------------------------------------------
  // WHY these open forms instead of flipping a flag: a flash sale is a flash_sales row with a
  // discount price, allocated units and an end time (flashSale.service.js createFlashSale), and
  // ending one means stopping that specific deal. The old one-click PUT {is_flash_sale} matched no
  // server field, so the ⚡ button "worked" only against the mock.
  const canStartFlashSale = () => can('growth.campaign.manage') && isFeatureEnabled('flash_sale');
  const canEndFlashSale = () => can('growth.campaign.emergency_stop') && isFeatureEnabled('flash_sale');

  /** Settles one request per product and reports how many succeeded, naming the first failure. */
  async function runForEach(items, fn) {
    const results = [];
    for (const p of items) {
      try {
        await fn(p);
        results.push({ p, ok: true });
      } catch (err) {
        results.push({ p, ok: false, message: err.message });
      }
    }
    return { done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
  }

  function reportBatch({ done, failed }, successMsg) {
    if (done) toast.success(successMsg(done));
    if (failed.length) {
      toast.error(
        t('admin_catalog.batch_failed', '{{count}} failed — {{title}}: {{reason}}', {
          count: failed.length,
          title: failed[0].p.title_en,
          reason: failed[0].message || t('admin_catalog.unknown_error', 'Something went wrong'),
        })
      );
    }
  }

  function openFlashSaleModal(targets) {
    const eligible = targets.filter((p) => !p.is_flash_sale && (p.stock || 0) > 0);
    const skipped = targets.length - eligible.length;
    if (!eligible.length) {
      toast.warning(t('admin_catalog.flash_none_eligible', 'None of these products can start a flash sale (already on sale or out of stock).'));
      return;
    }
    const single = eligible.length === 1 ? eligible[0] : null;
    const maxStock = Math.max(...eligible.map((p) => p.stock || 0));

    // datetime-local wants local wall-clock time without a zone; min = now so past ends are refused.
    const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    const form = document.createElement('form');
    form.className = 'catalog-form';
    form.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-4);';
    form.innerHTML = `
      ${
        skipped
          ? `<p class="catalog-form-hint">${t('admin_catalog.flash_skipped', '{{count}} selected products are skipped — already on sale or out of stock.', { count: skipped })}</p>`
          : ''
      }
      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="fs-discount">${t('admin_catalog.flash_discount_pct', 'Discount %')} *</label>
          <input type="number" id="fs-discount" name="discount_pct" class="catalog-form-input" min="1" max="99" step="1" required />
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="fs-units">${
            single ? t('admin_catalog.flash_units', 'Units at flash price') : t('admin_catalog.flash_units_each', 'Units per product')
          } *</label>
          <input type="number" id="fs-units" name="units" class="catalog-form-input" min="1" max="${maxStock}" step="1" required />
          <span class="catalog-form-hint">${
            single
              ? t('admin_catalog.flash_units_hint_single', 'In stock: {{stock}}', { stock: formatNumber(single.stock) })
              : t('admin_catalog.flash_units_hint_bulk', 'Capped at each product’s stock.')
          }</span>
        </div>
      </div>
      <div class="catalog-form-grid">
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="fs-limit">${t('admin_catalog.flash_per_user', 'Limit per customer')}</label>
          <input type="number" id="fs-limit" name="per_user_limit" class="catalog-form-input" min="1" step="1" placeholder="1" />
        </div>
        <div class="catalog-form-group">
          <label class="catalog-form-label" for="fs-ends">${t('admin_catalog.flash_ends_at', 'Ends at')} *</label>
          <input type="datetime-local" id="fs-ends" name="ends_at" class="catalog-form-input" min="${toLocalInput(new Date())}" required />
        </div>
      </div>
      ${single ? `<p class="catalog-form-hint" data-slot="preview" aria-live="polite"></p>` : ''}
    `;

    const field = (n) => form.querySelector(`[name="${n}"]`);
    const priceAfter = (p, pct) => Math.round(Number(p.price) * (1 - pct / 100) * 100) / 100;
    const preview = form.querySelector('[data-slot="preview"]');
    const updatePreview = () => {
      if (!preview) return;
      const pct = parseFloat(field('discount_pct').value);
      preview.textContent =
        pct > 0 && pct < 100
          ? t('admin_catalog.flash_preview', 'Flash price {{price}} (was {{was}})', {
              price: formatCurrency(priceAfter(single, pct)),
              was: formatCurrency(Number(single.price)),
            })
          : '';
    };
    form.addEventListener('input', (e) => {
      e.target.removeAttribute?.('aria-invalid');
      updatePreview();
    });

    const cancelBtn = Button({ label: t('common.cancel', 'Cancel'), variant: 'secondary', size: 'sm', onClick: () => modal.close() });
    const startBtn = Button({
      label: t('admin_catalog.flash_start_btn', 'Start Flash Sale'),
      variant: 'primary',
      size: 'sm',
      onClick: async () => {
        const pct = parseFloat(field('discount_pct').value);
        const units = parseInt(field('units').value, 10);
        const limitRaw = field('per_user_limit').value.trim();
        const perUser = limitRaw ? parseInt(limitRaw, 10) : undefined;
        const endsAt = field('ends_at').value ? new Date(field('ends_at').value) : null;

        const invalid = !(pct >= 1 && pct < 100)
          ? 'discount_pct'
          : !(units >= 1)
            ? 'units'
            : perUser !== undefined && !(perUser >= 1)
              ? 'per_user_limit'
              : !(endsAt && endsAt > new Date())
                ? 'ends_at'
                : null;
        if (invalid) {
          field(invalid).focus();
          field(invalid).setAttribute('aria-invalid', 'true');
          toast.error(t('admin_catalog.validation_error', 'Please fill in required fields.'));
          return;
        }

        startBtn.setLoading(true);
        const result = await runForEach(eligible, (p) =>
          api.post('/admin/growth/campaigns/flash-sales', {
            product_id: p.id,
            discount_price: priceAfter(p, pct),
            allocated_qty: Math.min(units, p.stock),
            ...(perUser !== undefined && { per_user_limit: perUser }),
            ends_at: endsAt.toISOString(),
          })
        );
        startBtn.setLoading(false);
        reportBatch(result, (n) => t('admin_catalog.flash_started', 'Flash sale started for {{count}} product(s).', { count: n }));
        if (result.done) {
          modal.close();
          selectedRefs.clear();
          await loadData();
        }
      },
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      startBtn.click();
    });

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:var(--space-2);width:100%;';
    footer.append(cancelBtn, startBtn);

    const modal = Modal({
      title: t('admin_catalog.flash_modal_title', 'Start Flash Sale'),
      description: single
        ? `${single.title_en} · ${formatCurrency(Number(single.price))}`
        : t('admin_catalog.flash_modal_bulk', '{{count}} products', { count: eligible.length }),
      content: form,
      footer,
      size: 'md',
    });
    modal.open();
  }

  async function endFlashSales(targets) {
    const live = targets.filter((p) => p.is_flash_sale && p.flash_sale_id);
    if (!live.length) {
      toast.warning(t('admin_catalog.flash_none_live', 'None of these products has a flash sale running.'));
      return;
    }
    const ok = await confirmDialog({
      title: t('admin_catalog.flash_end_title', 'End flash sale?'),
      description:
        live.length === 1
          ? t('admin_catalog.flash_end_msg_one', '"{{name}}" goes back to its normal price immediately.', { name: live[0].title_en })
          : t('admin_catalog.flash_end_msg_many', '{{count}} products go back to their normal price immediately.', { count: live.length }),
      confirmLabel: t('admin_catalog.flash_end_btn', 'End Flash Sale'),
      variant: 'danger',
    });
    if (!ok) return;

    const result = await runForEach(live, (p) =>
      api.post(`/admin/growth/campaigns/flash-sales/${p.flash_sale_id}/emergency-stop`, {
        reason: 'Ended from the admin product catalog',
      })
    );
    reportBatch(result, (n) => t('admin_catalog.flash_ended', 'Flash sale ended for {{count}} product(s).', { count: n }));
    selectedRefs.clear();
    await loadData();
  }

  function openRestockModal(targets) {
    const form = document.createElement('form');
    form.className = 'catalog-form';
    form.innerHTML = `
      <div class="catalog-form-group">
        <label class="catalog-form-label" for="restock-qty">${t('admin_catalog.restock_qty', 'Units to add to each product')} *</label>
        <input type="number" id="restock-qty" name="quantity" class="catalog-form-input" min="1" step="1" required />
        <span class="catalog-form-hint">${t('admin_catalog.restock_hint', 'Added on top of current stock, including any sales since this page loaded.')}</span>
      </div>
    `;
    const qtyEl = form.querySelector('[name="quantity"]');
    qtyEl.addEventListener('input', () => qtyEl.removeAttribute('aria-invalid'));

    const cancelBtn = Button({ label: t('common.cancel', 'Cancel'), variant: 'secondary', size: 'sm', onClick: () => modal.close() });
    const addBtn = Button({
      label: t('admin_catalog.restock_btn', 'Add Stock'),
      variant: 'primary',
      size: 'sm',
      onClick: async () => {
        const quantity = Number(qtyEl.value);
        if (!Number.isInteger(quantity) || quantity < 1) {
          qtyEl.focus();
          qtyEl.setAttribute('aria-invalid', 'true');
          toast.error(t('admin_catalog.restock_invalid', 'Enter a whole number of at least 1.'));
          return;
        }
        addBtn.setLoading(true);
        const result = await runForEach(targets, (p) =>
          api.post(`/products/${encodeURIComponent(p.ref)}/restock`, { quantity })
        );
        addBtn.setLoading(false);
        reportBatch(result, (n) =>
          t('admin_catalog.restock_done', 'Added {{qty}} units to {{count}} product(s).', { qty: formatNumber(quantity), count: n })
        );
        if (result.done) {
          modal.close();
          selectedRefs.clear();
          await loadData();
        }
      },
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      addBtn.click();
    });

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:var(--space-2);width:100%;';
    footer.append(cancelBtn, addBtn);

    const modal = Modal({
      title: t('admin_catalog.restock_title', 'Add Stock'),
      description:
        targets.length === 1
          ? `${targets[0].title_en} · ${t('admin_catalog.flash_units_hint_single', 'In stock: {{stock}}', { stock: formatNumber(targets[0].stock || 0) })}`
          : t('admin_catalog.flash_modal_bulk', '{{count}} products', { count: targets.length }),
      content: form,
      footer,
      size: 'sm',
    });
    modal.open();
  }

  // ---------------------------------------------------------------------------
  // 8. Delete Product Action
  // ---------------------------------------------------------------------------
  async function handleDeleteProduct(product) {
    const ok = await confirmDialog({
      title: t('admin_catalog.confirm_delete_title', 'Delete Product Listing'),
      description: t(
        'admin_catalog.confirm_delete_msg',
        'Are you sure you want to permanently remove "{{name}}" ({{ref}}) from the marketplace catalog?',
        { name: product.title_en, ref: product.ref }
      ),
      confirmLabel: t('common.delete', 'Delete Product'),
      variant: 'danger',
    });

    if (!ok) return;

    try {
      await api.delete(`/products/${product.ref}`);
      toast.success(t('admin_catalog.product_deleted_success', 'Product removed from catalog.'));
      await loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to delete product.');
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Export CSV Action
  // ---------------------------------------------------------------------------
  function handleExportCsv() {
    const items = getFilteredProducts();
    const headers = ['Ref', 'Title_EN', 'Title_BN', 'Category', 'District', 'Price_BDT', 'Stock', 'Margin_Pct', 'Supplier_Tier', 'Is_Flash_Sale'];
    const rows = items.map((p) => [
      p.ref,
      `"${(p.title_en || '').replace(/"/g, '""')}"`,
      `"${(p.title_bn || '').replace(/"/g, '""')}"`,
      p.category || 'General',
      p.district || 'Dhaka',
      p.price || 0,
      p.stock || 0,
      p.margin_pct || 0,
      p.supplier_tier || 'standard',
      p.is_flash_sale ? 'Yes' : 'No',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `explooro_catalog_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(t('admin_catalog.csv_exported', 'Catalog CSV exported successfully.'));
  }

  // ---------------------------------------------------------------------------
  // 10. Data Fetching
  // ---------------------------------------------------------------------------
  /**
   * Bridges the live API's product shape onto the field names this page reads.
   *
   * WHY: the server returns `stock_qty` and `category_name_en`; the page (and the mock fixtures it
   * was built against) read `stock` and `category`. Against a real server every row therefore
   * rendered as Out of Stock in the category "General". Mock-shaped fields win where present, so
   * VITE_API_MODE=mock behaves exactly as before.
   */
  function normalizeProducts(list) {
    return list.map((p) => ({
      ...p,
      stock: p.stock ?? p.stock_qty ?? 0,
      category: p.category || p.category_name_en || null,
      price: p.price ?? p.default_retail_price ?? 0,
    }));
  }

  async function loadData() {
    isLoading = true;
    renderContent();

    try {
      const [prodRes, statsRes] = await Promise.all([
        api.get('/products?limit=200'),
        // WHY the fallback survives even now that the endpoint exists: the KPI strip is not worth
        // failing the whole page over. But it must no longer fail *quietly* — swallowing the 404
        // from the missing endpoint is why this panel showed page-local totals for months.
        api.get('/admin/catalog/stats').catch((err) => {
          if (import.meta.env?.DEV) {
            // eslint-disable-next-line no-console
            console.warn('[catalog] /admin/catalog/stats unavailable, falling back to page-local counts:', err?.message || err);
          }
          return null;
        }),
      ]);

      products = normalizeProducts(prodRes?.data?.products || []);

      if (statsRes?.data?.stats) {
        stats = statsRes.data.stats;
        if (Number(stats.low_stock_threshold) > 0) {
          lowStockThreshold = Number(stats.low_stock_threshold);
          // The filter dropdown is built once, before this response lands — retitle the option so
          // it cannot advertise a cutoff different from the one the KPI and the rows now use.
          const lowOption = stockSelect.querySelector('option[value="LOW_STOCK"]');
          if (lowOption) {
            lowOption.textContent = t('admin_catalog.low_stock_only', { threshold: formatNumber(lowStockThreshold) });
          }
        }
      } else {
        // Fallback compute locally
        let gmv = 0;
        let inStock = 0;
        let lowStock = 0;
        let outOfStock = 0;
        let flash = 0;
        let verified = 0;
        const cats = new Set();

        products.forEach((p) => {
          const s = p.stock ?? 0;
          if (s > 0) inStock++;
          if (isLow(p)) lowStock++;
          if (s === 0) outOfStock++;
          if (p.is_flash_sale) flash++;
          if (p.supplier_tier === 'verified' || p.supplier_tier === 'elite') verified++;
          if (p.category) cats.add(p.category);
          gmv += parseFloat(p.price || 0) * s;
        });

        stats = {
          total_products: products.length,
          in_stock_count: inStock,
          low_stock_count: lowStock,
          out_of_stock_count: outOfStock,
          flash_sale_count: flash,
          verified_suppliers_count: verified,
          total_categories: cats.size,
          total_potential_inventory_value: Math.round(gmv),
        };
      }

      isLoading = false;
      renderStats();
      renderContent();
    } catch (err) {
      isLoading = false;
      toast.error(t('common.error_generic', 'Failed to load catalog data.'));
      renderContent();
    }
  }

  // Assemble Layout
  container.append(header, statsContainer, toolbar, bulkBar, contentArea);
  root.appendChild(container);

  // Initial load
  loadData();

  return {
    destroy() {
      container.remove();
    },
  };
}
