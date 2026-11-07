/**
 * AcademyPage.ts — Explooro Partner Academy Micro-Learning, Video/Audio Lessons & Certificate Portal (Prompt 10.8).
 *
 * Implements idea proposition.md §T & Prompt 10.8 Requirement 4:
 * - Structured micro-courses for Explooro partners & suppliers (Sourcing, Marketing, Finance).
 * - Video & Audio lesson player with interactive completion checklist.
 * - Digital Completion Certificate modal upon achieving 100% course progress.
 */

import { listAcademyCourses, getAcademyCourseDetail, markLessonCompleted } from '../services/content.api.ts';
import { Button } from '../components/ui/Button.ts';
import { Modal } from '../components/ui/Modal.ts';
import { EmptyState } from '../components/ui/EmptyState.ts';
import { t, getLanguage } from '../services/i18n.ts';
import { toast } from '../services/toast.ts';
import { isFeatureEnabled } from '../services/featureFlags.ts';
import { setupChecklistLink } from '../components/guide/SetupChecklist.ts';
import type { PageContext } from './types.ts';
import '../styles/components/academy.css';

export default function AcademyPage(root: HTMLElement, ctx: PageContext = {}) {
  const container = document.createElement('div');
  container.className = 'academy-page';

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
  header.className = 'page-header academy-header';
  header.innerHTML = `
    <div>
      <div class="academy-header__title">
        <span aria-hidden="true">🎓</span>
        <h2>${t('academy.page_title')}</h2>
      </div>
      <p class="academy-header__sub" data-page-info>${t('academy.page_subtitle')}</p>
    </div>
    <div class="academy-pills category-pills">
      <button type="button" class="cat-pill badge badge--md academy-pill ${selectedCategory === 'all' ? 'badge--primary' : 'badge--neutral'}" data-cat="all">
        All Courses
      </button>
      <button type="button" class="cat-pill badge badge--md academy-pill ${selectedCategory === 'sourcing' ? 'badge--primary' : 'badge--neutral'}" data-cat="sourcing">
        🏭 Sourcing & B2B
      </button>
      <button type="button" class="cat-pill badge badge--md academy-pill ${selectedCategory === 'marketing' ? 'badge--primary' : 'badge--neutral'}" data-cat="marketing">
        📣 Social Marketing
      </button>
    </div>
  `;
  // Prompt 13.4: the academy is the Explooro partner's Help, where the finished setup checklist can be
  // opened again. Guests on the public /academy get no link.
  const reopen = setupChecklistLink();
  if (reopen) header.querySelector('div')?.append(reopen);
  container.append(header);

  header.querySelectorAll<HTMLElement>('.cat-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      selectedCategory = pill.getAttribute('data-cat');
      header.querySelectorAll<HTMLElement>('.cat-pill').forEach((p) => {
        const isSel = p.getAttribute('data-cat') === selectedCategory;
        p.className = `cat-pill badge badge--md academy-pill ${isSel ? 'badge--primary' : 'badge--neutral'}`;
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
      workspace.innerHTML = `<div class="academy-status">Loading Explooro Partner Academy...</div>`;
      const res = await listAcademyCourses();
      courses = res?.data || [];
      renderCourseCatalog();
    } catch {
      workspace.innerHTML = `<div class="academy-status academy-status--error">Failed to load academy courses.</div>`;
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
    grid.className = 'academy-grid';

    filtered.forEach((course) => {
      const title = lang === 'bn' ? (course.title_bn || course.title_en) : (course.title_en || course.title_bn);
      const desc = lang === 'bn' ? (course.description_bn || course.description_en) : (course.description_en || course.description_bn);
      const isCompleted = course.is_completed || (course.progress_pct || 0) >= 100;

      const card = document.createElement('div');
      card.className = 'card academy-card';

      card.innerHTML = `
        <div class="academy-card__cover">
          <img src="${course.cover_image_url || 'https://placehold.co/600x300'}" alt="${title}" />
          <span class="badge badge--sm badge--primary academy-card__level">${course.difficulty_level || 'BEGINNER'}</span>
          ${isCompleted ? `<span class="badge badge--sm badge--success academy-card__done">🏆 100% COMPLETE</span>` : ''}
        </div>

        <div class="academy-card__body">
          <div>
            <h3 class="academy-card__title">${title}</h3>
            <p class="academy-card__desc">${desc}</p>
          </div>

          <div class="academy-card__foot">
            <div class="academy-row">
              <span>⏱️ ~${course.estimated_minutes || 25} mins</span>
              <span>📚 ${course.lessons_count || 3} lessons</span>
            </div>

            <div>
              <div class="academy-row">
                <span>Progress</span>
                <strong>${course.progress_pct || 0}%</strong>
              </div>
              <div class="academy-bar"><span style="width: ${course.progress_pct || 0}%;"></span></div>
            </div>

            <button type="button" class="btn btn--sm ${isCompleted ? 'btn--secondary' : 'btn--primary'} btn--full">
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
    layout.className = 'academy-player';

    // Left Column: Video/Audio Player & Lesson Content
    const playerCol = document.createElement('div');
    playerCol.className = 'academy-player__main';

    const lessonTitle = activeLesson ? (lang === 'bn' ? (activeLesson.title_bn || activeLesson.title_en) : (activeLesson.title_en || activeLesson.title_bn)) : 'Lesson';

    playerCol.innerHTML = `
      <div class="academy-crumbs">
        <button type="button" class="back-btn btn btn--sm btn--ghost">➔ ${t('common.back_to_catalog')}</button>
        <span>/</span>
        <span>${courseTitle}</span>
      </div>

      <div class="player-wrapper academy-stage">
        ${activeLesson?.media_type === 'VIDEO' ? `
          <video src="${activeLesson.media_url}" controls poster="${selectedCourse.cover_image_url || ''}"></video>
        ` : activeLesson?.media_type === 'AUDIO' ? `
          <div class="academy-stage__audio">
            <span aria-hidden="true">🎙️</span>
            <h4>${lessonTitle}</h4>
            <audio src="${activeLesson.media_url}" controls></audio>
          </div>
        ` : `
          <div class="academy-stage__text">
            <span aria-hidden="true">📄</span>
            <h4>${lessonTitle}</h4>
            <p>${activeLesson?.content_en || 'Reading Material'}</p>
          </div>
        `}
      </div>

      <div class="card academy-lesson">
        <div class="academy-lesson__head">
          <h3>${lessonTitle}</h3>
          <button type="button" class="complete-lesson-btn btn btn--sm ${activeLesson?.is_completed ? 'btn--secondary' : 'btn--primary'}">
            ${activeLesson?.is_completed ? `✅ ${t('academy.lesson_completed')}` : `Mark Lesson Complete ➔`}
          </button>
        </div>
        ${activeLesson?.content_en ? `
          <p>${lang === 'bn' ? (activeLesson.content_bn || activeLesson.content_en) : activeLesson.content_en}</p>
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
    playlistCol.className = 'academy-player__side';

    playlistCol.innerHTML = `
      <div class="card academy-list">
        <div>
          <h4>📚 Course Curriculum</h4>
          <div class="academy-row">${selectedCourse.completed_lessons || 0} / ${selectedCourse.lessons?.length || 0} completed</div>
        </div>

        <div class="academy-bar"><span style="width: ${selectedCourse.progress_pct || 0}%;"></span></div>

        <div class="lessons-list academy-list__items">
          ${(selectedCourse.lessons || []).map((l, idx) => {
            const isCur = activeLesson?.id === l.id;
            const lTitle = lang === 'bn' ? (l.title_bn || l.title_en) : (l.title_en || l.title_bn);
            return `
              <div class="lesson-item ${isCur ? 'lesson-item--current' : ''}" data-id="${l.id}">
                <div class="lesson-item__name">
                  <span class="lesson-item__no">${idx + 1}.</span>
                  <span>${lTitle}</span>
                </div>
                <span>${l.is_completed ? '✅' : '⏳'}</span>
              </div>
            `;
          }).join('')}
        </div>

        ${selectedCourse.is_completed ? `
          <button type="button" class="cert-btn btn btn--primary btn--full" id="open-cert-btn">
            🏆 ${t('academy.view_certificate')}
          </button>
        ` : ''}
      </div>
    `;

    playlistCol.querySelectorAll<HTMLElement>('.lesson-item').forEach((item) => {
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
    modalContent.className = 'academy-cert';

    modalContent.innerHTML = `
      <div aria-hidden="true">🏆</div>
      <div class="academy-cert__kicker">Certificate of Mastery</div>
      <h3>Explooro Partner Academy</h3>
      <p>This certifies that</p>
      <div class="academy-cert__name">Habib Traders (Dhaka)</div>
      <p>
        has successfully completed the micro-learning curriculum for:
        <br/><b>${course.title_en}</b>
      </p>
      <div class="academy-cert__foot">
        <span>Verified ID: EXA-${Math.random().toString(36).slice(2, 8).toUpperCase()}</span>
        <span>Issued: ${new Date().toLocaleDateString()}</span>
      </div>
    `;

    // WHY content + footer: Modal has no `body`, `confirmLabel` or `onConfirm`, and `modal.element` is
    // undefined (the modal IS the <dialog>), so the certificate used to open as a bare title.
    const footer = document.createDocumentFragment();
    footer.append(Button({ label: t('common.done'), variant: 'primary', onClick: () => modal.close() }));
    const modal = Modal({
      title: `🎓 ${t('academy.certificate_title')}`,
      content: modalContent,
      footer,
    });

    document.body.append(modal);
    modal.open();
  }

  loadCourses();
  root.append(container);

  return () => container.remove();
}
