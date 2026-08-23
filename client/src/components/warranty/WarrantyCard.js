/**
 * WarrantyCard.js — Digital Warranty Certificate Card with Live Expiry Countdown (Prompt 10.4).
 *
 * Implements:
 * 1. Security guarantee certificate layout with verification seal.
 * 2. Live countdown timer with Days : Hours : Minutes breakdown.
 * 3. Serial / IMEI number identifier chip and copy helper.
 * 4. Bilingual coverage terms viewer.
 * 5. 1-click Claim button and secondary transfer button for eligible categories.
 */

import { t, getLanguage } from '../../services/i18n.js';
import { Button } from '../ui/Button.js';
import { Badge } from '../ui/Badge.js';

export function WarrantyCard({
  card,
  onClaimClick = null,
  onTransferClick = null,
  onViewClaimsClick = null,
} = {}) {
  const container = document.createElement('div');
  container.className = 'warranty-card';
  container.dataset.cardId = card.id;

  const locale = getLanguage();
  const title = locale === 'bn' ? (card.product_title_bn || card.title_bn || card.title_snapshot || card.product_title_en || card.title_en) : (card.product_title_en || card.title_en || card.title_snapshot);
  const terms = locale === 'bn' ? (card.coverage_terms_bn || card.coverage_terms_en) : (card.coverage_terms_en || card.coverage_terms_bn);

  const isActive = card.is_active !== false;
  const isTransferable = Boolean(card.is_transferable);
  const claims = card.claims || [];
  const activeClaim = claims.find((c) => ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS'].includes(c.status));

  container.innerHTML = `
    <div class="warranty-card__inner ${isActive ? 'warranty-card--active' : 'warranty-card--expired'}">
      <div class="warranty-card__header">
        <div class="warranty-card__cert-seal">
          <span class="warranty-card__shield-icon">🛡️</span>
          <div>
            <div class="warranty-card__cert-title">${t('warranty.official_certificate')}</div>
            <div class="warranty-card__ref text-xs font-mono text-muted">${card.ref}</div>
          </div>
        </div>
        <div class="warranty-card__status">
          ${isActive
            ? `<span class="badge badge--success">${t('warranty.active_coverage')}</span>`
            : `<span class="badge badge--gray">${t('warranty.coverage_expired')}</span>`}
          ${isTransferable ? `<span class="badge badge--info text-xs">${t('warranty.transferable')}</span>` : ''}
        </div>
      </div>

      <div class="warranty-card__body">
        <div class="warranty-card__product-row">
          <div class="warranty-card__thumb">
            <img src="${card.product_image || '/placeholder-product.svg'}" alt="${title}" onerror="this.src='/placeholder-product.svg'"/>
          </div>
          <div class="warranty-card__product-info">
            <h4 class="warranty-card__product-title">${title}</h4>
            <div class="warranty-card__meta-grid">
              <div class="warranty-meta-item">
                <span class="text-xs text-muted">${t('warranty.serial_number')}:</span>
                <span class="font-mono text-xs font-semibold select-all">${card.serial_number || 'N/A'}</span>
              </div>
              <div class="warranty-meta-item">
                <span class="text-xs text-muted">${t('warranty.supplier')}:</span>
                <span class="text-xs font-medium">${card.supplier_shop_name || card.supplier_name || 'Verified Partner'}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Live Countdown Timer -->
        <div class="warranty-countdown ${isActive ? '' : 'warranty-countdown--expired'}">
          <div class="warranty-countdown__header flex justify-between items-center text-xs">
            <span class="text-muted font-medium">${t('warranty.coverage_time_remaining')}:</span>
            <span class="font-medium ${isActive ? 'text-success' : 'text-danger'}">
              ${isActive ? `${t('warranty.expires_on')}: ${new Date(card.expires_at).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}` : t('warranty.expired')}
            </span>
          </div>
          <div class="warranty-countdown__digits" data-expires="${card.expires_at}">
            <div class="countdown-slot">
              <span class="countdown-val" data-unit="days">${String(card.remaining_days || 0).padStart(2, '0')}</span>
              <span class="countdown-label">${t('warranty.days')}</span>
            </div>
            <span class="countdown-sep">:</span>
            <div class="countdown-slot">
              <span class="countdown-val" data-unit="hours">${String(card.remaining_hours || 0).padStart(2, '0')}</span>
              <span class="countdown-label">${t('warranty.hours')}</span>
            </div>
            <span class="countdown-sep">:</span>
            <div class="countdown-slot">
              <span class="countdown-val" data-unit="minutes">${String(card.remaining_minutes || 0).padStart(2, '0')}</span>
              <span class="countdown-label">${t('warranty.mins')}</span>
            </div>
          </div>
          <div class="warranty-progress-bar">
            <div class="warranty-progress-fill" style="width: ${card.progress_percent || 0}%;"></div>
          </div>
        </div>

        <!-- Expandable Terms Accordion -->
        <details class="warranty-terms-details">
          <summary class="text-xs text-secondary font-medium cursor-pointer py-1">
            📜 ${t('warranty.view_coverage_terms')}
          </summary>
          <div class="warranty-terms-box text-xs text-muted p-2 mt-1 bg-surface-2 rounded">
            ${terms || t('warranty.standard_coverage_text')}
          </div>
        </details>

        ${activeClaim ? `
          <div class="warranty-active-claim-banner mt-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs flex justify-between items-center">
            <div>
              <span class="font-semibold text-amber-700 dark:text-amber-300">⚠️ ${t('warranty.claim_in_progress')}: #${activeClaim.ref}</span>
              <div class="text-muted text-xs">${t('warranty.status')}: <strong>${activeClaim.status}</strong></div>
            </div>
            <button class="btn btn--sm btn--secondary view-claim-btn" type="button">
              ${t('warranty.track_claim')}
            </button>
          </div>
        ` : ''}
      </div>

      <div class="warranty-card__footer flex items-center justify-between gap-2 pt-3 border-t border-subtle">
        <div class="warranty-card__actions-left flex gap-1">
          ${isTransferable && isActive ? `
            <button class="btn btn--sm btn--ghost transfer-btn" type="button" title="${t('warranty.transfer_tooltip')}">
              🔄 ${t('warranty.transfer')}
            </button>
          ` : ''}
          ${claims.length > 0 ? `
            <button class="btn btn--sm btn--ghost history-btn" type="button">
              📋 ${t('warranty.claim_history')} (${claims.length})
            </button>
          ` : ''}
        </div>
        <div class="warranty-card__actions-right">
          ${isActive && !activeClaim ? `
            <button class="btn btn--sm btn--primary claim-btn" type="button">
              🛡️ ${t('warranty.file_claim_btn')}
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  // Attach event handlers
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

  // Live timer interval for remaining time countdown
  if (isActive) {
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
    }, 30000); // update every 30s
  }

  return container;
}
