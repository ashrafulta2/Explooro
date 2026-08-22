/**
 * Textarea — multi-line text control.
 *
 * Responsibility: descriptions, dispute reasons, and the mandatory-reason inputs that admin
 * actions require (module toggles, restrictions — Prompt 1.4's ConfirmDialog consumes this).
 *
 * Invariants:
 *  - `autoResize` never shrinks below the configured `rows`, so a cleared textarea does not
 *    collapse and shove the page content upward.
 *  - Same counter and aria contract as Input — both delegate to FormField so the two controls
 *    can never drift apart in how they announce errors.
 */

import { FormField, uid } from './FormField.js';

export function Textarea({
  label = '',
  hint = '',
  error = '',
  success = false,
  value = '',
  placeholder = '',
  name = '',
  id = '',
  rows = 4,
  disabled = false,
  readonly = false,
  required = false,
  maxLength = null,
  showCounter = false,
  autoResize = false,
  onInput = null,
  onChange = null,
} = {}) {
  const controlId = id || uid('textarea');

  const textarea = document.createElement('textarea');
  textarea.id = controlId;
  textarea.className = 'textarea';
  textarea.rows = rows;
  textarea.value = value;
  if (name) textarea.name = name;
  if (placeholder) textarea.placeholder = placeholder;
  if (disabled) textarea.disabled = true;
  if (readonly) textarea.readOnly = true;
  if (required) textarea.required = true;
  if (maxLength) textarea.maxLength = maxLength;

  const control = document.createElement('div');
  control.className = 'field__control field__control--textarea';
  control.append(textarea);

  let counter = null;
  if (showCounter && maxLength) {
    counter = document.createElement('span');
    counter.className = 'field__counter';
    counter.id = uid('counter');
  }

  function syncCounter() {
    if (!counter) return;
    const used = textarea.value.length;
    counter.textContent = `${used} / ${maxLength}`;
    counter.dataset.overflow = used >= maxLength ? 'true' : 'false';
  }

  function resize() {
    if (!autoResize) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  syncCounter();

  textarea.addEventListener('input', (event) => {
    syncCounter();
    resize();
    if (onInput) onInput(event);
  });
  if (onChange) textarea.addEventListener('change', onChange);

  const field = FormField({
    label,
    hint,
    error,
    success,
    required,
    controlId,
    control,
    input: textarea,
    counter,
  });

  field.input = textarea;
  Object.defineProperty(field, 'value', {
    get: () => textarea.value,
    set: (next) => {
      textarea.value = next;
      syncCounter();
      resize();
    },
  });
  field.focus = () => textarea.focus();

  return field;
}
