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

export function Modal({
  title = '',
  description = '',
  content = null,
  footer = null,
  size = 'md',
  showClose = true,
  closeOnScrim = true,
  closeLabel = 'Close',
  onClose = null,
  onOpen = null,
} = {}) {
  modalSeq += 1;
  const titleId = `modal-title-${modalSeq}`;
  const descId = `modal-desc-${modalSeq}`;

  const dialog = document.createElement('dialog');
  dialog.className = `overlay modal modal--${size}`;
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

  function open(trigger = null) {
    if (dialog.open) return;
    previouslyFocused = trigger ?? document.activeElement;

    if (!dialog.isConnected) document.body.append(dialog);

    // §6.2 Origin Rule — the panel grows out of the control that opened it, so the user keeps
    // the causal link between what they clicked and what appeared.
    if (previouslyFocused instanceof HTMLElement) {
      const r = previouslyFocused.getBoundingClientRect();
      if (r.width || r.height) {
        dialog.style.setProperty('--origin-x', `${r.left + r.width / 2}px`);
        dialog.style.setProperty('--origin-y', `${r.top + r.height / 2}px`);
      }
    }

    dialog.showModal();
    lockScroll();
    if (onOpen) onOpen();
  }

  function close(value = false) {
    if (!dialog.open) return;
    result = value;
    dialog.close();
  }

  // `close` fires for Escape too, so cleanup lives here and nowhere else — that is what keeps
  // the Escape path and the button path from drifting apart.
  dialog.addEventListener('close', () => {
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
