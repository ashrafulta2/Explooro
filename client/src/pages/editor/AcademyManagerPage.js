/**
 * AcademyManagerPage.js — Explooro Seller & Buyer Academy Course Manager.
 *
 * Implements /editor/academy:
 * - Educational tutorials, sourcing masterclasses, social commerce playbooks.
 * - Lessons manager with video embeds and completion tracking.
 * - Add/Edit Academy Course modal.
 */

import { contentApi } from '../../services/content.api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Modal } from '../../components/ui/Modal.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function AcademyManagerPage(root) {
  const container = document.createElement('div');
  container.className = 'editor-page-container';

  let courses = [];
  let loading = true;
  let activeCategory = 'ALL';
  let searchQuery = '';

  async function loadData() {
    loading = true;
    render();
    try {
      const res = await contentApi.listAcademyCourses();
      courses = res?.data || [];
    } catch (err) {
      console.error('Failed to load academy courses:', err);
      toast.error('Failed to load courses');
    } finally {
      loading = false;
      render();
    }
  }

  function openCourseModal(existingCourse = null) {
    const isEdit = Boolean(existingCourse);
    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '14px';
    content.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="supplier-form-field">
          <label for="course-role">Target Audience *</label>
          <select class="form-select" id="course-role">
            <option value="saler" ${existingCourse?.target_role === 'saler' ? 'selected' : ''}>🛍️ Resellers & Salers</option>
            <option value="supplier" ${existingCourse?.target_role === 'supplier' ? 'selected' : ''}>🏭 Factory Suppliers</option>
            <option value="all" ${existingCourse?.target_role === 'all' ? 'selected' : ''}>🌐 All Platform Members</option>
          </select>
        </div>
        <div class="supplier-form-field">
          <label for="course-diff">Difficulty Level *</label>
          <select class="form-select" id="course-diff">
            <option value="BEGINNER" ${existingCourse?.difficulty_level === 'BEGINNER' ? 'selected' : ''}>🟢 Beginner (Fundament)</option>
            <option value="INTERMEDIATE" ${existingCourse?.difficulty_level === 'INTERMEDIATE' ? 'selected' : ''}>🟡 Intermediate (Growth)</option>
            <option value="ADVANCED" ${existingCourse?.difficulty_level === 'ADVANCED' ? 'selected' : ''}>🔴 Advanced (Scaling)</option>
          </select>
        </div>
      </div>

      <div class="supplier-form-field">
        <label for="course-title-en">Course Title (English) *</label>
        <input type="text" id="course-title-en" class="form-input" placeholder="e.g. Sourcing Mastery: Direct Factory Negotiations" value="${existingCourse?.title_en || ''}" />
      </div>

      <div class="supplier-form-field">
        <label for="course-title-bn">Course Title (Bangla) *</label>
        <input type="text" id="course-title-bn" class="form-input" placeholder="e.g. সোর্সিং মাস্টারক্লাস: ডিরেক্ট ফ্যাক্টরি নেগোসিয়েশন" value="${existingCourse?.title_bn || ''}" />
      </div>

      <div class="supplier-form-field">
        <label for="course-cover">Cover Image URL *</label>
        <input type="url" id="course-cover" class="form-input" placeholder="https://images.unsplash.com/..." value="${existingCourse?.cover_image_url || 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=600&q=80'}" />
      </div>

      <div class="supplier-form-field">
        <label for="course-desc-en">Course Description (English) *</label>
        <textarea id="course-desc-en" class="form-textarea" rows="3" placeholder="What will the learner gain from this course?">${existingCourse?.description_en || ''}</textarea>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="supplier-form-field">
          <label for="course-cat">Category *</label>
          <select class="form-select" id="course-cat">
            <option value="sourcing" ${existingCourse?.category === 'sourcing' ? 'selected' : ''}>🏭 Factory Sourcing</option>
            <option value="marketing" ${existingCourse?.category === 'marketing' ? 'selected' : ''}>📱 Social Marketing</option>
            <option value="finance" ${existingCourse?.category === 'finance' ? 'selected' : ''}>💰 Vault & Escrow</option>
          </select>
        </div>
        <div class="supplier-form-field">
          <label for="course-minutes">Estimated Duration (Minutes)</label>
          <input type="number" id="course-minutes" class="form-input" min="5" value="${existingCourse?.estimated_minutes || 20}" />
        </div>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.innerHTML = `
      <button class="btn btn--secondary btn--sm" id="cancel-course-btn">Cancel</button>
      <button class="btn btn--primary btn--sm" id="save-course-btn">
        ${isEdit ? '💾 Update Course' : '✨ Publish Course'}
      </button>
    `;

    const modal = Modal({
      title: isEdit ? 'Edit Academy Course' : 'Create New Academy Course',
      content,
      footer,
      size: 'md',
    });

    document.body.appendChild(modal);
    modal.open();

    footer.querySelector('#cancel-course-btn').onclick = () => modal.close();
    footer.querySelector('#save-course-btn').onclick = async () => {
      const target_role = content.querySelector('#course-role').value;
      const difficulty_level = content.querySelector('#course-diff').value;
      const title_en = content.querySelector('#course-title-en').value.trim();
      const title_bn = content.querySelector('#course-title-bn').value.trim();
      const cover_image_url = content.querySelector('#course-cover').value.trim();
      const description_en = content.querySelector('#course-desc-en').value.trim();
      const category = content.querySelector('#course-cat').value;
      const estimated_minutes = parseInt(content.querySelector('#course-minutes').value, 10) || 20;

      if (!title_en || !title_bn || !cover_image_url) {
        toast.error('Please enter course title and cover image URL.');
        return;
      }

      try {
        await contentApi.upsertCourse({
          id: existingCourse?.id,
          target_role,
          difficulty_level,
          title_en,
          title_bn,
          cover_image_url,
          description_en,
          category,
          estimated_minutes,
        });
        toast.success(isEdit ? 'Course updated!' : 'New Academy course published!');
        modal.close();
        loadData();
      } catch (err) {
        toast.error('Failed to save course.');
      }
    };
  }

  async function handleDeleteCourse(id) {
    if (!confirm('Are you sure you want to remove this academy course?')) return;
    try {
      await contentApi.deleteCourse(id);
      toast.success('Course removed.');
      loadData();
    } catch (err) {
      toast.error('Failed to delete course.');
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
          <span class="badge badge--primary font-bold font-mono">SELLER ACADEMY</span>
        </div>
        <h1 class="editor-header__title">
          <span>🎓</span> ${t('editor.academy_title', 'Explooro Seller & Buyer Academy')}
        </h1>
        <p class="editor-header__subtitle">
          Manage step-by-step masterclasses, wholesale escrow guides, and video lessons for growing entrepreneurs.
        </p>
      </div>
      <div class="editor-header__actions">
        <button class="btn btn--sm btn--primary font-bold" id="create-course-btn">
          ✨ Add New Course
        </button>
      </div>
    `;

    header.querySelector('#create-course-btn').onclick = () => openCourseModal();
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
            All Categories (${courses.length})
          </button>
          <button class="editor-chip ${activeCategory === 'sourcing' ? 'editor-chip--active' : ''}" data-cat="sourcing">
            🏭 Factory Sourcing
          </button>
          <button class="editor-chip ${activeCategory === 'marketing' ? 'editor-chip--active' : ''}" data-cat="marketing">
            📱 Social Commerce
          </button>
          <button class="editor-chip ${activeCategory === 'finance' ? 'editor-chip--active' : ''}" data-cat="finance">
            💰 Escrow & Finance
          </button>
        </div>
        <input type="text" id="course-search" aria-label="🔍 Search course title..." placeholder="🔍 Search course title..." value="${searchQuery}" class="form-input" style="width: 220px; font-size: 12px; padding: 6px 12px;" />
      </div>
    `;

    filterCard.querySelectorAll('.editor-chip').forEach((chip) => {
      chip.onclick = () => {
        activeCategory = chip.dataset.cat;
        render();
      };
    });

    filterCard.querySelector('#course-search').oninput = (e) => {
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

    const filteredCourses = courses.filter((c) => {
      const matchCat = activeCategory === 'ALL' || c.category === activeCategory;
      const matchSearch = !searchQuery || c.title_en?.toLowerCase().includes(searchQuery) || c.title_bn?.includes(searchQuery);
      return matchCat && matchSearch;
    });

    if (filteredCourses.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '🎓',
          title: 'No academy courses found',
          description: 'Create an educational tutorial to help salers and buyers grow.',
        })
      );
      return;
    }

    // -------------------------------------------------------------------------
    // 3. Course Cards Grid
    // -------------------------------------------------------------------------
    const grid = document.createElement('div');
    grid.className = 'editor-course-grid';

    filteredCourses.forEach((course) => {
      const card = document.createElement('div');
      card.className = 'editor-course-card';
      card.innerHTML = `
        <img src="${course.cover_image_url}" alt="${course.title_en}" class="editor-course-card__cover" />
        <div class="editor-course-card__body">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span class="badge ${course.difficulty_level === 'BEGINNER' ? 'badge--success' : 'badge--primary'} font-mono font-bold text-xs">
              ${course.difficulty_level}
            </span>
            <span class="text-xs text-muted font-bold font-mono">⏱️ ${course.estimated_minutes} mins</span>
          </div>

          <h3 style="font-size: var(--text-base); font-weight: 800; color: var(--text-primary); margin: 2px 0;">
            ${course.title_en}
          </h3>

          <p style="font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.4; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
            ${course.description_en}
          </p>

          <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--surface-1); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-top: 4px;">
            <span class="text-xs font-bold text-primary">📚 Lessons:</span>
            <span class="text-xs font-mono font-bold">${course.lessons?.length || course.lessons_count || 1} Modules</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border-subtle);">
            <span class="badge badge--neutral font-mono text-xs font-bold">${course.target_role?.toUpperCase()}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button class="btn btn--xs btn--outline js-edit-course-btn">✏️ Edit</button>
              <button class="btn btn--xs btn--outline text-danger js-delete-course-btn">🗑️</button>
            </div>
          </div>
        </div>
      `;

      card.querySelector('.js-edit-course-btn').onclick = () => openCourseModal(course);
      card.querySelector('.js-delete-course-btn').onclick = () => handleDeleteCourse(course.id);

      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  loadData();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
