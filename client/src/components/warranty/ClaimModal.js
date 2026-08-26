/**
 * ClaimModal.js — Customer 1-Click Warranty Claim Submission Dialog (Prompt 10.4).
 */

import { t } from '../../services/i18n.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { Button } from '../ui/Button.js';
import { Textarea } from '../ui/Textarea.js';
import { Select } from '../ui/Select.js';

export function openClaimModal({ card, onSuccess = null } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal modal--md';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const title = card.product_title_en || card.title_en || card.title_snapshot || 'Product';

  modal.innerHTML = `
    <div class="modal__header flex justify-between items-center pb-3 border-b border-subtle">
      <div>
        <h3 class="modal__title font-semibold text-lg">🛡️ ${t('warranty.file_claim_title')}</h3>
        <p class="text-xs text-muted">Card #${card.ref} • Serial: ${card.serial_number || 'N/A'}</p>
      </div>
      <button class="btn-close" type="button" aria-label="Close">✕</button>
    </div>

    <form class="modal__body py-4 space-y-3" id="claim-form">
      <div class="product-summary-bar p-2 rounded bg-surface-2 flex items-center gap-3">
        <img src="${card.product_image || '/placeholder-product.svg'}" class="w-10 h-10 object-cover rounded" alt="${title}" onerror="this.src='/placeholder-product.svg'"/>
        <div class="text-xs">
          <div class="font-semibold text-primary line-clamp-1">${title}</div>
          <div class="text-muted">${t('warranty.supplier')}: ${card.supplier_shop_name || card.supplier_name || 'Verified Partner'}</div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label text-xs font-semibold block mb-1">
          ${t('warranty.describe_the_defect')} <span class="text-danger">*</span>
        </label>
        <textarea
          name="issue_description"
          rows="4"
          required
          minlength="10"
          class="form-control text-sm w-full p-2 rounded border border-subtle bg-surface"
          placeholder="${t('warranty.defect_placeholder')}"
        ></textarea>
        <span class="text-xs text-muted mt-1 block">${t('warranty.defect_min_chars')}</span>
      </div>

      <div class="form-group">
        <label class="form-label text-xs font-semibold block mb-1">
          ${t('warranty.preferred_resolution')}
        </label>
        <select name="preferred_resolution" class="form-control text-sm w-full p-2 rounded border border-subtle bg-surface">
          <option value="REPAIR" selected>🔧 ${t('warranty.resolution_repair')}</option>
          <option value="REPLACE">📦 ${t('warranty.resolution_replace')}</option>
          <option value="REFUND">💰 ${t('warranty.resolution_refund')}</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label text-xs font-semibold block mb-1">
          ${t('warranty.evidence_images')}
        </label>
        <input
          type="text"
          name="evidence_url"
          class="form-control text-sm w-full p-2 rounded border border-subtle bg-surface"
          placeholder="https://example.com/photo-of-defect.jpg"
        />
        <span class="text-xs text-muted mt-1 block">${t('warranty.evidence_hint')}</span>
      </div>

      <div class="sla-notice p-2 rounded bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-900 dark:text-indigo-200">
        ℹ️ <strong>${t('warranty.sla_guarantee_title')}:</strong> ${t('warranty.sla_guarantee_text')}
      </div>

      <div class="modal__footer flex justify-end gap-2 pt-4 border-t border-subtle">
        <button type="button" class="btn btn--secondary btn-cancel">${t('common.cancel')}</button>
        <button type="submit" class="btn btn--primary btn-submit">
          🛡️ ${t('warranty.submit_claim_btn')}
        </button>
      </div>
    </form>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
  };

  modal.querySelector('.btn-close').addEventListener('click', close);
  modal.querySelector('.btn-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const form = modal.querySelector('#claim-form');
  const submitBtn = modal.querySelector('.btn-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const issueDescription = formData.get('issue_description')?.toString().trim();
    const preferredResolution = formData.get('preferred_resolution')?.toString();
    const evidenceUrl = formData.get('evidence_url')?.toString().trim();

    if (!issueDescription || issueDescription.length < 10) {
      toast.error(t('warranty.defect_min_chars_error'));
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t('common.submitting');

    try {
      const payload = {
        issue_description: issueDescription,
        preferred_resolution: preferredResolution || 'REPAIR',
        evidence_media: evidenceUrl ? [evidenceUrl] : [],
      };

      const res = await api.post(`/warranties/${card.id}/claim`, payload);

      toast.success(t('warranty.claim_submitted_success'));
      close();
      if (onSuccess) onSuccess(res.data);
    } catch (err) {
      toast.error(err.message || t('warranty.claim_submit_error'));
      submitBtn.disabled = false;
      submitBtn.textContent = `🛡️ ${t('warranty.submit_claim_btn')}`;
    }
  });
}
