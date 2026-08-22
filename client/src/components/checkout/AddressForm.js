/**
 * AddressForm.js — Cascading Bangladeshi administrative address form (Prompt 5.4).
 *
 * Implements:
 *  - Division → District → Upazila cascading selects using bangladeshGeo.js
 *  - Phone validation for +8801 Bangladeshi numbers
 *  - Full bilingual support
 *  - Saved address picker for authenticated users
 */

import { BANGLADESH_DIVISIONS, getDistrictsByDivision, getUpazilasByDistrict } from '../../data/bangladeshGeo.js';
import { t } from '../../services/i18n.js';
import { Button } from '../ui/Button.js';

export function normalizeBdPhone(input) {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('8801') && digits.length === 13) return `+${digits}`;
  if (digits.startsWith('01') && digits.length === 11) return `+88${digits}`;
  if (digits.startsWith('1') && digits.length === 10) return `+880${digits}`;
  return input.trim();
}

export function isValidBdPhone(phone) {
  const normalized = normalizeBdPhone(phone);
  return /^\+8801[3-9]\d{8}$/.test(normalized);
}

export function AddressForm({
  initialData = {},
  savedAddresses = [],
  onSave,
  onChange,
} = {}) {
  const formEl = document.createElement('form');
  formEl.className = 'address-form';
  formEl.noValidate = true;

  let state = {
    recipient_name: initialData.recipient_name || '',
    recipient_phone: initialData.recipient_phone || '',
    division: initialData.division || 'dhaka',
    district: initialData.district || 'dhaka_city',
    upazila: initialData.upazila || '',
    address_line: initialData.address_line || '',
    delivery_notes: initialData.delivery_notes || '',
  };

  const isBn = () => document.documentElement.lang === 'bn';

  // 1. Saved Addresses Picker (if available)
  if (savedAddresses && savedAddresses.length > 0) {
    const savedWrap = document.createElement('div');
    savedWrap.className = 'address-form__saved-wrap';

    const savedTitle = document.createElement('label');
    savedTitle.className = 'form-label';
    savedTitle.textContent = t('checkout.saved_addresses');
    savedWrap.append(savedTitle);

    const savedGrid = document.createElement('div');
    savedGrid.className = 'address-form__saved-grid';

    savedAddresses.forEach((addr, idx) => {
      const card = document.createElement('div');
      card.className = `address-form__saved-card ${idx === 0 ? 'address-form__saved-card--selected' : ''}`;
      card.innerHTML = `
        <div class="address-form__saved-name"><strong>${addr.recipient_name}</strong> · ${addr.recipient_phone}</div>
        <div class="address-form__saved-details">${addr.address_line}, ${addr.upazila ? addr.upazila + ', ' : ''}${addr.district}, ${addr.division}</div>
      `;

      card.addEventListener('click', () => {
        savedGrid.querySelectorAll('.address-form__saved-card').forEach((c) => c.classList.remove('address-form__saved-card--selected'));
        card.classList.add('address-form__saved-card--selected');
        state = { ...state, ...addr };
        populateInputs();
        if (onChange) onChange(state);
      });

      savedGrid.append(card);
    });

    savedWrap.append(savedGrid);
    formEl.append(savedWrap);
  }

  // 2. Form Grid
  const grid = document.createElement('div');
  grid.className = 'address-form__grid';

  // Recipient Name
  const nameGroup = document.createElement('div');
  nameGroup.className = 'form-group address-form__group-name';
  nameGroup.innerHTML = `
    <label class="form-label" for="recipient-name">${t('checkout.recipient_name')} *</label>
    <input type="text" id="recipient-name" class="form-input" placeholder="${t('checkout.recipient_name_placeholder')}" value="${state.recipient_name}" required />
    <span class="form-error" id="err-recipient-name"></span>
  `;
  const nameInput = nameGroup.querySelector('input');
  nameInput.addEventListener('input', (e) => {
    state.recipient_name = e.target.value;
    if (onChange) onChange(state);
  });
  grid.append(nameGroup);

  // Recipient Phone
  const phoneGroup = document.createElement('div');
  phoneGroup.className = 'form-group address-form__group-phone';
  phoneGroup.innerHTML = `
    <label class="form-label" for="recipient-phone">${t('checkout.recipient_phone')} *</label>
    <input type="tel" id="recipient-phone" class="form-input" placeholder="${t('checkout.recipient_phone_placeholder')}" value="${state.recipient_phone}" required />
    <span class="form-error" id="err-recipient-phone"></span>
  `;
  const phoneInput = phoneGroup.querySelector('input');
  phoneInput.addEventListener('input', (e) => {
    state.recipient_phone = e.target.value;
    if (onChange) onChange(state);
  });
  grid.append(phoneGroup);

  // Division Select
  const divGroup = document.createElement('div');
  divGroup.className = 'form-group address-form__group-div';
  divGroup.innerHTML = `
    <label class="form-label" for="address-division">${t('checkout.division')} *</label>
    <select id="address-division" class="form-select" required>
      <option value="">-- ${t('checkout.select_division')} --</option>
    </select>
    <span class="form-error" id="err-address-division"></span>
  `;
  const divSelect = divGroup.querySelector('select');
  BANGLADESH_DIVISIONS.forEach((div) => {
    const opt = document.createElement('option');
    opt.value = div.id;
    opt.textContent = isBn() ? div.name_bn : div.name_en;
    if (div.id === state.division) opt.selected = true;
    divSelect.append(opt);
  });
  grid.append(divGroup);

  // District Select
  const distGroup = document.createElement('div');
  distGroup.className = 'form-group address-form__group-dist';
  distGroup.innerHTML = `
    <label class="form-label" for="address-district">${t('checkout.district')} *</label>
    <select id="address-district" class="form-select" required>
      <option value="">-- ${t('checkout.select_district')} --</option>
    </select>
    <span class="form-error" id="err-address-district"></span>
  `;
  const distSelect = distGroup.querySelector('select');
  grid.append(distGroup);

  // Upazila Select / Input
  const upaGroup = document.createElement('div');
  upaGroup.className = 'form-group address-form__group-upa';
  upaGroup.innerHTML = `
    <label class="form-label" for="address-upazila">${t('checkout.upazila')}</label>
    <select id="address-upazila" class="form-select">
      <option value="">-- ${t('checkout.select_upazila')} --</option>
    </select>
  `;
  const upaSelect = upaGroup.querySelector('select');
  grid.append(upaGroup);

  function updateDistricts(selectedDivId) {
    distSelect.innerHTML = `<option value="">-- ${t('checkout.select_district')} --</option>`;
    const districts = getDistrictsByDivision(selectedDivId);
    districts.forEach((dist) => {
      const opt = document.createElement('option');
      opt.value = dist.id;
      opt.textContent = isBn() ? dist.name_bn : dist.name_en;
      if (dist.id === state.district) opt.selected = true;
      distSelect.append(opt);
    });

    if (!districts.some((d) => d.id === state.district) && districts.length > 0) {
      state.district = districts[0].id;
      distSelect.value = state.district;
    }
    updateUpazilas(selectedDivId, state.district);
  }

  function updateUpazilas(selectedDivId, selectedDistId) {
    upaSelect.innerHTML = `<option value="">-- ${t('checkout.select_upazila')} --</option>`;
    const upazilas = getUpazilasByDistrict(selectedDivId, selectedDistId);
    upazilas.forEach((upa) => {
      const opt = document.createElement('option');
      opt.value = upa;
      opt.textContent = upa;
      if (upa === state.upazila) opt.selected = true;
      upaSelect.append(opt);
    });
  }

  divSelect.addEventListener('change', (e) => {
    state.division = e.target.value;
    updateDistricts(state.division);
    if (onChange) onChange(state);
  });

  distSelect.addEventListener('change', (e) => {
    state.district = e.target.value;
    updateUpazilas(state.division, state.district);
    if (onChange) onChange(state);
  });

  upaSelect.addEventListener('change', (e) => {
    state.upazila = e.target.value;
    if (onChange) onChange(state);
  });

  // Street Address Line
  const addrGroup = document.createElement('div');
  addrGroup.className = 'form-group address-form__group-line';
  addrGroup.innerHTML = `
    <label class="form-label" for="address-line">${t('checkout.address_line')} *</label>
    <textarea id="address-line" class="form-textarea" rows="2" placeholder="${t('checkout.address_line_placeholder')}" required>${state.address_line}</textarea>
    <span class="form-error" id="err-address-line"></span>
  `;
  const addrInput = addrGroup.querySelector('textarea');
  addrInput.addEventListener('input', (e) => {
    state.address_line = e.target.value;
    if (onChange) onChange(state);
  });
  grid.append(addrGroup);

  // Delivery Notes
  const notesGroup = document.createElement('div');
  notesGroup.className = 'form-group address-form__group-notes';
  notesGroup.innerHTML = `
    <label class="form-label" for="delivery-notes">${t('checkout.delivery_notes')}</label>
    <input type="text" id="delivery-notes" class="form-input" placeholder="${t('checkout.delivery_notes_placeholder')}" value="${state.delivery_notes}" />
  `;
  const notesInput = notesGroup.querySelector('input');
  notesInput.addEventListener('input', (e) => {
    state.delivery_notes = e.target.value;
    if (onChange) onChange(state);
  });
  grid.append(notesGroup);

  formEl.append(grid);

  function populateInputs() {
    nameInput.value = state.recipient_name;
    phoneInput.value = state.recipient_phone;
    divSelect.value = state.division;
    updateDistricts(state.division);
    distSelect.value = state.district;
    updateUpazilas(state.division, state.district);
    upaSelect.value = state.upazila;
    addrInput.value = state.address_line;
    notesInput.value = state.delivery_notes;
  }

  // Initial population of cascading dropdowns
  updateDistricts(state.division);

  // Form Submission & Action Buttons
  const actions = document.createElement('div');
  actions.className = 'address-form__actions';

  const saveBtn = Button({
    label: t('checkout.save_continue') || 'Save & Continue',
    variant: 'primary',
    size: 'md',
    onClick: (e) => {
      e.preventDefault();
      if (validate()) {
        if (onSave) onSave(state);
      }
    },
  });
  actions.append(saveBtn);
  formEl.append(actions);

  function validate() {
    let isValid = true;
    const clearError = (id) => {
      const el = formEl.querySelector(`#${id}`);
      if (el) el.textContent = '';
    };
    const setError = (id, msg) => {
      const el = formEl.querySelector(`#${id}`);
      if (el) el.textContent = msg;
      isValid = false;
    };

    clearError('err-recipient-name');
    clearError('err-recipient-phone');
    clearError('err-address-division');
    clearError('err-address-district');
    clearError('err-address-line');

    if (!state.recipient_name.trim()) {
      setError('err-recipient-name', t('checkout.validation_name'));
    }

    if (!isValidBdPhone(state.recipient_phone)) {
      setError('err-recipient-phone', t('checkout.validation_phone'));
    }

    if (!state.division) {
      setError('err-address-division', t('checkout.validation_division'));
    }

    if (!state.district) {
      setError('err-address-district', t('checkout.validation_district'));
    }

    if (!state.address_line.trim()) {
      setError('err-address-line', t('checkout.validation_address'));
    }

    return isValid;
  }

  return {
    element: formEl,
    getData: () => ({ ...state, recipient_phone: normalizeBdPhone(state.recipient_phone) }),
    setData: (newData) => {
      state = { ...state, ...newData };
      populateInputs();
    },
    validate,
  };
}
