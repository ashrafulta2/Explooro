/**
 * WorkloadSummary.js — Workload KPIs Widget (Prompt 7.6).
 *
 * Renders 4 Executive KPI Cards fully integrated with platform theme tokens:
 * 1. My Queue (items claimed by current moderator).
 * 2. Unassigned items (open pending items).
 * 3. SLA-at-risk items (approaching or past SLA).
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
  container.className = 'workload-summary-grid';
  container.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  `;

  const cards = [
    {
      id: 'my-queue',
      title: t('moderator_dashboard.kpi_my_queue', 'My Queue'),
      count: workload.my_queue_count || 0,
      icon: '📥',
      // --text-brand, not --brand: the sibling cards all use a status TEXT token (--warning,
      // --danger, --success); this one reached for the fill token and rendered at 1.64:1.
      color: 'var(--text-brand)',
      bgColor: 'var(--info-bg, rgba(79, 70, 229, 0.08))',
      borderColor: 'var(--info-border, rgba(79, 70, 229, 0.25))',
      subtext: 'Items claimed & in review',
      route: '/moderator/queue?filter=claimed_by_me',
    },
    {
      id: 'unassigned',
      title: t('moderator_dashboard.kpi_unassigned', 'Unassigned Items'),
      count: workload.unassigned_count || 0,
      icon: '⏳',
      color: 'var(--warning, #d97706)',
      bgColor: 'var(--warning-bg, rgba(217, 119, 6, 0.08))',
      borderColor: 'var(--warning-border, rgba(217, 119, 6, 0.25))',
      subtext: 'Pending items awaiting claim',
      route: '/moderator/queue?status=PENDING',
    },
    {
      id: 'sla-at-risk',
      title: t('moderator_dashboard.kpi_sla_at_risk', 'SLA At-Risk'),
      count: workload.sla_at_risk_count || 0,
      icon: '🔥',
      color: workload.sla_at_risk_count > 0 ? 'var(--danger, #e11d48)' : 'var(--text-muted, #64748b)',
      bgColor: workload.sla_at_risk_count > 0 ? 'var(--danger-bg, rgba(225, 29, 72, 0.08))' : 'var(--surface-2, rgba(100, 116, 139, 0.06))',
      borderColor: workload.sla_at_risk_count > 0 ? 'var(--danger-border, rgba(225, 29, 72, 0.3))' : 'var(--border-subtle, rgba(100, 116, 139, 0.2))',
      subtext: workload.sla_at_risk_count > 0 ? 'Requires immediate action' : 'All SLAs healthy',
      route: '/moderator/queue?flagged_only=true',
    },
    {
      id: 'resolved-today',
      title: t('moderator_dashboard.kpi_resolved_today', 'Resolved Today'),
      count: workload.resolved_today_count || 0,
      icon: '✅',
      color: 'var(--success, #059669)',
      bgColor: 'var(--success-bg, rgba(5, 150, 105, 0.08))',
      borderColor: 'var(--success-border, rgba(5, 150, 105, 0.25))',
      subtext: 'Decisions completed today',
      route: '/moderator/queue?status=APPROVED',
    },
  ];

  container.innerHTML = cards
    .map(
      (c) => `
    <div class="mod-kpi-card" data-route="${c.route}" style="
      background: var(--surface-1, #ffffff);
      border: 1px solid var(--border-subtle, #e2e8f0);
      border-left: 4px solid ${c.color};
      border-radius: var(--radius-lg, 12px);
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      box-shadow: var(--elevation-1, 0 1px 3px rgba(0,0,0,0.05));
      transition: all 0.2s ease;
    ">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <span style="font-size: 12px; font-weight: 600; color: var(--text-muted, #64748b);">${c.title}</span>
        <div style="font-size: 28px; font-weight: 800; color: var(--text-primary, #0f172a); line-height: 1.1;">${c.count}</div>
        <span style="font-size: 11px; color: ${c.color}; font-weight: 500;">${c.subtext}</span>
      </div>
      <div style="
        width: 46px;
        height: 46px;
        border-radius: var(--radius-md, 10px);
        background: ${c.bgColor};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        flex-shrink: 0;
      ">${c.icon}</div>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('.mod-kpi-card').forEach((card) => {
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translateY(-2px)';
      card.style.background = 'var(--surface-2, #f8fafc)';
      card.style.boxShadow = 'var(--elevation-2, 0 4px 12px rgba(0,0,0,0.08))';
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'translateY(0)';
      card.style.background = 'var(--surface-1, #ffffff)';
      card.style.boxShadow = 'var(--elevation-1, 0 1px 3px rgba(0,0,0,0.05))';
    });
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
