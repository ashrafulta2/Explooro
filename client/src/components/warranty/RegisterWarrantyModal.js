/**
 * RegisterWarrantyModal.js — Customer Manual / Offline Warranty Registration Dialog (Prompt 10.4).
 *
 * Allows users to register a product warranty purchased offline or with an invoice/serial number.
 */

import { t } from '../../services/i18n.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';

export function openRegisterWarrantyModal({ onSuccess = null } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'cert-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'cert-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  modal.innerHTML = `
    <div class="cert-modal__header">
      <h3 class="cert-modal__title">
        <span>➕</span> ${t('warranty.register_warranty_title') || 'Register Product Warranty'}
      </h3>
      <button class="btn-close" type="button" aria-label="${t('common.close')}" style="background:none; border:none; font-size:18px; cursor:pointer; color:var(--text-muted);">✕</button>
    </div>

    <form class="modal__body" id="register-warranty-form" style="padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4);">
      <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">
        ${t('warranty.register_warranty_desc') || 'Enter your purchase invoice reference and product serial number to activate your digital guarantee card.'}
      </div>

      <div class="form-group" style="display: flex; flex-direction: column; gap: 4px;">
        <label class="form-label" style="font-size: 12px; font-weight: 700; color: var(--text-primary);">
          ${t('warranty.order_or_invoice_ref') || 'Order / Invoice Reference'} <span style="color: var(--danger);">*</span>
        </label>
        <input
          type="text"
          name="invoice_ref"
          required
          placeholder="e.g. EXP-ORD-2026-8812 or INV-9901"
          style="height: 38px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-1); color: var(--text-primary); outline: none;"
        />
      </div>

      <div class="form-group" style="display: flex; flex-direction: column; gap: 4px;">
        <label class="form-label" style="font-size: 12px; font-weight: 700; color: var(--text-primary);">
          ${t('warranty.serial_number') || 'Serial Number / IMEI'} <span style="color: var(--danger);">*</span>
        </label>
        <input
          type="text"
          name="serial_number"
          required
          placeholder="e.g. SN-WALT-8899-2026"
          style="height: 38px; padding: 0 12px; font-size: 13px; font-family: var(--font-mono, monospace); font-weight: 600; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-1); color: var(--text-primary); outline: none;"
        />
        <span style="font-size: 11px; color: var(--text-muted);">${t('warranty.serial_hint') || 'Located on the product box, barcode sticker, or back panel.'}</span>
      </div>

      <div class="form-group" style="display: flex; flex-direction: column; gap: 4px;">
        <label class="form-label" style="font-size: 12px; font-weight: 700; color: var(--text-primary);">
          ${t('warranty.product_name') || 'Product / Brand Name'} <span style="color: var(--danger);">*</span>
        </label>
        <input
          type="text"
          name="product_title"
          required
          placeholder="e.g. Walton Smart TV 43 inch"
          style="height: 38px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-1); color: var(--text-primary); outline: none;"
        />
      </div>

      <div class="form-group" style="display: flex; flex-direction: column; gap: 4px;">
        <label class="form-label" style="font-size: 12px; font-weight: 700; color: var(--text-primary);">
          ${t('warranty.purchase_date') || 'Purchase Date'}
        </label>
        <input
          type="date"
          name="purchase_date"
          value="${new Date().toISOString().split('T')[0]}"
          style="height: 38px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-1); color: var(--text-primary); outline: none;"
        />
      </div>

      <div class="cert-modal__footer" style="padding: var(--space-4) 0 0; border-top: 1px solid var(--border-subtle); margin-top: var(--space-2);">
        <button type="button" class="btn btn--secondary btn-cancel" style="padding: 8px 16px; border-radius: var(--radius-full); font-size: 12px; font-weight: 700; cursor: pointer;">
          ${t('common.cancel')}
        </button>
        <button type="submit" class="btn btn--primary btn-submit" style="padding: 8px 18px; border-radius: var(--radius-full); font-size: 12px; font-weight: 800; background: var(--brand); border: 1px solid var(--brand); color: var(--brand-contrast); cursor: pointer;">
          🛡️ ${t('warranty.activate_warranty_btn') || 'Activate Warranty'}
        </button>
      </div>
    </form>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();

  modal.querySelector('.btn-close').addEventListener('click', close);
  modal.querySelector('.btn-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const form = modal.querySelector('#register-warranty-form');
  const submitBtn = modal.querySelector('.btn-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const invoiceRef = formData.get('invoice_ref')?.toString().trim();
    const serialNumber = formData.get('serial_number')?.toString().trim();
    const productTitle = formData.get('product_title')?.toString().trim();
    const purchaseDate = formData.get('purchase_date')?.toString().trim();

    if (!invoiceRef || !serialNumber || !productTitle) {
      toast.error(t('warranty.fill_required_fields') || 'Please fill in all required fields.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t('common.submitting') || 'Activating...';

    try {
      const res = await api.post('/warranties/register', {
        invoice_ref: invoiceRef,
        serial_number: serialNumber,
        product_title: productTitle,
        purchase_date: purchaseDate,
      });

      toast.success(t('warranty.registered_success') || 'Digital warranty card registered and activated successfully!');
      close();
      if (onSuccess) onSuccess(res.data);
    } catch (err) {
      toast.error(err.message || t('warranty.register_error') || 'Failed to register warranty.');
      submitBtn.disabled = false;
      submitBtn.textContent = `🛡️ ${t('warranty.activate_warranty_btn') || 'Activate Warranty'}`;
    }
  });
}
