/**
 * SlaMonitor.js — SLA Urgency & Priority Monitor Widget (Prompt 7.6).
 *
 * Displays:
 * 1. Queue items approaching or breaching SLA, sorted by urgency.
 * 2. Visual countdown and overdue indicators.
 * 3. Quick action jump links to resolve the item.
 */

import { t } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';

export default function SlaMonitor({
  items = [],
  onInspectItem = null,
} = {}) {
  const container = document.createElement('div');
  container.className = 'sla-monitor card p-4 space-y-4';

  function formatRemainingTime(minutes, isBreached) {
    if (isBreached) {
      const overMin = Math.abs(minutes);
      return `⚠️ Breached (${overMin}m overdue)`;
    }
    if (minutes <= 60) {
      return `🔥 ${minutes}m remaining`;
    }
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `⏳ ${hrs}h ${mins}m remaining`;
  }

  function getBadgeClass(urgency) {
    if (urgency === 'BREACHED') return 'badge--rose font-bold animate-pulse';
    if (urgency === 'CRITICAL') return 'badge--amber font-semibold';
    return 'badge--secondary';
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div class="flex items-center justify-between pb-2 border-b">
        <h3 class="font-bold text-sm flex items-center gap-2">
          ⏱️ ${t('moderator_dashboard.sla_monitor_title')}
        </h3>
        <span class="badge badge--emerald badge--xs">All SLAs Met</span>
      </div>
      <div class="py-6 text-center text-xs text-secondary">
        🎉 ${t('moderator_dashboard.sla_all_healthy')}
      </div>
    `;
    return container;
  }

  container.innerHTML = `
    <div class="flex items-center justify-between pb-2 border-b">
      <div class="flex items-center gap-2">
        <h3 class="font-bold text-sm flex items-center gap-2">
          ⏱️ ${t('moderator_dashboard.sla_monitor_title')}
        </h3>
        <span class="badge badge--rose badge--xs">${items.filter((i) => i.is_breached).length} Breached</span>
      </div>
      <span class="text-xxs text-secondary">Sorted by urgency</span>
    </div>

    <div class="divide-y text-xs">
      ${items
        .map(
          (item) => `
        <div class="py-2.5 flex items-center justify-between gap-3 hover:bg-surface-subtle px-1 rounded transition">
          <div class="space-y-0.5">
            <div class="flex items-center gap-2">
              <span class="font-mono text-primary font-bold">${item.ref}</span>
              <span class="badge badge--xs">${item.item_type || 'CONTENT'}</span>
              <span class="badge ${getBadgeClass(item.urgency)} badge--xs">
                ${formatRemainingTime(item.remaining_minutes, item.is_breached)}
              </span>
            </div>
            <div class="text-xxs text-secondary">
              Submitter: <span class="font-medium text-text">${item.submitter_name || 'Anonymous'}</span> • Due: ${formatDate(item.sla_due_at)}
            </div>
          </div>

          <button class="btn btn--secondary btn--xs btn-sla-action shrink-0" data-item-id="${item.id}" data-route="${item.target_route || '/moderator/queue'}">
            ⚡ ${t('moderator_dashboard.btn_take_action')}
          </button>
        </div>
      `
        )
        .join('')}
    </div>
  `;

  container.querySelectorAll('.btn-sla-action').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-item-id');
      const route = btn.getAttribute('data-route');
      if (typeof onInspectItem === 'function') {
        onInspectItem(id, route);
      } else {
        window.history.pushState({}, '', route);
        window.dispatchEvent(new Event('popstate'));
      }
    });
  });

  return container;
}
