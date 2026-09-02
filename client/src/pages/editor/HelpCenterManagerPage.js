/**
 * HelpCenterManagerPage.js — Knowledge Base & FAQs Management Hub.
 *
 * Implements /editor/help-center and /editor/help:
 * - Category grouping: orders, finance, sourcing, warranties, account.
 * - Helpfulness upvotes counter, keyword search, rich FAQ editor modal.
 */

import { contentApi } from '../../services/content.api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function HelpCenterManagerPage(root) {
  const container = document.createElement('div');
  container.className = 'editor-page-container';

  let articles = [];
  let loading = true;
  let activeCategory = 'ALL';
  let searchQuery = '';

  async function loadData() {
    loading = true;
    render();
    try {
      const res = await contentApi.listHelpArticles();
      articles = res?.data || [];
    } catch (err) {
      console.error('Failed to load help articles:', err);
      toast.error('Failed to load knowledge base');
    } finally {
      loading = false;
      render();
    }
  }

  function openArticleModal(existing = null) {
    const isEdit = Boolean(existing);
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <div class="supplier-form-field">
        <label>Help Category *</label>
        <select class="form-select" id="faq-cat">
          <option value="orders" ${existing?.category === 'orders' ? 'selected' : ''}>📦 Orders, Courier & Fulfillment</option>
          <option value="finance" ${existing?.category === 'finance' ? 'selected' : ''}>💰 Commissions, Payouts & Wallets</option>
          <option value="sourcing" ${existing?.category === 'sourcing' ? 'selected' : ''}>🏭 Factory Sourcing & B2B Escrow</option>
          <option value="warranties" ${existing?.category === 'warranties' ? 'selected' : ''}>🛡️ Digital Warranties & Returns</option>
        </select>
      </div>

      <div class="supplier-form-field">
        <label>Question / Article Title (English) *</label>
        <input type="text" id="faq-title-en" class="form-input" placeholder="e.g. How do I track customer orders with 3PL couriers?" value="${existing?.title_en || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Question / Article Title (Bangla) *</label>
        <input type="text" id="faq-title-bn" class="form-input" placeholder="e.g. কীভাবে কুরিয়ার দিয়ে কাস্টমার অর্ডার ট্র্যাক করবেন?" value="${existing?.title_bn || ''}" />
      </div>

      <div class="supplier-form-field">
        <label>Answer / Resolution Content (English) *</label>
        <textarea id="faq-content-en" class="form-textarea" rows="4" placeholder="Provide step-by-step guidance for the user...">${existing?.content_en || ''}</textarea>
      </div>

      <div class="supplier-form-field">
        <label>Answer / Resolution Content (Bangla)</label>
        <textarea id="faq-content-bn" class="form-textarea" rows="4" placeholder="বাংলা সমাধান লিখুন...">${existing?.content_bn || ''}</textarea>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-faq-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="save-faq-btn">
        ${isEdit ? '💾 Update FAQ' : '✨ Publish Article'}
      </button>
    `;

    const modal = Modal({
      title: isEdit ? 'Edit Help Center Article' : 'Create New Knowledge Base FAQ',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-faq-btn').onclick = () => modal.close();
    footer.querySelector('#save-faq-btn').onclick = async () => {
      const category = content.querySelector('#faq-cat').value;
      const title_en = content.querySelector('#faq-title-en').value.trim();
      const title_bn = content.querySelector('#faq-title-bn').value.trim();
      const content_en = content.querySelector('#faq-content-en').value.trim();
      const content_bn = content.querySelector('#faq-content-bn').value.trim();

      if (!title_en || !content_en) {
        toast.error('Please enter article title and answer content.');
        return;
      }

      try {
        await contentApi.upsertHelpArticle({
          id: existing?.id,
          category,
          title_en,
          title_bn,
          content_en,
          content_bn,
        });
        toast.success(isEdit ? 'FAQ updated!' : 'Knowledge base article published!');
        modal.close();
        loadData();
      } catch (err) {
        toast.error('Failed to save FAQ article.');
      }
    };
  }

  async function handleDeleteArticle(id) {
    if (!confirm('Are you sure you want to remove this FAQ article?')) return;
    try {
      await contentApi.deleteHelpArticle(id);
      toast.success('Article removed.');
      loadData();
    } catch (err) {
      toast.error('Failed to delete article.');
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
          <span class="badge badge--primary font-bold font-mono">HELP & KNOWLEDGE BASE</span>
        </div>
        <h1 class="editor-header__title">
          <span>❓</span> ${t('editor.help_title', 'Help Centre & Knowledge Base FAQs')}
        </h1>
        <p class="editor-header__subtitle">
          Manage merchant guides, buyer support FAQs, escrow tutorials, and resolution articles.
        </p>
      </div>
      <div class="editor-header__actions">
        <button class="btn btn--sm btn--primary font-bold" id="new-faq-btn">
          ✨ Add New FAQ Article
        </button>
      </div>
    `;

    header.querySelector('#new-faq-btn').onclick = () => openArticleModal();
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
            All Topics (${articles.length})
          </button>
          <button class="editor-chip ${activeCategory === 'orders' ? 'editor-chip--active' : ''}" data-cat="orders">
            📦 Orders & Courier
          </button>
          <button class="editor-chip ${activeCategory === 'finance' ? 'editor-chip--active' : ''}" data-cat="finance">
            💰 Payouts & Wallets
          </button>
          <button class="editor-chip ${activeCategory === 'sourcing' ? 'editor-chip--active' : ''}" data-cat="sourcing">
            🏭 Factory Escrow
          </button>
          <button class="editor-chip ${activeCategory === 'warranties' ? 'editor-chip--active' : ''}" data-cat="warranties">
            🛡️ Warranties & Returns
          </button>
        </div>
        <input type="text" id="faq-search" placeholder="🔍 Search question or keyword..." value="${searchQuery}" class="form-input" style="width: 240px; font-size: 12px; padding: 6px 12px;" />
      </div>
    `;

    filterCard.querySelectorAll('.editor-chip').forEach((chip) => {
      chip.onclick = () => {
        activeCategory = chip.dataset.cat;
        render();
      };
    });

    filterCard.querySelector('#faq-search').oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      render();
    };

    container.appendChild(filterCard);

    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>Loading knowledge base articles...</p>
      `;
      container.appendChild(loader);
      return;
    }

    const filteredArticles = articles.filter((a) => {
      const matchCat = activeCategory === 'ALL' || a.category === activeCategory;
      const matchSearch = !searchQuery || a.title_en?.toLowerCase().includes(searchQuery) || a.content_en?.toLowerCase().includes(searchQuery);
      return matchCat && matchSearch;
    });

    if (filteredArticles.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '❓',
          title: 'No articles found',
          description: 'Add a new FAQ article to assist platform buyers and sellers.',
        })
      );
      return;
    }

    // -------------------------------------------------------------------------
    // 3. FAQ List
    // -------------------------------------------------------------------------
    const listCard = document.createElement('div');
    listCard.className = 'editor-card';

    const list = document.createElement('div');
    list.className = 'editor-faq-list';

    filteredArticles.forEach((article) => {
      const row = document.createElement('div');
      row.className = 'editor-faq-item';
      row.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <span class="badge badge--primary font-mono font-bold text-xs">
            ${article.category.toUpperCase()}
          </span>
          <div style="display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-muted);">
            <span>👍 ${article.helpful_count || 0} helpful</span>
            <span>•</span>
            <span>👁️ ${article.views_count || 0} views</span>
          </div>
        </div>

        <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 2px 0;">
          ${article.title_en}
        </h3>

        <p style="font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.5; margin: 0;">
          ${article.content_en}
        </p>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border-subtle);">
          <span class="badge badge--success text-xs font-mono font-bold">🟢 PUBLISHED</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="btn btn--xs btn--outline" id="edit-faq-btn">✏️ Edit</button>
            <button class="btn btn--xs btn--outline text-danger" id="delete-faq-btn">🗑️</button>
          </div>
        </div>
      `;

      row.querySelector('#edit-faq-btn').onclick = () => openArticleModal(article);
      row.querySelector('#delete-faq-btn').onclick = () => handleDeleteArticle(article.id);

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
