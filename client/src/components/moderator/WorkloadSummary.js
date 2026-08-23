/**
 * WorkloadSummary.js — Workload KPIs Widget (Prompt 7.6).
 *
 * Renders:
 * 1. My Queue count (items claimed by current moderator).
 * 2. Unassigned items count (open pending items).
 * 3. SLA-at-risk items count (approaching or past SLA).
 * 4. Today's resolved count.
 */

import { t } from '../../services/i18n.js';

export default function WorkloadSummary({
  workload = {
    my_queue_count: 0,
    unassigned_count: 0,
    sla_at_risk_count: 0,
    resolved_today_count: 0,
  },
  onNavigate = null,
} = {}) {
  const container = document.createElement('div');
  container.className = 'workload-summary grid grid-cols-4 gap-4';

  const cards = [
    {
      id: 'my-queue',
      title: t('moderator_dashboard.kpi_my_queue'),
      count: workload.my_queue_count || 0,
      icon: '📥',
      badgeClass: 'badge--primary',
      accentClass: 'border-l-4 border-primary',
      route: '/moderator/queue?filter=claimed_by_me',
    },
    {
      id: 'unassigned',
      title: t('moderator_dashboard.kpi_unassigned'),
      count: workload.unassigned_count || 0,
      icon: '⏳',
      badgeClass: 'badge--amber',
      accentClass: 'border-l-4 border-amber',
      route: '/moderator/queue?status=PENDING',
    },
    {
      id: 'sla-at-risk',
      title: t('moderator_dashboard.kpi_sla_at_risk'),
      count: workload.sla_at_risk_count || 0,
      icon: '🔥',
      badgeClass: workload.sla_at_risk_count > 0 ? 'badge--rose' : 'badge--secondary',
      accentClass: workload.sla_at_risk_count > 0 ? 'border-l-4 border-rose' : 'border-l-4 border-border',
      route: '/moderator/queue?flagged_only=true',
    },
    {
      id: 'resolved-today',
      title: t('moderator_dashboard.kpi_resolved_today'),
      count: workload.resolved_today_count || 0,
      icon: '✅',
      badgeClass: 'badge--emerald',
      accentClass: 'border-l-4 border-emerald',
      route: '/moderator/queue?status=APPROVED',
    },
  ];

  container.innerHTML = cards
    .map(
      (c) => `
    <div class="card p-4 flex items-center justify-between cursor-pointer transition hover:shadow-md ${c.accentClass}" data-route="${c.route}">
      <div class="space-y-1">
        <span class="text-xs text-secondary font-medium">${c.title}</span>
        <div class="text-2xl font-bold text-text">${c.count}</div>
      </div>
      <div class="text-2xl opacity-80">${c.icon}</div>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('[data-route]').forEach((card) => {
    card.addEventListener('click', () => {
      const route = card.getAttribute('data-route');
      if (typeof onNavigate === 'function') {
        onNavigate(route);
      } else {
        window.history.pushState({}, '', route);
        window.dispatchEvent(new Event('popstate'));
      }
    });
  });

  return container;
}
