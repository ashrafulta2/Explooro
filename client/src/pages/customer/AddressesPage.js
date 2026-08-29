/**
 * AddressesPage.js — Customer Saved Delivery Addresses Book (Prompt 11.3 & IA 1.4).
 *
 * Implements:
 * 1. Complete address book management: list, create, edit, delete, set default.
 * 2. Cascading Bangladeshi administrative geography (Division → District → Upazila).
 * 3. Strict Bangladeshi phone validation (+88013-019).
 * 4. High-contrast, zero-gradient, responsive card layout adhering to Explooro design tokens.
 * 5. Instant 1-click default switching and clipboard copy for rapid logistics reference.
 * 6. Low-literacy friendly interactive modal form drawer with 48px+ touch targets and bilingual support.
 *
 * Route: /account/addresses (alias: /customer/addresses)
 */

import { customerApi } from '../../services/customer.api.js';
import { BANGLADESH_DIVISIONS, getDistrictsByDivision, getUpazilasByDistrict, getDivisionById, getDistrictById } from '../../data/bangladeshGeo.js';
import { isValidBdPhone, normalizeBdPhone } from '../../components/checkout/AddressForm.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { Modal } from '../../components/ui/Modal.js';
import { confirmDialog } from '../../components/ui/ConfirmDialog.js';

export default function AddressesPage(root, { navigate } = {}) {
  const isBn = () => document.documentElement.lang === 'bn';

  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'addresses-page';

  // 1. Header
  const header = document.createElement('div');
  header.className = 'addresses-page__header';
  header.innerHTML = `
    <a href="/account" class="addresses-page__back">
      ← ${t('common.back', 'Back')} · ${t('nav.customer.addresses', 'Addresses')}
    </a>
    <div class="addresses-page__title-wrap">
      <div class="addresses-page__title-info">
        <div class="addresses-page__badge">
          📍 ${t('customer_addresses.badge', 'Address Book')}
        </div>
        <h1 class="addresses-page__title">
          ${t('customer_addresses.page_title', 'Saved Delivery Addresses')}
        </h1>
        <p class="addresses-page__subtitle">
          ${t('customer_addresses.page_subtitle', 'Manage your home, office, and preferred delivery addresses for 1-click express checkout.')}
        </p>
      </div>
      <div class="addresses-page__title-actions" id="header-action-slot"></div>
    </div>
  `;
  container.append(header);

  // Add Address CTA Button in Header
  const addBtn = Button({
    label: t('customer_addresses.btn_add_address', '+ Add New Address'),
    variant: 'primary',
    size: 'md',
    onClick: () => openAddressModal({ onSaved: () => loadAddresses() }),
  });
  header.querySelector('#header-action-slot').append(addBtn);

  // 2. Content Slot
  const contentSlot = document.createElement('div');
  contentSlot.className = 'addresses-page__content space-y-6';
  container.append(contentSlot);

  root.append(container);

  async function loadAddresses() {
    contentSlot.innerHTML = '';
    contentSlot.append(
      Skeleton({ width: '100%', height: '100px' }),
      Skeleton({ width: '100%', height: '240px' })
    );

    try {
      const addresses = await customerApi.getAddresses();
      renderAddressBook(contentSlot, addresses || [], nav, loadAddresses);
    } catch (err) {
      contentSlot.innerHTML = `
        <div class="py-8 text-center text-danger">
          ${t('customer_addresses.toast_error', 'Failed to load addresses. Please refresh.')}
        </div>
      `;
    }
  }

  loadAddresses();

  return () => {
    container.remove();
  };
}

/**
 * Renders the KPI metrics, default spotlight, and address cards grid.
 */
function renderAddressBook(slot, addresses, nav, onRefresh) {
  slot.innerHTML = '';

  const isBn = () => document.documentElement.lang === 'bn';

  if (!addresses || addresses.length === 0) {
    // Empty State
    const emptyBox = document.createElement('div');
    emptyBox.className = 'addresses-empty';
    emptyBox.innerHTML = `
      <div class="addresses-empty__icon">📍</div>
      <h2 class="addresses-empty__title">${t('customer_addresses.empty_title', 'No Saved Delivery Addresses')}</h2>
      <p class="addresses-empty__desc">${t('customer_addresses.empty_desc', 'You have not saved any delivery addresses yet. Add your home or office address for frictionless 1-click checkout.')}</p>
      <div class="addresses-empty__actions" id="empty-cta-slot"></div>
    `;

    const emptyAddBtn = Button({
      label: t('customer_addresses.empty_cta', '+ Add Your First Address'),
      variant: 'primary',
      size: 'lg',
      onClick: () => openAddressModal({ onSaved: onRefresh }),
    });
    emptyBox.querySelector('#empty-cta-slot').append(emptyAddBtn);
    slot.append(emptyBox);
    return;
  }

  const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];

  // 1. KPI Summary Bar
  const kpis = document.createElement('div');
  kpis.className = 'addresses-kpis';
  kpis.innerHTML = `
    <div class="addresses-kpi-card">
      <div class="addresses-kpi-card__head">
        <span class="addresses-kpi-card__label">${t('customer_addresses.kpi_total_addresses', 'Saved Addresses')}</span>
        <span class="addresses-kpi-card__icon">📦</span>
      </div>
      <div class="addresses-kpi-card__val">${addresses.length}</div>
      <div class="addresses-kpi-card__sub">${t('customer_addresses.express_checkout_hint', 'Ready for 1-click checkout')}</div>
    </div>
    <div class="addresses-kpi-card">
      <div class="addresses-kpi-card__head">
        <span class="addresses-kpi-card__label">${t('customer_addresses.kpi_default_address', 'Primary Location')}</span>
        <span class="addresses-kpi-card__icon">⭐</span>
      </div>
      <div class="addresses-kpi-card__val" style="font-size: 1.25rem; font-family: inherit; font-weight: 800; text-transform: capitalize;">
        ${defaultAddr ? formatGeoName(defaultAddr.division, defaultAddr.district, isBn()) : '—'}
      </div>
      <div class="addresses-kpi-card__sub">${defaultAddr?.recipient_name || ''} · ${defaultAddr?.recipient_phone || ''}</div>
    </div>
  `;
  slot.append(kpis);

  // 2. Default Spotlight Card (if default exists)
  if (defaultAddr) {
    const spotlight = document.createElement('div');
    spotlight.className = 'addresses-spotlight';
    const labelType = (defaultAddr.label || 'HOME').toLowerCase();
    const labelText = defaultAddr.custom_label || t(`customer_addresses.label_${labelType}`, defaultAddr.label);

    spotlight.innerHTML = `
      <div class="addresses-spotlight__header">
        <div class="addresses-spotlight__badge">
          ⭐ ${t('customer_addresses.badge_default', 'Default Delivery Address')}
        </div>
        <span class="addresses-spotlight__hint">${t('customer_addresses.express_checkout_hint', 'Auto-selected during checkout')}</span>
      </div>
      <div class="addresses-spotlight__body">
        <div class="addresses-spotlight__info">
          <div class="addresses-spotlight__name">
            <span>${defaultAddr.recipient_name}</span>
            <span class="addresses-spotlight__type-tag">${labelText}</span>
            <span class="addresses-spotlight__phone">${defaultAddr.recipient_phone}</span>
          </div>
          <div class="addresses-spotlight__line">
            ${defaultAddr.address_line}${defaultAddr.upazila ? `, ${defaultAddr.upazila}` : ''}, ${formatGeoName(defaultAddr.division, defaultAddr.district, isBn())}${defaultAddr.postal_code ? ` - ${defaultAddr.postal_code}` : ''}
          </div>
          ${defaultAddr.delivery_notes ? `<div class="addresses-spotlight__notes">📝 ${defaultAddr.delivery_notes}</div>` : ''}
        </div>
        <div class="addresses-spotlight__actions" id="spotlight-action-slot"></div>
      </div>
    `;

    const copyBtn = Button({
      label: t('customer_addresses.btn_copy_address', 'Copy Address'),
      variant: 'secondary',
      size: 'sm',
      onClick: () => copyAddressToClipboard(defaultAddr, isBn()),
    });

    const editBtn = Button({
      label: t('customer_addresses.btn_edit', 'Edit Address'),
      variant: 'primary',
      size: 'sm',
      onClick: () => openAddressModal({ address: defaultAddr, onSaved: onRefresh }),
    });

    const actionSlot = spotlight.querySelector('#spotlight-action-slot');
    actionSlot.append(copyBtn, editBtn);
    slot.append(spotlight);
  }

  // 3. Address Cards Grid
  const grid = document.createElement('div');
  grid.className = 'addresses-grid';

  addresses.forEach((addr) => {
    const card = renderAddressCard(addr, onRefresh, isBn());
    grid.append(card);
  });

  slot.append(grid);
}

/**
 * Renders a single address card.
 */
function renderAddressCard(addr, onRefresh, isBn) {
  const card = document.createElement('div');
  card.className = `address-card ${addr.is_default ? 'address-card--default' : ''}`;

  const labelType = (addr.label || 'HOME').toLowerCase();
  const labelText = addr.custom_label || t(`customer_addresses.label_${labelType}`, addr.label);

  const iconMap = {
    home: '🏠',
    office: '🏢',
    other: '📍',
  };
  const icon = iconMap[labelType] || '📍';

  const fullGeo = `${addr.upazila ? addr.upazila + ', ' : ''}${formatGeoName(addr.division, addr.district, isBn)}${addr.postal_code ? ' - ' + addr.postal_code : ''}`;

  card.innerHTML = `
    <div class="address-card__header">
      <div class="address-card__type-tag address-card__type-tag--${labelType}">
        <span>${icon}</span>
        <span>${labelText}</span>
      </div>
      ${addr.is_default ? `<div class="address-card__default-badge">⭐ ${t('customer_addresses.badge_primary', 'Default')}</div>` : ''}
    </div>

    <div class="address-card__body">
      <div class="address-card__recipient">${addr.recipient_name}</div>
      <div class="address-card__phone-row">
        <span>${addr.recipient_phone}</span>
        <button type="button" class="address-card__copy-btn" title="${t('customer_addresses.btn_copy_address', 'Copy')}" data-copy="phone">
          📋 ${t('customer_addresses.btn_copy_address', 'Copy')}
        </button>
      </div>

      <div class="address-card__address-text">${addr.address_line}</div>
      <div class="address-card__geo-hierarchy">📍 ${fullGeo}</div>

      ${addr.delivery_notes ? `<div class="address-card__notes"><span>📝</span><span>${addr.delivery_notes}</span></div>` : ''}
    </div>

    <div class="address-card__footer">
      <div class="address-card__actions-left" id="card-left-actions-${addr.id}"></div>
      <div class="address-card__actions-right" id="card-right-actions-${addr.id}"></div>
    </div>
  `;

  // Copy phone listener
  card.querySelector('[data-copy="phone"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(addr.recipient_phone);
    toast.success(t('customer_addresses.toast_copied', 'Phone number copied!'));
  });

  const leftSlot = card.querySelector(`#card-left-actions-${addr.id}`);
  const rightSlot = card.querySelector(`#card-right-actions-${addr.id}`);

  // Set Default action (if not default)
  if (!addr.is_default) {
    const setDefaultBtn = Button({
      label: t('customer_addresses.btn_set_default', 'Set Default'),
      variant: 'ghost',
      size: 'xs',
      onClick: async () => {
        try {
          await customerApi.setDefaultAddress(addr.id);
          toast.success(t('customer_addresses.toast_default_set', 'Default delivery address updated!'));
          onRefresh();
        } catch {
          toast.error(t('customer_addresses.toast_error', 'Failed to update default address.'));
        }
      },
    });
    leftSlot.append(setDefaultBtn);
  }

  // Edit Action
  const editBtn = Button({
    label: t('customer_addresses.btn_edit', 'Edit'),
    variant: 'secondary',
    size: 'xs',
    onClick: () => openAddressModal({ address: addr, onSaved: onRefresh }),
  });
  rightSlot.append(editBtn);

  // Delete Action
  const deleteBtn = Button({
    label: t('customer_addresses.btn_delete', 'Delete'),
    variant: 'danger',
    size: 'xs',
    onClick: async () => {
      const confirmed = await confirmDialog({
        title: t('customer_addresses.delete_confirm_title', 'Delete this address?'),
        description: t('customer_addresses.delete_confirm_desc', 'Are you sure you want to remove this delivery address?'),
        confirmLabel: t('customer_addresses.delete_confirm_btn', 'Delete'),
        variant: 'danger',
      });

      if (confirmed) {
        try {
          await customerApi.deleteAddress(addr.id);
          toast.success(t('customer_addresses.toast_deleted', 'Address deleted successfully.'));
          onRefresh();
        } catch {
          toast.error(t('customer_addresses.toast_error', 'Failed to delete address.'));
        }
      }
    },
  });
  rightSlot.append(deleteBtn);

  return card;
}

/**
 * Copies formatted delivery address to clipboard.
 */
function copyAddressToClipboard(addr, isBn) {
  const geo = `${addr.upazila ? addr.upazila + ', ' : ''}${formatGeoName(addr.division, addr.district, isBn)}${addr.postal_code ? ' - ' + addr.postal_code : ''}`;
  const text = `${addr.recipient_name}\n${addr.recipient_phone}\n${addr.address_line}\n${geo}${addr.delivery_notes ? '\nNote: ' + addr.delivery_notes : ''}`;
  navigator.clipboard?.writeText(text);
  toast.success(t('customer_addresses.toast_copied', 'Address copied to clipboard!'));
}

/**
 * Helper to get localized division and district names.
 */
function formatGeoName(divisionId, districtId, isBn) {
  const div = getDivisionById(divisionId);
  const dist = getDistrictById(divisionId, districtId);
  const divName = div ? (isBn ? div.name_bn : div.name_en) : divisionId;
  const distName = dist ? (isBn ? dist.name_bn : dist.name_en) : districtId;
  if (!distName && !divName) return '';
  if (!distName) return divName;
  if (distName.toLowerCase() === divName.toLowerCase()) return distName;
  return `${distName}, ${divName}`;
}

/**
 * Opens Interactive Address Modal (for Create & Edit).
 */
export function openAddressModal({ address = null, onSaved = null } = {}) {
  const isEditing = Boolean(address && address.id);
  const isBn = () => document.documentElement.lang === 'bn';

  let selectedLabel = address?.label || 'HOME';
  let customLabel = address?.custom_label || '';
  let division = address?.division || 'dhaka';
  let district = address?.district || 'dhaka_city';
  let upazila = address?.upazila || '';
  let recipientName = address?.recipient_name || '';
  let recipientPhone = address?.recipient_phone || '';
  let addressLine = address?.address_line || '';
  let deliveryNotes = address?.delivery_notes || '';
  let postalCode = address?.postal_code || '';
  let isDefault = isEditing ? Boolean(address.is_default) : true;

  const content = document.createElement('form');
  content.className = 'address-modal-form';
  content.noValidate = true;

  content.innerHTML = `
    <!-- Section 1: Address Type / Label -->
    <div class="form-group">
      <label class="form-label">${t('customer_addresses.badge', 'Address Label')} *</label>
      <div class="address-modal-form__type-picker" id="type-picker">
        <button type="button" class="address-type-pill ${selectedLabel === 'HOME' ? 'address-type-pill--active' : ''}" data-val="HOME">
          🏠 ${t('customer_addresses.label_home', 'Home')}
        </button>
        <button type="button" class="address-type-pill ${selectedLabel === 'OFFICE' ? 'address-type-pill--active' : ''}" data-val="OFFICE">
          🏢 ${t('customer_addresses.label_office', 'Office')}
        </button>
        <button type="button" class="address-type-pill ${selectedLabel === 'OTHER' ? 'address-type-pill--active' : ''}" data-val="OTHER">
          📍 ${t('customer_addresses.label_other', 'Other')}
        </button>
      </div>
      <div id="custom-label-wrap" class="${selectedLabel === 'OTHER' ? '' : 'hidden'}" style="margin-top: 8px;">
        <input type="text" id="custom-label-input" class="form-input" placeholder="${t('customer_addresses.custom_label_placeholder', 'e.g. Parents\' House, Factory, Shop')}" value="${customLabel}" />
      </div>
    </div>

    <!-- Section 2: Recipient Name & Phone -->
    <div class="address-modal-form__grid-2">
      <div class="form-group">
        <label class="form-label" for="modal-rec-name">${t('customer_addresses.recipient_name', 'Recipient Name')} *</label>
        <input type="text" id="modal-rec-name" class="form-input" placeholder="${t('customer_addresses.recipient_name_placeholder', 'Full Name')}" value="${recipientName}" required />
        <span class="form-error" id="err-modal-name"></span>
      </div>
      <div class="form-group">
        <label class="form-label" for="modal-rec-phone">${t('customer_addresses.recipient_phone', 'Mobile Number')} *</label>
        <input type="tel" id="modal-rec-phone" class="form-input font-mono" placeholder="${t('customer_addresses.recipient_phone_placeholder', '017XXXXXXXX / +8801XXXXXXXXX')}" value="${recipientPhone}" required />
        <span class="form-error" id="err-modal-phone"></span>
      </div>
    </div>

    <!-- Section 3: Cascading Geography (Division & District) -->
    <div class="address-modal-form__grid-2">
      <div class="form-group">
        <label class="form-label" for="modal-division">${t('customer_addresses.division', 'Division')} *</label>
        <select id="modal-division" class="form-select" required>
          <option value="">${t('customer_addresses.select_division', '-- Select Division --')}</option>
        </select>
        <span class="form-error" id="err-modal-division"></span>
      </div>
      <div class="form-group">
        <label class="form-label" for="modal-district">${t('customer_addresses.district', 'District')} *</label>
        <select id="modal-district" class="form-select" required>
          <option value="">${t('customer_addresses.select_district', '-- Select District --')}</option>
        </select>
        <span class="form-error" id="err-modal-district"></span>
      </div>
    </div>

    <!-- Section 4: Upazila / Area & Postal Code -->
    <div class="address-modal-form__grid-2">
      <div class="form-group">
        <label class="form-label" for="modal-upazila">${t('customer_addresses.upazila', 'Upazila / Area / Thana')}</label>
        <select id="modal-upazila" class="form-select">
          <option value="">${t('customer_addresses.select_upazila', '-- Select Upazila / Area --')}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="modal-postal-code">${t('customer_addresses.postal_code', 'Postal / Zip Code')} <span class="form-label-sub">(${t('common.optional', 'Optional')})</span></label>
        <input type="text" id="modal-postal-code" class="form-input" placeholder="${t('customer_addresses.postal_code_placeholder', 'e.g. 1205')}" value="${postalCode}" />
      </div>
    </div>

    <!-- Section 5: Street Address -->
    <div class="form-group">
      <label class="form-label" for="modal-address-line">${t('customer_addresses.address_line', 'Street Address / House / Flat / Road')} *</label>
      <textarea id="modal-address-line" class="form-textarea" rows="2" placeholder="${t('customer_addresses.address_line_placeholder', 'House/Holding #, Flat/Floor, Road #, Sector/Village, Landmark')}" required>${addressLine}</textarea>
      <span class="form-error" id="err-modal-address"></span>
    </div>

    <!-- Section 6: Delivery Instructions -->
    <div class="form-group">
      <label class="form-label" for="modal-delivery-notes">${t('customer_addresses.delivery_notes', 'Delivery Instructions')} <span class="form-label-sub">(${t('common.optional', 'Optional')})</span></label>
      <input type="text" id="modal-delivery-notes" class="form-input" placeholder="${t('customer_addresses.delivery_notes_placeholder', 'e.g. Leave with gate security / Ring doorbell twice')}" value="${deliveryNotes}" />
    </div>

    <!-- Section 7: Default Checkbox Card -->
    <label class="address-modal-form__default-card">
      <input type="checkbox" id="modal-is-default" ${isDefault ? 'checked' : ''} />
      <div class="address-modal-form__default-card-text">
        <span class="address-modal-form__default-card-title">${t('customer_addresses.is_default_checkbox', 'Set as my primary default delivery address')}</span>
        <span class="address-modal-form__default-card-sub">${t('customer_addresses.express_checkout_hint', 'Automatically selected for fast 1-click checkout on all orders')}</span>
      </div>
    </label>

    <!-- Section 8: Modal Actions -->
    <div class="address-modal-form__actions" id="modal-actions-slot"></div>
  `;

  // Label Selector logic
  const typePicker = content.querySelector('#type-picker');
  const customWrap = content.querySelector('#custom-label-wrap');
  const customInput = content.querySelector('#custom-label-input');

  typePicker.querySelectorAll('.address-type-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      typePicker.querySelectorAll('.address-type-pill').forEach((b) => b.classList.remove('address-type-pill--active'));
      btn.classList.add('address-type-pill--active');
      selectedLabel = btn.dataset.val;
      if (selectedLabel === 'OTHER') {
        customWrap.classList.remove('hidden');
        customInput.focus();
      } else {
        customWrap.classList.add('hidden');
      }
    });
  });

  // Cascading Selects
  const divSelect = content.querySelector('#modal-division');
  const distSelect = content.querySelector('#modal-district');
  const upaSelect = content.querySelector('#modal-upazila');

  BANGLADESH_DIVISIONS.forEach((div) => {
    const opt = document.createElement('option');
    opt.value = div.id;
    opt.textContent = isBn() ? div.name_bn : div.name_en;
    if (div.id === division) opt.selected = true;
    divSelect.append(opt);
  });

  function populateDistricts(divId) {
    distSelect.innerHTML = `<option value="">${t('customer_addresses.select_district', '-- Select District --')}</option>`;
    const districts = getDistrictsByDivision(divId);
    districts.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = isBn() ? d.name_bn : d.name_en;
      if (d.id === district) opt.selected = true;
      distSelect.append(opt);
    });

    if (!districts.some((d) => d.id === district) && districts.length > 0) {
      district = districts[0].id;
      distSelect.value = district;
    }
    populateUpazilas(divId, district);
  }

  function populateUpazilas(divId, distId) {
    upaSelect.innerHTML = `<option value="">${t('customer_addresses.select_upazila', '-- Select Upazila / Area --')}</option>`;
    const upazilas = getUpazilasByDistrict(divId, distId);
    upazilas.forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      if (u === upazila) opt.selected = true;
      upaSelect.append(opt);
    });
  }

  divSelect.addEventListener('change', (e) => {
    division = e.target.value;
    populateDistricts(division);
  });

  distSelect.addEventListener('change', (e) => {
    district = e.target.value;
    populateUpazilas(division, district);
  });

  upaSelect.addEventListener('change', (e) => {
    upazila = e.target.value;
  });

  populateDistricts(division);

  // Modal Component Setup
  const modalTitle = isEditing
    ? t('customer_addresses.modal_edit_title', 'Edit Delivery Address')
    : t('customer_addresses.modal_add_title', 'Add New Delivery Address');

  let modal = null;

  const cancelBtn = Button({
    label: t('customer_addresses.modal_cancel_btn', 'Cancel'),
    variant: 'secondary',
    size: 'md',
    onClick: (e) => {
      e.preventDefault();
      modal?.closeModal();
    },
  });

  const saveBtn = Button({
    label: isEditing
      ? t('customer_addresses.modal_update_btn', 'Update Address')
      : t('customer_addresses.modal_save_btn', 'Save Address'),
    variant: 'primary',
    size: 'md',
    onClick: async (e) => {
      e.preventDefault();
      if (!validate()) return;

      const payload = {
        label: selectedLabel,
        custom_label: selectedLabel === 'OTHER' ? customInput.value.trim() : '',
        recipient_name: content.querySelector('#modal-rec-name').value.trim(),
        recipient_phone: normalizeBdPhone(content.querySelector('#modal-rec-phone').value),
        division,
        district,
        upazila: upaSelect.value,
        address_line: content.querySelector('#modal-address-line').value.trim(),
        delivery_notes: content.querySelector('#modal-delivery-notes').value.trim(),
        postal_code: content.querySelector('#modal-postal-code').value.trim(),
        is_default: content.querySelector('#modal-is-default').checked,
      };

      saveBtn.disabled = true;
      saveBtn.textContent = t('customer_addresses.modal_saving', 'Saving...');

      try {
        if (isEditing) {
          await customerApi.updateAddress(address.id, payload);
          toast.success(t('customer_addresses.toast_updated', 'Address updated successfully!'));
        } else {
          await customerApi.createAddress(payload);
          toast.success(t('customer_addresses.toast_created', 'Address saved successfully!'));
        }
        modal.closeModal();
        if (onSaved) onSaved();
      } catch (err) {
        toast.error(t('customer_addresses.toast_error', 'Failed to save address. Please check input.'));
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = isEditing
          ? t('customer_addresses.modal_update_btn', 'Update Address')
          : t('customer_addresses.modal_save_btn', 'Save Address');
      }
    },
  });

  content.querySelector('#modal-actions-slot').append(cancelBtn, saveBtn);

  function validate() {
    let isValid = true;
    const clearErr = (id) => {
      const el = content.querySelector(`#${id}`);
      if (el) el.textContent = '';
    };
    const setErr = (id, msg, inputEl) => {
      const el = content.querySelector(`#${id}`);
      if (el) el.textContent = msg;
      isValid = false;
      inputEl?.focus();
    };

    clearErr('err-modal-name');
    clearErr('err-modal-phone');
    clearErr('err-modal-division');
    clearErr('err-modal-district');
    clearErr('err-modal-address');

    const nameVal = content.querySelector('#modal-rec-name').value.trim();
    const phoneVal = content.querySelector('#modal-rec-phone').value.trim();
    const addrVal = content.querySelector('#modal-address-line').value.trim();

    if (!nameVal) {
      setErr('err-modal-name', t('customer_addresses.validation_name', 'Please enter recipient name.'), content.querySelector('#modal-rec-name'));
    }
    if (!isValidBdPhone(phoneVal)) {
      setErr('err-modal-phone', t('customer_addresses.validation_phone', 'Enter valid BD phone (+8801...)'), content.querySelector('#modal-rec-phone'));
    }
    if (!division) {
      setErr('err-modal-division', t('customer_addresses.validation_division', 'Select division.'), divSelect);
    }
    if (!district) {
      setErr('err-modal-district', t('customer_addresses.validation_district', 'Select district.'), distSelect);
    }
    if (!addrVal) {
      setErr('err-modal-address', t('customer_addresses.validation_address', 'Enter detailed address.'), content.querySelector('#modal-address-line'));
    }

    return isValid;
  }

  modal = Modal({
    title: modalTitle,
    content,
    size: 'lg',
    closeOnEscape: true,
    closeOnScrim: true,
  });

  document.body.append(modal);
  modal.openModal();
}
