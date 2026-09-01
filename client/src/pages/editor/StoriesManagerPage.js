/**
 * StoriesManagerPage.js — Shoppable Video Reels & Editorial Articles Curator.
 *
 * Implements /editor/stories:
 * - Tab switcher: "Editorial Stories & Spotlights" and "Shoppable Video Reels".
 * - Tagged product SKU previews, view counters, engagement analytics.
 * - Add / Edit Story & Reel modal with product tagging.
 */

import { contentApi } from '../../services/content.api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { formatCurrency, formatDate } from '../../services/format.js';

export default function StoriesManagerPage(root) {
  const container = document.createElement('div');
  container.className = 'editor-page-container';

  let activeTab = 'stories'; // 'stories' | 'reels'
  let stories = [];
  let reels = [];
  let loading = true;
  let searchQuery = '';

  async function loadData() {
    loading = true;
    render();
    try {
      const [sRes, rRes] = await Promise.all([
        contentApi.listStories().catch(() => ({ data: [] })),
        contentApi.listReels().catch(() => ({ data: [] })),
      ]);
      stories = sRes?.data || [];
      reels = rRes?.data || [];
    } catch (err) {
      console.error('Failed to load stories & reels:', err);
      toast.error('Failed to load content streams');
    } finally {
      loading = false;
      render();
    }
  }

  function openStoryModal(existingStory = null) {
    const isEdit = Boolean(existingStory);
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <div class="supplier-form-field">
        <label>Author / Spotlight Merchant *</label>
        <input type="text" id="story-author" class="form-input" placeholder="e.g. Habib Traders (Dhaka) or Bengal Weaves" value="${existingStory?.author_name || 'Explooro Editorial'}" />
      </div>

      <div class="supplier-form-field">
        <label>Story Title (English) *</label>
        <input type="text" id="story-title-en" class="form-input" placeholder="e.g. How I Scaled My Jamdani Saree Store to Tk 5 Lakh" value="${existingStory?.title_en || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Story Title (Bangla) *</label>
        <input type="text" id="story-title-bn" class="form-input" placeholder="e.g. কীভাবে আমি এক্সপ্লোরোতে জামদানি শাড়ির দোকান সম্প্রসারণ করেছি" value="${existingStory?.title_bn || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Cover Image URL *</label>
        <input type="url" id="story-cover" class="form-input" placeholder="https://images.unsplash.com/photo-..." value="${existingStory?.cover_image_url || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80'}" />
      </div>

      <div class="supplier-form-field">
        <label>Story Article Content (English) *</label>
        <textarea id="story-content-en" class="form-textarea" rows="4" placeholder="Write the editorial narrative...">${existingStory?.content_en || ''}</textarea>
      </div>

      <div class="supplier-form-field">
        <label>Story Article Content (Bangla)</label>
        <textarea id="story-content-bn" class="form-textarea" rows="4" placeholder="বাংলা বিবরণ লিখুন...">${existingStory?.content_bn || ''}</textarea>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-story-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="save-story-btn">
        ${isEdit ? '💾 Update Story' : '✨ Publish Story'}
      </button>
    `;

    const modal = Modal({
      title: isEdit ? 'Edit Editorial Story' : 'Publish New Editorial Story',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-story-btn').onclick = () => modal.close();
    footer.querySelector('#save-story-btn').onclick = async () => {
      const author_name = content.querySelector('#story-author').value.trim();
      const title_en = content.querySelector('#story-title-en').value.trim();
      const title_bn = content.querySelector('#story-title-bn').value.trim();
      const cover_image_url = content.querySelector('#story-cover').value.trim();
      const content_en = content.querySelector('#story-content-en').value.trim();
      const content_bn = content.querySelector('#story-content-bn').value.trim();

      if (!title_en || !title_bn || !cover_image_url) {
        toast.error('Please fill in title and cover image URL.');
        return;
      }

      try {
        await contentApi.upsertStory({
          id: existingStory?.id,
          author_name,
          title_en,
          title_bn,
          cover_image_url,
          content_en,
          content_bn,
          status: 'PUBLISHED',
        });
        toast.success(isEdit ? 'Story updated!' : 'Story published live!');
        modal.close();
        loadData();
      } catch (err) {
        toast.error('Failed to save story.');
      }
    };
  }

  function openReelModal() {
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <div class="supplier-form-field">
        <label>Creator / Channel Name *</label>
        <input type="text" id="reel-author" class="form-input" placeholder="e.g. Explooro Live Studio or Habib Traders" value="Explooro Studio" />
      </div>

      <div class="supplier-form-field">
        <label>Video Stream URL (.mp4 / stream) *</label>
        <input type="url" id="reel-video" class="form-input" placeholder="https://commondatastorage.googleapis.com/.../sample.mp4" value="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" />
      </div>

      <div class="supplier-form-field">
        <label>Thumbnail Poster Image URL *</label>
        <input type="url" id="reel-thumb" class="form-input" placeholder="https://images.unsplash.com/..." value="https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=400&q=80" />
      </div>

      <div class="supplier-form-field">
        <label>Shoppable Reel Caption *</label>
        <input type="text" id="reel-caption-en" class="form-input" placeholder="e.g. Live artisan weaving of pure silk sarees! Tap below to buy." />
      </div>

      <div class="supplier-form-field">
        <label>Pinned Product SKU Name *</label>
        <input type="text" id="reel-product-name" class="form-input" placeholder="Heritage Dhakai Jamdani Saree" value="Heritage Dhakai Jamdani Saree (84 Count)" />
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-reel-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="save-reel-btn">🚀 Publish Reel</button>
    `;

    const modal = Modal({
      title: 'Add Shoppable Video Reel',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-reel-btn').onclick = () => modal.close();
    footer.querySelector('#save-reel-btn').onclick = async () => {
      const author_name = content.querySelector('#reel-author').value.trim();
      const video_url = content.querySelector('#reel-video').value.trim();
      const thumbnail_url = content.querySelector('#reel-thumb').value.trim();
      const caption_en = content.querySelector('#reel-caption-en').value.trim();
      const prodTitle = content.querySelector('#reel-product-name').value.trim();

      if (!video_url || !thumbnail_url || !caption_en) {
        toast.error('Please enter video URL, thumbnail and caption.');
        return;
      }

      try {
        await contentApi.createReel({
          author_name,
          video_url,
          thumbnail_url,
          caption_en,
          caption_bn: caption_en,
          product: {
            id: Date.now(),
            title_en: prodTitle,
            title_bn: prodTitle,
            retail_price: 3500.0,
            media: [{ url: thumbnail_url }],
            is_in_stock: true,
          },
        });
        toast.success('Shoppable reel published live!');
        modal.close();
        loadData();
      } catch (err) {
        toast.error('Failed to create reel.');
      }
    };
  }

  async function handleDeleteStory(id) {
    if (!confirm('Are you sure you want to remove this story?')) return;
    try {
      await contentApi.deleteStory(id);
      toast.success('Story removed.');
      loadData();
    } catch (err) {
      toast.error('Failed to delete story.');
    }
  }

  async function handleDeleteReel(id) {
    if (!confirm('Are you sure you want to remove this video reel?')) return;
    try {
      await contentApi.deleteReel(id);
      toast.success('Video reel removed.');
      loadData();
    } catch (err) {
      toast.error('Failed to delete reel.');
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
          <span class="badge badge--primary font-bold font-mono">STORIES & REELS</span>
        </div>
        <h1 class="editor-header__title">
          <span>🎬</span> ${t('editor.stories_title', 'Shoppable Stories & Product Video Reels')}
        </h1>
        <p class="editor-header__subtitle">
          Curate merchant spotlights, behind-the-scenes artisan reels, and tag purchasable SKUs with 1-click checkout buttons.
        </p>
      </div>
      <div class="editor-header__actions">
        ${
          activeTab === 'stories'
            ? `<button class="btn btn--sm btn--primary font-bold" id="new-story-btn">✨ New Story</button>`
            : `<button class="btn btn--sm btn--primary font-bold" id="new-reel-btn">🎥 Add Reel</button>`
        }
      </div>
    `;

    if (activeTab === 'stories') {
      header.querySelector('#new-story-btn').onclick = () => openStoryModal();
    } else {
      header.querySelector('#new-reel-btn').onclick = () => openReelModal();
    }

    container.appendChild(header);

    // -------------------------------------------------------------------------
    // 2. Tab Bar & Search
    // -------------------------------------------------------------------------
    const filterCard = document.createElement('div');
    filterCard.className = 'editor-card';
    filterCard.style.padding = '16px 20px';
    filterCard.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div class="editor-filter-chips">
          <button class="editor-chip ${activeTab === 'stories' ? 'editor-chip--active' : ''}" data-tab="stories">
            📰 Editorial Stories (${stories.length})
          </button>
          <button class="editor-chip ${activeTab === 'reels' ? 'editor-chip--active' : ''}" data-tab="reels">
            🎬 Shoppable Video Reels (${reels.length})
          </button>
        </div>
        <input type="text" id="content-search" placeholder="🔍 Search title or author..." value="${searchQuery}" class="form-input" style="width: 240px; font-size: 12px; padding: 6px 12px;" />
      </div>
    `;

    filterCard.querySelectorAll('.editor-chip').forEach((chip) => {
      chip.onclick = () => {
        activeTab = chip.dataset.tab;
        render();
      };
    });

    filterCard.querySelector('#content-search').oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      render();
    };

    container.appendChild(filterCard);

    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>Loading stories & reels...</p>
      `;
      container.appendChild(loader);
      return;
    }

    // -------------------------------------------------------------------------
    // 3. Stories Tab
    // -------------------------------------------------------------------------
    if (activeTab === 'stories') {
      const filteredStories = stories.filter((s) => {
        return !searchQuery || s.title_en?.toLowerCase().includes(searchQuery) || s.author_name?.toLowerCase().includes(searchQuery);
      });

      if (filteredStories.length === 0) {
        container.appendChild(
          EmptyState({
            icon: '📰',
            title: 'No stories found',
            description: 'Publish an artisan spotlight story to educate buyers and resellers.',
          })
        );
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'editor-story-grid';

      filteredStories.forEach((story) => {
        const card = document.createElement('div');
        card.className = 'editor-story-card';
        card.innerHTML = `
          <div style="position: relative;">
            <img src="${story.cover_image_url}" alt="${story.title_en}" class="editor-story-card__cover" />
            <span class="editor-story-card__badge-overlay">👁️ ${story.view_count || 0} views</span>
          </div>

          <div style="padding: 16px; display: flex; flex-direction: column; gap: 8px; flex: 1;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <span class="text-xs text-muted font-bold">by ${story.author_name}</span>
              <span class="badge badge--success font-mono font-bold text-xs">PUBLISHED</span>
            </div>

            <h3 style="font-size: var(--font-size-base); font-weight: 800; color: var(--text-primary); margin: 2px 0;">
              ${story.title_en}
            </h3>

            <p style="font-size: var(--font-size-xs); color: var(--text-secondary); line-height: 1.4; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              ${story.content_en}
            </p>

            ${
              story.embedded_products?.length
                ? `
              <div style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--surface-1); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-top: 4px;">
                <span class="text-xs font-bold text-primary">🛍️ Tagged SKU:</span>
                <span class="text-xs font-mono font-bold">${story.embedded_products[0].title_en}</span>
              </div>
            `
                : ''
            }

            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border-subtle);">
              <span class="text-xs text-muted font-mono">${formatDate(story.published_at)}</span>
              <div style="display: flex; align-items: center; gap: 6px;">
                <button class="btn btn--xs btn--outline" id="edit-story-btn">✏️ Edit</button>
                <button class="btn btn--xs btn--outline text-danger" id="delete-story-btn">🗑️</button>
              </div>
            </div>
          </div>
        `;

        card.querySelector('#edit-story-btn').onclick = () => openStoryModal(story);
        card.querySelector('#delete-story-btn').onclick = () => handleDeleteStory(story.id);

        grid.appendChild(card);
      });

      container.appendChild(grid);
    } else {
      // -------------------------------------------------------------------------
      // 4. Reels Tab
      // -------------------------------------------------------------------------
      const filteredReels = reels.filter((r) => {
        return !searchQuery || r.caption_en?.toLowerCase().includes(searchQuery) || r.author_name?.toLowerCase().includes(searchQuery);
      });

      if (filteredReels.length === 0) {
        container.appendChild(
          EmptyState({
            icon: '🎬',
            title: 'No reels found',
            description: 'Add a video reel with pinned product buy buttons.',
          })
        );
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'editor-story-grid';

      filteredReels.forEach((reel) => {
        const card = document.createElement('div');
        card.className = 'editor-story-card';
        card.innerHTML = `
          <div style="position: relative;">
            <img src="${reel.thumbnail_url}" alt="${reel.caption_en}" class="editor-story-card__cover" />
            <span class="editor-story-card__badge-overlay">▶ ${reel.duration_seconds}s • ❤️ ${reel.likes_count}</span>
          </div>

          <div style="padding: 16px; display: flex; flex-direction: column; gap: 8px; flex: 1;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <span class="text-xs text-muted font-bold">${reel.author_name}</span>
              <span class="badge badge--primary font-mono font-bold text-xs">REEL</span>
            </div>

            <p style="font-size: var(--font-size-sm); font-weight: 700; color: var(--text-primary); margin: 2px 0; line-height: 1.4;">
              ${reel.caption_en}
            </p>

            ${
              reel.product
                ? `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: var(--brand-50, #fdf8ef); border-radius: var(--radius-md); border: 1px solid rgba(236, 174, 0, 0.3); margin-top: 4px;">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                  <span class="text-xs font-bold text-primary">${reel.product.title_en}</span>
                  <span class="text-xs font-mono font-bold text-success">${formatCurrency(reel.product.retail_price)}</span>
                </div>
                <span class="badge badge--success font-bold text-xs">PINNED</span>
              </div>
            `
                : ''
            }

            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border-subtle);">
              <span class="text-xs text-muted font-mono">👁️ ${reel.views_count} views</span>
              <button class="btn btn--xs btn--outline text-danger" id="delete-reel-btn">🗑️ Delete</button>
            </div>
          </div>
        `;

        card.querySelector('#delete-reel-btn').onclick = () => handleDeleteReel(reel.id);

        grid.appendChild(card);
      });

      container.appendChild(grid);
    }
  }

  loadData();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
