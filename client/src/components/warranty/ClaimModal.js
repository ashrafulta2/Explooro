/**
 * ClaimModal.js — Customer 1-Click Warranty Claim Submission Dialog (Prompt 10.4).
 */

import { t, getLanguage } from '../../services/i18n.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';

export function openClaimModal({ card, onSuccess = null } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'cert-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'cert-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const locale = getLanguage();
  const title = locale === 'bn'
    ? (card.product_title_bn || card.title_bn || card.title_snapshot || card.product_title_en || card.title_en || 'Product')
    : (card.product_title_en || card.title_en || card.title_snapshot || 'Product');

  const certRef = card.ref || `WAR-${card.serial_number ? card.serial_number.slice(-8) : card.id || '2026-001'}`;

  modal.innerHTML = `
    <div class="cert-modal__header">
      <div>
        <h3 class="cert-modal__title">
          <span>🛡️</span> ${t('warranty.file_claim_title')}
        </h3>
        <p class="text-xs text-muted" style="margin: 2px 0 0; font-size: 11px;">
          ${t('warranty.claim_ref')}: <strong>#${certRef}</strong> • ${t('warranty.serial_number')}: <span style="font-family: monospace;">${card.serial_number || 'N/A'}</span>
        </p>
      </div>
      <button class="btn-close" type="button" aria-label="${t('common.close')}" style="background:none; border:none; font-size:18px; cursor:pointer; color:var(--text-muted);">✕</button>
    </div>

    <form class="modal__body" id="claim-form" style="padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4);">
      <!-- Product Summary Banner -->
      <div style="background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 10px 12px; display: flex; align-items: center; gap: 12px;">
        <img
          src="${card.product_image || card.image_url || '/placeholder-product.svg'}"
          style="width: 44px; height: 44px; border-radius: var(--radius-md); object-fit: cover; border: 1px solid var(--border-subtle); flex-shrink: 0;"
          alt="${title}"
          onerror="this.src='/placeholder-product.svg'"
        />
        <div style="min-width: 0; flex: 1;">
          <div style="font-size: 12px; font-weight: 800; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${title}
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
            ${t('warranty.supplier')}: <strong>${card.supplier_shop_name || card.supplier_name || 'Verified Partner'}</strong>
          </div>
        </div>
      </div>

      <!-- Preferred Resolution Cards -->
      <div class="form-group" style="display: flex; flex-direction: column; gap: 4px;">
        <label style="font-size: 12px; font-weight: 700; color: var(--text-primary);">
          ${t('warranty.preferred_resolution')}
        </label>
        <div class="claim-resolutions-grid">
          <label class="claim-resolution-card claim-resolution-card--selected" data-value="REPAIR">
            <input type="radio" name="preferred_resolution" value="REPAIR" checked style="display: none;" />
            <span class="claim-resolution-card__icon">🔧</span>
            <span class="claim-resolution-card__label">${t('warranty.resolution_repair')}</span>
            <span class="claim-resolution-card__desc">${t('warranty.resolution_repair_desc') || 'Free official parts & certified repair'}</span>
          </label>
          <label class="claim-resolution-card" data-value="REPLACE">
            <input type="radio" name="preferred_resolution" value="REPLACE" style="display: none;" />
            <span class="claim-resolution-card__icon">📦</span>
            <span class="claim-resolution-card__label">${t('warranty.resolution_replace')}</span>
            <span class="claim-resolution-card__desc">${t('warranty.resolution_replace_desc') || 'Replacement unit for unfixable defect'}</span>
          </label>
          <label class="claim-resolution-card" data-value="REFUND">
            <input type="radio" name="preferred_resolution" value="REFUND" style="display: none;" />
            <span class="claim-resolution-card__icon">💰</span>
            <span class="claim-resolution-card__label">${t('warranty.resolution_refund')}</span>
            <span class="claim-resolution-card__desc">${t('warranty.resolution_refund_desc') || 'Store credit or wallet refund'}</span>
          </label>
        </div>
      </div>

      <!-- Defect Description -->
      <div class="form-group" style="display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <label style="font-size: 12px; font-weight: 700; color: var(--text-primary);">
            ${t('warranty.describe_the_defect')} <span style="color: var(--danger);">*</span>
          </label>
          <span class="char-count" style="font-size: 11px; color: var(--text-muted);">0 / 10 min</span>
        </div>
        <textarea
          name="issue_description"
          rows="3"
          required
          minlength="10"
          style="padding: 10px 12px; font-size: 13px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-1); color: var(--text-primary); outline: none; resize: vertical;"
          placeholder="${t('warranty.defect_placeholder')}"
        ></textarea>
        <span style="font-size: 11px; color: var(--text-muted);">${t('warranty.defect_min_chars')}</span>
      </div>

      <!-- Proof Image URL -->
      <div class="form-group" style="display: flex; flex-direction: column; gap: 4px;">
        <label style="font-size: 12px; font-weight: 700; color: var(--text-primary);">
          ${t('warranty.evidence_images')}
        </label>
        <input
          type="text"
          name="evidence_url"
          style="height: 38px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-1); color: var(--text-primary); outline: none;"
          placeholder="https://example.com/photo-of-defect.jpg"
        />
        <span style="font-size: 11px; color: var(--text-muted);">${t('warranty.evidence_hint')}</span>
      </div>

      <!-- SLA Commitment Box -->
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: var(--radius-lg); padding: 10px 12px; font-size: 11px; color: #1e40af; line-height: 1.4;">
        ℹ️ <strong>${t('warranty.sla_guarantee_title')}:</strong> ${t('warranty.sla_guarantee_text')}
      </div>

      <div class="cert-modal__footer" style="padding: var(--space-4) 0 0; border-top: 1px solid var(--border-subtle); margin-top: var(--space-2);">
        <button type="button" class="btn btn--secondary btn-cancel" style="padding: 8px 16px; border-radius: var(--radius-full); font-size: 12px; font-weight: 700; cursor: pointer;">
          ${t('common.cancel')}
        </button>
        <button type="submit" class="btn btn--primary btn-submit" style="padding: 8px 18px; border-radius: var(--radius-full); font-size: 12px; font-weight: 800; background: var(--brand); border: 1px solid var(--brand); color: var(--brand-contrast); cursor: pointer;">
          🛡️ ${t('warranty.submit_claim_btn')}
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

  // Radio cards toggle
  const resolutionCards = modal.querySelectorAll('.claim-resolution-card');
  resolutionCards.forEach((cardEl) => {
    cardEl.addEventListener('click', () => {
      resolutionCards.forEach((c) => c.classList.remove('claim-resolution-card--selected'));
      cardEl.classList.add('claim-resolution-card--selected');
      const radio = cardEl.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  // Character counter
  const textarea = modal.querySelector('textarea[name="issue_description"]');
  const charCount = modal.querySelector('.char-count');
  if (textarea && charCount) {
    textarea.addEventListener('input', () => {
      const len = textarea.value.trim().length;
      charCount.textContent = `${len} / 10 min`;
      charCount.style.color = len >= 10 ? 'var(--success, #16a34a)' : 'var(--text-muted)';
    });
  }

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
