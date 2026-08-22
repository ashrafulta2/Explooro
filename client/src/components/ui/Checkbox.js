/**
 * Checkbox — independent boolean choice.
 *
 * Responsibility: multi-select lists, terms acceptance, and the select-all header cell that
 * Prompt 1.4's Table needs (hence `indeterminate`).
 *
 * Invariants:
 *  - The whole row is the target, not just the 20px box. The visual control and the touch target
 *    are independent (design-system §11) — a 20px tap target on a phone is a miss waiting to
 *    happen, and making the label clickable is also what a sighted mouse user expects.
 *  - `indeterminate` is a DOM property only; it has no HTML attribute, so it MUST be set in JS
 *    and re-applied whenever checked state is written.
 */

import { uid } from './FormField.js';

/** Tick + dash marks. Inline SVG, currentColor, 1.5px stroke per design-system §13. */
function createMark() {
  const mark = document.createElement('span');
  mark.className = 'checkbox__box';
  mark.setAttribute('aria-hidden', 'true');
  mark.innerHTML =
    '<svg class="checkbox__tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 6 9 17l-5-5"/></svg>' +
    '<svg class="checkbox__dash" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round"><path d="M6 12h12"/></svg>';
  return mark;
}

export function Checkbox({
  label = '',
  hint = '',
  checked = false,
  indeterminate = false,
  disabled = false,
  required = false,
  name = '',
  value = '',
  id = '',
  onChange = null,
} = {}) {
  const controlId = id || uid('checkbox');

  const root = document.createElement('label');
  root.className = 'toggle toggle--checkbox';
  root.htmlFor = controlId;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = controlId;
  input.className = 'toggle__input';
  input.checked = checked;
  input.indeterminate = indeterminate;
  if (name) input.name = name;
  if (value) input.value = value;
  if (disabled) input.disabled = true;
  if (required) input.required = true;

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

  root.append(input, createMark(), text);

  input.addEventListener('change', (event) => {
    // Any explicit user choice resolves the mixed state — it is no longer "partially selected".
    input.indeterminate = false;
    if (onChange) onChange(input.checked, event);
  });

  root.input = input;
  Object.defineProperty(root, 'checked', {
    get: () => input.checked,
    set: (next) => {
      input.checked = next;
      input.indeterminate = false;
    },
  });
  root.setIndeterminate = (on) => {
    input.indeterminate = on;
  };
  root.setDisabled = (on) => {
    input.disabled = on;
  };

  return root;
}
