/**
 * ClaimTimeline.js — Visual Stage Stepper for Warranty Claim Lifecycle (Prompt 10.4).
 *
 * Visualizes:
 * 1. SUBMITTED (Timestamp & 72-hour SLA deadline).
 * 2. UNDER_REVIEW (Supplier inspection of customer evidence).
 * 3. APPROVED / REJECTED (Resolution: Repair, Replace, Refund + Reverse courier tracking).
 * 4. IN_PROGRESS (Workshop service / Replacement parcel in transit).
 * 5. COMPLETED / RESOLVED.
 */

import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

export function ClaimTimeline({ claim, isSupplier = false } = {}) {
  const container = document.createElement('div');
  container.className = 'claim-timeline';

  if (!claim) {
    container.innerHTML = `<div class="text-sm text-muted p-4 text-center">${t('warranty.no_claim_data')}</div>`;
    return container;
  }

  const locale = getLanguage();
  const steps = [
    { key: 'SUBMITTED', label: t('warranty.step_submitted'), icon: '📝' },
    { key: 'UNDER_REVIEW', label: t('warranty.step_under_review'), icon: '🔍' },
    { key: 'APPROVED', label: t('warranty.step_decided'), icon: claim.status === 'REJECTED' ? '❌' : '✅' },
    { key: 'IN_PROGRESS', label: t('warranty.step_in_progress'), icon: '🔧' },
    { key: 'COMPLETED', label: t('warranty.step_completed'), icon: '🎉' },
  ];

  const statusOrder = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS', 'COMPLETED'];
  const currentIndex = claim.status === 'REJECTED'
    ? 2
    : (claim.status === 'ESCALATED' ? 1 : Math.max(0, statusOrder.indexOf(claim.status)));

  const isRejected = claim.status === 'REJECTED';
  const isEscalated = claim.status === 'ESCALATED';

  container.innerHTML = `
    <div class="claim-timeline__wrapper card p-5" style="border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); background: var(--surface-0);">
      <div class="claim-timeline__header flex justify-between items-center pb-3 border-b border-subtle mb-4" style="border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-family: var(--font-mono, monospace); font-size: 14px; font-weight: 800; color: var(--text-primary);">
            Claim #${claim.ref || claim.id}
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
            ${t('warranty.filed_on')}: ${new Date(claim.created_at || Date.now()).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
          </div>
        </div>
        <div>
          ${isEscalated ? `
            <span class="badge badge--danger" style="font-size: 11px; font-weight: 800;">🚨 ${t('warranty.status_escalated')}</span>
          ` : isRejected ? `
            <span class="badge badge--danger" style="font-size: 11px; font-weight: 800;">❌ ${t('warranty.status_rejected')}</span>
          ` : `
            <span class="badge badge--primary" style="font-size: 11px; font-weight: 800;">● ${claim.status}</span>
          `}
        </div>
      </div>

      <!-- Stepper Track -->
      <div class="claim-stepper">
        <div class="claim-stepper__track-bg"></div>
        <div class="claim-stepper__track-fill" style="width: ${(currentIndex / (steps.length - 1)) * 100}%;"></div>

        ${steps.map((step, idx) => {
          const isDone = idx < currentIndex || (idx === currentIndex && claim.status === 'COMPLETED');
          const isCurrent = idx === currentIndex && claim.status !== 'COMPLETED';
          return `
            <div class="claim-step ${isDone ? 'claim-step--done' : ''} ${isCurrent ? 'claim-step--current' : ''}">
              <div class="claim-step__node">
                ${step.icon}
              </div>
              <span class="claim-step__label">${step.label}</span>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Claim Details Panel -->
      <div class="claim-details-panel" style="background: var(--surface-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl); padding: 14px; margin-top: 16px; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
          <div>
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">${t('warranty.issue_description')}:</span>
            <p style="font-size: 13px; font-weight: 600; color: var(--text-primary); margin: 3px 0 0; line-height: 1.4;">
              ${claim.issue_description || 'N/A'}
            </p>
          </div>
          <div>
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">${t('warranty.preferred_resolution')}:</span>
            <p style="margin: 3px 0 0;">
              <span class="badge badge--info" style="font-size: 11px; font-weight: 800;">
                ${claim.resolution || claim.preferred_resolution || 'REPAIR'}
              </span>
            </p>
          </div>
        </div>

        ${claim.sla_due_at ? `
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: var(--radius-md); background: var(--surface-0); border: 1px solid var(--border-subtle); font-size: 11px;">
            <span style="color: var(--text-muted); font-weight: 600;">⏱️ ${t('warranty.supplier_sla_deadline')}:</span>
            <span style="font-family: var(--font-mono, monospace); font-weight: 800; color: ${claim.is_sla_breached ? 'var(--danger)' : 'var(--text-primary)'};">
              ${new Date(claim.sla_due_at).toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB')}
              ${claim.is_sla_breached ? `(${t('warranty.sla_breached')})` : ''}
            </span>
          </div>
        ` : ''}

        ${claim.reverse_tracking_number ? `
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: var(--radius-lg); padding: 10px 12px; font-size: 12px; color: #166534;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>🚚 ${t('warranty.reverse_courier_booked')}</strong>
              <span class="badge badge--emerald" style="font-size: 10px;">${claim.reverse_courier || 'Courier'}</span>
            </div>
            <div style="font-family: var(--font-mono, monospace); margin-top: 4px; display: flex; align-items: center; gap: 6px;">
              <span>${t('warranty.tracking_number')}: <strong>${claim.reverse_tracking_number}</strong></span>
              <button class="copy-tracking-btn" type="button" style="background:none; border:none; cursor:pointer; font-size:12px;" title="Copy">📋</button>
            </div>
            <div style="font-size: 11px; opacity: 0.85; margin-top: 2px;">
              ${t('warranty.reverse_pickup_instructions')}
            </div>
          </div>
        ` : ''}

        ${claim.rejection_reason ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: var(--radius-lg); padding: 10px 12px; font-size: 12px; color: #991b1b;">
            <strong>❌ ${t('warranty.rejection_reason')}:</strong>
            <p style="margin: 3px 0 0; font-size: 11px;">${claim.rejection_reason}</p>
          </div>
        ` : ''}

        ${Array.isArray(claim.evidence_media) && claim.evidence_media.length > 0 ? `
          <div style="border-top: 1px solid var(--border-subtle); padding-top: 8px; margin-top: 4px;">
            <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 6px;">
              ${t('warranty.customer_evidence_media')}:
            </span>
            <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px;">
              ${claim.evidence_media.map((url, i) => `
                <a href="${url}" target="_blank" rel="noopener noreferrer">
                  <img src="${url}" alt="Proof ${i+1}" style="width: 52px; height: 52px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-subtle);" onerror="this.src='/placeholder-img.svg'"/>
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  const copyTrackingBtn = container.querySelector('.copy-tracking-btn');
  if (copyTrackingBtn && claim.reverse_tracking_number) {
    copyTrackingBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(claim.reverse_tracking_number).then(() => {
        toast.success(`Tracking number ${claim.reverse_tracking_number} copied!`);
      }).catch(() => {});
    });
  }

  return container;
}
