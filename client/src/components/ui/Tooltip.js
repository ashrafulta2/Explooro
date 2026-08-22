/**
 * Tooltip — short supplementary label attached to a trigger.
 *
 * Usage: `Tooltip({ trigger: someButton, content: 'Escrow releases in 3 days' })`
 * It attaches listeners to the trigger and returns a handle; there is no element to insert.
 *
 * Invariants:
 *  - HOVER INTENT: a 120ms delay before showing (design-system §15), so dragging the cursor
 *    across a grid of twelve product cards does not flash twelve tooltips.
 *  - A tooltip is NEVER the only place information lives. It is unavailable on touch devices and
 *    to many assistive tech users — anything essential belongs in the visible UI.
 *  - Positioning is FLIPPED, not clipped, when it would leave the viewport, and re-measured on
 *    every show because layout may have changed since the last one.
 */

const SHOW_DELAY = 120;
const HIDE_DELAY = 80;
const OFFSET = 8;

let tooltipSeq = 0;

export function Tooltip({
  trigger = null,
  content = '',
  placement = 'top',
  delay = SHOW_DELAY,
} = {}) {
  if (!trigger) throw new Error('Tooltip requires a trigger element');

  tooltipSeq += 1;
  const id = `tooltip-${tooltipSeq}`;

  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.id = id;
  tip.setAttribute('role', 'tooltip');
  tip.textContent = content;
  // Top layer when available, so the tooltip is never clipped by an ancestor's overflow.
  if (HTMLElement.prototype.hasOwnProperty('popover')) tip.popover = 'manual';

  let showTimer = null;
  let hideTimer = null;
  let open = false;

  function position() {
    const t = trigger.getBoundingClientRect();
    const r = tip.getBoundingClientRect();
    let placed = placement;

    // Flip if there is not enough room on the preferred side.
    if (placed === 'top' && t.top - r.height - OFFSET < 0) placed = 'bottom';
    else if (placed === 'bottom' && t.bottom + r.height + OFFSET > window.innerHeight) placed = 'top';
    else if (placed === 'left' && t.left - r.width - OFFSET < 0) placed = 'right';
    else if (placed === 'right' && t.right + r.width + OFFSET > window.innerWidth) placed = 'left';

    let top;
    let left;
    switch (placed) {
      case 'bottom':
        top = t.bottom + OFFSET;
        left = t.left + t.width / 2 - r.width / 2;
        break;
      case 'left':
        top = t.top + t.height / 2 - r.height / 2;
        left = t.left - r.width - OFFSET;
        break;
      case 'right':
        top = t.top + t.height / 2 - r.height / 2;
        left = t.right + OFFSET;
        break;
      default:
        top = t.top - r.height - OFFSET;
        left = t.left + t.width / 2 - r.width / 2;
    }

    // Keep it fully on screen horizontally even after flipping.
    const margin = 8;
    left = Math.min(Math.max(margin, left), window.innerWidth - r.width - margin);

    tip.dataset.placement = placed;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
  }

  function show() {
    clearTimeout(hideTimer);
    if (open) return;
    showTimer = setTimeout(() => {
      if (!tip.isConnected) document.body.append(tip);
      if (tip.popover) {
        try {
          tip.showPopover();
        } catch {
          /* already open */
        }
      }
      open = true;
      // Measure after insertion — the tooltip has no size until it is in the document.
      position();
      tip.dataset.open = 'true';
      trigger.setAttribute('aria-describedby', id);
    }, delay);
  }

  function hide() {
    clearTimeout(showTimer);
    if (!open) return;
    hideTimer = setTimeout(() => {
      tip.dataset.open = 'false';
      open = false;
      trigger.removeAttribute('aria-describedby');
      const remove = () => {
        if (open) return;
        if (tip.popover) {
          try {
            tip.hidePopover();
          } catch {
            /* already hidden */
          }
        }
        tip.remove();
      };
      tip.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 300);
    }, HIDE_DELAY);
  }

  trigger.addEventListener('mouseenter', show);
  trigger.addEventListener('mouseleave', hide);
  // Keyboard parity: focus shows it immediately rather than after the hover-intent delay,
  // because a deliberate Tab is already an expression of intent.
  trigger.addEventListener('focus', () => {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(), 0);
    show();
  });
  trigger.addEventListener('blur', hide);
  // Escape dismisses, matching every other transient surface in the product.
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) hide();
  });

  return {
    element: tip,
    show,
    hide,
    setContent(next) {
      tip.textContent = next;
    },
    destroy() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      trigger.removeEventListener('mouseenter', show);
      trigger.removeEventListener('mouseleave', hide);
      tip.remove();
    },
  };
}
