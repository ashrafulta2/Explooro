/**
 * AcademyPage.js — Seller Academy Micro-Learning, Video/Audio Lessons & Certificate Portal (Prompt 10.8).
 *
 * Implements idea proposition.md §T & Prompt 10.8 Requirement 4:
 * - Structured micro-courses for salers & suppliers (Sourcing, Marketing, Finance).
 * - Video & Audio lesson player with interactive completion checklist.
 * - Digital Completion Certificate modal upon achieving 100% course progress.
 */

import { listAcademyCourses, getAcademyCourseDetail, markLessonCompleted } from '../services/content.api.js';
import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { t, getLanguage } from '../services/i18n.js';
import { toast } from '../services/toast.js';
import { isFeatureEnabled } from '../services/featureFlags.js';

export default function AcademyPage(root, ctx = {}) {
  const container = document.createElement('div');
  container.className = 'academy-page p-4 md:p-6 max-w-7xl mx-auto space-y-8';

  let courses = [];
  let selectedCourse = null;
  let activeLesson = null;
  let selectedCategory = 'all';

  // Module Gating
  if (!isFeatureEnabled('seller_academy')) {
    container.append(
      EmptyState({
        title: t('academy.module_disabled_title'),
        description: t('academy.module_disabled_desc'),
      })
    );
    root.append(container);
    return () => container.remove();
  }

  // 1. Page Header
  const header = document.createElement('div');
  header.className = 'page-header flex-between flex-wrap gap-4 border-b pb-4';
  header.innerHTML = `
    <div>
      <div class="flex items-center gap-2">
        <span class="text-2xl">🎓</span>
        <h2 class="text-2xl font-bold tracking-tight m-0">${t('academy.page_title')}</h2>
      </div>
      <p class="text-sm text-muted m-0 mt-1">${t('academy.page_subtitle')}</p>
    </div>
    <div class="flex gap-2 flex-wrap category-pills">
      <button class="cat-pill badge cursor-pointer text-xs font-mono py-1 px-3 ${selectedCategory === 'all' ? 'badge-primary' : 'badge-neutral'}" data-cat="all">
        All Courses
      </button>
      <button class="cat-pill badge cursor-pointer text-xs font-mono py-1 px-3 ${selectedCategory === 'sourcing' ? 'badge-primary' : 'badge-neutral'}" data-cat="sourcing">
        🏭 Sourcing & B2B
      </button>
      <button class="cat-pill badge cursor-pointer text-xs font-mono py-1 px-3 ${selectedCategory === 'marketing' ? 'badge-primary' : 'badge-neutral'}" data-cat="marketing">
        📣 Social Marketing
      </button>
    </div>
  `;
  container.append(header);

  header.querySelectorAll('.cat-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      selectedCategory = pill.getAttribute('data-cat');
      header.querySelectorAll('.cat-pill').forEach((p) => {
        const isSel = p.getAttribute('data-cat') === selectedCategory;
        p.className = `cat-pill badge cursor-pointer text-xs font-mono py-1 px-3 ${isSel ? 'badge-primary' : 'badge-neutral'}`;
      });
      renderCourseCatalog();
    });
  });

  // 2. Main Workspace (Grid of Courses or Course Lesson Player)
  const workspace = document.createElement('div');
  workspace.className = 'academy-workspace';
  container.append(workspace);

  async function loadCourses() {
    try {
      workspace.innerHTML = `<div class="text-center p-8 text-muted text-xs">Loading Seller Academy...</div>`;
      const res = await listAcademyCourses();
      courses = res?.data || [];
      renderCourseCatalog();
    } catch {
      workspace.innerHTML = `<div class="text-danger text-xs p-4">Failed to load academy courses.</div>`;
    }
  }

  function renderCourseCatalog() {
    selectedCourse = null;
    activeLesson = null;
    workspace.innerHTML = '';

    const filtered = selectedCategory === 'all' ? courses : courses.filter((c) => c.category === selectedCategory);
    const lang = getLanguage();

    if (filtered.length === 0) {
      workspace.append(
        EmptyState({
          title: t('academy.no_courses_title'),
          description: t('academy.no_courses_desc'),
        })
      );
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6';

    filtered.forEach((course) => {
      const title = lang === 'bn' ? (course.title_bn || course.title_en) : (course.title_en || course.title_bn);
      const desc = lang === 'bn' ? (course.description_bn || course.description_en) : (course.description_en || course.description_bn);
      const isCompleted = course.is_completed || (course.progress_pct || 0) >= 100;

      const card = document.createElement('div');
      card.className = 'card border rounded-2xl overflow-hidden bg-surface shadow-sm hover:shadow-md transition-all flex flex-col cursor-pointer';

      card.innerHTML = `
        <div class="h-44 bg-slate-800 relative">
          <img src="${course.cover_image_url || 'https://placehold.co/600x300'}" alt="${title}" class="w-full h-full object-cover" />
          <div class="absolute top-3 left-3">
            <span class="badge badge-primary text-xs font-mono font-bold uppercase">${course.difficulty_level || 'BEGINNER'}</span>
          </div>
          ${isCompleted ? `
            <div class="absolute top-3 right-3">
              <span class="badge badge-success text-xs font-mono font-bold">🏆 100% COMPLETE</span>
            </div>
          ` : ''}
        </div>

        <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
          <div class="space-y-2">
            <h3 class="text-base font-bold text-slate-900 m-0 line-clamp-2">${title}</h3>
            <p class="text-xs text-muted line-clamp-2 m-0">${desc}</p>
          </div>

          <div class="space-y-3 pt-2 border-t">
            <div class="flex-between text-xs text-muted">
              <span>⏱️ ~${course.estimated_minutes || 25} mins</span>
              <span>📚 ${course.lessons_count || 3} lessons</span>
            </div>

            <div class="space-y-1">
              <div class="flex-between text-xs font-bold">
                <span>Progress</span>
                <span class="font-mono text-primary">${course.progress_pct || 0}%</span>
              </div>
              <div class="w-full bg-surface-subtle h-2 rounded-full overflow-hidden border">
                <div class="bg-primary h-full transition-all duration-300" style="width: ${course.progress_pct || 0}%;"></div>
              </div>
            </div>

            <button class="btn btn-sm ${isCompleted ? 'btn-secondary' : 'btn-primary'} w-full text-xs font-bold">
              ${isCompleted ? `📜 ${t('academy.view_certificate')}` : `▶ ${t('academy.start_course')}`}
            </button>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        openCoursePlayer(course);
      });

      grid.append(card);
    });

    workspace.append(grid);
  }

  async function openCoursePlayer(course) {
    try {
      const res = await getAcademyCourseDetail(course.ref || course.id);
      selectedCourse = res?.data || course;
      activeLesson = selectedCourse.lessons?.[0] || null;
      renderLessonPlayer();
    } catch {
      toast.error('Failed to load course lessons');
    }
  }

  function renderLessonPlayer() {
    workspace.innerHTML = '';
    const lang = getLanguage();
    const courseTitle = lang === 'bn' ? (selectedCourse.title_bn || selectedCourse.title_en) : (selectedCourse.title_en || selectedCourse.title_bn);

    const layout = document.createElement('div');
    layout.className = 'grid grid-cols-1 lg:grid-cols-3 gap-6';

    // Left Column: Video/Audio Player & Lesson Content
    const playerCol = document.createElement('div');
    playerCol.className = 'lg:col-span-2 space-y-4';

    const lessonTitle = activeLesson ? (lang === 'bn' ? (activeLesson.title_bn || activeLesson.title_en) : (activeLesson.title_en || activeLesson.title_bn)) : 'Lesson';

    playerCol.innerHTML = `
      <div class="flex items-center gap-2 mb-2">
        <button class="back-btn btn btn-sm btn-ghost text-xs">➔ ${t('common.back_to_catalog')}</button>
        <span class="text-xs text-muted">/</span>
        <span class="text-xs font-bold text-muted truncate">${courseTitle}</span>
      </div>

      <div class="player-wrapper aspect-video bg-black rounded-2xl overflow-hidden shadow-xl flex items-center justify-center relative">
        ${activeLesson?.media_type === 'VIDEO' ? `
          <video src="${activeLesson.media_url}" controls class="w-full h-full object-cover" poster="${selectedCourse.cover_image_url || ''}"></video>
        ` : activeLesson?.media_type === 'AUDIO' ? `
          <div class="text-center p-6 space-y-4 text-white">
            <span class="text-5xl">🎙️</span>
            <h4 class="text-base font-bold">${lessonTitle}</h4>
            <audio src="${activeLesson.media_url}" controls class="w-full max-w-md mx-auto"></audio>
          </div>
        ` : `
          <div class="p-8 text-white space-y-3 max-w-lg">
            <span class="text-4xl">📄</span>
            <h4 class="text-lg font-bold">${lessonTitle}</h4>
            <p class="text-xs text-white/80 leading-relaxed">${activeLesson?.content_en || 'Reading Material'}</p>
          </div>
        `}
      </div>

      <div class="p-4 border rounded-2xl bg-surface space-y-3 shadow-sm">
        <div class="flex-between flex-wrap gap-2">
          <h3 class="text-lg font-bold m-0">${lessonTitle}</h3>
          <button class="complete-lesson-btn btn btn-sm ${activeLesson?.is_completed ? 'btn-secondary' : 'btn-success'} text-xs font-bold">
            ${activeLesson?.is_completed ? `✅ ${t('academy.lesson_completed')}` : `Mark Lesson Complete ➔`}
          </button>
        </div>
        ${activeLesson?.content_en ? `
          <p class="text-sm text-slate-700 leading-relaxed m-0">${lang === 'bn' ? (activeLesson.content_bn || activeLesson.content_en) : activeLesson.content_en}</p>
        ` : ''}
      </div>
    `;

    playerCol.querySelector('.back-btn')?.addEventListener('click', () => {
      renderCourseCatalog();
    });

    playerCol.querySelector('.complete-lesson-btn')?.addEventListener('click', async () => {
      if (!activeLesson) return;
      try {
        await markLessonCompleted(selectedCourse.id, activeLesson.id);
        activeLesson.is_completed = true;
        toast.success(t('academy.lesson_marked_complete'));

        // Refresh details
        const refreshed = await getAcademyCourseDetail(selectedCourse.id);
        selectedCourse = refreshed?.data;

        if (selectedCourse.is_completed) {
          openCertificateModal(selectedCourse);
        }
        renderLessonPlayer();
      } catch (err) {
        toast.error(err?.message || 'Failed to complete lesson');
      }
    });

    // Right Column: Lesson Playlist & Certificate Trigger
    const playlistCol = document.createElement('div');
    playlistCol.className = 'space-y-4';

    playlistCol.innerHTML = `
      <div class="card p-5 border rounded-2xl bg-surface space-y-4 shadow-sm">
        <div class="space-y-1">
          <h4 class="text-sm font-bold m-0">📚 Course Curriculum</h4>
          <div class="text-xs text-muted">${selectedCourse.completed_lessons || 0} / ${selectedCourse.lessons?.length || 0} completed</div>
        </div>

        <div class="space-y-1">
          <div class="w-full bg-surface-subtle h-2 rounded-full overflow-hidden border">
            <div class="bg-primary h-full transition-all duration-300" style="width: ${selectedCourse.progress_pct || 0}%;"></div>
          </div>
        </div>

        <div class="lessons-list space-y-2 pt-2 border-t">
          ${(selectedCourse.lessons || []).map((l, idx) => {
            const isCur = activeLesson?.id === l.id;
            const lTitle = lang === 'bn' ? (l.title_bn || l.title_en) : (l.title_en || l.title_bn);
            return `
              <div class="lesson-item p-3 border rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-colors ${isCur ? 'border-primary bg-primary-soft/30' : 'hover:bg-surface-subtle'}" data-id="${l.id}">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-xs font-mono font-bold text-muted">${idx + 1}.</span>
                  <span class="text-xs font-bold truncate ${isCur ? 'text-primary' : 'text-slate-800'}">${lTitle}</span>
                </div>
                <span class="text-xs shrink-0">${l.is_completed ? '✅' : '⏳'}</span>
              </div>
            `;
          }).join('')}
        </div>

        ${selectedCourse.is_completed ? `
          <button class="cert-btn btn btn-primary w-full text-xs font-bold py-2 mt-3" id="open-cert-btn">
            🏆 ${t('academy.view_certificate')}
          </button>
        ` : ''}
      </div>
    `;

    playlistCol.querySelectorAll('.lesson-item').forEach((item) => {
      item.addEventListener('click', () => {
        const id = parseInt(item.getAttribute('data-id'), 10);
        activeLesson = selectedCourse.lessons.find((x) => x.id === id);
        renderLessonPlayer();
      });
    });

    playlistCol.querySelector('#open-cert-btn')?.addEventListener('click', () => {
      openCertificateModal(selectedCourse);
    });

    layout.append(playerCol, playlistCol);
    workspace.append(layout);
  }

  function openCertificateModal(course) {
    const modalContent = document.createElement('div');
    modalContent.className = 'p-6 text-center space-y-4 border-4 border-double border-primary/40 rounded-2xl bg-gradient-to-b from-amber-50/50 to-white';

    modalContent.innerHTML = `
      <div class="text-4xl">🏆</div>
      <div class="uppercase tracking-widest text-xs font-bold text-primary font-mono">Certificate of Mastery</div>
      <h3 class="text-xl font-bold text-slate-900 m-0">Explooro Seller Academy</h3>
      <p class="text-xs text-muted">This certifies that</p>
      <div class="text-lg font-bold text-slate-900 border-b-2 border-slate-300 pb-1 max-w-xs mx-auto">
        Habib Traders (Dhaka)
      </div>
      <p class="text-xs text-slate-700 leading-relaxed">
        has successfully completed the micro-learning curriculum for:
        <br/><b class="text-slate-900">${course.title_en}</b>
      </p>
      <div class="flex-between text-[11px] text-muted font-mono pt-4 border-t">
        <span>Verified ID: EXA-${Math.random().toString(36).slice(2, 8).toUpperCase()}</span>
        <span>Issued: ${new Date().toLocaleDateString()}</span>
      </div>
    `;

    const modal = Modal({
      title: `🎓 ${t('academy.certificate_title')}`,
      body: modalContent,
      confirmLabel: t('common.done'),
      onConfirm: () => modal.close(),
    });

    document.body.append(modal.element);
    modal.open();
  }

  loadCourses();
  root.append(container);

  return () => container.remove();
}
