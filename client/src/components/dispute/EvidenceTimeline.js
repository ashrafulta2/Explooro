/**
 * EvidenceTimeline.js — Chronological, immutable dispute audit & evidence trail (Prompt 7.3).
 *
 * Integrated with platform theme variables.
 */

import { formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';

export function EvidenceTimeline({ timeline = [], disputeRef = '' } = {}) {
  const container = document.createElement('div');
  container.className = 'evidence-timeline-widget';
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 0;
  `;

  if (!timeline || timeline.length === 0) {
    container.innerHTML = `
      <div style="padding: 32px; text-align: center; color: var(--text-muted, #64748b); font-size: 13px;">
        ${t('dispute.no_timeline_events', 'No timeline events recorded yet.')}
      </div>
    `;
    return container;
  }

  const eventIcons = {
    ORDER_PLACED: '🛍️',
    COURIER_EVENT: '🚚',
    RETURN_REQUESTED: '📦',
    DISPUTE_OPENED: '⚖️',
    MESSAGE: '💬',
    INTERNAL_NOTE: '🔒',
    DISPUTE_ESCALATED: '🚨',
    DISPUTE_RESOLVED: '✅',
  };

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${timeline
        .map((event, idx) => {
          const isInternal = event.is_internal || event.type === 'INTERNAL_NOTE';
          const icon = eventIcons[event.type] || '📌';

          let metaHtml = '';
          if (event.metadata && Object.keys(event.metadata).length > 0) {
            metaHtml = `
              <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
                ${Object.entries(event.metadata)
                  .map(
                    ([k, v]) => `
                  <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--surface-3, #e2e8f0); color: var(--text-secondary, #475569); font-family: monospace;">
                    <strong>${k}:</strong> ${typeof v === 'object' ? JSON.stringify(v) : v}
                  </span>
                `
                  )
                  .join('')}
              </div>
            `;
          }

          return `
            <div style="
              display: flex;
              gap: 12px;
              align-items: flex-start;
              position: relative;
            ">
              <div style="
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background: ${isInternal ? 'var(--danger-bg, rgba(225, 29, 72, 0.1))' : 'var(--info-bg, rgba(79, 70, 229, 0.1))'};
                border: 1px solid ${isInternal ? 'var(--danger-border, rgba(225, 29, 72, 0.3))' : 'var(--info-border, rgba(79, 70, 229, 0.3))'};
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                flex-shrink: 0;
              ">
                ${icon}
              </div>

              <div style="
                flex: 1;
                padding: 12px 14px;
                border-radius: var(--radius-md, 8px);
                background: ${isInternal ? 'var(--danger-bg, rgba(225, 29, 72, 0.05))' : 'var(--surface-2, #f8fafc)'};
                border: 1px solid ${isInternal ? 'var(--danger-border, rgba(225, 29, 72, 0.2))' : 'var(--border-subtle, #e2e8f0)'};
              ">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <strong style="font-size: 12px; color: var(--text-primary, #0f172a);">${event.type.replace(/_/g, ' ')}</strong>
                    <span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); color: var(--text-brand, #4f46e5); font-weight: 600;">${event.actor_role || 'SYSTEM'}</span>
                  </div>
                  <span style="font-size: 11px; color: var(--text-muted, #64748b);">${formatDate(event.created_at)}</span>
                </div>

                <div style="font-size: 12px; color: var(--text-secondary, #475569); margin-top: 4px;">
                  Actor: <strong>${event.actor_name || 'Automated Pipeline'}</strong>
                </div>

                ${metaHtml}
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;

  return container;
}
