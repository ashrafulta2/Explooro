/**
 * EvidenceTimeline.js — Chronological, immutable dispute audit & evidence trail (Prompt 7.3).
 *
 * Visualizes in strict time-order:
 * - Order creation & delivery
 * - Courier transit & tracking events
 * - Return requests, photos, inspection findings
 * - Participant messages & evidence uploads
 * - Moderator internal notes (staff-gated)
 * - Escalations and arbitration determinations
 */

import { formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';

export function EvidenceTimeline({ timeline = [], disputeRef = '' } = {}) {
  const container = document.createElement('div');
  container.className = 'evidence-timeline';

  if (!timeline || timeline.length === 0) {
    container.innerHTML = `
      <div class="evidence-timeline__empty text-secondary text-sm p-4 text-center">
        ${t('dispute.no_timeline_events')}
      </div>
    `;
    return container;
  }

  const roleColors = {
    CUSTOMER: 'badge--blue',
    SALER: 'badge--purple',
    SUPPLIER: 'badge--amber',
    MODERATOR: 'badge--indigo',
    ADMIN: 'badge--indigo',
    SUPER_ADMIN: 'badge--rose',
    COURIER: 'badge--emerald',
    SYSTEM: 'badge--gray',
  };

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

  const list = document.createElement('div');
  list.className = 'evidence-timeline__list';

  timeline.forEach((event, idx) => {
    const item = document.createElement('div');
    const isInternal = event.is_internal || event.type === 'INTERNAL_NOTE';
    const isResolution = event.type === 'DISPUTE_RESOLVED';
    const isEscalation = event.type === 'DISPUTE_ESCALATED';

    item.className = `evidence-timeline__item ${isInternal ? 'evidence-timeline__item--internal' : ''} ${isResolution ? 'evidence-timeline__item--resolution' : ''} ${isEscalation ? 'evidence-timeline__item--escalation' : ''}`;

    const icon = eventIcons[event.type] || '📌';
    const badgeClass = roleColors[event.actor_role] || 'badge--gray';

    let mediaHtml = '';
    if (Array.isArray(event.attachments) && event.attachments.length > 0) {
      mediaHtml = `
        <div class="evidence-timeline__media-grid">
          ${event.attachments
            .map(
              (url, i) => `
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="evidence-timeline__media-thumb" title="Evidence ${i + 1}">
              <img src="${url}" alt="Evidence ${i + 1}" onerror="this.src='/placeholder-img.svg'"/>
            </a>
          `
            )
            .join('')}
        </div>
      `;
    }

    let metaDetailsHtml = '';
    if (event.metadata && Object.keys(event.metadata).length > 0) {
      metaDetailsHtml = `
        <div class="evidence-timeline__meta-tags">
          ${Object.entries(event.metadata)
            .filter(([_, v]) => v != null && v !== '')
            .map(([k, v]) => `<span class="evidence-meta-pill"><strong>${k.replace(/_/g, ' ')}:</strong> ${typeof v === 'object' ? JSON.stringify(v) : v}</span>`)
            .join('')}
        </div>
      `;
    }

    item.innerHTML = `
      <div class="evidence-timeline__marker">
        <span class="evidence-timeline__icon">${icon}</span>
        ${idx < timeline.length - 1 ? '<div class="evidence-timeline__line"></div>' : ''}
      </div>
      <div class="evidence-timeline__content card ${isInternal ? 'card--internal-note' : ''}">
        <div class="evidence-timeline__header flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm">${event.title}</span>
            <span class="badge ${badgeClass} badge--xs">${event.actor || event.actor_role}</span>
            ${isInternal ? `<span class="badge badge--rose badge--xs">🔒 ${t('dispute.internal_note')}</span>` : ''}
          </div>
          <span class="text-xs text-secondary">${formatDate(event.timestamp)}</span>
        </div>
        ${event.body ? `<div class="evidence-timeline__body text-sm mt-2">${event.body}</div>` : ''}
        ${mediaHtml}
        ${metaDetailsHtml}
      </div>
    `;

    list.appendChild(item);
  });

  container.appendChild(list);
  return container;
}
