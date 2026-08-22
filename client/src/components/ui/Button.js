/**
 * Button — the primary action primitive.
 *
 * Responsibility: every clickable action in the app. Implements the full design-system state
 * matrix (§10): default, hover, focus-visible, active, disabled, loading.
 *
 * Invariants:
 *  - The button's width NEVER changes when it enters the loading state. The label keeps its box
 *    and is hidden with `visibility`, and the spinner overlays it — a reflowing button under the
 *    user's finger is how mis-taps happen on a slow connection.
 *  - A loading button is also functionally disabled: it carries `aria-busy` AND blocks activation,
 *    so a double-tap on a slow network cannot fire two payments.
 */

/** Spinner element. CSS-only so it inherits currentColor and needs no icon dependency. */
function createSpinner() {
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  spinner.setAttribute('aria-hidden', 'true');
  return spinner;
}

export function Button({
  label = '',
  variant = 'primary',
  size = 'md',
  type = 'button',
  loading = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  fullWidth = false,
  onClick = null,
  ariaLabel = '',
} = {}) {
  const btn = document.createElement('button');
  btn.type = type;
  btn.className = `btn btn--${variant} btn--${size}`;
  if (fullWidth) btn.classList.add('btn--full');

  // §14 optical correction: a single-word button looks cramped next to multi-word siblings at the
  // same padding. Widen it ~1.25x so the pair reads as optically equal.
  if (label && !label.trim().includes(' ')) btn.classList.add('btn--single-word');

  if (iconLeft) {
    iconLeft.classList.add('btn__icon');
    iconLeft.setAttribute('aria-hidden', 'true');
    btn.append(iconLeft);
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'btn__label';
  labelEl.textContent = label;
  btn.append(labelEl);

  if (iconRight) {
    iconRight.classList.add('btn__icon');
    iconRight.setAttribute('aria-hidden', 'true');
    btn.append(iconRight);
  }

  // An icon-only button has no visible text, so it must carry an accessible name explicitly.
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);

  const spinnerWrap = document.createElement('span');
  spinnerWrap.className = 'btn__spinner';
  spinnerWrap.append(createSpinner());

  function setLoading(on) {
    btn.dataset.loading = on ? 'true' : 'false';
    if (on) {
      btn.setAttribute('aria-busy', 'true');
      if (!spinnerWrap.isConnected) btn.append(spinnerWrap);
    } else {
      btn.removeAttribute('aria-busy');
      spinnerWrap.remove();
    }
    syncDisabled();
  }

  function setDisabled(on) {
    btn.dataset.disabled = on ? 'true' : 'false';
    syncDisabled();
  }

  // WHY a single sync point: the button must be inert when EITHER explicitly disabled or loading.
  // Deriving `disabled` from both flags in one place stops the two from fighting each other —
  // e.g. setLoading(false) must not re-enable a button that was disabled for another reason.
  function syncDisabled() {
    btn.disabled = btn.dataset.disabled === 'true' || btn.dataset.loading === 'true';
  }

  if (onClick) {
    btn.addEventListener('click', (event) => {
      if (btn.disabled) return;
      onClick(event);
    });
  }

  setDisabled(disabled);
  setLoading(loading);

  btn.setLoading = setLoading;
  btn.setDisabled = setDisabled;
  btn.setLabel = (text) => {
    labelEl.textContent = text;
  };

  return btn;
}
