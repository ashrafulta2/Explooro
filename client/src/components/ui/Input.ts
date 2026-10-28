/**
 * Input — single-line text control.
 *
 * Responsibility: text, email, tel, number, password and search entry, with the optional
 * affix slots and character counter the design system's form surfaces rely on.
 *
 * Invariants:
 *  - Affixes (৳, .00, a unit suffix) are `aria-hidden` and NOT focusable. They are visual
 *    context; the accessible name comes from the label, and a tab stop on a currency symbol
 *    would be a keyboard trap for no benefit.
 *  - The counter reflects the live value length on every input event, and flags overflow via a
 *    data attribute rather than a colour set in JS.
 */

import { FormField, uid } from './FormField.ts';
import type { ControlField } from './FormField.ts';

export interface InputOptions {
  label?: string;
  hint?: string;
  error?: string;
  success?: boolean;
  value?: string;
  placeholder?: string;
  type?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  /** Decorative text inside the control, before or after the input. */
  prefix?: string;
  suffix?: string;
  maxLength?: number | null;
  showCounter?: boolean;
  autocomplete?: string;
  inputmode?: string;
  ariaLabel?: string;
  onInput?: ((event: Event) => void) | null;
  onChange?: ((event: Event) => void) | null;
}

export function Input({
  label = '',
  hint = '',
  error = '',
  success = false,
  value = '',
  placeholder = '',
  type = 'text',
  name = '',
  id = '',
  disabled = false,
  readonly = false,
  required = false,
  prefix = '',
  suffix = '',
  maxLength = null,
  showCounter = false,
  autocomplete = '',
  inputmode = '',
  ariaLabel = '',
  onInput = null,
  onChange = null,
}: InputOptions = {}): ControlField<HTMLInputElement> {
  const controlId = id || uid('input');

  const input = document.createElement('input');
  input.type = type;
  input.id = controlId;
  input.className = 'input';
  input.value = value;
  if (name) input.name = name;
  if (placeholder) input.placeholder = placeholder;
  if (disabled) input.disabled = true;
  if (readonly) input.readOnly = true;
  if (required) input.required = true;
  if (maxLength) input.maxLength = maxLength;
  // The cast: the DOM types `autocomplete` as a closed list of tokens, but the field accepts any.
  if (autocomplete) input.autocomplete = autocomplete as AutoFill;
  if (inputmode) input.inputMode = inputmode;
  if (ariaLabel) input.setAttribute('aria-label', ariaLabel);

  const control = document.createElement('div');
  control.className = 'field__control';

  if (prefix) {
    const el = document.createElement('span');
    el.className = 'field__affix field__affix--prefix';
    el.textContent = prefix;
    el.setAttribute('aria-hidden', 'true');
    control.append(el);
    control.dataset.hasPrefix = 'true';
  }

  control.append(input);

  if (suffix) {
    const el = document.createElement('span');
    el.className = 'field__affix field__affix--suffix';
    el.textContent = suffix;
    el.setAttribute('aria-hidden', 'true');
    control.append(el);
    control.dataset.hasSuffix = 'true';
  }

  let counter: HTMLSpanElement | null = null;
  if (showCounter && maxLength) {
    counter = document.createElement('span');
    counter.className = 'field__counter';
    counter.id = uid('counter');
  }

  function syncCounter(): void {
    if (!counter || !maxLength) return;
    const used = input.value.length;
    counter.textContent = `${used} / ${maxLength}`;
    counter.dataset.overflow = used >= maxLength ? 'true' : 'false';
  }
  syncCounter();

  input.addEventListener('input', (event) => {
    syncCounter();
    if (onInput) onInput(event);
  });
  if (onChange) input.addEventListener('change', onChange);

  // The cast: `input` and `value` are attached on the next two statements.
  const field = FormField({
    label,
    hint,
    error,
    success,
    required,
    controlId,
    control,
    input,
    counter,
  }) as ControlField<HTMLInputElement>;

  field.input = input;
  Object.defineProperty(field, 'value', {
    get: () => input.value,
    set: (next: string) => {
      input.value = next;
      syncCounter();
    },
  });
  field.focus = () => input.focus();

  return field;
}
