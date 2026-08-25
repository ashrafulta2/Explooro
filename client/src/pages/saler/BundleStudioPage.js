/**
 * BundleStudioPage.js — Cross-Seller Product Bundling & Surge Pricing Studio (Prompt 10.5).
 *
 * Implements idea proposition.md §AC & §AF.
 *
 * Capabilities:
 * 1. Multi-Merchant Combo Builder: Select products from multiple distinct suppliers.
 * 2. Real-Time Profit Split Breakdown: Live breakdown showing sum of parts, discount share per item,
 *    guaranteed wholesale payouts to suppliers, saler commission, and platform share.
 * 3. Validation: Enforces price floors and minimum 2 items.
 * 4. Published Bundles Manager: List and manage active bundle combos.
 * 5. Dynamic Demand Surge Radar: View advisory surge price recommendations and opt-in/dismiss.
 */

import {
  previewBundleBreakdown,
  createBundle,
  listSalerBundles,
  updateBundle,
  deleteBundle,
  listSurgeRecommendations,
  acceptSurgeRecommendation,
  dismissSurgeRecommendation,
} from '../../services/bundle.api.js';
import { getSalerStoreItems } from '../../services/catalog.api.js';
import { createBundleProfitBreakdown } from '../../components/bundle/BundleProfitBreakdown.js';
import { Button } from '../../components/ui/Button.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatCurrency } from '../../services/format.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';

export default function BundleStudioPage(root, ctx) {
  const container = document.createElement('div');
  container.className = 'bundle-studio-page p-4 max-w-7xl mx-auto';
  container.setAttribute('data-module', 'product_bundling');

  if (!isFeatureEnabled('product_bundling')) {
    container.append(
      EmptyState({
        title: t('bundle.module_disabled_title'),
        description: t('bundle.module_disabled_desc'),
      })
    );
    root.append(container);
    return () => {};
  }

  // State
  let activeTab = 'builder'; // 'builder' | 'my_bundles' | 'surge'
  let availableProducts = [];
  let selectedItems = [];
  let currentBreakdown = null;
  let publishedBundles = [];
  let surgeRecommendations = [];
  let isLoading = false;

  // Header
  const header = document.createElement('header');
  header.className = 'page-header mb-6';
  header.innerHTML = `
    <div class="flex-between flex-wrap gap-4">
      <div>
        <h1 class="text-2xl font-bold m-0">${t('bundle.studio_title')}</h1>
        <p class="text-muted m-0 mt-1">${t('bundle.studio_subtitle')}</p>
      </div>
      <div class="tabs-nav flex gap-2 border-b">
        <button class="tab-btn px-4 py-2 font-medium border-b-2 ${activeTab === 'builder' ? 'border-primary text-primary' : 'border-transparent text-muted'}" data-tab="builder">
          🛠️ ${t('bundle.tab_builder')}
        </button>
        <button class="tab-btn px-4 py-2 font-medium border-b-2 ${activeTab === 'my_bundles' ? 'border-primary text-primary' : 'border-transparent text-muted'}" data-tab="my_bundles">
          📦 ${t('bundle.tab_my_bundles')}
        </button>
        <button class="tab-btn px-4 py-2 font-medium border-b-2 ${activeTab === 'surge' ? 'border-primary text-primary' : 'border-transparent text-muted'}" data-tab="surge">
          ⚡ ${t('bundle.tab_surge')}
        </button>
      </div>
    </div>
  `;

  const contentArea = document.createElement('div');
  contentArea.className = 'bundle-studio-content mt-4';

  container.append(header, contentArea);

  // Tab switching
  header.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      header.querySelectorAll('.tab-btn').forEach((b) => {
        const isCurrent = b.getAttribute('data-tab') === activeTab;
        b.className = `tab-btn px-4 py-2 font-medium border-b-2 ${isCurrent ? 'border-primary text-primary' : 'border-transparent text-muted'}`;
      });
      renderCurrentTab();
    });
  });

  async function renderCurrentTab() {
    contentArea.innerHTML = '';

    if (activeTab === 'builder') {
      renderBuilderTab();
    } else if (activeTab === 'my_bundles') {
      await loadPublishedBundles();
      renderMyBundlesTab();
    } else if (activeTab === 'surge') {
      await loadSurgeRecommendations();
      renderSurgeTab();
    }
  }

  // -------------------------------------------------------------
  // BUILDER TAB
  // -------------------------------------------------------------
  function renderBuilderTab() {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 lg:grid-cols-12 gap-6';

    // Left column: Product Selection & Bundle Settings (7 cols)
    const leftCol = document.createElement('div');
    leftCol.className = 'lg:col-span-7 space-y-4';

    // 1. Title & Details Card
    const detailsCard = document.createElement('div');
    detailsCard.className = 'card p-4 border rounded bg-surface';
    detailsCard.innerHTML = `
      <h3 class="font-bold text-base mb-3">${t('bundle.config_heading')}</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-xs font-semibold text-muted uppercase mb-1">${t('bundle.title_en_label')}</label>
          <input type="text" id="bundle-title-en" class="input w-full p-2 border rounded" placeholder="e.g. Executive Office Combo" value="Executive Office Outfit Combo" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-muted uppercase mb-1">${t('bundle.title_bn_label')}</label>
          <input type="text" id="bundle-title-bn" class="input w-full p-2 border rounded" placeholder="যেমন: এক্সিকিউটিভ অফিস কম্বো" value="এক্সিকিউটিভ অফিস কম্বো বান্ডেল" />
        </div>
      </div>
      <div>
        <label class="block text-xs font-semibold text-muted uppercase mb-1">${t('bundle.bundle_price_label')} (৳)</label>
        <div class="flex items-center gap-2">
          <input type="number" id="bundle-price-input" class="input p-2 border rounded font-mono font-bold text-lg w-48" placeholder="0.00" step="10" />
          <span class="text-xs text-muted">${t('bundle.price_hint')}</span>
        </div>
      </div>
    `;

    // 2. Selected Items Shelf
    const selectedShelf = document.createElement('div');
    selectedShelf.className = 'card p-4 border rounded bg-surface';
    selectedShelf.innerHTML = `
      <div class="flex-between mb-3">
        <h3 class="font-bold text-base m-0">${t('bundle.selected_items_heading')} (${selectedItems.length})</h3>
        <span class="text-xs text-muted">${t('bundle.drag_or_click_hint')}</span>
      </div>
      <div id="selected-items-list" class="space-y-2 min-h-[80px]">
        ${selectedItems.length === 0 ? `<p class="text-sm text-muted text-center py-4">${t('bundle.no_items_selected')}</p>` : ''}
      </div>
    `;

    // 3. Product Catalog Browser (Search & Pick)
    const catalogCard = document.createElement('div');
    catalogCard.className = 'card p-4 border rounded bg-surface';
    catalogCard.innerHTML = `
      <div class="flex-between mb-3 flex-wrap gap-2">
        <h3 class="font-bold text-base m-0">${t('bundle.catalog_picker_heading')}</h3>
        <input type="text" id="catalog-search-input" class="input text-sm p-1.5 border rounded w-64" placeholder="${t('bundle.search_products_placeholder')}" />
      </div>
      <div id="catalog-picker-grid" class="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-96 overflow-y-auto p-1">
        <p class="text-sm text-muted py-4 col-span-3 text-center">${t('common.loading')}</p>
      </div>
    `;

    leftCol.append(detailsCard, selectedShelf, catalogCard);

    // Right column: Live Profit Breakdown & Publish Action (5 cols)
    const rightCol = document.createElement('div');
    rightCol.className = 'lg:col-span-5 space-y-4';

    const breakdownWidget = createBundleProfitBreakdown({ breakdown: currentBreakdown });
    rightCol.append(breakdownWidget.element);

    const actionCard = document.createElement('div');
    actionCard.className = 'card p-4 border rounded bg-surface text-center';
    
    const publishBtn = Button({
      label: t('bundle.publish_bundle_btn'),
      variant: 'primary',
      onClick: handlePublishBundle,
    });
    publishBtn.className += ' w-full py-3 text-base font-bold';

    actionCard.append(publishBtn);
    rightCol.append(actionCard);

    grid.append(leftCol, rightCol);
    contentArea.append(grid);

    // Wire interactions
    const priceInput = detailsCard.querySelector('#bundle-price-input');
    priceInput.addEventListener('input', () => {
      recalculateBreakdown(breakdownWidget);
    });

    const searchInput = catalogCard.querySelector('#catalog-search-input');
    searchInput.addEventListener('input', (e) => {
      renderCatalogGrid(e.target.value);
    });

    // Populate catalog
    loadCatalogProducts().then(() => {
      renderCatalogGrid();
      // Default auto-select 2 items if empty to showcase multi-supplier combo
      if (selectedItems.length === 0 && availableProducts.length >= 2) {
        selectedItems.push({ ...availableProducts[0], qty: 1 });
        selectedItems.push({ ...availableProducts[1], qty: 1 });
        const sumParts = availableProducts[0].retail_price + availableProducts[1].retail_price;
        priceInput.value = (sumParts * 0.85).toFixed(0); // 15% combo discount
        renderSelectedShelf(breakdownWidget);
        recalculateBreakdown(breakdownWidget);
      }
    });

    function renderCatalogGrid(query = '') {
      const pickerGrid = catalogCard.querySelector('#catalog-picker-grid');
      if (!pickerGrid) return;

      const filtered = availableProducts.filter((p) => {
        const title = (p.title_en + ' ' + (p.title_bn || '') + ' ' + (p.supplier_name || '')).toLowerCase();
        return title.includes(query.toLowerCase());
      });

      if (filtered.length === 0) {
        pickerGrid.innerHTML = `<p class="text-sm text-muted py-4 col-span-3 text-center">${t('bundle.no_catalog_matches')}</p>`;
        return;
      }

      pickerGrid.innerHTML = filtered.map((p) => `
        <div class="product-picker-item border p-2 rounded hover:border-primary cursor-pointer transition flex flex-col justify-between bg-surface-subtle" data-product-id="${p.product_id}">
          <div>
            <div class="font-medium text-xs line-clamp-2">${p.title_en}</div>
            <div class="text-xs text-muted mt-1">🏭 ${p.supplier_name || 'Supplier'}</div>
          </div>
          <div class="mt-2 flex-between text-xs font-mono">
            <span class="font-bold text-primary">${formatCurrency(p.retail_price)}</span>
            <button class="add-to-bundle-btn text-xs px-2 py-0.5 bg-primary text-white rounded font-sans hover:opacity-90">
              + ${t('bundle.add_btn')}
            </button>
          </div>
        </div>
      `).join('');

      pickerGrid.querySelectorAll('.product-picker-item').forEach((card) => {
        card.addEventListener('click', () => {
          const pId = parseInt(card.getAttribute('data-product-id'), 10);
          const prod = availableProducts.find((p) => p.product_id === pId);
          if (prod) {
            const existing = selectedItems.find((it) => it.product_id === pId);
            if (existing) {
              existing.qty += 1;
            } else {
              selectedItems.push({ ...prod, qty: 1 });
            }
            renderSelectedShelf(breakdownWidget);
            recalculateBreakdown(breakdownWidget);
          }
        });
      });
    }

    function renderSelectedShelf(breakdownWidget) {
      const shelf = selectedShelf.querySelector('#selected-items-list');
      if (!shelf) return;

      if (selectedItems.length === 0) {
        shelf.innerHTML = `<p class="text-sm text-muted text-center py-4">${t('bundle.no_items_selected')}</p>`;
        return;
      }

      shelf.innerHTML = selectedItems.map((item, idx) => `
        <div class="flex-between p-2 rounded border bg-surface-hover text-sm">
          <div class="flex items-center gap-3">
            <span class="font-mono text-muted text-xs">#${idx + 1}</span>
            <div>
              <span class="font-semibold block">${item.title_en}</span>
              <span class="text-xs text-muted">🏭 ${item.supplier_name} · ৳${item.retail_price}</span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center border rounded">
              <button class="qty-btn px-2 py-0.5 text-xs hover:bg-surface-subtle" data-action="dec" data-index="${idx}">-</button>
              <span class="px-2 font-mono text-xs font-bold">${item.qty}</span>
              <button class="qty-btn px-2 py-0.5 text-xs hover:bg-surface-subtle" data-action="inc" data-index="${idx}">+</button>
            </div>
            <span class="font-mono font-bold text-xs w-16 text-right">${formatCurrency(item.retail_price * item.qty)}</span>
            <button class="remove-item-btn text-danger text-xs hover:opacity-75" data-index="${idx}">✕</button>
          </div>
        </div>
      `).join('');

      shelf.querySelectorAll('.qty-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute('data-index'), 10);
          const act = btn.getAttribute('data-action');
          if (act === 'inc') {
            selectedItems[idx].qty += 1;
          } else if (act === 'dec' && selectedItems[idx].qty > 1) {
            selectedItems[idx].qty -= 1;
          }
          renderSelectedShelf(breakdownWidget);
          recalculateBreakdown(breakdownWidget);
        });
      });

      shelf.querySelectorAll('.remove-item-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute('data-index'), 10);
          selectedItems.splice(idx, 1);
          renderSelectedShelf(breakdownWidget);
          recalculateBreakdown(breakdownWidget);
        });
      });
    }

    async function recalculateBreakdown(breakdownWidget) {
      if (selectedItems.length < 2) {
        breakdownWidget.update(null);
        return;
      }

      const rawPrice = parseFloat(detailsCard.querySelector('#bundle-price-input')?.value || 0);
      if (isNaN(rawPrice) || rawPrice <= 0) {
        breakdownWidget.update(null);
        return;
      }

      try {
        const payload = {
          bundle_price: rawPrice,
          items: selectedItems.map((it) => ({
            productId: it.product_id,
            productTitleEn: it.title_en,
            productTitleBn: it.title_bn,
            retailPrice: it.retail_price,
            baseCost: it.base_cost,
            wholesaleMargin: it.wholesale_margin,
            supplierId: it.supplier_id,
            supplierName: it.supplier_name,
            qty: it.qty,
          })),
        };

        const res = await previewBundleBreakdown(payload);
        currentBreakdown = res?.data || res;
        breakdownWidget.update(currentBreakdown);
      } catch (err) {
        // Silently clear or show error in widget if price invalid
      }
    }

    async function handlePublishBundle() {
      const titleEn = detailsCard.querySelector('#bundle-title-en')?.value?.trim();
      const titleBn = detailsCard.querySelector('#bundle-title-bn')?.value?.trim();
      const bundlePrice = parseFloat(detailsCard.querySelector('#bundle-price-input')?.value || 0);

      if (!titleEn || !titleBn) {
        toast.error(t('bundle.error_titles_required'));
        return;
      }
      if (selectedItems.length < 2) {
        toast.error(t('bundle.error_min_items'));
        return;
      }
      if (!bundlePrice || bundlePrice <= 0) {
        toast.error(t('bundle.error_invalid_price'));
        return;
      }

      try {
        publishBtn.setLoading(true);
        const payload = {
          title_en: titleEn,
          title_bn: titleBn,
          bundle_price: bundlePrice,
          items: selectedItems.map((it) => ({
            productId: it.product_id,
            productTitleEn: it.title_en,
            productTitleBn: it.title_bn,
            retailPrice: it.retail_price,
            baseCost: it.base_cost,
            wholesaleMargin: it.wholesale_margin,
            supplierId: it.supplier_id,
            qty: it.qty,
          })),
        };

        await createBundle(payload);
        toast.success(t('bundle.created_success'));

        // Reset and switch to my bundles
        selectedItems = [];
        activeTab = 'my_bundles';
        renderCurrentTab();
      } catch (err) {
        toast.error(err?.message || t('bundle.error_create_failed'));
      } finally {
        publishBtn.setLoading(false);
      }
    }
  }

  // -------------------------------------------------------------
  // MY BUNDLES TAB
  // -------------------------------------------------------------
  function renderMyBundlesTab() {
    const tabContainer = document.createElement('div');
    tabContainer.className = 'space-y-4';

    if (publishedBundles.length === 0) {
      tabContainer.append(
        EmptyState({
          title: t('bundle.no_published_bundles_title'),
          description: t('bundle.no_published_bundles_desc'),
        })
      );
      contentArea.append(tabContainer);
      return;
    }

    tabContainer.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${publishedBundles.map((b) => `
          <div class="card p-4 border rounded bg-surface flex flex-col justify-between" data-bundle-id="${b.id}">
            <div>
              <div class="flex-between mb-2">
                <span class="badge badge-primary font-mono text-xs">${b.ref}</span>
                <span class="badge ${b.is_active ? 'badge-success' : 'badge-neutral'} text-xs">
                  ${b.is_active ? t('common.active') : t('common.inactive')}
                </span>
              </div>
              <h4 class="font-bold text-base mb-1">${getLanguage() === 'bn' ? b.title_bn : b.title_en}</h4>
              <div class="flex items-baseline gap-2 mb-3">
                <span class="text-xl font-bold font-mono text-primary">${formatCurrency(b.bundle_price)}</span>
                <span class="text-xs text-muted line-through font-mono">${formatCurrency(b.sum_of_parts)}</span>
                <span class="text-xs text-danger font-semibold font-mono">-${formatCurrency(b.discount_amount)}</span>
              </div>
              <div class="text-xs text-muted mb-4 space-y-1">
                <div>📦 ${t('bundle.items_count', { count: b.item_count || 2 })}</div>
                <div>🏭 ${t('bundle.suppliers_count', { count: b.supplier_count || 2 })}</div>
              </div>
            </div>
            <div class="pt-3 border-t flex-between gap-2">
              <button class="toggle-bundle-btn text-xs px-3 py-1.5 rounded border hover:bg-surface-hover" data-id="${b.id}" data-active="${b.is_active}">
                ${b.is_active ? t('bundle.deactivate') : t('bundle.activate')}
              </button>
              <button class="copy-bundle-link-btn text-xs px-3 py-1.5 rounded bg-surface-subtle border hover:bg-surface-hover" data-ref="${b.ref}">
                🔗 ${t('bundle.copy_link')}
              </button>
              <button class="delete-bundle-btn text-xs text-danger hover:underline px-2" data-id="${b.id}">
                🗑️
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    tabContainer.querySelectorAll('.toggle-bundle-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const isActive = btn.getAttribute('data-active') === 'true';
        try {
          await updateBundle(id, { is_active: !isActive });
          toast.success(t('bundle.updated_success'));
          await loadPublishedBundles();
          renderMyBundlesTab();
        } catch {
          toast.error(t('bundle.error_update_failed'));
        }
      });
    });

    tabContainer.querySelectorAll('.copy-bundle-link-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ref = btn.getAttribute('data-ref');
        const url = `${window.location.origin}/bundle/${ref}`;
        navigator.clipboard?.writeText(url);
        toast.success(t('bundle.link_copied'));
      });
    });

    tabContainer.querySelectorAll('.delete-bundle-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('bundle.confirm_delete'))) return;
        const id = btn.getAttribute('data-id');
        try {
          await deleteBundle(id);
          toast.success(t('bundle.deleted_success'));
          await loadPublishedBundles();
          renderMyBundlesTab();
        } catch {
          toast.error(t('bundle.error_delete_failed'));
        }
      });
    });

    contentArea.append(tabContainer);
  }

  // -------------------------------------------------------------
  // SURGE RADAR TAB
  // -------------------------------------------------------------
  function renderSurgeTab() {
    const tabContainer = document.createElement('div');
    tabContainer.className = 'space-y-4';

    tabContainer.innerHTML = `
      <div class="card p-4 border rounded bg-warning-soft mb-4">
        <div class="flex items-start gap-3">
          <span class="text-2xl">⚡</span>
          <div>
            <h4 class="font-bold text-base m-0">${t('surge.radar_title')}</h4>
            <p class="text-sm text-muted m-0 mt-1">${t('surge.radar_desc')}</p>
          </div>
        </div>
      </div>

      ${surgeRecommendations.length === 0 ? `
        <div class="p-8 text-center border rounded bg-surface">
          <p class="text-muted">${t('surge.no_active_surges')}</p>
        </div>
      ` : `
        <div class="space-y-3">
          ${surgeRecommendations.map((rec) => `
            <div class="card p-4 border rounded bg-surface flex-between flex-wrap gap-4" data-rec-id="${rec.id}">
              <div class="space-y-1 max-w-xl">
                <div class="flex items-center gap-2">
                  <span class="badge badge-warning font-mono text-xs">${rec.ref}</span>
                  <span class="badge badge-primary font-bold text-xs">+${rec.surge_pct}% ${t('surge.surge_badge')}</span>
                </div>
                <h4 class="font-bold text-base m-0">${rec.product_title_en}</h4>
                <p class="text-xs text-muted m-0">
                  ${getLanguage() === 'bn' ? rec.reason_bn : rec.reason_en}
                </p>
                <div class="flex gap-4 text-xs font-mono text-muted pt-1">
                  <span>📈 24h Velocity: <b>${rec.velocity_score}</b></span>
                  <span>📦 Depletion: <b>${(rec.depletion_rate_score * 100).toFixed(0)}%</b></span>
                </div>
              </div>
              <div class="flex items-center gap-4">
                <div class="text-right">
                  <span class="text-xs text-muted block line-through font-mono">${formatCurrency(rec.current_price)}</span>
                  <span class="text-lg font-bold font-mono text-success">${formatCurrency(rec.recommended_price)}</span>
                </div>
                <div class="flex gap-2">
                  <button class="accept-surge-btn px-3 py-1.5 text-xs font-bold bg-success text-white rounded hover:opacity-90" data-id="${rec.id}">
                    ✓ ${t('surge.opt_in_btn')}
                  </button>
                  <button class="dismiss-surge-btn px-3 py-1.5 text-xs border rounded hover:bg-surface-subtle" data-id="${rec.id}">
                    ✕ ${t('surge.dismiss_btn')}
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;

    tabContainer.querySelectorAll('.accept-surge-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        try {
          await acceptSurgeRecommendation(id);
          toast.success(t('surge.accepted_success'));
          await loadSurgeRecommendations();
          renderSurgeTab();
        } catch (err) {
          toast.error(err?.message || t('surge.error_accept_failed'));
        }
      });
    });

    tabContainer.querySelectorAll('.dismiss-surge-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        try {
          await dismissSurgeRecommendation(id);
          toast.success(t('surge.dismissed_success'));
          await loadSurgeRecommendations();
          renderSurgeTab();
        } catch {
          toast.error(t('surge.error_dismiss_failed'));
        }
      });
    });

    contentArea.append(tabContainer);
  }

  // Helpers
  async function loadCatalogProducts() {
    try {
      const items = await getSalerStoreItems();
      if (items && items.length > 0) {
        availableProducts = items.map((it) => ({
          product_id: it.product_id,
          title_en: it.title_en || it.product_title_en || `Product #${it.product_id}`,
          title_bn: it.title_bn || it.product_title_bn || `পণ্য #${it.product_id}`,
          retail_price: parseFloat(it.retail_price || it.current_product_retail_price || 1200),
          base_cost: parseFloat(it.base_cost || it.base_price || 700),
          wholesale_margin: parseFloat(it.wholesale_margin || 100),
          supplier_id: it.supplier_id || 1,
          supplier_name: it.supplier_name || 'Walton Bangladesh',
        }));
      } else {
        // Fallback default sample multi-supplier catalog for preview
        availableProducts = [
          { product_id: 1, title_en: 'Walton Formal Cotton Shirt', title_bn: 'ওয়ালটন ফর্মাল সুতি শার্ট', retail_price: 1200, base_cost: 700, wholesale_margin: 100, supplier_id: 5, supplier_name: 'Walton Apparel' },
          { product_id: 2, title_en: 'Apex Executive Trousers', title_bn: 'এপেক্স এক্সিকিউটিভ ট্রাউজার', retail_price: 1800, base_cost: 1100, wholesale_margin: 150, supplier_id: 6, supplier_name: 'Apex Footwear & Textiles' },
          { product_id: 3, title_en: 'Bata Leather Dress Belt', title_bn: 'বাটা লেদার ড্রেস বেল্ট', retail_price: 650, base_cost: 350, wholesale_margin: 50, supplier_id: 7, supplier_name: 'Bata Bangladesh' },
          { product_id: 4, title_en: 'Aarong Silk Tie & Cufflinks', title_bn: 'আড়ং সিল্ক টাই ও কাফলিংক', retail_price: 850, base_cost: 450, wholesale_margin: 80, supplier_id: 8, supplier_name: 'Aarong Crafts' },
        ];
      }
    } catch {
      availableProducts = [
        { product_id: 1, title_en: 'Walton Formal Cotton Shirt', title_bn: 'ওয়ালটন ফর্মাল সুতি শার্ট', retail_price: 1200, base_cost: 700, wholesale_margin: 100, supplier_id: 5, supplier_name: 'Walton Apparel' },
        { product_id: 2, title_en: 'Apex Executive Trousers', title_bn: 'এপেক্স এক্সিকিউটিভ ট্রাউজার', retail_price: 1800, base_cost: 1100, wholesale_margin: 150, supplier_id: 6, supplier_name: 'Apex Footwear & Textiles' },
      ];
    }
  }

  async function loadPublishedBundles() {
    try {
      const res = await listSalerBundles();
      publishedBundles = res?.data || res || [];
    } catch {
      publishedBundles = [];
    }
  }

  async function loadSurgeRecommendations() {
    try {
      const res = await listSurgeRecommendations();
      surgeRecommendations = res?.data || res || [];
    } catch {
      surgeRecommendations = [];
    }
  }

  // Initial render
  renderCurrentTab();

  root.append(container);
  return () => {
    container.remove();
  };
}
