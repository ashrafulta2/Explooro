/**
 * WhatsNewManagerPage.js — Platform Changelog & Release Announcements Manager.
 *
 * Implements /editor/whats-new:
 * - Version updates, release notes, and audience targeting.
 * - Add/Edit Changelog Entry modal with markdown summary.
 */

import { contentApi } from '../../services/content.api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.ts';
import { formatDate } from '../../services/format.js';
import { escapeHtml } from '../../services/html.ts';
import { pickMessage } from '../../core/api.js';

// Same cap as HIGHLIGHT_LIMITS.maxItems in server/src/services/content.service.ts.
const MAX_HIGHLIGHTS = 6;

export default function WhatsNewManagerPage(root) {
  const container = document.createElement('div');
  container.className = 'editor-page-container';

  let updates = [];
  let loading = true;
  let activeCategory = 'ALL';
  let searchQuery = '';

  async function loadData() {
    loading = true;
    render();
    try {
      const res = await contentApi.listWhatsNew();
      updates = res?.data || [];
    } catch (err) {
      console.error('Failed to load what’s new updates:', err);
      toast.error('Failed to load release updates');
    } finally {
      loading = false;
      render();
    }
  }

  function openUpdateModal(existing = null) {
    const isEdit = Boolean(existing);
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr); gap: 12px;">
        <div class="supplier-form-field">
          <label for="update-ver">Version Tag *</label>
          <input type="text" id="update-ver" class="form-input" placeholder="e.g. v2.4.0" value="${escapeHtml(existing?.version || 'v2.4.0')}" />
        </div>
        <div class="supplier-form-field">
          <label for="update-cat">Category *</label>
          <select class="form-select" id="update-cat">
            <option value="FEATURE" ${existing?.category === 'FEATURE' ? 'selected' : ''}>✨ New Feature</option>
            <option value="IMPROVEMENT" ${existing?.category === 'IMPROVEMENT' ? 'selected' : ''}>⚡ Improvement</option>
            <option value="SECURITY" ${existing?.category === 'SECURITY' ? 'selected' : ''}>🛡️ Security & Escrow</option>
            <option value="FIX" ${existing?.category === 'FIX' ? 'selected' : ''}>🐛 Bug Fix</option>
          </select>
        </div>
        <div class="supplier-form-field">
          <label for="update-aud">Target Audience *</label>
          <select class="form-select" id="update-aud">
            <option value="ALL" ${existing?.target_audience === 'ALL' ? 'selected' : ''}>🌐 All Users</option>
            <option value="SALERS" ${existing?.target_audience === 'SALERS' ? 'selected' : ''}>🛍️ Shop Partners Only</option>
            <option value="SUPPLIERS" ${existing?.target_audience === 'SUPPLIERS' ? 'selected' : ''}>🏭 Suppliers Only</option>
          </select>
        </div>
      </div>

      <div class="supplier-form-field">
        <label for="update-title-en">Release Title (English) *</label>
        <input type="text" id="update-title-en" class="form-input" placeholder="e.g. 1-Click Physical Factory Showroom Status" value="${escapeHtml(existing?.title_en)}" />
      </div>

      <div class="supplier-form-field">
        <label for="update-title-bn">Release Title (Bangla) *</label>
        <input type="text" id="update-title-bn" class="form-input" placeholder="e.g. ১-ক্লিক ফিজিক্যাল ফ্যাক্টরি শোরুম স্ট্যাটাস" value="${escapeHtml(existing?.title_bn)}" />
      </div>

      <div class="supplier-form-field">
        <label for="update-summary-en">Summary Narrative (English) *</label>
        <textarea id="update-summary-en" class="form-textarea" rows="3" placeholder="Explain the key improvements and features in this release...">${escapeHtml(existing?.summary_en)}</textarea>
      </div>

      <div class="supplier-form-field">
        <label for="update-summary-bn">Summary Narrative (Bangla)</label>
        <textarea id="update-summary-bn" class="form-textarea" rows="3" placeholder="বাংলা বিবরণ লিখুন...">${escapeHtml(existing?.summary_bn)}</textarea>
      </div>

      <fieldset class="whats-new-hl-editor">
        <legend>${t('editor.whats_new_highlights_label')}</legend>
        <p class="text-xs text-muted">${t('editor.whats_new_highlights_hint', { max: MAX_HIGHLIGHTS })}</p>
        <div class="whats-new-hl-editor__list" id="update-hl-list"></div>
        <button type="button" class="btn btn--outline btn--sm" id="update-hl-add">+ ${t('editor.whats_new_highlight_add')}</button>
      </fieldset>
    `;

    // Highlight cards: the popup's icon + title + description rows (highlights_json).
    const hlList = content.querySelector('#update-hl-list');
    const hlAdd = content.querySelector('#update-hl-add');

    function syncHlAdd() {
      hlAdd.hidden = hlList.children.length >= MAX_HIGHLIGHTS;
    }

    function addHighlightRow(h = {}) {
      const row = document.createElement('div');
      row.className = 'whats-new-hl-editor__row';
      row.innerHTML = `
        <div class="whats-new-hl-editor__head">
          <label class="supplier-form-field whats-new-hl-editor__icon">
            <span>${t('editor.whats_new_highlight_icon')}</span>
            <input type="text" class="form-input" data-hl="icon" maxlength="8" placeholder="✨" value="${escapeHtml(h.icon)}" />
          </label>
          <button type="button" class="btn btn--xs btn--outline text-danger" data-hl-remove aria-label="${t('editor.whats_new_highlight_remove')}">🗑️</button>
        </div>
        <label class="supplier-form-field">
          <span>${t('editor.whats_new_highlight_title_en')} *</span>
          <input type="text" class="form-input" data-hl="title_en" maxlength="80" value="${escapeHtml(h.title_en)}" />
        </label>
        <label class="supplier-form-field">
          <span>${t('editor.whats_new_highlight_title_bn')}</span>
          <input type="text" class="form-input" data-hl="title_bn" maxlength="80" value="${escapeHtml(h.title_bn)}" />
        </label>
        <label class="supplier-form-field">
          <span>${t('editor.whats_new_highlight_desc_en')} *</span>
          <textarea class="form-textarea" rows="2" data-hl="desc_en" maxlength="240">${escapeHtml(h.desc_en)}</textarea>
        </label>
        <label class="supplier-form-field">
          <span>${t('editor.whats_new_highlight_desc_bn')}</span>
          <textarea class="form-textarea" rows="2" data-hl="desc_bn" maxlength="240">${escapeHtml(h.desc_bn)}</textarea>
        </label>
      `;
      row.querySelector('[data-hl-remove]').onclick = () => {
        row.remove();
        syncHlAdd();
      };
      hlList.appendChild(row);
      syncHlAdd();
    }

    function readHighlights() {
      return [...hlList.children].map((row) => {
        const v = (k) => row.querySelector(`[data-hl="${k}"]`).value.trim();
        return { icon: v('icon'), title_en: v('title_en'), title_bn: v('title_bn'), desc_en: v('desc_en'), desc_bn: v('desc_bn') };
      });
    }

    (Array.isArray(existing?.highlights_json) ? existing.highlights_json : []).forEach((h) => addHighlightRow(h));
    hlAdd.onclick = () => addHighlightRow();

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-update-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="save-update-btn">
        ${isEdit ? '💾 Update Note' : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg> Publish Announcement'}
      </button>
    `;

    const modal = Modal({
      title: isEdit ? 'Edit Release Note' : 'Publish New Changelog Announcement',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-update-btn').onclick = () => modal.close();
    footer.querySelector('#save-update-btn').onclick = async () => {
      const version = content.querySelector('#update-ver').value.trim();
      const category = content.querySelector('#update-cat').value;
      const target_audience = content.querySelector('#update-aud').value;
      const title_en = content.querySelector('#update-title-en').value.trim();
      const title_bn = content.querySelector('#update-title-bn').value.trim();
      const summary_en = content.querySelector('#update-summary-en').value.trim();
      const summary_bn = content.querySelector('#update-summary-bn').value.trim();

      const highlights_json = readHighlights();

      if (!version || !title_en || !summary_en) {
        toast.error('Please enter version, title and summary.');
        return;
      }

      try {
        await contentApi.upsertWhatsNew({
          id: existing?.id,
          version,
          category,
          target_audience,
          title_en,
          title_bn,
          summary_en,
          summary_bn,
          highlights_json,
        });
        toast.success(isEdit ? 'Release note updated!' : 'Changelog published live!');
        modal.close();
        loadData();
      } catch (err) {
        // The server's bilingual reason (duplicate version, a highlight missing its text) beats a generic one.
        toast.error((err && pickMessage(err)) || 'Failed to save announcement.');
      }
    };
  }

  async function handleDeleteUpdate(id) {
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
    // 1. Header
    // -------------------------------------------------------------------------
    const header = document.createElement('header');
    header.className = 'editor-header';
    header.innerHTML = `
      <div class="editor-header__titles">
        <div class="editor-header__badge-row">
          <a href="/editor" class="text-xs text-muted hover:underline">← Content Studio</a>
          <span class="text-muted">•</span>
          <span class="badge badge--primary font-bold font-mono">RELEASE CHANGELOGS</span>
        </div>
        <h1 class="editor-header__title">
          <span>📢</span> ${t('editor.whats_new_title', "What's New & Release Changelogs")}
        </h1>
        <p class="editor-header__subtitle">
          Publish platform updates, feature upgrades, and release announcements for merchants and buyers.
        </p>
      </div>
      <div class="editor-header__actions">
        <button class="btn btn--sm btn--primary font-bold" id="new-announcement-btn">
          ✨ New Announcement
        </button>
      </div>
    `;

    header.querySelector('#new-announcement-btn').onclick = () => openUpdateModal();
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
          <button class="editor-chip ${activeCategory === 'ALL' ? 'editor-chip--active' : ''}" data-cat="ALL">
            All Releases (${updates.length})
          </button>
          <button class="editor-chip ${activeCategory === 'FEATURE' ? 'editor-chip--active' : ''}" data-cat="FEATURE">
            ✨ Features
          </button>
          <button class="editor-chip ${activeCategory === 'IMPROVEMENT' ? 'editor-chip--active' : ''}" data-cat="IMPROVEMENT">
            ⚡ Improvements
          </button>
          <button class="editor-chip ${activeCategory === 'SECURITY' ? 'editor-chip--active' : ''}" data-cat="SECURITY">
            🛡️ Security & Escrow
          </button>
        </div>
        <input type="search" id="update-search" aria-label="Search release notes..." placeholder="Search release notes..." value="${searchQuery}" class="form-input" style="width: 220px; font-size: 12px; padding: 6px 12px;" />
      </div>
    `;

    filterCard.querySelectorAll('.editor-chip').forEach((chip) => {
      chip.onclick = () => {
        activeCategory = chip.dataset.cat;
        render();
      };
    });

    filterCard.querySelector('#update-search').oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      render();
    };

    container.appendChild(filterCard);

    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>${t('common.loading')}</p>
      `;
      container.appendChild(loader);
      return;
    }

    const filteredUpdates = updates.filter((u) => {
      const matchCat = activeCategory === 'ALL' || u.category === activeCategory;
      const matchSearch = !searchQuery || u.title_en?.toLowerCase().includes(searchQuery) || u.version?.toLowerCase().includes(searchQuery);
      return matchCat && matchSearch;
    });

    if (filteredUpdates.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '📢',
          title: 'No release notes found',
          description: 'Publish a new announcement to notify platform members.',
        })
      );
      return;
    }

    // -------------------------------------------------------------------------
    // 3. Changelog List
    // -------------------------------------------------------------------------
    const listCard = document.createElement('div');
    listCard.className = 'editor-card';

    const list = document.createElement('div');
    list.className = 'editor-changelog-list';

    filteredUpdates.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'editor-changelog-item';
      row.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="badge ${item.category === 'FEATURE' ? 'badge--primary' : 'badge--neutral'} font-mono font-bold" style="font-size: 12px;">
              ${escapeHtml(item.version)}
            </span>
            <span class="badge badge--neutral text-xs font-bold font-mono">${item.category}</span>
            <span class="badge badge--success text-xs font-bold">FOR ${item.target_audience}</span>
            ${item.highlights_json?.length ? `<span class="badge badge--neutral text-xs">${t('editor.whats_new_highlight_count', { count: item.highlights_json.length })}</span>` : ''}
          </div>
          <span class="text-xs text-muted font-mono">${formatDate(item.published_at)}</span>
        </div>

        <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 2px 0;">
          ${escapeHtml(item.title_en)}
        </h3>

        <p style="font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.5; margin: 0;">
          ${escapeHtml(item.summary_en)}
        </p>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border-subtle);">
          <span class="text-xs text-muted font-bold font-mono">Status: 🟢 PUBLISHED</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="btn btn--xs btn--outline js-edit-up-btn">✏️ Edit</button>
            <button class="btn btn--xs btn--outline text-danger js-delete-up-btn">🗑️</button>
          </div>
        </div>
      `;

      row.querySelector('.js-edit-up-btn').onclick = () => openUpdateModal(item);
      row.querySelector('.js-delete-up-btn').onclick = () => handleDeleteUpdate(item.id);

      list.appendChild(row);
    });

    listCard.appendChild(list);
    container.appendChild(listCard);
  }

  loadData();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
