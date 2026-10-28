/**
 * MilestoneProgressStepper.ts — Visual progress stepper for B2B escrow staged release milestones (Prompt 10.6).
 */

import { t, getLanguage } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';

/** One staged-release milestone of a B2B escrow deal. */
export interface Milestone {
  id: number;
  ref?: string;
  label_en?: string;
  label_bn?: string;
  /** `PENDING`, `EVIDENCE_SUBMITTED`, `FROZEN`, `RELEASED` or `REFUNDED`. */
  status: string;
  amount: number | string;
  release_pct: number | string;
  evidence_required?: string;
  evidence_media_json?: { evidence_type?: string; notes?: string } | null;
}

export interface MilestoneStepperOptions {
  milestones?: Milestone[];
  dealStatus?: string;
  userRole?: 'supplier' | 'saler' | string;
  isBuyer?: boolean;
  isAdmin?: boolean;
  onEvidenceClick?: ((milestone: Milestone) => void) | null;
  onReleaseClick?: ((milestone: Milestone) => void) | null;
  onRefundClick?: ((milestone: Milestone) => void) | null;
}

export function createMilestoneProgressStepper({
  milestones = [],
  dealStatus = 'IN_PROGRESS',
  userRole = 'supplier',
  isBuyer = false,
  isAdmin = false,
  onEvidenceClick = null,
  onReleaseClick = null,
  onRefundClick = null,
}: MilestoneStepperOptions = {}): {
  element: HTMLDivElement;
  update(newMilestones?: Milestone[], newDealStatus?: string): void;
} {
  const container = document.createElement('div');
  container.className = 'milestone-stepper-container space-y-4';

  function getStatusBadge(status: string): string {
    switch (status) {
      case 'RELEASED':
        return `<span class="badge badge-success font-mono text-xs">✓ ${t('b2b_escrow.status_released')}</span>`;
      case 'EVIDENCE_SUBMITTED':
        return `<span class="badge badge-primary font-mono text-xs">📄 ${t('b2b_escrow.status_evidence_submitted')}</span>`;
      case 'FROZEN':
        return `<span class="badge badge-danger font-mono text-xs">❄️ ${t('b2b_escrow.status_frozen')}</span>`;
      case 'REFUNDED':
        return `<span class="badge badge-neutral font-mono text-xs">↩ ${t('b2b_escrow.status_refunded')}</span>`;
      default:
        return `<span class="badge badge-neutral font-mono text-xs">⏳ ${t('b2b_escrow.status_pending')}</span>`;
    }
  }

  function render(): void {
    if (!milestones.length) {
      container.innerHTML = `<p class="text-sm text-muted text-center py-4">${t('b2b_escrow.no_milestones')}</p>`;
      return;
    }

    const totalReleased = milestones
      .filter((m) => m.status === 'RELEASED')
      .reduce((sum, m) => sum + (parseFloat(String(m.amount)) || 0), 0);

    const totalAmount = milestones
      .reduce((sum, m) => sum + (parseFloat(String(m.amount)) || 0), 0);

    const progressPct = totalAmount > 0 ? Math.round((totalReleased / totalAmount) * 100) : 0;

    container.innerHTML = `
      <div class="stepper-header mb-3">
        <div class="flex-between text-xs text-muted mb-1">
          <span>${t('b2b_escrow.disbursed_progress')}: <b>${progressPct}%</b> (${formatCurrency(totalReleased)} / ${formatCurrency(totalAmount)})</span>
          <span>${milestones.length} ${t('b2b_escrow.stages_count')}</span>
        </div>
        <div class="w-full bg-surface-subtle h-2 rounded-full overflow-hidden border">
          <div class="bg-success h-full transition-all duration-300" style="width: ${progressPct}%"></div>
        </div>
      </div>

      <div class="space-y-3">
        ${milestones.map((m, idx) => {
          const isReleased = m.status === 'RELEASED';
          const isFrozen = m.status === 'FROZEN';
          const isEvidenceSubmitted = m.status === 'EVIDENCE_SUBMITTED';
          const isPending = m.status === 'PENDING';
          const lang = getLanguage();
          const title = lang === 'bn' ? m.label_bn : m.label_en;

          return `
            <div class="milestone-card p-4 rounded border ${isReleased ? 'bg-success-soft border-success' : isFrozen ? 'bg-danger-soft border-danger' : 'bg-surface'} flex flex-col md:flex-row md:items-center md:justify-between gap-4" data-milestone-id="${m.id}">
              <div class="flex items-start gap-3">
                <div class="step-badge rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm ${isReleased ? 'bg-success text-white' : 'bg-surface-subtle border text-muted'}">
                  ${isReleased ? '✓' : idx + 1}
                </div>
                <div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-base">${title}</span>
                    <span class="badge badge-neutral text-xs font-mono">${m.release_pct}%</span>
                    ${getStatusBadge(m.status)}
                  </div>
                  <div class="text-xs text-muted mt-1 space-y-1">
                    <div>Ref: <span class="font-mono">${m.ref}</span> · Required Proof: <span class="font-semibold">${m.evidence_required}</span></div>
                    ${m.evidence_media_json ? `
                      <div class="text-primary font-mono text-xs">
                        📎 Evidence attached (${m.evidence_media_json.evidence_type})
                        ${m.evidence_media_json.notes ? ` · "${m.evidence_media_json.notes}"` : ''}
                      </div>
                    ` : ''}
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0">
                <div class="text-right">
                  <span class="text-lg font-bold font-mono ${isReleased ? 'text-success' : 'text-primary'}">${formatCurrency(m.amount)}</span>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  ${(userRole === 'supplier' || isAdmin) && (isPending || isEvidenceSubmitted) ? `
                    <button class="submit-evidence-btn btn btn-sm btn-secondary text-xs" data-id="${m.id}">
                      📤 ${isEvidenceSubmitted ? t('b2b_escrow.update_evidence') : t('b2b_escrow.submit_evidence')}
                    </button>
                  ` : ''}

                  ${(isBuyer || isAdmin) && (isPending || isEvidenceSubmitted) && !isFrozen ? `
                    <button class="release-btn btn btn-sm btn-success text-xs font-bold" data-id="${m.id}">
                      ✓ ${t('b2b_escrow.release_funds')}
                    </button>
                  ` : ''}

                  ${isAdmin && isFrozen ? `
                    <button class="refund-btn btn btn-sm btn-danger text-xs" data-id="${m.id}">
                      ↩ ${t('b2b_escrow.refund_to_buyer')}
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Attach listeners
    container.querySelectorAll('.submit-evidence-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const m = milestones.find((x) => x.id === id);
        if (m && onEvidenceClick) onEvidenceClick(m);
      });
    });

    container.querySelectorAll('.release-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const m = milestones.find((x) => x.id === id);
        if (m && onReleaseClick) onReleaseClick(m);
      });
    });

    container.querySelectorAll('.refund-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const m = milestones.find((x) => x.id === id);
        if (m && onRefundClick) onRefundClick(m);
      });
    });
  }

  render();

  return {
    element: container,
    update: (newMilestones?: Milestone[], newDealStatus?: string) => {
      if (newMilestones) milestones = newMilestones;
      if (newDealStatus) dealStatus = newDealStatus;
      render();
    },
  };
}
