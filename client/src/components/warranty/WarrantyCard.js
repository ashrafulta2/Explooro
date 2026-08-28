/**
 * WarrantyCard.js — Digital Warranty Certificate Card with Live Expiry Countdown (Prompt 10.4).
 *
 * Implements:
 * 1. Security guarantee certificate layout with verification seal.
 * 2. Live countdown timer with Days : Hours : Minutes breakdown.
 * 3. Serial / IMEI number identifier chip and 1-click copy helper.
 * 4. Bilingual coverage terms viewer.
 * 5. 1-click Claim button, official Certificate viewer, and secondary transfer.
 */

import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { openCertificateModal } from './CertificateModal.js';

export function WarrantyCard({
  card,
  onClaimClick = null,
  onTransferClick = null,
  onViewClaimsClick = null,
  onViewCertificateClick = null,
} = {}) {
  const container = document.createElement('div');
  container.className = 'warranty-card';
  container.dataset.cardId = card.id;

  const locale = getLanguage();
  const title = locale === 'bn'
    ? (card.product_title_bn || card.title_bn || card.title_snapshot || card.product_title_en || card.title_en || 'Product')
    : (card.product_title_en || card.title_en || card.title_snapshot || 'Product');

  const terms = locale === 'bn'
    ? (card.coverage_terms_bn || card.coverage_terms_en || t('warranty.standard_coverage_text'))
    : (card.coverage_terms_en || card.coverage_terms_bn || t('warranty.standard_coverage_text'));

  const isActive = card.is_active !== false && card.status !== 'EXPIRED';
  const isTransferable = Boolean(card.is_transferable);
  const claims = card.claims || [];
  const activeClaim = claims.find((c) => ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS'].includes(c.status));

  const certRef = card.ref || `WAR-${card.serial_number ? card.serial_number.slice(-8) : card.id || '2026-001'}`;
  const remainingDays = card.remaining_days ?? (card.expires_at ? Math.max(0, Math.floor((new Date(card.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0);
  const remainingHours = card.remaining_hours ?? (card.expires_at ? Math.max(0, Math.floor(((new Date(card.expires_at).getTime() - Date.now()) % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))) : 0);
  const remainingMinutes = card.remaining_minutes ?? (card.expires_at ? Math.max(0, Math.floor(((new Date(card.expires_at).getTime() - Date.now()) % (1000 * 60 * 60)) / (1000 * 60))) : 0);
  const isUrgent = isActive && remainingDays < 30;

  // Calculate elapsed progress percentage
  let progressPercent = card.progress_percent;
  if (progressPercent === undefined && card.starts_at && card.expires_at) {
    const totalMs = Math.max(1, new Date(card.expires_at).getTime() - new Date(card.starts_at).getTime());
    const elapsedMs = Math.min(totalMs, Math.max(0, Date.now() - new Date(card.starts_at).getTime()));
    progressPercent = Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));
  }
  progressPercent = progressPercent || (isActive ? 65 : 100);

  container.innerHTML = `
    <div class="warranty-card__header">
      <div class="warranty-card__cert-seal">
        <div class="warranty-card__shield-icon">🛡️</div>
        <div>
          <div class="warranty-card__cert-title">${t('warranty.official_certificate')}</div>
          <button class="warranty-card__ref-chip copy-ref-btn" type="button" title="${t('common.copy') || 'Copy ID'}">
            <span>${certRef}</span>
            <span style="font-size: 9px; opacity: 0.7;">📋</span>
          </button>
        </div>
      </div>
      <div class="warranty-card__status-wrap">
        ${isActive
          ? `<span class="badge ${isUrgent ? 'badge--warning' : 'badge--success'}" style="font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: var(--radius-full);">
              ${isUrgent ? '⚠️ ' + t('warranty.expiring_soon') : '● ' + t('warranty.active_coverage')}
             </span>`
          : `<span class="badge badge--gray" style="font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: var(--radius-full);">${t('warranty.coverage_expired')}</span>`}
        ${isTransferable ? `<span class="badge badge--info" style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: var(--radius-full);">${t('warranty.transferable')}</span>` : ''}
      </div>
    </div>

    <div class="warranty-card__body">
      <div class="warranty-card__product-row">
        <div class="warranty-card__thumb-wrap">
          <img
            src="${card.product_image || card.image_url || '/placeholder-product.svg'}"
            alt="${title}"
            class="warranty-card__thumb"
            onerror="this.src='/placeholder-product.svg'"
          />
        </div>
        <div class="warranty-card__product-info">
          <h4 class="warranty-card__product-title" title="${title}">${title}</h4>
          <div class="warranty-card__supplier-tag">
            <span>✓</span> ${t('warranty.supplier')}: <strong>${card.supplier_shop_name || card.supplier_name || 'Verified Partner'}</strong>
          </div>
        </div>
      </div>

      <!-- Identifier Details Grid -->
      <div class="warranty-card__meta-grid">
        <div class="warranty-meta-item">
          <span class="warranty-meta-item__label">${t('warranty.serial_number')}</span>
          <div class="warranty-meta-item__val">
            <span class="serial-text select-all">${card.serial_number || 'N/A'}</span>
            ${card.serial_number ? `<button class="warranty-meta-item__btn-copy copy-sn-btn" type="button" title="Copy Serial">📋</button>` : ''}
          </div>
        </div>
        <div class="warranty-meta-item">
          <span class="warranty-meta-item__label">${t('warranty.coverage_months') || 'Duration'}</span>
          <span class="warranty-meta-item__val" style="font-family: inherit;">
            ${card.duration_months || card.warranty_months || '12'} ${t('warranty.months') || 'Months'}
          </span>
        </div>
      </div>

      <!-- Live Countdown Timer -->
      <div class="warranty-countdown ${isUrgent ? 'warranty-countdown--urgent' : (!isActive ? 'warranty-countdown--expired' : '')}">
        <div class="warranty-countdown__header">
          <span class="text-muted font-medium">⏱️ ${t('warranty.coverage_time_remaining')}:</span>
          <span class="warranty-countdown__status ${isActive ? (isUrgent ? 'warranty-countdown__status--urgent' : 'warranty-countdown__status--active') : 'warranty-countdown__status--expired'}">
            ${isActive
              ? `${t('warranty.expires_on')}: ${new Date(card.expires_at).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}`
              : t('warranty.expired')}
          </span>
        </div>

        <div class="warranty-countdown__digits" data-expires="${card.expires_at}">
          <div class="countdown-slot">
            <span class="countdown-val" data-unit="days">${String(remainingDays).padStart(2, '0')}</span>
            <span class="countdown-label">${t('warranty.days')}</span>
          </div>
          <span class="countdown-sep">:</span>
          <div class="countdown-slot">
            <span class="countdown-val" data-unit="hours">${String(remainingHours).padStart(2, '0')}</span>
            <span class="countdown-label">${t('warranty.hours')}</span>
          </div>
          <span class="countdown-sep">:</span>
          <div class="countdown-slot">
            <span class="countdown-val" data-unit="minutes">${String(remainingMinutes).padStart(2, '0')}</span>
            <span class="countdown-label">${t('warranty.mins')}</span>
          </div>
        </div>

        <div class="warranty-progress-bar">
          <div class="warranty-progress-fill ${isUrgent ? 'warranty-progress-fill--urgent' : (!isActive ? 'warranty-progress-fill--expired' : '')}" style="width: ${progressPercent}%;"></div>
        </div>
      </div>

      <!-- Expandable Terms Accordion -->
      <details class="warranty-terms-details">
        <summary>
          <span>📜 ${t('warranty.view_coverage_terms')}</span>
        </summary>
        <div class="warranty-terms-box">
          ${terms}
        </div>
      </details>

      ${activeClaim ? `
        <div class="warranty-active-claim-banner">
          <div>
            <div class="warranty-active-claim-banner__title">⚠️ ${t('warranty.claim_in_progress')}: #${activeClaim.ref || activeClaim.id}</div>
            <div class="warranty-active-claim-banner__sub">${t('warranty.status')}: <strong>${activeClaim.status}</strong></div>
          </div>
          <button class="warranty-btn warranty-btn--secondary view-claim-btn" type="button">
            ${t('warranty.track_claim')}
          </button>
        </div>
      ` : ''}
    </div>

    <div class="warranty-card__footer">
      <div class="warranty-card__actions-left">
        <button class="warranty-btn warranty-btn--secondary view-cert-btn" type="button" title="${t('warranty.view_certificate') || 'View Certificate'}">
          📄 ${t('warranty.certificate') || 'Certificate'}
        </button>
        ${isTransferable && isActive ? `
          <button class="warranty-btn warranty-btn--ghost transfer-btn" type="button" title="${t('warranty.transfer_tooltip')}">
            🔄 ${t('warranty.transfer')}
          </button>
        ` : ''}
        ${claims.length > 0 && !activeClaim ? `
          <button class="warranty-btn warranty-btn--ghost history-btn" type="button">
            📋 (${claims.length})
          </button>
        ` : ''}
      </div>
      <div class="warranty-card__actions-right">
        ${isActive && !activeClaim ? `
          <button class="warranty-btn warranty-btn--primary claim-btn" type="button">
            🛡️ ${t('warranty.file_claim_btn')}
          </button>
        ` : ''}
      </div>
    </div>
  `;

  // Attach event handlers
  const copyRefBtn = container.querySelector('.copy-ref-btn');
  if (copyRefBtn) {
    copyRefBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(certRef).then(() => {
        toast.success(t('warranty.ref_copied') || `Certificate ID #${certRef} copied!`);
      }).catch(() => {});
    });
  }

  const copySnBtn = container.querySelector('.copy-sn-btn');
  if (copySnBtn && card.serial_number) {
    copySnBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(card.serial_number).then(() => {
        toast.success(t('warranty.serial_copied') || `Serial #${card.serial_number} copied!`);
      }).catch(() => {});
    });
  }

  const viewCertBtn = container.querySelector('.view-cert-btn');
  if (viewCertBtn) {
    viewCertBtn.addEventListener('click', () => {
      if (onViewCertificateClick) {
        onViewCertificateClick(card);
      } else {
        openCertificateModal({ card });
      }
    });
  }

  const claimBtn = container.querySelector('.claim-btn');
  if (claimBtn && onClaimClick) {
    claimBtn.addEventListener('click', () => onClaimClick(card));
  }

  const transferBtn = container.querySelector('.transfer-btn');
  if (transferBtn && onTransferClick) {
    transferBtn.addEventListener('click', () => onTransferClick(card));
  }

  const viewClaimBtn = container.querySelector('.view-claim-btn');
  if (viewClaimBtn && onViewClaimsClick) {
    viewClaimBtn.addEventListener('click', () => onViewClaimsClick(card));
  }

  const historyBtn = container.querySelector('.history-btn');
  if (historyBtn && onViewClaimsClick) {
    historyBtn.addEventListener('click', () => onViewClaimsClick(card));
  }

  // Live timer interval
  if (isActive && card.expires_at) {
    const digitsContainer = container.querySelector('.warranty-countdown__digits');
    const expiresMs = new Date(card.expires_at).getTime();

    const intervalId = setInterval(() => {
      const remainingMs = Math.max(0, expiresMs - Date.now());
      if (remainingMs <= 0) {
        clearInterval(intervalId);
        return;
      }
      const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

      const dayEl = digitsContainer?.querySelector('[data-unit="days"]');
      const hrEl = digitsContainer?.querySelector('[data-unit="hours"]');
      const minEl = digitsContainer?.querySelector('[data-unit="minutes"]');

      if (dayEl) dayEl.textContent = String(days).padStart(2, '0');
      if (hrEl) hrEl.textContent = String(hours).padStart(2, '0');
      if (minEl) minEl.textContent = String(minutes).padStart(2, '0');
    }, 30000);
  }

  return container;
}
