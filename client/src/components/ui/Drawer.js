/**
 * Drawer — edge-anchored overlay panel (left / right / bottom).
 *
 * Responsibility: filters, mobile navigation, and detail panes that should not take the user off
 * the current page. `bottom` is the mobile sheet, with drag-to-dismiss.
 *
 * Shares Modal's <dialog> foundation — see that file's header for why the platform dialog is used
 * rather than a hand-rolled trap.
 *
 * Invariants:
 *  - The drag gesture NEVER fights the sheet's own scrolling. A downward drag only becomes a
 *    dismiss when the sheet's content is already scrolled to the top; otherwise the sheet is
 *    scrolling and the gesture belongs to it. Getting this wrong makes a scrollable sheet feel
 *    broken, and it is the single most common bug in mobile sheet implementations.
 *  - Dismissal is decided by VELOCITY or distance, not distance alone. A fast short flick is an
 *    intentional dismiss; a slow long drag that stops short is not.
 *  - Pointer capture is released on every exit path, including cancel — a stuck capture makes
 *    the rest of the page unclickable.
 */

import { lockScroll, unlockScroll } from './Modal.js';

function createCloseIcon() {
  const span = document.createElement('span');
  span.className = 'overlay__close-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  return span;
}

let drawerSeq = 0;

export function Drawer({
  title = '',
  description = '',
  content = null,
  footer = null,
  side = 'right',
  size = 'md',
  showClose = true,
  closeOnScrim = true,
  closeLabel = 'Close',
  dragToDismiss = true,
  bodyPadding = true,
  className = '',
  onClose = null,
  onOpen = null,
} = {}) {
  drawerSeq += 1;
  const titleId = `drawer-title-${drawerSeq}`;
  const descId = `drawer-desc-${drawerSeq}`;

  const dialog = document.createElement('dialog');
  dialog.className = `overlay drawer drawer--${side} drawer--${size}${className ? ` ${className}` : ''}`;
  dialog.setAttribute('aria-modal', 'true');
  if (title) dialog.setAttribute('aria-labelledby', titleId);
  if (description) dialog.setAttribute('aria-describedby', descId);

  const panel = document.createElement('div');
  panel.className = 'drawer__panel';

  // The grab handle is the affordance that tells the user the sheet can be dragged at all.
  if (side === 'bottom' && dragToDismiss) {
    const grip = document.createElement('div');
    grip.className = 'drawer__grip';
    grip.setAttribute('aria-hidden', 'true');
    panel.append(grip);
  }

  const header = document.createElement('div');
  header.className = 'drawer__header';

  const heading = document.createElement('div');
  heading.className = 'drawer__heading';
  if (title) {
    const titleEl = document.createElement('h2');
    titleEl.className = 'drawer__title';
    titleEl.id = titleId;
    titleEl.textContent = title;
    heading.append(titleEl);
  }
  if (description) {
    const descEl = document.createElement('p');
    descEl.className = 'drawer__description';
    descEl.id = descId;
    descEl.textContent = description;
    heading.append(descEl);
  }
  header.append(heading);

  if (showClose) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'overlay__close';
    closeBtn.setAttribute('aria-label', closeLabel);
    closeBtn.append(createCloseIcon());
    closeBtn.addEventListener('click', () => close(false));
    header.append(closeBtn);
  }

  if (title || description || showClose) panel.append(header);

  const bodyEl = document.createElement('div');
  bodyEl.className = `drawer__body${!bodyPadding ? ' drawer__body--flush' : ''}`;
  if (content) bodyEl.append(content);
  panel.append(bodyEl);

  const footerEl = document.createElement('div');
  footerEl.className = 'drawer__footer';
  if (footer) {
    footerEl.append(footer);
    panel.append(footerEl);
  }

  dialog.append(panel);

  let previouslyFocused = null;
  let result;

  function open(trigger = null) {
    if (dialog.open) return;
    previouslyFocused = trigger ?? document.activeElement;
    if (!dialog.isConnected) document.body.append(dialog);
    dialog.showModal();
    lockScroll();
    if (onOpen) onOpen();
  }

  const nativeClose = dialog.close.bind(dialog);

  function close(value = false) {
    if (!dialog.open) return;
    result = value;
    nativeClose();
  }

  dialog.addEventListener('close', () => {
    unlockScroll();
    // Clear any transform left behind by an interrupted drag, so the next open starts clean.
    panel.style.transform = '';
    panel.style.transition = '';
    dialog.style.removeProperty('--drag-progress');
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
    if (onClose) onClose(result);
  });

  if (closeOnScrim) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close(false);
    });
  }

  /* ---- Drag to dismiss (bottom sheet only) ---------------------------- */
  if (side === 'bottom' && dragToDismiss) {
    let startY = 0;
    let startTime = 0;
    let currentY = 0;
    let dragging = false;
    let pointerId = null;

    const DISMISS_DISTANCE = 0.25; // fraction of sheet height
    const DISMISS_VELOCITY = 0.5; // px per ms

    panel.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // Never hijack a gesture that starts on a control.
      if (event.target.closest('button, a, input, select, textarea')) return;
      // The sheet owns the gesture until its content is scrolled to the very top.
      if (bodyEl.scrollTop > 0) return;

      dragging = true;
      pointerId = event.pointerId;
      startY = event.clientY;
      currentY = 0;
      startTime = performance.now();
      panel.style.transition = 'none';
    });

    panel.addEventListener('pointermove', (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const delta = event.clientY - startY;
      // Upward drag is not a dismiss; resist it so the sheet cannot be flung off the top.
      currentY = delta > 0 ? delta : delta * 0.2;

      if (currentY > 4 && !panel.hasPointerCapture(pointerId)) {
        // Capture only once the gesture is clearly a drag, so a plain tap still works normally.
        panel.setPointerCapture(pointerId);
      }
      panel.style.transform = `translateY(${currentY}px)`;
      const progress = Math.min(1, Math.max(0, currentY / panel.offsetHeight));
      // Fade the scrim with the drag so the sheet feels physically attached to the backdrop.
      dialog.style.setProperty('--drag-progress', String(progress));
    });

    function endDrag(event) {
      if (!dragging || (pointerId !== null && event.pointerId !== pointerId)) return;
      dragging = false;
      if (pointerId !== null && panel.hasPointerCapture(pointerId)) {
        panel.releasePointerCapture(pointerId);
      }
      pointerId = null;
      panel.style.transition = '';

      const elapsed = Math.max(1, performance.now() - startTime);
      const velocity = currentY / elapsed;
      const past = currentY > panel.offsetHeight * DISMISS_DISTANCE;

      if (currentY > 0 && (past || velocity > DISMISS_VELOCITY)) {
        close(false);
      } else {
        // Spring back. Clearing the inline transform lets the CSS transition do the easing.
        panel.style.transform = '';
        dialog.style.removeProperty('--drag-progress');
      }
      currentY = 0;
    }

    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
  }

  dialog.openDrawer = open;
  dialog.closeDrawer = close;
  dialog.isOpen = () => Boolean(dialog.hasAttribute('open'));
  dialog.setContent = (node) => {
    bodyEl.replaceChildren(node);
  };
  dialog.body = bodyEl;

  return dialog;
}
