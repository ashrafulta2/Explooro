/**
 * supplierModal — thin wrapper that puts the supplier pages' popups on the shared Modal.
 *
 * WHY: these pages used to hand-roll a `.supplier-modal-scrim` div, which bypassed the shared
 * Modal and so had no genie open/close, no focus trap, no Escape and no scroll lock. Routing them
 * through Modal gives all four, and the genie follows /admin/platform/genie.
 *
 * Callers keep their existing HTML strings: `body` fills the panel, `footer` goes in the footer
 * row, and any element with `.close-modal-btn` closes the popup (through the genie).
 * Open with `modal.open(document.activeElement)`; close with `modal.close(false)` — never
 * `modal.remove()`, which would skip the animation and leak the scroll lock.
 */

import { Modal } from '../../components/ui/Modal.js';

export function supplierModal({ title, body, footer = '', size = 'md', danger = false }) {
  const content = document.createElement('div');
  content.innerHTML = body;

  let footerEl = null;
  if (footer) {
    footerEl = document.createElement('div');
    footerEl.className = 'supplier-modal__footer';
    // The shared modal__footer already draws the divider.
    footerEl.style.cssText = 'border-top: 0; padding-top: 0;';
    footerEl.innerHTML = footer;
  }

  const modal = Modal({
    title,
    content,
    footer: footerEl,
    size,
    onClose: () => modal.remove(),
  });

  if (danger) modal.querySelector('.modal__title')?.classList.add('text-danger');

  modal.querySelectorAll('.close-modal-btn').forEach((b) => {
    b.onclick = () => modal.close(false);
  });

  return modal;
}
