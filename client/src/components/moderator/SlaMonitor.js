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
  container.className = 'sla-monitor-card';
  container.style.cssText = `
    background: var(--surface-1, #ffffff);
    border: 1px solid var(--border-subtle, #e2e8f0);
    border-radius: var(--radius-lg, 12px);
    padding: 20px;
    box-shadow: var(--elevation-1, 0 1px 3px rgba(0,0,0,0.05));
    display: flex;
    flex-direction: column;
    height: 100%;
  `;

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

  function getBadgeStyle(urgency) {
    if (urgency === 'BREACHED') {
      return 'background: var(--danger-bg, rgba(225, 29, 72, 0.1)); color: var(--danger, #e11d48); border: 1px solid var(--danger-border, rgba(225, 29, 72, 0.3)); font-weight: 700;';
    }
    if (urgency === 'CRITICAL') {
      return 'background: var(--warning-bg, rgba(217, 119, 6, 0.1)); color: var(--warning, #d97706); border: 1px solid var(--warning-border, rgba(217, 119, 6, 0.3)); font-weight: 600;';
    }
    return 'background: var(--surface-2, rgba(100, 116, 139, 0.1)); color: var(--text-muted, #64748b); border: 1px solid var(--border-subtle, rgba(100, 116, 139, 0.2));';
  }

  const breachedCount = items.filter((i) => i.is_breached).length;

  if (items.length === 0) {
    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border-subtle, #e2e8f0);">
        <h3 style="margin: 0; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 6px; color: var(--text-primary, #0f172a);">
          ⏱️ ${t('moderator_dashboard.sla_monitor_title', 'SLA Urgency Monitor')}
        </h3>
        <span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; background: var(--success-bg, rgba(5, 150, 105, 0.1)); color: var(--success, #059669); font-weight: 600;">
          ✓ All SLAs Healthy
        </span>
      </div>
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px 10px; text-align: center; color: var(--text-muted, #64748b);">
        <span style="font-size: 28px; margin-bottom: 8px;">🎉</span>
        <span style="font-size: 13px; font-weight: 500;">${t('moderator_dashboard.sla_all_healthy', 'All pending cases are within target resolution windows.')}</span>
      </div>
    `;
    return container;
  }

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border-subtle, #e2e8f0);">
      <div style="display: flex; align-items: center; gap: 8px;">
        <h3 style="margin: 0; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 6px; color: var(--text-primary, #0f172a);">
          ⏱️ ${t('moderator_dashboard.sla_monitor_title', 'SLA Urgency Monitor')}
        </h3>
        <span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; background: ${breachedCount > 0 ? 'var(--danger-bg, rgba(225, 29, 72, 0.1))' : 'var(--success-bg, rgba(5, 150, 105, 0.1))'}; color: ${breachedCount > 0 ? 'var(--danger, #e11d48)' : 'var(--success, #059669)'}; font-weight: 700;">
          ${breachedCount > 0 ? `${breachedCount} Breached` : 'On Track'}
        </span>
      </div>
      <span style="font-size: 11px; color: var(--text-muted, #64748b);">Prioritized by deadline</span>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 220px;">
      ${items
        .map(
          (item) => `
        <div style="
          padding: 10px 12px;
          border-radius: var(--radius-md, 8px);
          background: var(--surface-2, #f8fafc);
          border: 1px solid var(--border-subtle, #e2e8f0);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          transition: background 0.15s ease;
        ">
          <div style="display: flex; flex-direction: column; gap: 3px; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="font-family: monospace; font-size: 12px; font-weight: 700; color: var(--text-brand, #4f46e5);">${item.ref}</span>
              <span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--surface-3, rgba(100, 116, 139, 0.1)); color: var(--text-secondary, #475569); font-weight: 600;">${item.item_type || 'CONTENT'}</span>
              <span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; ${getBadgeStyle(item.urgency)}">
                ${formatRemainingTime(item.remaining_minutes, item.is_breached)}
              </span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted, #64748b); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              Submitter: <strong style="color: var(--text-primary, #0f172a);">${item.submitter_name || 'Anonymous'}</strong> • Due: ${formatDate(item.sla_due_at)}
            </div>
          </div>

          <button class="btn-sla-action" data-item-id="${item.id}" data-route="${item.target_route || '/moderator/queue'}" style="
            padding: 5px 12px;
            font-size: 11px;
            font-weight: 600;
            border-radius: var(--radius-sm, 6px);
            border: 1px solid var(--border-interactive, #4f46e5);
            background: var(--surface-1, #ffffff);
            color: var(--text-brand, #4f46e5);
            cursor: pointer;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.15s ease;
          ">
            ⚡ ${t('moderator_dashboard.btn_take_action', 'Take Action')}
          </button>
        </div>
      `
        )
        .join('')}
    </div>
  `;

  container.querySelectorAll('.btn-sla-action').forEach((btn) => {
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'var(--brand, #4f46e5)';
      btn.style.color = 'var(--brand-contrast, #ffffff)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'var(--surface-1, #ffffff)';
      btn.style.color = 'var(--text-brand, #4f46e5)';
    });
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
