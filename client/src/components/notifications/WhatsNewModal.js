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
                <div class="highlight-icon">${h.icon || '🚀'}</div>
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
