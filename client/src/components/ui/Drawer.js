/**
 * Drawer — edge-anchored overlay panel (left / right / bottom).
 *
 * Responsibility: filters, mobile navigation, and detail panes that should not take the user off
 * the current page. `bottom` is the mobile sheet; `bottom`, `right`, and `left` are drag-to-dismiss.
 *
 * Shares Modal's <dialog> foundation — see that file's header for why the platform dialog is used
 * rather than a hand-rolled trap.
 *
 * Invariants:
 *  - The drag gesture NEVER fights the panel's own scrolling. On a bottom sheet a downward drag
 *    only becomes a dismiss when the content is already scrolled to the top; a side drawer
 *    dismisses horizontally, so a mostly-vertical move is claimed by the scroll and abandons the
 *    drag. Getting this wrong makes a scrollable panel feel broken, and it is the single most
 *    common bug in mobile sheet implementations.
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
  headerAction = null,
  side = 'right',
  size = 'md',
  showClose = true,
  closeOnScrim = true,
  closeLabel = 'Close',
  dragToDismiss = true,
  floating = false,
  positionKey = null,
  bodyPadding = true,
  lockBodyScroll = true,
  className = '',
  onClose = null,
  onOpen = null,
} = {}) {
  drawerSeq += 1;
  const titleId = `drawer-title-${drawerSeq}`;
  const descId = `drawer-desc-${drawerSeq}`;

  const dialog = document.createElement('dialog');
  dialog.className = `overlay drawer drawer--${side} drawer--${size}${floating ? ' drawer--floating' : ''}${className ? ` ${className}` : ''}`;
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

  const actions = document.createElement('div');
  actions.className = 'drawer__actions';
  if (headerAction) {
    actions.append(headerAction);
  }

  if (showClose) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'overlay__close';
    closeBtn.setAttribute('aria-label', closeLabel);
    closeBtn.append(createCloseIcon());
    closeBtn.addEventListener('click', () => close(false));
    actions.append(closeBtn);
  }

  if (title || description || actions.children.length) {
    header.append(actions);
    panel.append(header);
  }

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
  // Assigned in the floating block below; a no-op for every docked drawer.
  let restorePosition = () => {};

  function open(trigger = null) {
    if (dialog.hasAttribute('open')) return;
    previouslyFocused = trigger ?? document.activeElement;
    if (!dialog.isConnected) document.body.append(dialog);
    dialog.showModal();
    restorePosition();
    if (lockBodyScroll) lockScroll();
    if (onOpen) onOpen();
  }

  const nativeClose = dialog.close.bind(dialog);

  function close(value = false) {
    if (!dialog.hasAttribute('open')) return;
    result = value;
    nativeClose();
  }

  /* ---- Floating mode: move the panel by its header (desktop only) ----- */
  // WHY a media query and not a size check: on a phone the panel is full-width, so there is nowhere
  // to move it to, and the swipe-to-dismiss gesture below must keep working there.
  const floatMq = window.matchMedia('(min-width: 768px) and (pointer: fine)');
  const isFloatingDesktop = () => floating && floatMq.matches;

  if (floating) {
    let moveId = null;
    let originX = 0;
    let originY = 0;
    let baseX = 0;
    let baseY = 0;
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const setOffset = (x, y) => {
      dialog.style.setProperty('--float-x', `${x}px`);
      dialog.style.setProperty('--float-y', `${y}px`);
    };

    header.classList.add('drawer__header--movable');

    // WHY try/catch: storage throws in private windows and with blocked site data, and a drawer that
    // cannot remember where it was must still open.
    const storeKey = positionKey ? `explooro.drawer.pos.${positionKey}` : null;
    const savePosition = (x, y) => {
      if (!storeKey) return;
      try {
        if (x === 0 && y === 0) localStorage.removeItem(storeKey);
        else localStorage.setItem(storeKey, JSON.stringify({ x, y }));
      } catch {
        /* position just isn't remembered */
      }
    };
    const currentOffset = () => [
      parseFloat(dialog.style.getPropertyValue('--float-x')) || 0,
      parseFloat(dialog.style.getPropertyValue('--float-y')) || 0,
    ];

    restorePosition = () => {
      if (!storeKey || !isFloatingDesktop()) return;
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
      } catch {
        return;
      }
      if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return;
      // WHY re-clamp: the window may be smaller than when the position was saved, and an off-screen
      // panel has no reachable handle. WHY offset*: this runs during the slide-in, when
      // getBoundingClientRect() still includes the entry transform; the layout box does not.
      setOffset(saved.x, saved.y);
      // WHY a frame later: the dialog has no layout box until the browser has run style for the
      // freshly opened <dialog> (its `display` transitions), so measuring synchronously gives 0.
      requestAnimationFrame(() => {
        if (!dialog.offsetWidth) return;
        setOffset(
          Math.min(window.innerWidth - dialog.offsetLeft - dialog.offsetWidth, Math.max(-dialog.offsetLeft, saved.x)),
          Math.min(window.innerHeight - dialog.offsetTop - dialog.offsetHeight, Math.max(-dialog.offsetTop, saved.y)),
        );
      });
    };

    header.addEventListener('pointerdown', (event) => {
      if (!isFloatingDesktop() || event.button !== 0) return;
      if (event.target.closest('button, a, input, select, textarea')) return;
      const rect = panel.getBoundingClientRect();
      baseX = parseFloat(dialog.style.getPropertyValue('--float-x')) || 0;
      baseY = parseFloat(dialog.style.getPropertyValue('--float-y')) || 0;
      // Keep the whole panel on screen: the header is the only handle, so a panel dragged out of
      // the viewport could never be grabbed again.
      minX = baseX - rect.left;
      maxX = baseX + (window.innerWidth - rect.right);
      minY = baseY - rect.top;
      maxY = baseY + (window.innerHeight - rect.bottom);
      originX = event.clientX;
      originY = event.clientY;
      moveId = event.pointerId;
      header.setPointerCapture(moveId);
      dialog.classList.add('drawer--moving');
      event.preventDefault();
    });

    header.addEventListener('pointermove', (event) => {
      if (moveId === null || event.pointerId !== moveId) return;
      setOffset(
        clamp(baseX + event.clientX - originX, minX, maxX),
        clamp(baseY + event.clientY - originY, minY, maxY),
      );
    });

    const endMove = (event) => {
      if (moveId === null || event.pointerId !== moveId) return;
      if (header.hasPointerCapture(moveId)) header.releasePointerCapture(moveId);
      moveId = null;
      dialog.classList.remove('drawer--moving');
      savePosition(...currentOffset());
    };
    header.addEventListener('pointerup', endMove);
    header.addEventListener('pointercancel', endMove);

    // Double-click the title bar to snap back to the docked position.
    header.addEventListener('dblclick', (event) => {
      if (event.target.closest('button, a')) return;
      setOffset(0, 0);
      savePosition(0, 0);
    });
  }

  dialog.addEventListener('close', () => {
    dialog.style.removeProperty('--float-x');
    dialog.style.removeProperty('--float-y');
    if (lockBodyScroll) unlockScroll();
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

  /* ---- Drag to dismiss (bottom sheet + side drawers) ------------------ */
  // A bottom sheet dismisses on the vertical axis (drag down); a right/left drawer
  // dismisses on the horizontal axis (drag toward its own edge). The mechanics —
  // velocity-or-distance threshold, spring-back, scrim fade, pointer-capture
  // cleanup — are shared; only the axis and the dismiss direction differ.
  if (dragToDismiss && (side === 'bottom' || side === 'right' || side === 'left')) {
    const axis = side === 'bottom' ? 'y' : 'x';
    // Sign that carries the panel toward its exit edge: down (+y), right (+x), left (−x).
    const dismissSign = side === 'left' ? -1 : 1;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let current = 0; // travel along the dismiss axis; positive = toward dismissal
    let dragging = false;
    let decided = false; // committed the gesture to a drag (vs. a scroll) yet?
    let pointerId = null;

    const DISMISS_DISTANCE = 0.25; // fraction of the panel's extent along the axis
    const DISMISS_VELOCITY = 0.5; // px per ms

    const extent = () => (axis === 'y' ? panel.offsetHeight : panel.offsetWidth);

    panel.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // Never hijack a gesture that starts on a control.
      if (event.target.closest('button, a, input, select, textarea')) return;
      // A floating panel on desktop is moved, not swiped away.
      if (isFloatingDesktop()) return;
      // The bottom sheet dismisses on the same axis its content scrolls, so it must
      // own the gesture only when scrolled to the very top. A side drawer dismisses
      // horizontally, orthogonal to its vertical scroll, so the axis is resolved on
      // the first move instead (see `decided` below) and no scroll check is needed.
      if (side === 'bottom' && bodyEl.scrollTop > 0) return;

      dragging = true;
      decided = false;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      current = 0;
      startTime = performance.now();
      panel.style.transition = 'none';
    });

    panel.addEventListener('pointermove', (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (!decided) {
        // Wait for a few px before committing, then bail if the intent is the wrong
        // axis (a mostly-vertical move on a side drawer is the content scrolling).
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        if (axis === 'x' && Math.abs(dy) > Math.abs(dx)) {
          dragging = false;
          panel.style.transition = '';
          return;
        }
        decided = true;
      }

      const delta = (axis === 'y' ? dy : dx) * dismissSign;
      // A drag back past the open edge is not a dismiss; resist it so the panel
      // cannot be flung further onto the screen than its resting position.
      current = delta > 0 ? delta : delta * 0.2;

      if (current > 4 && !panel.hasPointerCapture(pointerId)) {
        // Capture only once the gesture is clearly a drag, so a plain tap still works normally.
        panel.setPointerCapture(pointerId);
      }
      const offset = current * dismissSign;
      panel.style.transform = axis === 'y' ? `translateY(${offset}px)` : `translateX(${offset}px)`;
      const progress = Math.min(1, Math.max(0, current / extent()));
      // Fade the scrim with the drag so the panel feels physically attached to the backdrop.
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
      const velocity = current / elapsed;
      const past = current > extent() * DISMISS_DISTANCE;

      if (current > 0 && (past || velocity > DISMISS_VELOCITY)) {
        close(false);
      } else {
        // Spring back. Clearing the inline transform lets the CSS transition do the easing.
        panel.style.transform = '';
        dialog.style.removeProperty('--drag-progress');
      }
      current = 0;
    }

    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
  }

  dialog.openDrawer = open;
  dialog.closeDrawer = close;
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
  dialog.body = bodyEl;

  return dialog;
}
