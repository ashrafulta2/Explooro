/**
 * EditorDashboardPage.js — Editor Portal Central Dashboard & Content Management Studio (Prompt 10.8).
 *
 * Implements /editor:
 * - Real-time KPI summary cards with direct navigation triggers.
 * - Quick Action Buttons: Quick Add Banner, Quick Add Story/Reel, Quick Announcement.
 * - 6 Workspace Launchpad cards.
 * - Live Tabbed Management Console (Banners, Stories, Changelogs, Academy Tutorials) with 1-click status toggles, inline editing, and deletion.
 */

import { contentApi } from '../../services/content.api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { formatCurrency, formatDate } from '../../services/format.js';

export default function EditorDashboardPage(root) {
  const container = document.createElement('div');
  container.className = 'editor-page-container';

  let activeConsoleTab = 'banners'; // 'banners' | 'stories' | 'whats_new' | 'academy'
  let banners = [];
  let stories = [];
  let reels = [];
  let courses = [];
  let whatsNew = [];
  let helpArticles = [];
  let completeness = { locales: [] };
  let loading = true;

  async function loadData() {
    loading = true;
    render();
    try {
      const [bRes, sRes, rRes, cRes, wRes, hRes, tRes] = await Promise.all([
        contentApi.listBanners().catch(() => ({ data: [] })),
        contentApi.listStories().catch(() => ({ data: [] })),
        contentApi.listReels().catch(() => ({ data: [] })),
        contentApi.listAcademyCourses().catch(() => ({ data: [] })),
        contentApi.listWhatsNew().catch(() => ({ data: [] })),
        contentApi.listHelpArticles().catch(() => ({ data: [] })),
        contentApi.listTranslationCompleteness().catch(() => ({ data: { locales: [] } })),
      ]);

      banners = bRes?.data || [];
      stories = sRes?.data || [];
      reels = rRes?.data || [];
      courses = cRes?.data || [];
      whatsNew = wRes?.data || [];
      helpArticles = hRes?.data || [];
      completeness = tRes?.data || { locales: [] };
    } catch (err) {
      console.error('Failed to load editor dashboard metrics:', err);
      toast.error('Failed to load dashboard metrics');
    } finally {
      loading = false;
      render();
    }
  }

  // ---------------------------------------------------------------------------
  // Quick Action Modal 1: Add/Edit Banner
  // ---------------------------------------------------------------------------
  function openQuickBannerModal(existingBanner = null) {
    const isEdit = Boolean(existingBanner);
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <div class="supplier-form-field">
        <label>Placement Slot *</label>
        <select class="form-select" id="q-banner-slot">
          <option value="HOMEPAGE_HERO" ${existingBanner?.slot === 'HOMEPAGE_HERO' ? 'selected' : ''}>🎯 Homepage Main Hero Slider (1200x400)</option>
          <option value="HOMEPAGE_SECONDARY" ${existingBanner?.slot === 'HOMEPAGE_SECONDARY' ? 'selected' : ''}>📌 Homepage Secondary Showcase (1200x300)</option>
          <option value="FLASH_SALE_STRIP" ${existingBanner?.slot === 'FLASH_SALE_STRIP' ? 'selected' : ''}>⚡ Flash Sale Strip (1200x120)</option>
        </select>
      </div>

      <div class="supplier-form-field">
        <label>Banner Title (English) *</label>
        <input type="text" id="q-banner-title-en" class="form-input" placeholder="e.g. Grand Handloom Festival 2026" value="${existingBanner?.title_en || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Banner Title (Bangla) *</label>
        <input type="text" id="q-banner-title-bn" class="form-input" placeholder="e.g. ঐতিহ্যবাহী তাঁত মেলা ২০২৬" value="${existingBanner?.title_bn || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Desktop Image URL *</label>
        <input type="url" id="q-banner-img" class="form-input" placeholder="https://images.unsplash.com/..." value="${existingBanner?.image_url_desktop || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1200&q=80'}" />
      </div>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px;">
        <div class="supplier-form-field">
          <label>Target Click URL *</label>
          <input type="text" id="q-banner-link" class="form-input" placeholder="/stories" value="${existingBanner?.target_link || '/stories'}" />
        </div>
        <div class="supplier-form-field">
          <label>Order</label>
          <input type="number" id="q-banner-order" class="form-input" min="1" value="${existingBanner?.display_order || banners.length + 1}" />
        </div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-q-banner-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="save-q-banner-btn">
        ${isEdit ? '💾 Update Banner' : '✨ Publish Live'}
      </button>
    `;

    const modal = Modal({
      title: isEdit ? 'Edit Banner' : 'Quick Add Promotional Banner',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-q-banner-btn').onclick = () => modal.close();
    footer.querySelector('#save-q-banner-btn').onclick = async () => {
      const slot = content.querySelector('#q-banner-slot').value;
      const title_en = content.querySelector('#q-banner-title-en').value.trim();
      const title_bn = content.querySelector('#q-banner-title-bn').value.trim();
      const image_url_desktop = content.querySelector('#q-banner-img').value.trim();
      const target_link = content.querySelector('#q-banner-link').value.trim() || '/';
      const display_order = parseInt(content.querySelector('#q-banner-order').value, 10) || 1;

      if (!title_en || !title_bn || !image_url_desktop) {
        toast.error('Please enter English title, Bangla title and image URL.');
        return;
      }

      try {
        await contentApi.upsertBanner({
          id: existingBanner?.id,
          slot,
          title_en,
          title_bn,
          image_url_desktop,
          target_link,
          display_order,
          is_active: existingBanner?.is_active ?? true,
        });
        toast.success(isEdit ? 'Banner updated!' : 'Banner published live!');
        modal.close();
        loadData();
      } catch (err) {
        toast.error('Failed to save banner.');
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Quick Action Modal 2: Add/Edit Story
  // ---------------------------------------------------------------------------
  function openQuickStoryModal(existingStory = null) {
    const isEdit = Boolean(existingStory);
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <div class="supplier-form-field">
        <label>Author / Spotlight Merchant *</label>
        <input type="text" id="q-story-author" class="form-input" placeholder="e.g. Habib Traders (Dhaka)" value="${existingStory?.author_name || 'Explooro Editorial'}" />
      </div>

      <div class="supplier-form-field">
        <label>Story Title (English) *</label>
        <input type="text" id="q-story-title-en" class="form-input" placeholder="e.g. How I Scaled My Jamdani Saree Store" value="${existingStory?.title_en || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Cover Image URL *</label>
        <input type="url" id="q-story-cover" class="form-input" placeholder="https://images.unsplash.com/..." value="${existingStory?.cover_image_url || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=800&q=80'}" />
      </div>

      <div class="supplier-form-field">
        <label>Story Content *</label>
        <textarea id="q-story-content" class="form-textarea" rows="3" placeholder="Write story narrative...">${existingStory?.content_en || ''}</textarea>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-q-story-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="save-q-story-btn">
        ${isEdit ? '💾 Update Story' : '🚀 Publish Story'}
      </button>
    `;

    const modal = Modal({
      title: isEdit ? 'Edit Story' : 'Quick Publish Editorial Story',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-q-story-btn').onclick = () => modal.close();
    footer.querySelector('#save-q-story-btn').onclick = async () => {
      const author_name = content.querySelector('#q-story-author').value.trim();
      const title_en = content.querySelector('#q-story-title-en').value.trim();
      const cover_image_url = content.querySelector('#q-story-cover').value.trim();
      const content_en = content.querySelector('#q-story-content').value.trim();

      if (!title_en || !cover_image_url) {
        toast.error('Please enter title and cover image.');
        return;
      }

      try {
        await contentApi.upsertStory({
          id: existingStory?.id,
          author_name,
          title_en,
          title_bn: title_en,
          cover_image_url,
          content_en,
          content_bn: content_en,
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

  // ---------------------------------------------------------------------------
  // Quick Action Modal 3: Add/Edit Release Note
  // ---------------------------------------------------------------------------
  function openQuickAnnouncementModal(existing = null) {
    const isEdit = Boolean(existing);
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="supplier-form-field">
          <label>Version *</label>
          <input type="text" id="q-up-ver" class="form-input" placeholder="v2.5.0" value="${existing?.version || 'v2.5.0'}" />
        </div>
        <div class="supplier-form-field">
          <label>Category *</label>
          <select class="form-select" id="q-up-cat">
            <option value="FEATURE" ${existing?.category === 'FEATURE' ? 'selected' : ''}>✨ Feature</option>
            <option value="IMPROVEMENT" ${existing?.category === 'IMPROVEMENT' ? 'selected' : ''}>⚡ Improvement</option>
            <option value="SECURITY" ${existing?.category === 'SECURITY' ? 'selected' : ''}>🛡️ Security</option>
          </select>
        </div>
      </div>

      <div class="supplier-form-field">
        <label>Release Title *</label>
        <input type="text" id="q-up-title" class="form-input" placeholder="e.g. Courier Reverse Logistics Handover" value="${existing?.title_en || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Summary Narrative *</label>
        <textarea id="q-up-summary" class="form-textarea" rows="3" placeholder="Explain the key improvements...">${existing?.summary_en || ''}</textarea>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-q-up-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="save-q-up-btn">
        ${isEdit ? '💾 Update Note' : '📢 Publish Release'}
      </button>
    `;

    const modal = Modal({
      title: isEdit ? 'Edit Release Note' : 'Quick Publish Platform Announcement',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-q-up-btn').onclick = () => modal.close();
    footer.querySelector('#save-q-up-btn').onclick = async () => {
      const version = content.querySelector('#q-up-ver').value.trim();
      const category = content.querySelector('#q-up-cat').value;
      const title_en = content.querySelector('#q-up-title').value.trim();
      const summary_en = content.querySelector('#q-up-summary').value.trim();

      if (!version || !title_en || !summary_en) {
        toast.error('Please enter version, title and summary.');
        return;
      }

      try {
        await contentApi.upsertWhatsNew({
          id: existing?.id,
          version,
          category,
          target_audience: 'ALL',
          title_en,
          title_bn: title_en,
          summary_en,
          summary_bn: summary_en,
        });
        toast.success(isEdit ? 'Release note updated!' : 'Announcement published live!');
        modal.close();
        loadData();
      } catch (err) {
        toast.error('Failed to save announcement.');
      }
    };
  }

  async function handleToggleBannerActive(banner) {
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

  async function handleDeleteBanner(id) {
    if (!confirm('Are you sure you want to remove this banner?')) return;
    try {
      await contentApi.deleteBanner(id);
      toast.success('Banner removed.');
      loadData();
    } catch (err) {
      toast.error('Failed to delete banner.');
    }
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

  async function handleDeleteWhatsNew(id) {
    if (!confirm('Are you sure you want to remove this announcement?')) return;
    try {
      await contentApi.deleteWhatsNew(id);
      toast.success('Announcement removed.');
      loadData();
    } catch (err) {
      toast.error('Failed to delete announcement.');
    }
  }

  function render() {
    container.innerHTML = '';

    // -------------------------------------------------------------------------
    // 1. Header with Quick Actions
    // -------------------------------------------------------------------------
    const header = document.createElement('header');
    header.className = 'editor-header';
    header.innerHTML = `
      <div class="editor-header__titles">
        <div class="editor-header__badge-row">
          <span class="badge badge--primary font-bold font-mono">EDITORIAL STUDIO</span>
          <span class="text-xs text-muted">v2.4.0 • Zero-Deploy CMS</span>
        </div>
        <h1 class="editor-header__title">
          <span>✍️</span> ${t('editor.dashboard_title', 'Content & Editorial Management Studio')}
        </h1>
        <p class="editor-header__subtitle">
          Manage storefront hero banners, shoppable reels, seller tutorials, and live localization phrases.
        </p>
      </div>

      <div class="editor-header__actions">
        <button class="btn btn--sm btn--primary font-bold" id="quick-add-banner-btn">
          ✨ Add Banner
        </button>
        <button class="btn btn--sm btn--outline font-bold" id="quick-add-story-btn">
          🎬 Add Story
        </button>
        <button class="btn btn--sm btn--outline font-bold" id="quick-add-up-btn">
          📢 Release Note
        </button>
        <button class="btn btn--sm btn--secondary" id="refresh-dashboard-btn" title="Refresh metrics">
          🔄 Refresh
        </button>
      </div>
    `;

    header.querySelector('#quick-add-banner-btn').onclick = () => openQuickBannerModal();
    header.querySelector('#quick-add-story-btn').onclick = () => openQuickStoryModal();
    header.querySelector('#quick-add-up-btn').onclick = () => openQuickAnnouncementModal();
    header.querySelector('#refresh-dashboard-btn').onclick = loadData;

    container.appendChild(header);

    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>Loading editorial metrics & content console...</p>
      `;
      container.appendChild(loader);
      return;
    }

    // -------------------------------------------------------------------------
    // 2. Clickable KPI Summary Strip (4 Cards)
    // -------------------------------------------------------------------------
    const activeBannersCount = banners.filter((b) => b.is_active).length;
    const bnLocale = completeness.locales?.find((l) => l.locale === 'bn') || { completeness_pct: 97 };

    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'editor-kpi-grid';
    kpiGrid.innerHTML = `
      <a href="/editor/banners" class="editor-kpi-card" style="text-decoration: none; cursor: pointer;">
        <span class="editor-kpi-card__label">Active Storefront Banners</span>
        <div class="editor-kpi-card__value text-primary">${activeBannersCount} Banners</div>
        <span class="editor-kpi-card__subtext">Live on Homepage & Flash strips →</span>
      </a>

      <a href="/editor/stories" class="editor-kpi-card" style="text-decoration: none; cursor: pointer;">
        <span class="editor-kpi-card__label">Published Stories & Reels</span>
        <div class="editor-kpi-card__value text-success">${stories.length + reels.length} Curations</div>
        <span class="editor-kpi-card__subtext">Shoppable artisan & video spots →</span>
      </a>

      <a href="/editor/academy" class="editor-kpi-card" style="text-decoration: none; cursor: pointer;">
        <span class="editor-kpi-card__label">Academy Modules Active</span>
        <div class="editor-kpi-card__value text-primary">${courses.length} Courses</div>
        <span class="editor-kpi-card__subtext">Sourcing, Escrow & Sales guides →</span>
      </a>

      <a href="/editor/translations" class="editor-kpi-card" style="text-decoration: none; cursor: pointer;">
        <span class="editor-kpi-card__label">Bangla Localization Coverage</span>
        <div class="editor-kpi-card__value text-success">${bnLocale.completeness_pct}%</div>
        <span class="editor-kpi-card__subtext">${completeness.locales?.length || 2} languages synchronized →</span>
      </a>
    `;
    container.appendChild(kpiGrid);

    // -------------------------------------------------------------------------
    // 3. Quick Action Launchpad Workspaces
    // -------------------------------------------------------------------------
    const launchpadSection = document.createElement('div');
    launchpadSection.innerHTML = `
      <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 0 0 12px 0;">
        🚀 Content Management Workspaces
      </h3>
    `;

    const launchpadGrid = document.createElement('div');
    launchpadGrid.className = 'editor-launchpad-grid';

    const launchpadItems = [
      {
        icon: '🖼️',
        title: 'Promotional Banners',
        desc: 'Schedule and deploy homepage hero sliders, category headers, and flash sale ribbons.',
        path: '/editor/banners',
        badge: `${banners.length} Banners`,
      },
      {
        icon: '🎬',
        title: 'Stories & Shoppable Reels',
        desc: 'Curate product discovery video reels, artisan spotlights, and tag purchasable SKUs.',
        path: '/editor/stories',
        badge: `${stories.length + reels.length} Items`,
      },
      {
        icon: '🎓',
        title: 'Seller & Buyer Academy',
        desc: 'Manage educational courses, video lessons, and sourcing best practices.',
        path: '/editor/academy',
        badge: `${courses.length} Courses`,
      },
      {
        icon: '📢',
        title: "What's New & Changelogs",
        desc: 'Publish release announcements, system feature updates, and audience alerts.',
        path: '/editor/whats-new',
        badge: `${whatsNew.length} Updates`,
      },
      {
        icon: '❓',
        title: 'Help Centre & Knowledge Base',
        desc: 'Maintain customer FAQs, escrow guides, and return policies across categories.',
        path: '/editor/help-center',
        badge: `${helpArticles.length} Articles`,
      },
      {
        icon: '🌐',
        title: 'Localization & Translations',
        desc: 'Edit bilingual phrases in real-time, import/export JSON dictionaries, and review missing keys.',
        path: '/editor/translations',
        badge: `${bnLocale.completeness_pct}% Synced`,
      },
    ];

    launchpadItems.forEach((item) => {
      const card = document.createElement('a');
      card.href = item.path;
      card.className = 'editor-launchpad-card';
      card.innerHTML = `
        <div class="editor-launchpad-card__icon">${item.icon}</div>
        <div class="editor-launchpad-card__info">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span class="editor-launchpad-card__title">${item.title}</span>
            <span class="badge badge--neutral font-mono text-xs font-bold">${item.badge}</span>
          </div>
          <span class="editor-launchpad-card__desc">${item.desc}</span>
        </div>
      `;
      launchpadGrid.appendChild(card);
    });

    launchpadSection.appendChild(launchpadGrid);
    container.appendChild(launchpadSection);

    // -------------------------------------------------------------------------
    // 4. Live Editorial Management Console (Interactive Tabs)
    // -------------------------------------------------------------------------
    const consoleCard = document.createElement('div');
    consoleCard.className = 'editor-card';

    const consoleHeader = document.createElement('div');
    consoleHeader.className = 'editor-card__header';
    consoleHeader.innerHTML = `
      <div>
        <h3 class="editor-card__title">🎛️ Live Editorial Management Console</h3>
        <p class="editor-card__subtitle">Instant actions: toggle live states, edit active content, or jump to specialized managers</p>
      </div>

      <div class="editor-filter-chips">
        <button class="editor-chip ${activeConsoleTab === 'banners' ? 'editor-chip--active' : ''}" data-tab="banners">
          🖼️ Banners (${banners.length})
        </button>
        <button class="editor-chip ${activeConsoleTab === 'stories' ? 'editor-chip--active' : ''}" data-tab="stories">
          🎬 Stories (${stories.length})
        </button>
        <button class="editor-chip ${activeConsoleTab === 'whats_new' ? 'editor-chip--active' : ''}" data-tab="whats_new">
          📢 Changelogs (${whatsNew.length})
        </button>
        <button class="editor-chip ${activeConsoleTab === 'academy' ? 'editor-chip--active' : ''}" data-tab="academy">
          🎓 Academy (${courses.length})
        </button>
      </div>
    `;

    consoleHeader.querySelectorAll('.editor-chip').forEach((chip) => {
      chip.onclick = () => {
        activeConsoleTab = chip.dataset.tab;
        render();
      };
    });
    consoleCard.appendChild(consoleHeader);

    // Render Tab Body
    if (activeConsoleTab === 'banners') {
      if (banners.length === 0) {
        consoleCard.appendChild(EmptyState({ icon: '🖼️', title: 'No banners yet', description: 'Click Add Banner above to create one.' }));
      } else {
        const tableWrapper = document.createElement('div');
        tableWrapper.style.overflowX = 'auto';
        tableWrapper.innerHTML = `
          <table class="supplier-table">
            <thead>
              <tr>
                <th style="width: 80px;">Preview</th>
                <th>Title & Placement</th>
                <th>Target Link</th>
                <th>Status</th>
                <th style="text-align: right; width: 140px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${banners.map((b) => `
                <tr data-id="${b.id}">
                  <td>
                    <img src="${b.image_url_desktop}" alt="${b.title_en}" style="width: 70px; height: 38px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-subtle);" />
                  </td>
                  <td>
                    <div style="font-weight: 800; font-size: 13px; color: var(--text-primary);">${b.title_en}</div>
                    <div class="text-xs text-muted font-mono">${b.slot} • Order: #${b.display_order}</div>
                  </td>
                  <td>
                    <span class="text-xs font-mono text-brand font-bold">${b.target_link}</span>
                  </td>
                  <td>
                    <span class="badge ${b.is_active ? 'badge--success' : 'badge--neutral'} font-bold text-xs">
                      ${b.is_active ? '🟢 LIVE' : '⚪ DRAFT'}
                    </span>
                  </td>
                  <td style="text-align: right;">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
                      <button class="btn btn--xs ${b.is_active ? 'btn--outline' : 'btn--secondary'}" data-action="toggle-banner" data-id="${b.id}" title="Toggle status">
                        ${b.is_active ? 'Draft' : 'Live'}
                      </button>
                      <button class="btn btn--xs btn--outline" data-action="edit-banner" data-id="${b.id}" title="Edit banner">✏️</button>
                      <button class="btn btn--xs btn--outline text-danger" data-action="del-banner" data-id="${b.id}" title="Delete">🗑️</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;

        tableWrapper.querySelectorAll('[data-action="toggle-banner"]').forEach((btn) => {
          btn.onclick = () => {
            const b = banners.find((x) => x.id === parseInt(btn.dataset.id, 10));
            if (b) handleToggleBannerActive(b);
          };
        });
        tableWrapper.querySelectorAll('[data-action="edit-banner"]').forEach((btn) => {
          btn.onclick = () => {
            const b = banners.find((x) => x.id === parseInt(btn.dataset.id, 10));
            if (b) openQuickBannerModal(b);
          };
        });
        tableWrapper.querySelectorAll('[data-action="del-banner"]').forEach((btn) => {
          btn.onclick = () => handleDeleteBanner(parseInt(btn.dataset.id, 10));
        });

        consoleCard.appendChild(tableWrapper);
      }
    } else if (activeConsoleTab === 'stories') {
      if (stories.length === 0) {
        consoleCard.appendChild(EmptyState({ icon: '🎬', title: 'No stories yet', description: 'Click Add Story above to create one.' }));
      } else {
        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '10px';

        stories.forEach((s) => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.justifyContent = 'space-between';
          row.style.padding = '12px 14px';
          row.style.background = 'var(--surface-1)';
          row.style.borderRadius = 'var(--radius-lg)';
          row.style.border = '1px solid var(--border-subtle)';
          row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${s.cover_image_url}" alt="${s.title_en}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover;" />
              <div>
                <div style="font-weight: 800; font-size: 13px; color: var(--text-primary);">${s.title_en}</div>
                <div class="text-xs text-muted">by ${s.author_name} • 👁️ ${s.view_count || 0} views • ${formatDate(s.published_at)}</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button class="btn btn--xs btn--outline" id="edit-story-row-btn">✏️ Edit</button>
              <button class="btn btn--xs btn--outline text-danger" id="del-story-row-btn">🗑️</button>
            </div>
          `;
          row.querySelector('#edit-story-row-btn').onclick = () => openQuickStoryModal(s);
          row.querySelector('#del-story-row-btn').onclick = () => handleDeleteStory(s.id);
          list.appendChild(row);
        });

        consoleCard.appendChild(list);
      }
    } else if (activeConsoleTab === 'whats_new') {
      if (whatsNew.length === 0) {
        consoleCard.appendChild(EmptyState({ icon: '📢', title: 'No release notes yet', description: 'Click Release Note above to create one.' }));
      } else {
        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '10px';

        whatsNew.forEach((w) => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.justifyContent = 'space-between';
          row.style.padding = '12px 14px';
          row.style.background = 'var(--surface-1)';
          row.style.borderRadius = 'var(--radius-lg)';
          row.style.border = '1px solid var(--border-subtle)';
          row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="badge ${w.category === 'FEATURE' ? 'badge--primary' : 'badge--neutral'} font-mono font-bold" style="font-size: 11px;">
                ${w.version}
              </span>
              <div>
                <div style="font-weight: 800; font-size: 13px; color: var(--text-primary);">${w.title_en}</div>
                <div class="text-xs text-muted">${w.summary_en?.slice(0, 75)}...</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button class="btn btn--xs btn--outline" id="edit-up-row-btn">✏️ Edit</button>
              <button class="btn btn--xs btn--outline text-danger" id="del-up-row-btn">🗑️</button>
            </div>
          `;
          row.querySelector('#edit-up-row-btn').onclick = () => openQuickAnnouncementModal(w);
          row.querySelector('#del-up-row-btn').onclick = () => handleDeleteWhatsNew(w.id);
          list.appendChild(row);
        });

        consoleCard.appendChild(list);
      }
    } else if (activeConsoleTab === 'academy') {
      if (courses.length === 0) {
        consoleCard.appendChild(EmptyState({ icon: '🎓', title: 'No academy courses yet', description: 'Manage courses in the Academy workspace.' }));
      } else {
        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '10px';

        courses.forEach((c) => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.justifyContent = 'space-between';
          row.style.padding = '12px 14px';
          row.style.background = 'var(--surface-1)';
          row.style.borderRadius = 'var(--radius-lg)';
          row.style.border = '1px solid var(--border-subtle)';
          row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="badge ${c.difficulty_level === 'BEGINNER' ? 'badge--success' : 'badge--primary'} font-mono font-bold text-xs">
                ${c.difficulty_level}
              </span>
              <div>
                <div style="font-weight: 800; font-size: 13px; color: var(--text-primary);">${c.title_en}</div>
                <div class="text-xs text-muted font-mono">${c.lessons?.length || c.lessons_count || 1} Lessons • ⏱️ ${c.estimated_minutes} mins</div>
              </div>
            </div>
            <a href="/editor/academy" class="btn btn--xs btn--outline font-bold">Open in Academy →</a>
          `;
          list.appendChild(row);
        });

        consoleCard.appendChild(list);
      }
    }

    container.appendChild(consoleCard);
  }

  loadData();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
