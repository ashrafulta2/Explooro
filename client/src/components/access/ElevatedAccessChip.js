/**
 * ElevatedAccessChip.js — Persistent top-bar countdown chip for active JIT elevation (Prompt 2.8).
 *
 * Implements Prompt 2.8 Requirement 6:
 * - Persistent top-bar countdown while a JIT window is active.
 * - "Give up access early" button to safely release elevated privileges.
 * - Bilingual formatting (English & Bengali).
 */

import { releaseJitAccess } from '../../services/permissions.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export function formatRemainingTime(ms, lang) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (lang === 'bn') {
    const toBn = (n) => String(n).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
    if (hours > 0) return `${toBn(hours)} ঘণ্টা ${toBn(minutes)} মিনিট`;
    return `${toBn(minutes)} মিনিট`;
  }

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function ElevatedAccessChip({ elevatedGrant }) {
  if (!elevatedGrant) return document.createDocumentFragment();

  const chip = document.createElement('div');
  chip.className = 'elevated-chip';
  chip.setAttribute('role', 'status');
  chip.setAttribute('aria-live', 'polite');

  const iconSpan = document.createElement('span');
  iconSpan.className = 'elevated-chip__icon';
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';

  const textSpan = document.createElement('span');
  textSpan.className = 'elevated-chip__remaining';

  const updateText = () => {
    const remainingMs = elevatedGrant.expiresAt - Date.now();
    textSpan.textContent = t('access.elevated.chip', {
      remaining: formatRemainingTime(remainingMs, getLanguage()),
    });
  };
  updateText();

  const releaseBtn = document.createElement('button');
  releaseBtn.type = 'button';
  releaseBtn.className = 'elevated-chip__release-btn';
  releaseBtn.textContent = t('access.elevated.release');
  releaseBtn.setAttribute('aria-label', t('access.elevated.release'));

  releaseBtn.addEventListener('click', async () => {
    await releaseJitAccess(elevatedGrant.ref);
    toast.info(t('access.elevated.released'));
  });

  chip.append(iconSpan, textSpan, releaseBtn);
  return chip;
}
