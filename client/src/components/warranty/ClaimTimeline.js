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

import { t } from '../../services/i18n.js';

export function ClaimTimeline({ claim, isSupplier = false } = {}) {
  const container = document.createElement('div');
  container.className = 'claim-timeline';

  if (!claim) {
    container.innerHTML = `<div class="text-sm text-muted p-4 text-center">${t('warranty.no_claim_data')}</div>`;
    return container;
  }

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
    <div class="claim-timeline__wrapper card p-4">
      <div class="claim-timeline__header flex justify-between items-center pb-3 border-b border-subtle mb-4">
        <div>
          <span class="font-mono text-sm font-semibold">Claim #${claim.ref}</span>
          <div class="text-xs text-muted">
            ${t('warranty.filed_on')}: ${new Date(claim.created_at).toLocaleDateString()}
          </div>
        </div>
        <div>
          ${isEscalated ? `
            <span class="badge badge--danger">🚨 ${t('warranty.status_escalated')}</span>
          ` : isRejected ? `
            <span class="badge badge--danger">❌ ${t('warranty.status_rejected')}</span>
          ` : `
            <span class="badge badge--primary">${claim.status}</span>
          `}
        </div>
      </div>

      <!-- Stepper Track -->
      <div class="claim-stepper flex items-center justify-between relative mb-6">
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
      <div class="claim-details-panel bg-surface-2 p-3 rounded text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <div>
            <span class="text-muted">${t('warranty.issue_description')}:</span>
            <p class="font-medium mt-0.5">${claim.issue_description || 'N/A'}</p>
          </div>
          <div>
            <span class="text-muted">${t('warranty.preferred_resolution')}:</span>
            <p class="font-medium mt-0.5">
              <span class="badge badge--info">${claim.resolution || claim.preferred_resolution || 'REPAIR'}</span>
            </p>
          </div>
        </div>

        ${claim.sla_due_at ? `
          <div class="sla-indicator-row flex items-center justify-between p-2 rounded bg-surface border border-subtle mt-2">
            <span class="text-muted font-medium">⏱️ ${t('warranty.supplier_sla_deadline')}:</span>
            <span class="font-mono ${claim.is_sla_breached ? 'text-danger font-bold' : 'text-primary'}">
              ${new Date(claim.sla_due_at).toLocaleString()}
              ${claim.is_sla_breached ? `(${t('warranty.sla_breached')})` : ''}
            </span>
          </div>
        ` : ''}

        ${claim.reverse_tracking_number ? `
          <div class="reverse-courier-box p-2 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 mt-2">
            <div class="flex justify-between items-center">
              <span class="font-semibold text-emerald-800 dark:text-emerald-300">🚚 ${t('warranty.reverse_courier_booked')}</span>
              <span class="badge badge--emerald text-xs">${claim.reverse_carrier || 'Courier'}</span>
            </div>
            <div class="font-mono text-xs mt-1">
              ${t('warranty.tracking_number')}: <strong>${claim.reverse_tracking_number}</strong>
            </div>
            <div class="text-muted text-xs mt-0.5">
              ${t('warranty.reverse_pickup_instructions')}
            </div>
          </div>
        ` : ''}

        ${claim.rejection_reason ? `
          <div class="rejection-box p-2 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 mt-2">
            <span class="font-semibold text-rose-800 dark:text-rose-300">❌ ${t('warranty.rejection_reason')}:</span>
            <p class="mt-0.5 text-rose-700 dark:text-rose-200">${claim.rejection_reason}</p>
          </div>
        ` : ''}

        ${Array.isArray(claim.evidence_media) && claim.evidence_media.length > 0 ? `
          <div class="evidence-media-strip mt-3 pt-2 border-t border-subtle">
            <span class="text-muted block mb-1 font-medium">${t('warranty.customer_evidence_media')}:</span>
            <div class="flex gap-2 overflow-x-auto py-1">
              ${claim.evidence_media.map((url, i) => `
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="evidence-thumb-link">
                  <img src="${url}" alt="Proof ${i+1}" class="w-14 h-14 object-cover rounded border border-subtle" onerror="this.src='/placeholder-img.svg'"/>
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  return container;
}
