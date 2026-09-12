/**
 * WhatsNewModal.js — What's New Feature Release Notes Modal (Prompt 8.2).
 *
 * Implements:
 * - Automatically checks for unviewed published release notes.
 * - Displays version tag, feature highlights, and summary.
 * - Acknowledges release view to show exactly once per release version.
 */

import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { api } from '../../core/api.js';
import { t, getLanguage } from '../../services/i18n.js';

export async function checkAndShowWhatsNew() {
  const isBn = getLanguage() === 'bn';

  try {
    const res = await api.get('/notifications/whats-new');
    const release = res?.data?.releaseNote;

    if (!release) return null;

    const title = isBn ? (release.title_bn || release.title_en) : release.title_en;
    const summary = isBn ? (release.summary_bn || release.summary_en) : release.summary_en;
    const highlights = Array.isArray(release.highlights_json) ? release.highlights_json : [];

    const content = document.createElement('div');
    content.className = 'whats-new-modal-body';
    content.innerHTML = `
      <div class="whats-new-badge">
        <span class="version-pill">${release.version_tag}</span>
        <span class="sparkle-icon">✨</span>
      </div>
      <p class="whats-new-summary">${summary}</p>
      <div class="whats-new-highlights">
        ${highlights
          .map((h) => {
            const hTitle = isBn ? (h.title_bn || h.title_en) : h.title_en;
            const hDesc = isBn ? (h.desc_bn || h.desc_en) : h.desc_en;
            return `
              <div class="highlight-card">
                <div class="highlight-icon">${h.icon || '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg>'}</div>
                <div class="highlight-text">
                  <h5>${hTitle}</h5>
                  <p>${hDesc}</p>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    async function acknowledge() {
      try {
        await api.post('/notifications/whats-new/ack', {
          version_tag: release.version_tag,
        });
      } catch {}
    }

    const modal = Modal({
      title: title || t('notifications.whats_new_title') || "What's New in Explooro",
      content,
      footer: Button({
        label: t('notifications.btn_explore_features') || 'Explore New Features',
        variant: 'primary',
        onClick: () => {
          acknowledge();
          modal.close();
        },
      }),
      onClose: () => {
        acknowledge();
      },
    });

    modal.open();
    return modal;
  } catch {
    return null;
  }
}
