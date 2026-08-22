/**
 * Select — single-choice dropdown.
 *
 * Responsibility: bounded choice from a known option list (district, category, status filter).
 *
 * Invariants:
 *  - Built on the NATIVE <select>. On the entry-level Android devices this product targets, the
 *    OS picker is faster, accessible for free, and correctly handles keyboard, screen readers,
 *    and small viewports. A hand-rolled listbox would be a downgrade in every one of those.
 *  - The chevron is decorative: `aria-hidden` and `pointer-events: none`, so clicks fall through
 *    to the select underneath it rather than being swallowed.
 */

import { FormField, uid } from './FormField.js';

/** Chevron indicator. Inline SVG per design-system §13: 1.5px stroke, round caps, currentColor. */
function createChevron() {
  const wrap = document.createElement('span');
  wrap.className = 'select__chevron';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  return wrap;
}

export function Select({
  label = '',
  hint = '',
  error = '',
  success = false,
  options = [],
  value = '',
  placeholder = '',
  name = '',
  id = '',
  disabled = false,
  required = false,
  onChange = null,
} = {}) {
  const controlId = id || uid('select');

  const select = document.createElement('select');
  select.id = controlId;
  select.className = 'select';
  if (name) select.name = name;
  if (disabled) select.disabled = true;
  if (required) select.required = true;

  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    // Placeholder is not a selectable answer — `required` then rejects an unchanged select.
    opt.disabled = true;
    opt.selected = !value;
    select.append(opt);
  }

  for (const option of options) {
    const opt = document.createElement('option');
    // Accept both a bare string and a { value, label, disabled } object.
    const isObject = typeof option === 'object' && option !== null;
    opt.value = isObject ? String(option.value) : String(option);
    opt.textContent = isObject ? option.label : String(option);
    if (isObject && option.disabled) opt.disabled = true;
    if (opt.value === String(value)) opt.selected = true;
    select.append(opt);
  }

  const control = document.createElement('div');
  control.className = 'field__control field__control--select';
  control.append(select, createChevron());

  if (onChange) select.addEventListener('change', onChange);

  const field = FormField({
    label,
    hint,
    error,
    success,
    required,
    controlId,
    control,
    input: select,
  });

  field.input = select;
  Object.defineProperty(field, 'value', {
    get: () => select.value,
    set: (next) => {
      select.value = next;
    },
  });
  field.focus = () => select.focus();

  return field;
}
