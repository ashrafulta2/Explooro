/**
 * Radio / RadioGroup — mutually exclusive choice.
 *
 * Responsibility: payment method, delivery option, dispute reason — any "exactly one of these".
 *
 * Invariants:
 *  - Arrow-key navigation and roving focus come from the NATIVE radio group behaviour, which the
 *    browser provides for free to inputs sharing a `name`. Do not re-implement it with keydown
 *    handlers: the native behaviour is already correct in RTL, wraps at both ends, and matches
 *    what screen-reader users expect. Re-implementing it is how that gets broken.
 *  - RadioGroup renders a <fieldset>/<legend>, which is what actually associates the group's
 *    question with each option for assistive tech. A <div> with a heading does not.
 */

import { uid } from './FormField.js';

export function Radio({
  label = '',
  hint = '',
  name = '',
  value = '',
  checked = false,
  disabled = false,
  id = '',
  onChange = null,
} = {}) {
  const controlId = id || uid('radio');

  const root = document.createElement('label');
  root.className = 'toggle toggle--radio';
  root.htmlFor = controlId;

  const input = document.createElement('input');
  input.type = 'radio';
  input.id = controlId;
  input.className = 'toggle__input';
  input.checked = checked;
  if (name) input.name = name;
  if (value) input.value = value;
  if (disabled) input.disabled = true;

  const dot = document.createElement('span');
  dot.className = 'radio__box';
  dot.setAttribute('aria-hidden', 'true');

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

  root.append(input, dot, text);

  if (onChange) {
    input.addEventListener('change', (event) => {
      if (input.checked) onChange(input.value, event);
    });
  }

  root.input = input;
  Object.defineProperty(root, 'checked', {
    get: () => input.checked,
    set: (next) => {
      input.checked = next;
    },
  });

  return root;
}

export function RadioGroup({
  legend = '',
  hint = '',
  error = '',
  name = '',
  options = [],
  value = '',
  disabled = false,
  required = false,
  onChange = null,
} = {}) {
  const groupName = name || uid('radiogroup');

  const root = document.createElement('fieldset');
  root.className = 'radio-group field';

  const legendEl = document.createElement('legend');
  legendEl.className = 'field__label';
  legendEl.textContent = legend;
  if (required) {
    const mark = document.createElement('span');
    mark.className = 'field__required';
    mark.textContent = '*';
    mark.setAttribute('aria-hidden', 'true');
    legendEl.append(' ', mark);
  }
  root.append(legendEl);

  // WHY the hint sits above the options: it qualifies the whole question ("Inside Dhaka only"),
  // so it has to be read BEFORE the choice is made. Below the list it is a footnote nobody
  // reads until after they have already picked.
  const hintEl = document.createElement('p');
  hintEl.className = 'field__hint';
  hintEl.id = uid('hint');
  hintEl.textContent = hint;
  if (hint) {
    root.append(hintEl);
    root.setAttribute('aria-describedby', hintEl.id);
  }

  const list = document.createElement('div');
  list.className = 'radio-group__options';

  const radios = options.map((option) => {
    const isObject = typeof option === 'object' && option !== null;
    const optValue = isObject ? String(option.value) : String(option);
    const radio = Radio({
      label: isObject ? option.label : String(option),
      hint: isObject ? (option.hint ?? '') : '',
      name: groupName,
      value: optValue,
      checked: optValue === String(value),
      disabled: disabled || (isObject && Boolean(option.disabled)),
      onChange,
    });
    list.append(radio);
    return radio;
  });

  root.append(list);

  // The error stays below the options: unlike the hint, it is feedback ON the choice just made,
  // so it belongs where the eye lands after reading the list.
  const footer = document.createElement('div');
  footer.className = 'field__footer';
  const messages = document.createElement('div');
  messages.className = 'field__messages';

  const errorEl = document.createElement('p');
  errorEl.className = 'field__error';
  errorEl.id = uid('error');
  errorEl.setAttribute('role', 'alert');
  errorEl.textContent = error;

  messages.append(errorEl);
  footer.append(messages);
  root.append(footer);
  root.dataset.invalid = error ? 'true' : 'false';

  function syncDescribedBy() {
    const ids = [];
    if (hintEl.textContent) ids.push(hintEl.id);
    if (errorEl.textContent) ids.push(errorEl.id);
    if (ids.length) root.setAttribute('aria-describedby', ids.join(' '));
    else root.removeAttribute('aria-describedby');
  }
  syncDescribedBy();

  root.setError = (message = '') => {
    errorEl.textContent = message;
    root.dataset.invalid = message ? 'true' : 'false';
    syncDescribedBy();
  };
  Object.defineProperty(root, 'value', {
    get: () => radios.find((r) => r.checked)?.input.value ?? '',
    set: (next) => {
      for (const r of radios) r.checked = r.input.value === String(next);
    },
  });

  return root;
}
