/**
 * Toast service — the app's single notification queue.
 *
 * Responsibility: own the one toast container in the document, cap how many are visible at once,
 * and queue the rest. Every notification in the product goes through here.
 *
 *   import { toast } from '../services/toast.js';
 *   toast.success('Product added to your store');
 *   toast.error('Payment failed', { action: retry, actionLabel: 'Try again' });
 *
 * Invariants:
 *  - MAX_VISIBLE is a hard cap. Beyond it, toasts queue rather than stack — a column of eight
 *    notifications covers the very content the user is trying to act on.
 *  - The container uses the Popover API when available so it sits in the TOP LAYER, above any
 *    open <dialog>. Without this, a toast fired from inside a modal renders behind it — the one
 *    place a notification is most likely to be needed and least likely to be seen. Ordinary
 *    fixed positioning with --z-toast is the fallback.
 *  - The container is created lazily and reused. Re-creating it per toast would restart the
 *    aria-live region and cause missed or duplicated announcements.
 */

import { Toast } from '../components/ui/Toast.js';

const MAX_VISIBLE = 3;

let container = null;
const visible = new Set();
const queue = [];

function ensureContainer() {
  if (container?.isConnected) return container;

  container = document.createElement('div');
  container.className = 'toast-container';
  // polite, not assertive: a toast should wait for a natural pause rather than interrupt whatever
  // the user is currently having read to them. Errors escalate individually via role="alert".
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-atomic', 'false');

  // Top layer via popover, so toasts clear modals and drawers.
  if (HTMLElement.prototype.hasOwnProperty('popover')) {
    container.popover = 'manual';
    document.body.append(container);
    try {
      container.showPopover();
    } catch {
      // Already shown, or the element was disconnected mid-call — the fallback styling still
      // positions it correctly, so this is not worth surfacing.
    }
  } else {
    container.dataset.fallback = 'true';
    document.body.append(container);
  }

  return container;
}

function drain() {
  while (visible.size < MAX_VISIBLE && queue.length > 0) {
    show(queue.shift());
  }
}

function show(options) {
  const parent = ensureContainer();
  const el = Toast({
    ...options,
    onDismiss: () => {
      visible.delete(el);
      drain();
    },
  });
  visible.add(el);
  parent.append(el);
  // Start the timer on the next frame so the enter transition plays from its start state.
  requestAnimationFrame(() => {
    el.dataset.entered = 'true';
    el.start();
  });
  return el;
}

function push(variant, message, options = {}) {
  const config = { ...options, message, variant };
  if (visible.size >= MAX_VISIBLE) {
    queue.push(config);
    return null;
  }
  return show(config);
}

export const toast = {
  success: (message, options) => push('success', message, options),
  error: (message, options) =>
    // Errors default to a longer read: the user has to absorb what failed and decide what to do.
    push('error', message, { duration: 8000, ...options }),
  warning: (message, options) => push('warning', message, options),
  info: (message, options) => push('info', message, options),

  /** Dismiss everything on screen and drop anything still queued (e.g. on route change). */
  clear() {
    queue.length = 0;
    for (const el of [...visible]) el.dismiss();
  },
};

export default toast;
