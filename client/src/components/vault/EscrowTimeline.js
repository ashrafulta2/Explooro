/**
 * EscrowTimeline.js — Interactive Escrow Holdings Timeline with Live Ticking Countdowns (Prompt 6.5).
 *
 * Implements:
 * 1. Live ticking countdown timers (HH:MM:SS / Days) updating every 1000ms.
 * 2. Explicit source order attribution and clearance timestamps.
 * 3. Clear status badges and progress indicators.
 */

import { formatCurrency, formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';

export function EscrowTimeline({ escrowEntries = [] }) {
  const container = document.createElement('div');
  container.className = 'escrow-timeline-component';

  let timerInterval = null;
  const entriesState = escrowEntries.map((e) => ({
    ...e,
    remainingSeconds: e.remaining_seconds ?? Math.max(0, Math.round((new Date(e.hold_until).getTime() - Date.now()) / 1000)),
  }));

  function formatCountdown(totalSecs) {
    if (totalSecs <= 0) return t('vault.ready_to_release');
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    if (days > 0) {
      return `${days}d ${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m`;
    }
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  function render() {
    container.innerHTML = `
      <div class="card escrow-timeline-card">
        <div class="escrow-timeline__header">
          <div>
            <h3 class="escrow-timeline__title">⏳ ${t('vault.escrow_timeline_title')}</h3>
            <p class="text-sm text-secondary">${t('vault.escrow_timeline_subtitle')}</p>
          </div>
          <span class="badge badge--warning font-mono font-bold">
            ${entriesState.length} ${t('vault.pending_items')}
          </span>
        </div>

        ${entriesState.length === 0 ? `
          <div class="empty-state p-6">
            <div class="empty-state__icon">✨</div>
            <h4>${t('vault.no_pending_escrow')}</h4>
            <p class="text-sm text-secondary">${t('vault.no_pending_escrow_desc')}</p>
          </div>
        ` : `
          <div class="escrow-timeline__list">
            ${entriesState.map((item, idx) => `
              <div class="escrow-timeline__item ${item.remainingSeconds <= 0 ? 'escrow-timeline__item--ready' : ''}">
                <div class="escrow-timeline__icon-col">
                  <div class="escrow-timeline__dot ${item.remainingSeconds <= 0 ? 'escrow-timeline__dot--ready' : ''}"></div>
                  ${idx < entriesState.length - 1 ? '<div class="escrow-timeline__line"></div>' : ''}
                </div>

                <div class="escrow-timeline__content">
                  <div class="escrow-timeline__top">
                    <div>
                      <span class="font-bold text-sm">
                        ${t('vault.order_label')} <span class="font-mono text-primary">${item.sub_order_ref || `#${item.sub_order_id}`}</span>
                      </span>
                      <div class="text-xs text-secondary">
                        ${t('vault.hold_until')}: <strong>${formatDate(item.hold_until)}</strong>
                      </div>
                    </div>

                    <div class="text-right">
                      <div class="font-bold text-base text-warning">
                        +${formatCurrency(item.amount)}
                      </div>
                      <div class="countdown-badge ${item.remainingSeconds <= 0 ? 'countdown-badge--ready' : ''}" data-index="${idx}">
                        ⏱️ ${formatCountdown(item.remainingSeconds)}
                      </div>
                    </div>
                  </div>

                  <div class="escrow-timeline__footer text-xs text-secondary">
                    <span>${t('vault.role')}: <strong class="badge badge--neutral">${item.beneficiary_role}</strong></span>
                    <span>${t('vault.clearance_policy')}</span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      let hasChanges = false;
      entriesState.forEach((item, idx) => {
        if (item.remainingSeconds > 0) {
          item.remainingSeconds -= 1;
          hasChanges = true;
          const el = container.querySelector(`.countdown-badge[data-index="${idx}"]`);
          if (el) {
            el.textContent = `⏱️ ${formatCountdown(item.remainingSeconds)}`;
            if (item.remainingSeconds <= 0) {
              el.classList.add('countdown-badge--ready');
              el.textContent = `✓ ${t('vault.ready_to_release')}`;
            }
          }
        }
      });
    }, 1000);
  }

  render();
  startTimer();

  // Lifecycle cleanup
  const observer = new MutationObserver(() => {
    if (!document.body.contains(container)) {
      if (timerInterval) clearInterval(timerInterval);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return container;
}
