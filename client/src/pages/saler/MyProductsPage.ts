/**
 * MyProductsPage.ts — Shop Partner Curated Store Products (Prompt 4.8 / idea §AL.2).
 *
 * Route: /saler/products
 * Implements:
 * 1. Curated products list with live supplier stock levels.
 * 2. The supplier's fixed price.
 * 3. Product visibility toggle (Active / Hidden on storefront) & Featured pin.
 * 4. 1-Click "Create Social Flyer" deep-link to Social Kit.
 * 5. Search, Category, Stock & price sorters.
 * 6. Quick CTA to Sourcing Catalog (/saler/sourcing).
 *
 * WHY no price editor or profit column: since migration 085 the supplier sets the price and partners
 * are paid monthly from the reward pool by score, so a partner has no price to set and no per-sale profit.
 * WHY no "Reward pool / sale" column or pool sort either (owner, 2026-11-02): a per-product pool
 * figure read as the partner's own profit on that product, which a partner never earns.
 */

import { salerApi } from '../../services/saler.api.ts';
import { formatCurrency } from '../../services/format.ts';
import { escapeHtml } from '../../services/html.ts';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.ts';
import { toast } from '../../services/toast.ts';
import { Button } from '../../components/ui/Button.ts';
import { Skeleton } from '../../components/ui/Skeleton.ts';
import { EmptyState } from '../../components/ui/EmptyState.ts';
import type { PageContext } from '../types.ts';

export default function MyProductsPage(root: HTMLElement, { navigate }: PageContext = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'saler-page-container';

  let products = [];
  let loading = true;
  let searchQuery = '';
  let selectedCategory = 'all';
  let stockFilter = 'all';
  let sortBy = 'newest';
  let unsubscribeLang = null;

  function render() {
    container.innerHTML = '';
    const isBn = getLanguage() === 'bn';

    // 1. Header
    const header = document.createElement('div');
    header.className = 'saler-header-row';
    header.innerHTML = `
      <div class="saler-header-row__titles">
        <div class="saler-header-row__breadcrumb">
          <a href="/saler" class="hover:text-primary">&lt; ${t('saler.dashboard.title', 'Dashboard')}</a>
          <span>/</span>
          <span class="text-primary font-bold">${t('saler_products.title')}</span>
        </div>
        <h1 class="saler-header-row__title">
          <span>📦</span>
          <span>${t('saler_products.title')}</span>
        </h1>
        <p class="saler-header-row__subtitle">
          ${t('saler_products.subtitle')}
        </p>
      </div>
      <div class="saler-header-row__actions">
        <button id="btn-source-more" class="btn btn--primary">
          ${t('saler_products.btn_source_more')}
        </button>
      </div>
    `;
    header.querySelector<HTMLElement>('#btn-source-more').onclick = () => nav('/saler/sourcing');
    container.append(header);

    // 2. KPI Summary Strip
    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'saler-kpi-grid';
    kpiGrid.id = 'products-kpis';
    container.append(kpiGrid);
    renderKpis();

    // 3. Toolbar & Filters
    const toolbar = document.createElement('div');
    toolbar.className = 'saler-toolbar';
    toolbar.innerHTML = `
      <div class="saler-toolbar__search">
        <span>🔍</span>
        <input
          type="search"
          id="product-search"
          class="input input--sm w-full"
          aria-label="${t('saler_products.search_placeholder')}"
          placeholder="${t('saler_products.search_placeholder')}"
          value="${searchQuery}"
        />
      </div>
      <div class="saler-toolbar__filters">
        <select id="category-filter" class="select select--sm" aria-label="${t('saler_products.filter_all_categories')}">
          <option value="all">${t('saler_products.filter_all_categories')}</option>
          ${categoryOptions().map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
        </select>
        <select id="stock-filter" class="select select--sm" aria-label="${t('saler_products.filter_all_stock')}">
          <option value="all">${t('saler_products.filter_all_stock')}</option>
          <option value="in_stock">${t('saler_products.filter_in_stock_only')}</option>
        </select>
        <select id="sort-filter" class="select select--sm" aria-label="${t('saler_products.sort_label', 'Sort products')}">
          <option value="newest">${t('saler_products.sort_newest')}</option>
          <option value="price_asc">${t('saler_products.sort_price_asc')}</option>
          <option value="price_desc">${t('saler_products.sort_price_desc')}</option>
        </select>
      </div>
    `;

    const searchInput = toolbar.querySelector<HTMLInputElement>('#product-search');
    searchInput.oninput = (e) => {
      searchQuery = (e.target as HTMLInputElement).value;
      renderTableBody();
    };

    const catSelect = toolbar.querySelector<HTMLSelectElement>('#category-filter');
    catSelect.value = selectedCategory;
    catSelect.onchange = (e) => {
      selectedCategory = (e.target as HTMLSelectElement).value;
      renderTableBody();
    };

    const stockSelect = toolbar.querySelector<HTMLSelectElement>('#stock-filter');
    stockSelect.value = stockFilter;
    stockSelect.onchange = (e) => {
      stockFilter = (e.target as HTMLSelectElement).value;
      renderTableBody();
    };

    const sortSelect = toolbar.querySelector<HTMLSelectElement>('#sort-filter');
    sortSelect.value = sortBy;
    sortSelect.onchange = (e) => {
      sortBy = (e.target as HTMLSelectElement).value;
      renderTableBody();
    };

    container.append(toolbar);

    // 4. Products Table Wrapper
    const tableWrap = document.createElement('div');
    tableWrap.className = 'saler-table-wrap';
    tableWrap.id = 'products-table-container';
    container.append(tableWrap);

    renderTableBody();
  }

  function categoryOptions(): string[] {
    return [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function renderKpis() {
    const grid = container.querySelector('#products-kpis');
    if (!grid) return;
    const isBn = getLanguage() === 'bn';
    // WHY counted here, not taken from the response summary: the list is the whole shelf, and a
    // removal or visibility change must move these figures without a refetch.
    const value = (n: number) => (loading ? '—' : String(n));
    const inStock = products.filter((p) => Number(p.stock_qty) > 0).length;
    grid.innerHTML = `
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_products.kpi_total_curated')}</span>
          <span aria-hidden="true">🏷️</span>
        </div>
        <div class="saler-kpi-card__value">${value(products.length)}</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'আপনার স্টোরে সক্রিয় আইটেম' : 'Items across shelves'}</div>
      </div>
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_products.kpi_in_stock')}</span>
          <span aria-hidden="true">🟢</span>
        </div>
        <div class="saler-kpi-card__value text-success">${value(inStock)}</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'সাপ্লায়ার স্টকে অর্ডারযোগ্য' : 'Ready for fast dispatch'}</div>
      </div>
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_products.kpi_out_of_stock')}</span>
          <span aria-hidden="true">⚠️</span>
        </div>
        <div class="saler-kpi-card__value text-danger">${value(products.length - inStock)}</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'সাপ্লায়ার স্টক খালি' : 'Needs catalog swap'}</div>
      </div>
    `;
  }

  function renderTableBody() {
    const wrap = container.querySelector('#products-table-container');
    if (!wrap) return;
    const isBn = getLanguage() === 'bn';

    if (loading) {
      wrap.innerHTML = '';
      wrap.append(
        Skeleton({ width: '100%', height: '80px' }),
        Skeleton({ width: '100%', height: '80px' }),
        Skeleton({ width: '100%', height: '80px' })
      );
      return;
    }

    let filtered = [...products];

    if (selectedCategory !== 'all') {
      filtered = filtered.filter((p) => p.category.toLowerCase() === selectedCategory.toLowerCase());
    }

    if (stockFilter === 'in_stock') {
      filtered = filtered.filter((p) => p.stock_qty > 0);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.title_en.toLowerCase().includes(q) ||
          (p.title_bn && p.title_bn.includes(q)) ||
          p.supplier_name.toLowerCase().includes(q)
      );
    }

    if (sortBy === 'price_asc') {
      filtered.sort((a, b) => a.default_retail_price - b.default_retail_price);
    } else if (sortBy === 'price_desc') {
      filtered.sort((a, b) => b.default_retail_price - a.default_retail_price);
    }

    if (filtered.length === 0) {
      wrap.innerHTML = '';
      const empty = EmptyState({
        icon: '📦',
        title: t('saler_products.empty_title'),
        description: t('saler_products.empty_desc'),
        action: Button({
          label: t('saler_products.empty_cta'),
          variant: 'primary',
          size: 'sm',
          onClick: () => nav('/saler/sourcing'),
        }),
      });
      wrap.append(empty);
      return;
    }

    // WHY own classes, not utility names: this table used Tailwind-style names (w-12, line-clamp-1,
    // btn--xs, …) that no stylesheet defines, so the photo rendered at full size and the title
    // was squeezed into one word per line over the category column.
    const table = document.createElement('table');
    table.className = 'saler-table sp-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>${t('saler_products.th_product')}</th>
          <th>${t('saler_products.th_category')}</th>
          <th class="sp-num">${t('saler_products.th_retail_price')}</th>
          <th>${t('saler_products.th_stock')}</th>
          <th>${t('saler_products.th_status')}</th>
          <th class="sp-num">${t('saler_products.th_actions')}</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    filtered.forEach((p) => {
      const retail = Number(p.default_retail_price || 0);
      const title = escapeHtml(isBn ? (p.title_bn || p.title_en) : p.title_en);
      const stock = Number(p.stock_qty || 0);
      const stockBadge =
        stock > 10
          ? ['success', t('saler_products.stock_in', { count: stock })]
          : stock > 0
          ? ['warning', t('saler_products.stock_left', { count: stock })]
          : ['danger', t('saler_products.badge_out_of_stock')];

      const tr = document.createElement('tr');
      if (!p.is_active) tr.className = 'sp-row--hidden';
      tr.innerHTML = `
        <td class="sp-cell-product">
          <div class="sp-product">
            <img src="${escapeHtml(p.image_url || '/placeholder-product.png')}" alt="" class="sp-product__thumb" loading="lazy" width="56" height="56" />
            <div class="sp-product__text">
              <div class="sp-product__title" title="${title}">${title}</div>
              <div class="sp-product__supplier">${escapeHtml(p.supplier_name || '')}</div>
            </div>
          </div>
        </td>
        <td data-label="${t('saler_products.th_category')}">
          <span class="sp-chip">${escapeHtml(p.category || '')}</span>
        </td>
        <td class="sp-num" data-label="${t('saler_products.th_retail_price')}">
          <span class="sp-price" title="${t('saler_products.price_locked_hint')}">${formatCurrency(retail)}</span>
        </td>
        <td data-label="${t('saler_products.th_stock')}">
          <span class="badge badge--md badge--${stockBadge[0]} sp-stock"><span class="sp-dot" aria-hidden="true"></span>${stockBadge[1]}</span>
        </td>
        <td data-label="${t('saler_products.th_status')}">
          <button type="button" class="btn-toggle-active sp-visibility" aria-pressed="${p.is_active ? 'true' : 'false'}" data-id="${p.id}">
            <span class="sp-visibility__track" aria-hidden="true"></span>
            <span>${p.is_active ? t('saler_products.badge_active') : t('saler_products.badge_hidden')}</span>
          </button>
        </td>
        <td class="sp-num sp-cell-actions">
          <div class="sp-actions">
            <button type="button" class="btn-flyer btn btn--secondary btn--sm" data-id="${p.id}" data-pid="${p.product_id}">
              ${t('saler_products.btn_create_flyer')}
            </button>
            <button type="button" class="btn-remove-product btn btn--ghost btn--sm sp-remove" data-id="${p.id}" aria-label="${t('saler_products.btn_remove')}" title="${t('saler_products.btn_remove')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </td>
      `;

      // Toggle active handler
      const toggleBtn = tr.querySelector<HTMLElement>('.btn-toggle-active');
      toggleBtn.onclick = async () => {
        try {
          const nextState = !p.is_active;
          await salerApi.updateProduct(p.id, { is_active: nextState });
          p.is_active = nextState;
          toast.success(t('saler_products.toast_status_updated'));
          renderKpis();
          renderTableBody();
        } catch (err) {
          toast.error(err.message || 'Failed to update visibility');
        }
      };

      // Flyer handler
      const flyerBtn = tr.querySelector<HTMLElement>('.btn-flyer');
      flyerBtn.onclick = () => {
        nav(`/saler/social-kit?product_id=${p.product_id || p.id}`);
      };

      // Remove handler
      const removeBtn = tr.querySelector<HTMLElement>('.btn-remove-product');
      removeBtn.onclick = async () => {
        if (!confirm(t('saler_products.confirm_remove'))) return;
        try {
          await salerApi.removeProduct(p.id);
          products = products.filter((item) => item.id !== p.id);
          toast.success(t('saler_products.toast_removed'));
          renderKpis();
          renderTableBody();
        } catch (err) {
          toast.error(err.message || 'Failed to remove product');
        }
      };

      tbody.appendChild(tr);
    });

    wrap.innerHTML = '';
    wrap.appendChild(table);
  }

  async function loadData() {
    loading = true;
    render();
    try {
      const res = await salerApi.getProducts();
      products = res?.data?.products || [];
    } catch (err) {
      toast.error(err.message || 'Failed to load store products');
    } finally {
      loading = false;
      // WHY render(), not renderTableBody(): the KPI strip and the category list are drawn from
      // the loaded products, and were left showing the loading state's zeros.
      render();
    }
  }

  unsubscribeLang = subscribeLang(() => {
    render();
  });

  loadData();
  root.append(container);

  return () => {
    if (unsubscribeLang) unsubscribeLang();
    container.remove();
  };
}
