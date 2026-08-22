/**
 * Toast — a single transient notification element.
 *
 * The stacking, queueing, and lifetime rules live in services/toast.js; this file only builds and
 * animates one toast. Application code should never import this directly — it calls
 * `toast.success(...)` and lets the service own the queue.
 *
 * Invariants:
 *  - The dismiss timer PAUSES on hover and on focus. Focus matters as much as hover: a keyboard
 *    user tabbing to the toast's action must not have it vanish mid-reach.
 *  - Remaining time is preserved across pause/resume rather than restarted, or a user who
 *    hovers briefly gets a full fresh countdown every time.
 */

const ICONS = {
  success: '<path d="M20 6 9 17l-5-5"/>',
  error: '<path d="M18 6 6 18M6 6l12 12"/>',
  warning: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  info: '<path d="M12 16v-4M12 8h.01"/><circle cx="12" cy="12" r="10"/>',
};

function createIcon(variant) {
  const span = document.createElement('span');
  span.className = 'toast__icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    `stroke-linecap="round" stroke-linejoin="round">${ICONS[variant] ?? ICONS.info}</svg>`;
  return span;
}

export function Toast({
  message = '',
  title = '',
  variant = 'info',
  duration = 5000,
  action = null,
  actionLabel = '',
  dismissible = true,
  onDismiss = null,
} = {}) {
  const root = document.createElement('div');
  root.className = `toast toast--${variant}`;
  // The container owns aria-live; an individual toast is just its content. Declaring live here
  // too would make some screen readers announce the message twice.
  root.setAttribute('role', variant === 'error' ? 'alert' : 'status');

  root.append(createIcon(variant));

  const body = document.createElement('div');
  body.className = 'toast__body';
  if (title) {
    const titleEl = document.createElement('p');
    titleEl.className = 'toast__title';
    titleEl.textContent = title;
    body.append(titleEl);
  }
  const msg = document.createElement('p');
  msg.className = 'toast__message';
  msg.textContent = message;
  body.append(msg);
  root.append(body);

  if (action && actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      action();
      dismiss();
    });
    root.append(btn);
  }

  if (dismissible) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 6 6 18M6 6l12 12"/></svg>';
    close.addEventListener('click', () => dismiss());
    root.append(close);
  }

  let timer = null;
  let remaining = duration;
  let startedAt = 0;
  let dismissed = false;

  function resume() {
    if (dismissed || duration <= 0 || remaining <= 0) return;
    startedAt = performance.now();
    timer = setTimeout(dismiss, remaining);
  }

  function pause() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining -= performance.now() - startedAt;
  }

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (timer !== null) clearTimeout(timer);
    root.dataset.leaving = 'true';
    // Wait for the exit transition before removing, so the stack does not snap closed.
    const done = () => {
      root.remove();
      if (onDismiss) onDismiss();
    };
    root.addEventListener('transitionend', done, { once: true });
    // Fallback: if the transition never fires (reduced motion, display:none), still clean up.
    setTimeout(done, 400);
  }

  root.addEventListener('mouseenter', pause);
  root.addEventListener('mouseleave', resume);
  root.addEventListener('focusin', pause);
  root.addEventListener('focusout', resume);

  root.start = resume;
  root.dismiss = dismiss;

  return root;
}
