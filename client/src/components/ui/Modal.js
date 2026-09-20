/**
 * Modal — centred, focus-trapping overlay dialog.
 *
 * Responsibility: any interruption that must be resolved before the user continues.
 *
 * WHY native <dialog> + showModal() instead of a hand-rolled overlay: the browser gives us a
 * REAL focus trap (one that also handles iframes, shadow roots, and content inserted while the
 * dialog is open), Escape-to-close, `inert` on the background, and the top layer — which means
 * no z-index arms race with sticky headers. A hand-written trap is the single most commonly
 * broken piece of custom UI, and every one of those behaviours is a correctness requirement in
 * this prompt. What the platform does not give us — scroll lock and explicit focus restore — is
 * implemented below.
 *
 * Open/close motion is the "genie" (lib/genie.js): the panel pours out of the control that opened
 * it and is sucked back into it on close, for EVERY modal. Whether it plays, how long it takes and
 * how finely it is drawn are platform settings (/admin/platform/genie); with the genie off the
 * modal uses its plain CSS fade. Reduced-motion users always get an instant show/hide. Escape, scrim click and the close button all funnel through close(), so they play
 * the same animation.
 *
 * Invariants:
 *  - The PANEL is solid. Only the scrim (::backdrop) may carry a backdrop-filter — this is the
 *    one place in the entire product where glass is permitted (design-system §0), and it is
 *    dropped entirely on small screens, which are the cheap devices.
 *  - Scroll lock is reference-counted. Nested overlays must not have the inner one's close
 *    restore scrolling while the outer one is still open.
 *  - Focus returns to whatever opened the modal. Browsers mostly do this already; we do it
 *    explicitly because "mostly" is not a guarantee and a lost focus position strands a
 *    keyboard user at the top of the document.
 */

import { canAnimate, canGenie, genieRun } from '../../lib/genie.js';

/** Reference-counted scroll lock, shared with Drawer and ConfirmDialog. */
let lockCount = 0;
let savedPaddingRight = '';

export function lockScroll() {
  lockCount += 1;
  if (lockCount > 1) return;
  // Compensate for the scrollbar's width, or removing it shifts the whole page sideways at the
  // exact moment the user's attention moves to the dialog.
  const gap = window.innerWidth - document.documentElement.clientWidth;
  savedPaddingRight = document.body.style.paddingRight;
  if (gap > 0) document.body.style.paddingRight = `${gap}px`;
  document.body.style.overflow = 'hidden';
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;
  document.body.style.overflow = '';
  document.body.style.paddingRight = savedPaddingRight;
}

/** Close icon. Inline SVG per design-system §13: 1.5px stroke, round caps, currentColor. */
function createCloseIcon() {
  const span = document.createElement('span');
  span.className = 'overlay__close-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  return span;
}

let modalSeq = 0;

/**
 * Plain fade-and-drop. Used when a panel is too heavy to slice into genie strips, and for every
 * modal while a Super Admin has the genie switched off (/admin/platform/genie).
 */
const FALLBACK_CLOSE_MS = 220;

export function Modal({
  title = '',
  description = '',
  content = null,
  footer = null,
  size = 'md',
  showClose = true,
  closeOnScrim = true,
  closeLabel = 'Close',
  important = false,
  onClose = null,
  onOpen = null,
} = {}) {
  modalSeq += 1;
  const titleId = `modal-title-${modalSeq}`;
  const descId = `modal-desc-${modalSeq}`;

  const dialog = document.createElement('dialog');
  dialog.className = `overlay modal modal--${size}${important ? ' modal--important' : ''}`;
  // showModal() implies aria-modal, but stating it keeps the contract explicit for anyone
  // reading the DOM and for older assistive tech.
  dialog.setAttribute('aria-modal', 'true');
  if (title) dialog.setAttribute('aria-labelledby', titleId);
  if (description) dialog.setAttribute('aria-describedby', descId);

  const panel = document.createElement('div');
  panel.className = 'modal__panel';

  const header = document.createElement('div');
  header.className = 'modal__header';

  const heading = document.createElement('div');
  heading.className = 'modal__heading';
  if (title) {
    const titleEl = document.createElement('h2');
    titleEl.className = 'modal__title';
    titleEl.id = titleId;
    titleEl.textContent = title;
    heading.append(titleEl);
  }
  if (description) {
    const descEl = document.createElement('p');
    descEl.className = 'modal__description';
    descEl.id = descId;
    descEl.textContent = description;
    heading.append(descEl);
  }
  header.append(heading);

  let closeBtn = null;
  if (showClose) {
    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'overlay__close';
    closeBtn.setAttribute('aria-label', closeLabel);
    closeBtn.append(createCloseIcon());
    closeBtn.addEventListener('click', () => close(false));
    header.append(closeBtn);
  }

  if (title || description || showClose) panel.append(header);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal__body';
  if (content) bodyEl.append(content);
  panel.append(bodyEl);

  const footerEl = document.createElement('div');
  footerEl.className = 'modal__footer';
  if (footer) {
    footerEl.append(footer);
    panel.append(footerEl);
  }

  dialog.append(panel);

  let previouslyFocused = null;
  let result;
  let isClosing = false;
  // True from open() until the open animation ends; a close requested meanwhile is deferred.
  let isOpening = false;
  let pendingClose = null;
  let activeGenie = null;
  const nativeClose = dialog.close.bind(dialog);

  // WHY the panel, not the <dialog>, is what gets sliced: the dialog is the top-layer box the
  // strips are drawn into, and it must stay untransformed for `position: fixed` to mean "viewport".
  function playGenie(direction) {
    const run = genieRun({ panel, host: dialog, trigger: previouslyFocused, direction });
    activeGenie = run;
    return run;
  }

  function stopGenie() {
    activeGenie?.cancel();
    activeGenie = null;
  }

  function open(trigger = null) {
    if (dialog.hasAttribute('open') && !isClosing) return;
    if (isClosing) {
      // Re-opened while still swallowing itself: abort the close and stay open.
      isClosing = false;
      stopGenie();
      dialog.classList.remove('modal--closing', 'modal--genie-closing');
      return;
    }

    previouslyFocused = trigger ?? document.activeElement;

    if (!dialog.isConnected) document.body.append(dialog);

    // Opts the dialog out of the plain CSS fade so it cannot fight the genie for opacity/transform.
    const useGenie = canGenie();
    dialog.classList.toggle('modal--genie', useGenie);

    dialog.showModal();
    lockScroll();
    // onOpen may change the panel's size, so it runs before the strips are measured.
    if (onOpen) onOpen();

    if (!useGenie) return;
    const run = playGenie('open');
    if (!run) return;
    isOpening = true;
    run.finished.then((completed) => {
      if (activeGenie === run) activeGenie = null;
      isOpening = false;
      if (!completed || !pendingClose) return;
      const { value, opts } = pendingClose;
      pendingClose = null;
      close(value, opts);
    });
  }

  function close(value = false, { force = false } = {}) {
    if (!dialog.hasAttribute('open') || isClosing) return;
    if (isOpening) {
      pendingClose = { value, opts: { force } };
      return;
    }
    result = value;

    // Instant only when motion is unavailable/unwanted. A switched-off genie still fades out.
    if (force || !canAnimate()) {
      nativeClose();
      return;
    }

    isClosing = true;
    let run = null;
    if (canGenie()) {
      dialog.classList.add('modal--genie-closing');
      run = playGenie('close');
    }

    if (!run) {
      // Genie off, or the panel is too heavy (or has no size) to slice — plain fade-and-drop.
      dialog.classList.remove('modal--genie', 'modal--genie-closing');
      dialog.classList.add('modal--closing');
      setTimeout(() => {
        if (!isClosing) return;
        isClosing = false;
        nativeClose();
      }, FALLBACK_CLOSE_MS);
      return;
    }

    run.finished.then((completed) => {
      if (activeGenie === run) activeGenie = null;
      if (!completed || !isClosing) return;
      isClosing = false;
      nativeClose();
    });
  }

  // Intercept Escape key to play graceful MacBook exit instead of abrupt instant vanishing
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close(false);
  });

  // `close` fires for Escape too, so cleanup lives here and nowhere else — that is what keeps
  // the Escape path and the button path from drifting apart.
  dialog.addEventListener('close', () => {
    isClosing = false;
    isOpening = false;
    pendingClose = null;
    stopGenie();
    dialog.classList.remove('modal--closing', 'modal--genie', 'modal--genie-closing');
    unlockScroll();
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
    if (onClose) onClose(result);
  });

  if (closeOnScrim) {
    // A <dialog>'s own box covers only the panel area; clicks landing on the dialog element
    // itself are therefore clicks on the backdrop.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close(false);
    });
  }

  dialog.open_ = open;
  dialog.openModal = open;
  dialog.closeModal = close;
  // Kept for callers written before every close became a genie.
  dialog.minimize = () => close(false);
  dialog.isOpen = () => Boolean(dialog.hasAttribute('open'));

  Object.defineProperty(dialog, 'open', {
    value: open,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(dialog, 'close', {
    value: close,
    writable: true,
    configurable: true,
  });

  dialog.setContent = (node) => {
    bodyEl.replaceChildren(node);
  };
  dialog.setFooter = (node) => {
    footerEl.replaceChildren(node);
    if (!footerEl.isConnected) panel.append(footerEl);
  };
  dialog.body = bodyEl;

  return dialog;
}
