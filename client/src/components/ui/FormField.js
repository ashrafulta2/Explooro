/**
 * FormField — label + hint + error + counter wrapper, and the single owner of aria plumbing.
 *
 * Responsibility: every labelled control in the app routes its accessibility wiring through here,
 * so `aria-describedby` composition, `aria-invalid`, and required-marking exist in exactly one
 * place. Input/Select/Textarea all delegate to it rather than each re-deriving the same rules.
 *
 * Invariants:
 *  - A control with a hint, an error, or a counter always has all of them referenced by
 *    `aria-describedby`, in visual order, with no stale ids left behind after setError().
 *  - `aria-invalid` is present if and only if an error message is currently displayed.
 *  - The required marker is `aria-hidden`; the real signal is the control's `required` attribute,
 *    because a screen reader announcing a literal "asterisk" is noise, not information.
 */

let seq = 0;

/** Collision-free DOM id. Ids must be unique per document, not per component instance. */
export function uid(prefix = 'field') {
  seq += 1;
  return `${prefix}-${seq.toString(36)}`;
}

export function FormField({
  label = '',
  hint = '',
  error = '',
  success = false,
  required = false,
  controlId = '',
  control = null,
  input = null,
  counter = null,
  labelTag = 'label',
} = {}) {
  const root = document.createElement('div');
  root.className = 'field';

  // The focusable element aria attributes are applied to. For a plain input this IS the control;
  // for a control wrapped in prefix/suffix affixes it is the inner <input>.
  const target = input ?? control;

  if (label) {
    const labelEl = document.createElement(labelTag);
    labelEl.className = 'field__label';
    if (labelTag === 'label' && controlId) labelEl.htmlFor = controlId;
    labelEl.textContent = label;
    if (required) {
      const mark = document.createElement('span');
      mark.className = 'field__required';
      mark.textContent = '*';
      mark.setAttribute('aria-hidden', 'true');
      labelEl.append(' ', mark);
    }
    root.append(labelEl);
  }

  if (control) root.append(control);

  const footer = document.createElement('div');
  footer.className = 'field__footer';

  const hintId = uid('hint');
  const errorId = uid('error');

  const hintEl = document.createElement('p');
  hintEl.className = 'field__hint';
  hintEl.id = hintId;
  hintEl.textContent = hint;

  const errorEl = document.createElement('p');
  errorEl.className = 'field__error';
  errorEl.id = errorId;
  // WHY role="alert": an error appearing after a failed submit must be announced immediately.
  // It is only populated when an error exists, so it never announces an empty string.
  errorEl.setAttribute('role', 'alert');
  errorEl.textContent = error;

  const messages = document.createElement('div');
  messages.className = 'field__messages';
  messages.append(hintEl, errorEl);
  footer.append(messages);
  if (counter) footer.append(counter);

  root.append(footer);

  /** Recomputes aria-describedby from whatever is currently visible. */
  function syncDescribedBy() {
    if (!target) return;
    const ids = [];
    if (hintEl.textContent) ids.push(hintId);
    if (errorEl.textContent) ids.push(errorId);
    if (counter?.id) ids.push(counter.id);
    if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
    else target.removeAttribute('aria-describedby');
  }

  function setError(message = '') {
    errorEl.textContent = message;
    root.dataset.invalid = message ? 'true' : 'false';
    if (target) {
      if (message) target.setAttribute('aria-invalid', 'true');
      else target.removeAttribute('aria-invalid');
    }
    // Success and error are mutually exclusive: a field cannot be simultaneously wrong and right.
    if (message) root.dataset.success = 'false';
    syncDescribedBy();
  }

  function setSuccess(on = true) {
    root.dataset.success = on ? 'true' : 'false';
    if (on) setError('');
  }

  function setHint(message = '') {
    hintEl.textContent = message;
    syncDescribedBy();
  }

  setError(error);
  if (success) setSuccess(true);
  syncDescribedBy();

  root.setError = setError;
  root.setSuccess = setSuccess;
  root.setHint = setHint;
  root.control = target;

  return root;
}
