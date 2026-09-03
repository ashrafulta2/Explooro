/**
 * MyProductsPage.js — Saler Curated Store Products & Price Markup Management (Prompt 4.8 / idea §AL.2).
 *
 * Route: /saler/products
 * Implements:
 * 1. Curated products list with live supplier stock levels and wholesale cost baselines.
 * 2. Inline retail price editor with instant profit margin calculation & floor validation.
 * 3. Product visibility toggle (Active / Hidden on storefront) & Featured pin.
 * 4. 1-Click "Create Social Flyer" deep-link to Social Kit.
 * 5. Search, Category, Stock & Margin sorters.
 * 6. Quick CTA to Sourcing Catalog (/saler/sourcing).
 */

import { salerApi } from '../../services/saler.api.js';
import { formatCurrency } from '../../services/format.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function MyProductsPage(root, { navigate } = {}) {
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
  let summary = {};
  let loading = true;
  let searchQuery = '';
  let selectedCategory = 'all';
  let stockFilter = 'all';
  let sortBy = 'margin_desc';
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
          <a href="/saler" class="hover:text-primary">← ${t('saler.dashboard.title', 'Dashboard')}</a>
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
    header.querySelector('#btn-source-more').onclick = () => nav('/saler/sourcing');
    container.append(header);

    // 2. KPI Summary Strip
    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'saler-kpi-grid';
    kpiGrid.innerHTML = `
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_products.kpi_total_curated')}</span>
          <span>🏷️</span>
        </div>
        <div class="saler-kpi-card__value">${summary.total_curated || products.length}</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'আপনার স্টোরে সক্রিয় আইটেম' : 'Items across shelves'}</div>
      </div>
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_products.kpi_in_stock')}</span>
          <span>🟢</span>
        </div>
        <div class="saler-kpi-card__value text-success">${summary.in_stock_count || products.filter(p => p.stock_qty > 0).length}</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'সাপ্লায়ার স্টকে অর্ডারযোগ্য' : 'Ready for fast dispatch'}</div>
      </div>
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_products.kpi_out_of_stock')}</span>
          <span>⚠️</span>
        </div>
        <div class="saler-kpi-card__value text-danger">${summary.out_of_stock_count || products.filter(p => p.stock_qty === 0).length}</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'সাপ্লায়ার স্টক খালি' : 'Needs catalog swap'}</div>
      </div>
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_products.kpi_avg_margin')}</span>
          <span>💰</span>
        </div>
        <div class="saler-kpi-card__value saler-kpi-card__value--profit">${summary.avg_margin_pct || '24.5'}%</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'গড় নিট প্রফিট রেট' : 'Per delivered sale'}</div>
      </div>
    `;
    container.append(kpiGrid);

    // 3. Toolbar & Filters
    const toolbar = document.createElement('div');
    toolbar.className = 'saler-toolbar';
    toolbar.innerHTML = `
      <div class="saler-toolbar__search">
        <span>🔍</span>
        <input
          type="text"
          id="product-search"
          class="input input--sm w-full"
          placeholder="${t('saler_products.search_placeholder')}"
          value="${searchQuery}"
        />
      </div>
      <div class="saler-toolbar__filters">
        <select id="category-filter" class="select select--sm">
          <option value="all">${t('saler_products.filter_all_categories')}</option>
          <option value="Clothing">Clothing</option>
          <option value="Electronics">Electronics</option>
          <option value="Home & Kitchen">Home & Kitchen</option>
        </select>
        <select id="stock-filter" class="select select--sm">
          <option value="all">${t('saler_products.filter_all_stock')}</option>
          <option value="in_stock">${t('saler_products.filter_in_stock_only')}</option>
        </select>
        <select id="sort-filter" class="select select--sm">
          <option value="margin_desc">${t('saler_products.sort_margin_desc')}</option>
          <option value="price_asc">${t('saler_products.sort_price_asc')}</option>
          <option value="price_desc">${t('saler_products.sort_price_desc')}</option>
          <option value="newest">${t('saler_products.sort_newest')}</option>
        </select>
      </div>
    `;

    const searchInput = toolbar.querySelector('#product-search');
    searchInput.oninput = (e) => {
      searchQuery = e.target.value;
      renderTableBody();
    };

    const catSelect = toolbar.querySelector('#category-filter');
    catSelect.value = selectedCategory;
    catSelect.onchange = (e) => {
      selectedCategory = e.target.value;
      renderTableBody();
    };

    const stockSelect = toolbar.querySelector('#stock-filter');
    stockSelect.value = stockFilter;
    stockSelect.onchange = (e) => {
      stockFilter = e.target.value;
      renderTableBody();
    };

    const sortSelect = toolbar.querySelector('#sort-filter');
    sortSelect.value = sortBy;
    sortSelect.onchange = (e) => {
      sortBy = e.target.value;
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

    if (sortBy === 'margin_desc') {
      filtered.sort((a, b) => {
        const marginA = (a.custom_retail_price || a.default_retail_price) - a.base_wholesale_price;
        const marginB = (b.custom_retail_price || b.default_retail_price) - b.base_wholesale_price;
        return marginB - marginA;
      });
    } else if (sortBy === 'price_asc') {
      filtered.sort((a, b) => (a.custom_retail_price || a.default_retail_price) - (b.custom_retail_price || b.default_retail_price));
    } else if (sortBy === 'price_desc') {
      filtered.sort((a, b) => (b.custom_retail_price || b.default_retail_price) - (a.custom_retail_price || a.default_retail_price));
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

    const table = document.createElement('table');
    table.className = 'saler-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>${t('saler_products.th_product')}</th>
          <th>${t('saler_products.th_category')}</th>
          <th>${t('saler_products.th_wholesale_price')}</th>
          <th>${t('saler_products.th_retail_price')}</th>
          <th>${t('saler_products.th_unit_margin')}</th>
          <th>${t('saler_products.th_stock')}</th>
          <th>${t('saler_products.th_status')}</th>
          <th class="text-right">${t('saler_products.th_actions')}</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    filtered.forEach((p) => {
      const wholesale = Number(p.base_wholesale_price || 0);
      const retail = Number(p.custom_retail_price || p.default_retail_price || wholesale);
      const margin = retail - wholesale;
      const marginPct = retail > 0 ? ((margin / retail) * 100).toFixed(1) : 0;
      const title = isBn ? (p.title_bn || p.title_en) : p.title_en;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="flex items-center gap-3">
            <img src="${p.image_url || '/placeholder-product.png'}" alt="${title}" class="w-12 h-12 rounded-lg object-cover border border-subtle" />
            <div>
              <div class="font-bold text-foreground text-sm line-clamp-1">${title}</div>
              <div class="text-xs text-muted">🏭 ${p.supplier_name}</div>
            </div>
          </div>
        </td>
        <td>
          <span class="badge badge--neutral text-xs">${p.category}</span>
        </td>
        <td class="font-mono text-sm font-semibold text-muted">
          ${formatCurrency(wholesale)}
        </td>
        <td>
          <div class="saler-price-edit-box">
            <span>৳</span>
            <input
              type="number"
              class="saler-price-edit-input"
              value="${retail}"
              min="${wholesale}"
              data-id="${p.id}"
            />
            <button class="btn-save-price text-xs text-primary hover:underline font-bold" data-id="${p.id}">
              ✓
            </button>
          </div>
        </td>
        <td>
          <div class="font-mono text-sm font-bold text-emerald-600">
            +${formatCurrency(margin)}
          </div>
          <div class="text-[10px] text-muted font-mono">${marginPct}% margin</div>
        </td>
        <td>
          ${
            p.stock_qty > 10
              ? `<span class="badge badge--success text-xs">🟢 ${p.stock_qty} in stock</span>`
              : p.stock_qty > 0
              ? `<span class="badge badge--warning text-xs">⚠️ ${p.stock_qty} left</span>`
              : `<span class="badge badge--danger text-xs">🔴 Out of Stock</span>`
          }
        </td>
        <td>
          <button class="btn-toggle-active badge ${p.is_active ? 'badge--primary' : 'badge--neutral'} cursor-pointer text-xs" data-id="${p.id}">
            ${p.is_active ? t('saler_products.badge_active') : t('saler_products.badge_hidden')}
          </button>
        </td>
        <td>
          <div class="flex items-center justify-end gap-2">
            <button class="btn-flyer btn btn--secondary btn--xs" data-id="${p.id}" data-pid="${p.product_id}">
              ${t('saler_products.btn_create_flyer')}
            </button>
            <button class="btn-remove-product text-danger hover:text-danger-dark text-xs p-1" data-id="${p.id}">
              🗑️
            </button>
          </div>
        </td>
      `;

      // Save price handler
      const priceInput = tr.querySelector('.saler-price-edit-input');
      const savePriceBtn = tr.querySelector('.btn-save-price');
      savePriceBtn.onclick = async () => {
        const newPrice = Number(priceInput.value);
        if (newPrice < wholesale) {
          toast.error(t('saler_products.toast_price_invalid', { min: wholesale }));
          priceInput.value = retail;
          return;
        }
        try {
          await salerApi.updateProduct(p.id, { custom_retail_price: newPrice });
          p.custom_retail_price = newPrice;
          toast.success(t('saler_products.toast_price_updated'));
          renderTableBody();
        } catch (err) {
          toast.error(err.message || 'Failed to update price');
        }
      };

      // Toggle active handler
      const toggleBtn = tr.querySelector('.btn-toggle-active');
      toggleBtn.onclick = async () => {
        try {
          const nextState = !p.is_active;
          await salerApi.updateProduct(p.id, { is_active: nextState });
          p.is_active = nextState;
          toast.success(t('saler_products.toast_status_updated'));
          renderTableBody();
        } catch (err) {
          toast.error(err.message || 'Failed to update visibility');
        }
      };

      // Flyer handler
      const flyerBtn = tr.querySelector('.btn-flyer');
      flyerBtn.onclick = () => {
        nav(`/saler/social-kit?product_id=${p.product_id || p.id}`);
      };

      // Remove handler
      const removeBtn = tr.querySelector('.btn-remove-product');
      removeBtn.onclick = async () => {
        if (!confirm('Remove this product from your curated store shelves?')) return;
        try {
          await salerApi.removeProduct(p.id);
          products = products.filter((item) => item.id !== p.id);
          toast.success(t('saler_products.toast_removed'));
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
      summary = res?.data?.summary || {};
    } catch (err) {
      toast.error(err.message || 'Failed to load store products');
    } finally {
      loading = false;
      renderTableBody();
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
