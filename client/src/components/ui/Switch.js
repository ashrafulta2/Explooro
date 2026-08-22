/**
 * Switch — immediate-effect binary toggle.
 *
 * Responsibility: settings that apply on flip rather than on submit. The Module Control Panel
 * (Prompt 3.2) is the heaviest consumer, which is why the pending state below is a first-class
 * feature rather than an afterthought.
 *
 * Use a Switch when the change takes effect immediately; use a Checkbox when it takes effect on
 * form submit. Getting this backwards is the most common misuse of the two controls.
 *
 * Invariants:
 *  - PENDING IS THE POINT. An optimistic toggle flips instantly, then awaits the server. While
 *    pending the control is `aria-busy` and non-interactive, so a user cannot queue a second
 *    write against a module whose first write has not landed. `revert()` restores the pre-toggle
 *    value on failure without firing onChange again — otherwise a failed request would trigger
 *    another request and loop.
 *  - The off-state track measures 2.25:1 against the page and fails WCAG 1.4.11 on its own
 *    (design-system §2). The track therefore carries a `--border-interactive` outline in CSS.
 *    Do NOT "fix" this by darkening the track — that makes off look like on.
 */

import { uid } from './FormField.js';

export function Switch({
  label = '',
  hint = '',
  checked = false,
  disabled = false,
  pending = false,
  name = '',
  id = '',
  labelPosition = 'end',
  onChange = null,
} = {}) {
  const controlId = id || uid('switch');

  const root = document.createElement('label');
  root.className = 'toggle toggle--switch';
  root.htmlFor = controlId;
  if (labelPosition === 'start') root.classList.add('toggle--label-start');

  const input = document.createElement('input');
  input.type = 'checkbox';
  // WHY role="switch": semantically this announces "on/off" rather than "checked/unchecked",
  // which is what a settings toggle actually means to a screen-reader user.
  input.setAttribute('role', 'switch');
  input.id = controlId;
  input.className = 'toggle__input';
  input.checked = checked;
  if (name) input.name = name;
  if (disabled) input.disabled = true;

  const track = document.createElement('span');
  track.className = 'switch__track';
  track.setAttribute('aria-hidden', 'true');

  const thumb = document.createElement('span');
  thumb.className = 'switch__thumb';
  track.append(thumb);

  const text = document.createElement('span');
  text.className = 'toggle__text';

  const labelEl = document.createElement('span');
  labelEl.className = 'toggle__label';
  labelEl.textContent = label;
  text.append(labelEl);

  if (hint) {
    const hintEl = document.createElement('span');
    hintEl.className = 'toggle__hint';
    hintEl.id = uid('hint');
    hintEl.textContent = hint;
    text.append(hintEl);
    input.setAttribute('aria-describedby', hintEl.id);
  }

  root.append(input, track, text);

  /** Value to restore if the in-flight request fails. */
  let committed = checked;

  function setPending(on) {
    root.dataset.pending = on ? 'true' : 'false';
    if (on) {
      input.setAttribute('aria-busy', 'true');
      input.disabled = true;
    } else {
      input.removeAttribute('aria-busy');
      input.disabled = disabled;
    }
  }

  function revert() {
    input.checked = committed;
    setPending(false);
  }

  function commit() {
    committed = input.checked;
    setPending(false);
  }

  input.addEventListener('change', (event) => {
    if (onChange) onChange(input.checked, event);
  });

  setPending(pending);

  root.input = input;
  Object.defineProperty(root, 'checked', {
    get: () => input.checked,
    set: (next) => {
      input.checked = next;
      committed = next;
    },
  });
  root.setPending = setPending;
  root.revert = revert;
  root.commit = commit;
  root.setDisabled = (on) => {
    disabled = on;
    if (root.dataset.pending !== 'true') input.disabled = on;
  };

  return root;
}
