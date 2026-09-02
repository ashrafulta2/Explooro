/**
 * BannersManagerPage.js — Homepage Banners, Sliders & Promotional Strips Manager.
 *
 * Implements /editor/banners:
 * - Slot filters: All, HOMEPAGE_HERO, HOMEPAGE_SECONDARY, FLASH_SALE_STRIP.
 * - Banner preview cards with live status toggles, display order, target URLs.
 * - Create / Edit Banner modal with desktop & mobile asset links.
 */

import { contentApi } from '../../services/content.api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function BannersManagerPage(root) {
  const container = document.createElement('div');
  container.className = 'editor-page-container';

  let banners = [];
  let loading = true;
  let activeSlot = 'ALL';
  let searchQuery = '';

  async function loadData() {
    loading = true;
    render();
    try {
      const res = await contentApi.listBanners();
      banners = res?.data || [];
    } catch (err) {
      console.error('Failed to load banners:', err);
      toast.error('Failed to load banners');
    } finally {
      loading = false;
      render();
    }
  }

  function openBannerModal(existingBanner = null) {
    const isEdit = Boolean(existingBanner);
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <div class="supplier-form-field">
        <label>Banner Slot Placement *</label>
        <select class="form-select" id="banner-slot">
          <option value="HOMEPAGE_HERO" ${existingBanner?.slot === 'HOMEPAGE_HERO' ? 'selected' : ''}>🎯 Homepage Main Hero Slider (1200x400)</option>
          <option value="HOMEPAGE_SECONDARY" ${existingBanner?.slot === 'HOMEPAGE_SECONDARY' ? 'selected' : ''}>📌 Homepage Secondary Showcase (1200x300)</option>
          <option value="FLASH_SALE_STRIP" ${existingBanner?.slot === 'FLASH_SALE_STRIP' ? 'selected' : ''}>⚡ Flash Sale & Campaign Ribbon (1200x120)</option>
        </select>
      </div>

      <div class="supplier-form-field">
        <label>Banner Title (English) *</label>
        <input type="text" id="banner-title-en" class="form-input" placeholder="e.g. Grand Artisan Festival: 100% Authentic Handloom" value="${existingBanner?.title_en || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Banner Title (Bangla) *</label>
        <input type="text" id="banner-title-bn" class="form-input" placeholder="e.g. ঐতিহ্যবাহী তাঁত উৎসব: ১০০% খাঁটি দেশীয় পণ্য" value="${existingBanner?.title_bn || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Desktop Image URL *</label>
        <input type="url" id="banner-img-desktop" class="form-input" placeholder="https://images.unsplash.com/photo-..." value="${existingBanner?.image_url_desktop || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Mobile Image URL (Optional)</label>
        <input type="url" id="banner-img-mobile" class="form-input" placeholder="https://images.unsplash.com/photo-... (600x400)" value="${existingBanner?.image_url_mobile || ''}" />
      </div>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px;">
        <div class="supplier-form-field">
          <label>Target Click Link URL *</label>
          <input type="text" id="banner-link" class="form-input" placeholder="/stories or /saler/b2b-escrow" value="${existingBanner?.target_link || '/stories'}" />
        </div>
        <div class="supplier-form-field">
          <label>Display Order</label>
          <input type="number" id="banner-order" class="form-input" min="1" value="${existingBanner?.display_order || banners.length + 1}" />
        </div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-banner-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="save-banner-btn">
        ${isEdit ? '💾 Save Changes' : '✨ Publish Banner'}
      </button>
    `;

    const modal = Modal({
      title: isEdit ? 'Edit Promotional Banner' : 'Create New Promotional Banner',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-banner-btn').onclick = () => modal.close();
    footer.querySelector('#save-banner-btn').onclick = async () => {
      const slot = content.querySelector('#banner-slot').value;
      const title_en = content.querySelector('#banner-title-en').value.trim();
      const title_bn = content.querySelector('#banner-title-bn').value.trim();
      const image_url_desktop = content.querySelector('#banner-img-desktop').value.trim();
      const image_url_mobile = content.querySelector('#banner-img-mobile').value.trim() || null;
      const target_link = content.querySelector('#banner-link').value.trim() || '/';
      const display_order = parseInt(content.querySelector('#banner-order').value, 10) || 1;

      if (!title_en || !title_bn || !image_url_desktop) {
        toast.error('Please enter English title, Bangla title and desktop image URL.');
        return;
      }

      try {
        await contentApi.upsertBanner({
          id: existingBanner?.id,
          slot,
          title_en,
          title_bn,
          image_url_desktop,
          image_url_mobile,
          target_link,
          display_order,
          is_active: existingBanner?.is_active ?? true,
        });
        toast.success(isEdit ? 'Banner updated successfully!' : 'Banner published live!');
        modal.close();
        loadData();
      } catch (err) {
        toast.error('Failed to save banner.');
      }
    };
  }

  async function handleDeleteBanner(id) {
    if (!confirm('Are you sure you want to remove this banner from storefront?')) return;
    try {
      await contentApi.deleteBanner(id);
      toast.success('Banner removed.');
      loadData();
    } catch (err) {
      toast.error('Failed to delete banner.');
    }
  }

  async function handleToggleActive(banner) {
    try {
      await contentApi.upsertBanner({
        ...banner,
        is_active: !banner.is_active,
      });
      toast.success(`Banner is now ${!banner.is_active ? 'ACTIVE' : 'DRAFT'}`);
      loadData();
    } catch (err) {
      toast.error('Failed to update banner status.');
    }
  }

  function render() {
    container.innerHTML = '';

    // -------------------------------------------------------------------------
    // 1. Header
    // -------------------------------------------------------------------------
    const header = document.createElement('header');
    header.className = 'editor-header';
    header.innerHTML = `
      <div class="editor-header__titles">
        <div class="editor-header__badge-row">
          <a href="/editor" class="text-xs text-muted hover:underline">← Content Studio</a>
          <span class="text-muted">•</span>
          <span class="badge badge--primary font-bold font-mono">BANNERS & SLIDERS</span>
        </div>
        <h1 class="editor-header__title">
          <span>🖼️</span> ${t('editor.banners_title', 'Promotional Banners & Hero Sliders')}
        </h1>
        <p class="editor-header__subtitle">
          Manage promotional slider ribbons, category tops, and seasonal campaign visuals with real-time zero-deploy publishing.
        </p>
      </div>
      <div class="editor-header__actions">
        <button class="btn btn--sm btn--primary font-bold" id="create-banner-btn">
          ✨ Add New Banner
        </button>
      </div>
    `;

    header.querySelector('#create-banner-btn').onclick = () => openBannerModal();
    container.appendChild(header);

    // -------------------------------------------------------------------------
    // 2. Filter Bar & Search
    // -------------------------------------------------------------------------
    const filterCard = document.createElement('div');
    filterCard.className = 'editor-card';
    filterCard.style.padding = '16px 20px';
    filterCard.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div class="editor-filter-chips">
          <button class="editor-chip ${activeSlot === 'ALL' ? 'editor-chip--active' : ''}" data-slot="ALL">
            All Slots (${banners.length})
          </button>
          <button class="editor-chip ${activeSlot === 'HOMEPAGE_HERO' ? 'editor-chip--active' : ''}" data-slot="HOMEPAGE_HERO">
            🎯 Main Hero Slider
          </button>
          <button class="editor-chip ${activeSlot === 'HOMEPAGE_SECONDARY' ? 'editor-chip--active' : ''}" data-slot="HOMEPAGE_SECONDARY">
            📌 Secondary Showcase
          </button>
          <button class="editor-chip ${activeSlot === 'FLASH_SALE_STRIP' ? 'editor-chip--active' : ''}" data-slot="FLASH_SALE_STRIP">
            ⚡ Flash Sale Strip
          </button>
        </div>
        <input type="text" id="banner-search" placeholder="🔍 Search banner title..." value="${searchQuery}" class="form-input" style="width: 220px; font-size: 12px; padding: 6px 12px;" />
      </div>
    `;

    filterCard.querySelectorAll('.editor-chip').forEach((chip) => {
      chip.onclick = () => {
        activeSlot = chip.dataset.slot;
        render();
      };
    });

    filterCard.querySelector('#banner-search').oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      render();
    };

    container.appendChild(filterCard);

    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>Loading banners...</p>
      `;
      container.appendChild(loader);
      return;
    }

    // Filter banners
    const filteredBanners = banners.filter((b) => {
      const matchSlot = activeSlot === 'ALL' || b.slot === activeSlot;
      const matchSearch = !searchQuery || (b.title_en?.toLowerCase().includes(searchQuery) || b.title_bn?.includes(searchQuery));
      return matchSlot && matchSearch;
    });

    // -------------------------------------------------------------------------
    // 3. Banners Grid
    // -------------------------------------------------------------------------
    if (filteredBanners.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '🖼️',
          title: 'No banners found',
          description: 'Create a new promotional banner to feature on the homepage or campaign strips.',
        })
      );
      return;
    }

    const bannerGrid = document.createElement('div');
    bannerGrid.className = 'editor-banner-grid';

    filteredBanners.forEach((banner) => {
      const card = document.createElement('div');
      card.className = 'editor-banner-item';
      card.innerHTML = `
        <img src="${banner.image_url_desktop}" alt="${banner.title_en}" class="editor-banner-item__preview" />
        <div class="editor-banner-item__body">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span class="badge ${banner.slot === 'HOMEPAGE_HERO' ? 'badge--primary' : 'badge--neutral'} font-mono text-xs font-bold">
              ${banner.slot} • #${banner.display_order}
            </span>
            <span class="badge ${banner.is_active ? 'badge--success' : 'badge--neutral'} font-bold text-xs">
              ${banner.is_active ? '🟢 LIVE' : '⚪ DRAFT'}
            </span>
          </div>

          <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 4px 0 2px 0;">
            ${banner.title_en}
          </h3>
          <p style="font-size: var(--text-xs); color: var(--text-secondary); margin: 0;">
            ${banner.title_bn}
          </p>

          <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top: 4px;">
            <span>Target:</span>
            <span class="text-brand font-bold">${banner.target_link}</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
            <button class="btn btn--xs ${banner.is_active ? 'btn--outline' : 'btn--secondary'}" id="toggle-active-btn">
              ${banner.is_active ? 'Set to Draft' : 'Set to Live'}
            </button>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button class="btn btn--xs btn--outline" id="edit-banner-btn">✏️ Edit</button>
              <button class="btn btn--xs btn--outline text-danger" id="delete-banner-btn">🗑️</button>
            </div>
          </div>
        </div>
      `;

      card.querySelector('#toggle-active-btn').onclick = () => handleToggleActive(banner);
      card.querySelector('#edit-banner-btn').onclick = () => openBannerModal(banner);
      card.querySelector('#delete-banner-btn').onclick = () => handleDeleteBanner(banner.id);

      bannerGrid.appendChild(card);
    });

    container.appendChild(bannerGrid);
  }

  loadData();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
