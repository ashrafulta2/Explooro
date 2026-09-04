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
  container.className = 'saler-page-container';
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
  const header = document.createElement('div');
  header.className = 'saler-header-row';
  header.innerHTML = `
    <div class="saler-header-row__titles">
      <div class="saler-header-row__breadcrumb">
        <a href="/saler" class="hover:text-primary transition-colors">
          ← ${t('saler.dashboard.title', 'Dashboard')}
        </a>
        <span>/</span>
        <span class="font-bold text-primary">${t('bundle.studio_title')}</span>
      </div>
      <h1 class="saler-header-row__title">
        <span>📦</span>
        <span>${t('bundle.studio_title')}</span>
      </h1>
      <p class="saler-header-row__subtitle">${t('bundle.studio_subtitle')}</p>
    </div>
    <div class="saler-mode-toggle">
      <button class="saler-mode-btn ${activeTab === 'builder' ? 'active' : ''}" data-tab="builder">
        🛠️ ${t('bundle.tab_builder')}
      </button>
      <button class="saler-mode-btn ${activeTab === 'my_bundles' ? 'active' : ''}" data-tab="my_bundles">
        📦 ${t('bundle.tab_my_bundles')}
      </button>
      <button class="saler-mode-btn ${activeTab === 'surge' ? 'active' : ''}" data-tab="surge">
        ⚡ ${t('bundle.tab_surge')}
      </button>
    </div>
  `;

  const contentArea = document.createElement('div');
  contentArea.className = 'bundle-studio-content';

  container.append(header, contentArea);

  // Tab switching
  header.querySelectorAll('.saler-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      header.querySelectorAll('.saler-mode-btn').forEach((b) => {
        const isCurrent = b.getAttribute('data-tab') === activeTab;
        if (isCurrent) b.classList.add('active');
        else b.classList.remove('active');
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
    grid.className = 'saler-bundle-grid';

    // Left column: Product Selection & Bundle Settings
    const leftCol = document.createElement('div');
    leftCol.className = 'saler-stack';

    // 1. Title & Details Card
    const detailsCard = document.createElement('div');
    detailsCard.className = 'saler-card';
    detailsCard.innerHTML = `
      <h3 class="saler-card__title">${t('bundle.config_heading')}</h3>
      <div class="saler-two-col--equal">
        <div class="saler-stack--xs">
          <label class="text-xs font-bold text-muted uppercase tracking-wider">${t('bundle.title_en_label')}</label>
          <input type="text" id="bundle-title-en" class="input input--sm w-full" placeholder="e.g. Executive Office Combo" value="Executive Office Outfit Combo" />
        </div>
        <div class="saler-stack--xs">
          <label class="text-xs font-bold text-muted uppercase tracking-wider">${t('bundle.title_bn_label')}</label>
          <input type="text" id="bundle-title-bn" class="input input--sm w-full" placeholder="যেমন: এক্সিকিউটিভ অফিস কম্বো" value="এক্সিকিউটিভ অফিস কম্বো বান্ডেল" />
        </div>
      </div>
      <div class="saler-stack--xs">
        <label class="text-xs font-bold text-muted uppercase tracking-wider">${t('bundle.bundle_price_label')} (৳)</label>
        <div class="saler-row">
          <input type="number" id="bundle-price-input" class="input input--sm font-mono font-bold text-lg" style="width: 180px;" placeholder="0.00" step="10" />
          <span class="text-xs text-muted">${t('bundle.price_hint')}</span>
        </div>
      </div>
    `;

    // 2. Selected Items Shelf
    const selectedShelf = document.createElement('div');
    selectedShelf.className = 'saler-card';
    selectedShelf.innerHTML = `
      <div class="saler-row--between">
        <h3 class="saler-card__title m-0">${t('bundle.selected_items_heading')} (${selectedItems.length})</h3>
        <span class="text-xs text-muted">${t('bundle.drag_or_click_hint')}</span>
      </div>
      <div id="selected-items-list" class="saler-stack--sm" style="min-height: 80px;">
        ${selectedItems.length === 0 ? `<p class="text-sm text-muted text-center py-4">${t('bundle.no_items_selected')}</p>` : ''}
      </div>
    `;

    // 3. Product Catalog Browser (Search & Pick)
    const catalogCard = document.createElement('div');
    catalogCard.className = 'saler-card';
    catalogCard.innerHTML = `
      <div class="saler-row--between">
        <h3 class="saler-card__title m-0">${t('bundle.catalog_picker_heading')}</h3>
        <input type="text" id="catalog-search-input" class="input input--sm text-sm" style="width: 240px;" placeholder="${t('bundle.search_products_placeholder')}" />
      </div>
      <div id="catalog-picker-grid" class="saler-bundle-picker-grid">
        <p class="text-sm text-muted py-4 text-center" style="grid-column: 1 / -1;">${t('common.loading')}</p>
      </div>
    `;

    leftCol.append(detailsCard, selectedShelf, catalogCard);

    // Right column: Live Profit Breakdown & Publish Action
    const rightCol = document.createElement('div');
    rightCol.className = 'saler-stack';

    const breakdownWidget = createBundleProfitBreakdown({ breakdown: currentBreakdown });
    rightCol.append(breakdownWidget.element);

    const actionCard = document.createElement('div');
    actionCard.className = 'saler-card text-center';
    
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
        <div class="saler-bundle-picker-item" data-product-id="${p.product_id}">
          <div>
            <div style="font-weight: 600; font-size: 12px; line-height: 1.3;">${p.title_en}</div>
            <div class="text-xs text-muted mt-1">🏭 ${p.supplier_name || 'Supplier'}</div>
          </div>
          <div class="saler-row--between pt-2">
            <span style="font-weight: 700; font-family: var(--font-mono); color: var(--text-primary); font-size: 13px;">${formatCurrency(p.retail_price)}</span>
            <button class="add-to-bundle-btn btn btn--primary btn--xs">
              + ${t('bundle.add_btn')}
            </button>
          </div>
        </div>
      `).join('');

      pickerGrid.querySelectorAll('.saler-bundle-picker-item').forEach((card) => {
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

    function renderSelectedShelf(widget) {
      const shelfList = selectedShelf.querySelector('#selected-items-list');
      const heading = selectedShelf.querySelector('h3');
      if (heading) heading.textContent = `${t('bundle.selected_items_heading')} (${selectedItems.length})`;

      if (selectedItems.length === 0) {
        shelfList.innerHTML = `<p class="text-sm text-muted text-center py-4">${t('bundle.no_items_selected')}</p>`;
        return;
      }

      shelfList.innerHTML = selectedItems.map((it, idx) => `
        <div class="saler-row--between p-2 rounded" style="background: var(--surface-1); border: 1px solid var(--border-subtle);" data-index="${idx}">
          <div class="saler-row" style="gap: 8px;">
            <span class="font-mono text-xs font-bold" style="color: var(--text-muted);">#${idx + 1}</span>
            <div>
              <div style="font-weight: 600; font-size: 12px;">${it.title_en}</div>
              <div class="text-xs text-muted">🏭 ${it.supplier_name} · Retail: <b>${formatCurrency(it.retail_price)}</b></div>
            </div>
          </div>
          <div class="saler-row" style="gap: 8px;">
            <div class="saler-row" style="gap: 4px;">
              <button class="btn-qty-minus btn btn--neutral btn--xs" data-index="${idx}">-</button>
              <span class="font-mono font-bold text-xs px-1">${it.qty}</span>
              <button class="btn-qty-plus btn btn--neutral btn--xs" data-index="${idx}">+</button>
            </div>
            <button class="btn-remove-item btn btn--neutral btn--xs text-danger font-bold" data-index="${idx}">✕</button>
          </div>
        </div>
      `).join('');

      shelfList.querySelectorAll('.btn-qty-plus').forEach((b) => {
        b.addEventListener('click', () => {
          const idx = parseInt(b.getAttribute('data-index'), 10);
          selectedItems[idx].qty += 1;
          renderSelectedShelf(widget);
          recalculateBreakdown(widget);
        });
      });

      shelfList.querySelectorAll('.btn-qty-minus').forEach((b) => {
        b.addEventListener('click', () => {
          const idx = parseInt(b.getAttribute('data-index'), 10);
          if (selectedItems[idx].qty > 1) {
            selectedItems[idx].qty -= 1;
          } else {
            selectedItems.splice(idx, 1);
          }
          renderSelectedShelf(widget);
          recalculateBreakdown(widget);
        });
      });

      shelfList.querySelectorAll('.btn-remove-item').forEach((b) => {
        b.addEventListener('click', () => {
          const idx = parseInt(b.getAttribute('data-index'), 10);
          selectedItems.splice(idx, 1);
          renderSelectedShelf(widget);
          recalculateBreakdown(widget);
        });
      });
    }

    async function recalculateBreakdown(widget) {
      if (selectedItems.length === 0) {
        widget.update(null);
        return;
      }
      const rawPrice = parseFloat(priceInput.value);
      if (isNaN(rawPrice) || rawPrice <= 0) return;

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
        widget.update(currentBreakdown);
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
    tabContainer.className = 'saler-stack';

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
      <div class="saler-three-col">
        ${publishedBundles.map((b) => `
          <div class="saler-card" data-bundle-id="${b.id}">
            <div>
              <div class="saler-row--between mb-2">
                <span class="badge badge--primary font-mono text-xs font-bold">${b.ref}</span>
                <span class="badge ${b.is_active ? 'badge--success' : 'badge--neutral'} text-xs font-bold">
                  ${b.is_active ? t('common.active') : t('common.inactive')}
                </span>
              </div>
              <h4 class="saler-card__title mb-1">${getLanguage() === 'bn' ? b.title_bn : b.title_en}</h4>
              <div class="saler-row mb-3" style="gap: 8px; align-items: baseline;">
                <span class="font-mono font-bold text-xl text-primary">${formatCurrency(b.bundle_price)}</span>
                <span class="text-xs text-muted line-through font-mono">${formatCurrency(b.sum_of_parts)}</span>
                <span class="text-xs text-danger font-bold font-mono">-${formatCurrency(b.discount_amount)}</span>
              </div>
              <div class="text-xs text-muted saler-stack--xs mb-4">
                <div>📦 ${t('bundle.items_count', { count: b.item_count || 2 })}</div>
                <div>🏭 ${t('bundle.suppliers_count', { count: b.supplier_count || 2 })}</div>
              </div>
            </div>
            <div class="saler-row--between pt-3" style="border-top: 1px solid var(--border-subtle);">
              <button class="toggle-bundle-btn btn btn--neutral btn--xs font-bold" data-id="${b.id}" data-active="${b.is_active}">
                ${b.is_active ? t('bundle.deactivate') : t('bundle.activate')}
              </button>
              <div class="saler-row" style="gap: 6px;">
                <button class="copy-bundle-link-btn btn btn--secondary btn--xs font-bold" data-ref="${b.ref}">
                  🔗 ${t('bundle.copy_link')}
                </button>
                <button class="delete-bundle-btn btn btn--neutral btn--xs text-danger font-bold" data-id="${b.id}">
                  🗑️
                </button>
              </div>
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
    tabContainer.className = 'saler-stack';

    tabContainer.innerHTML = `
      <div class="saler-card" style="background: var(--brand-50, #fdf8ef); border-color: var(--brand-300, #fedc80);">
        <div class="saler-row" style="gap: 12px; align-items: flex-start;">
          <span style="font-size: 24px;">⚡</span>
          <div>
            <h4 class="saler-card__title" style="color: var(--brand-900, #866100);">${t('surge.radar_title')}</h4>
            <p class="saler-card__subtitle" style="color: var(--brand-800, #a17700);">${t('surge.radar_desc')}</p>
          </div>
        </div>
      </div>

      ${surgeRecommendations.length === 0 ? `
        <div class="saler-card text-center p-8">
          <p class="text-muted m-0">${t('surge.no_active_surges')}</p>
        </div>
      ` : `
        <div class="saler-stack">
          ${surgeRecommendations.map((rec) => `
            <div class="saler-card" data-rec-id="${rec.id}">
              <div class="saler-row--between">
                <div class="saler-stack--xs" style="max-width: 600px;">
                  <div class="saler-row" style="gap: 8px;">
                    <span class="badge badge--warning font-mono text-xs font-bold">${rec.ref}</span>
                    <span class="badge badge--primary font-bold text-xs">+${rec.surge_pct}% ${t('surge.surge_badge')}</span>
                  </div>
                  <h4 class="saler-card__title m-0">${rec.product_title_en}</h4>
                  <p class="saler-card__subtitle m-0">
                    ${getLanguage() === 'bn' ? rec.reason_bn : rec.reason_en}
                  </p>
                  <div class="saler-row text-xs font-mono text-muted pt-1" style="gap: 16px;">
                    <span>📈 24h Velocity: <b>${rec.velocity_score}</b></span>
                    <span>📦 Depletion: <b>${(rec.depletion_rate_score * 100).toFixed(0)}%</b></span>
                  </div>
                </div>
                <div class="saler-row" style="gap: 16px;">
                  <div style="text-align: right;">
                    <span class="text-xs text-muted block line-through font-mono">${formatCurrency(rec.current_price)}</span>
                    <span class="text-lg font-bold font-mono" style="color: var(--success-600, #16a34a);">${formatCurrency(rec.recommended_price)}</span>
                  </div>
                  <div class="saler-row" style="gap: 8px;">
                    <button class="accept-surge-btn btn btn--primary btn--sm font-bold" data-id="${rec.id}">
                      ✓ ${t('surge.opt_in_btn')}
                    </button>
                    <button class="dismiss-surge-btn btn btn--neutral btn--sm font-bold" data-id="${rec.id}">
                      ✕
                    </button>
                  </div>
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
