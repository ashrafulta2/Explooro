/**
 * ModeratorDashboardPage.js — Moderator Home Surface & Workspace Hub (Prompt 7.6).
 *
 * Implements:
 * 1. Delegation-aware Workspace Hub (unlocked vs. locked with JIT "Request Access").
 * 2. WorkloadSummary & personal performance metrics.
 * 3. SlaMonitor urgency alert queue.
 * 4. "My Elevated Access" grants manager with countdowns and renew requests.
 * 5. "Awaiting Admin Approval" maker-checker submissions tracker.
 */

import { api } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatDate } from '../../services/format.js';
import WorkloadSummary from '../../components/moderator/WorkloadSummary.js';
import SlaMonitor from '../../components/moderator/SlaMonitor.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';

export default function ModeratorDashboardPage(root) {
  const container = document.createElement('div');
  container.className = 'page-container moderator-dashboard-page space-y-6';

  let dashboardData = {
    workload: {
      my_queue_count: 0,
      unassigned_count: 0,
      sla_at_risk_count: 0,
      resolved_today_count: 0,
    },
    performance: {
      total_resolved: 0,
      avg_handling_minutes: 8.5,
      overturn_rate_pct: 0.8,
      accuracy_score: 98.5,
    },
    sla_urgent_items: [],
    active_grants: [],
    submitted_actions: [],
  };

  let permissions = [];
  let userRole = 'moderator';
  let loading = true;
  let autoRefreshTimer = null;

  const WORKSPACES = [
    {
      id: 'product-moderation',
      title: 'Product & Content Moderation',
      desc: 'Review newly listed and edited seller products, banned keyword flags, and price anomalies.',
      icon: '🛍️',
      permissionKey: 'moderation.product.approve',
      route: '/moderator/queue',
    },
    {
      id: 'returns-queue',
      title: 'Returns & Inspection Queue',
      desc: 'Inspect customer return requests, damaged product media evidence, and reverse couriers.',
      icon: '🔄',
      permissionKey: 'orders.return.handle',
      route: '/admin/returns/queue',
    },
    {
      id: 'disputes-panel',
      title: 'Dispute Arbitration Panel',
      desc: 'Mediate 3-way buyer-saler-supplier conflicts and execute fair multi-outcome verdicts.',
      icon: '⚖️',
      permissionKey: 'disputes.arbitrate',
      route: '/disputes',
    },
    {
      id: 'kyc-verification',
      title: 'KYC Verification Center',
      desc: 'Inspect government NIDs, business trade licenses, facility photos, and issue Blue-Tick badges.',
      icon: '🛡️',
      permissionKey: 'users.kyc.approve',
      route: '/admin/verification',
    },
    {
      id: 'community-reports',
      title: 'Community User Reports',
      desc: 'Investigate user flags regarding fake products, harassment, or policy violations.',
      icon: '🚩',
      permissionKey: 'moderation.report.handle',
      route: '/moderator/queue?filter=reports',
    },
    {
      id: 'review-integrity',
      title: 'Review Integrity & UGC',
      desc: 'Inspect UGC videos, customer ratings, and automated spam/sentiment anomalies.',
      icon: '⭐',
      permissionKey: 'moderation.review.handle',
      route: '/moderator/queue?item_type=REVIEW',
    },
  ];

  async function init() {
    await fetchAllData();
  }

  async function fetchAllData() {
    try {
      loading = true;
      render();

      // Fetch user profile and permissions
      try {
        const permRes = await api.get('/me/permissions');
        permissions = permRes.data?.permissions || [];
        userRole = permRes.data?.role || 'moderator';
      } catch {
        permissions = [];
      }

      // Fetch dashboard aggregated KPIs
      try {
        const dashRes = await api.get('/moderator/dashboard');
        dashboardData = dashRes.data || dashboardData;
      } catch (err) {
        toast.error('Failed to load dashboard statistics.');
      }
    } finally {
      loading = false;
      render();
    }
  }

  function hasPermission(permissionKey) {
    if (userRole === 'super_admin' || userRole === 'admin') return true;
    return permissions.includes(permissionKey);
  }

  function openJitGrantDrawer(permissionKey) {
    openGrantDrawer({
      permissions: [{ key: permissionKey, label_en: permissionKey }],
      onSuccess: async () => {
        toast.success(t('moderator_dashboard.grant_requested_success'));
        await fetchAllData();
      },
    });
  }

  function renderPerformanceStats() {
    const perf = dashboardData.performance || {};
    return `
      <div class="card p-4">
        <div class="flex items-center justify-between pb-2 mb-3 border-b">
          <h3 class="font-bold text-sm flex items-center gap-2">
            📊 ${t('moderator_dashboard.perf_title')}
          </h3>
          <span class="badge badge--emerald badge--xs">${perf.accuracy_score}% Accuracy Score</span>
        </div>

        <div class="grid grid-cols-3 gap-4 text-center">
          <div class="p-2 rounded bg-surface-subtle">
            <span class="text-xxs text-secondary block">${t('moderator_dashboard.perf_total_resolved')}</span>
            <span class="text-lg font-bold text-text">${perf.total_resolved || 0}</span>
          </div>
          <div class="p-2 rounded bg-surface-subtle">
            <span class="text-xxs text-secondary block">${t('moderator_dashboard.perf_avg_handling_time')}</span>
            <span class="text-lg font-bold text-primary">${perf.avg_handling_minutes || 8.5}m</span>
          </div>
          <div class="p-2 rounded bg-surface-subtle">
            <span class="text-xxs text-secondary block">${t('moderator_dashboard.perf_overturn_rate')}</span>
            <span class="text-lg font-bold text-emerald">${perf.overturn_rate_pct || 0.8}%</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderWorkspaceCards() {
    return `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-bold flex items-center gap-2">
            🗂️ ${t('moderator_dashboard.workspaces_title')}
          </h2>
          <span class="text-xxs text-secondary">Phase 2 Dynamic Delegation Model</span>
        </div>

        <div class="grid grid-cols-3 gap-4">
          ${WORKSPACES.map((ws) => {
            const isUnlocked = hasPermission(ws.permissionKey);
            return `
              <div class="card p-4 flex flex-col justify-between transition hover:shadow-md ${isUnlocked ? 'border-primary/40' : 'bg-surface-subtle opacity-90'}">
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-2xl">${ws.icon}</span>
                    <span class="badge ${isUnlocked ? 'badge--emerald' : 'badge--amber'} badge--xs">
                      ${isUnlocked ? '🔓 Unlocked' : '🔒 Locked'}
                    </span>
                  </div>

                  <div>
                    <h3 class="font-bold text-sm text-text">${ws.title}</h3>
                    <p class="text-xxs text-secondary mt-1 leading-relaxed">${ws.desc}</p>
                  </div>
                </div>

                <div class="pt-4 mt-4 border-t flex items-center justify-between">
                  <span class="font-mono text-xxs text-tertiary truncate max-w-[120px]">${ws.permissionKey}</span>
                  ${
                    isUnlocked
                      ? `<button class="btn btn--primary btn--xs btn-open-ws" data-route="${ws.route}">
                          ${t('moderator_dashboard.btn_open_workspace')} →
                        </button>`
                      : `<button class="btn btn--secondary btn--xs btn-request-access" data-perm="${ws.permissionKey}">
                          🔑 ${t('moderator_dashboard.btn_request_access')}
                        </button>`
                  }
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderElevatedAccessPanel() {
    const grants = dashboardData.active_grants || [];
    return `
      <div class="card p-4 space-y-3">
        <div class="flex items-center justify-between pb-2 border-b">
          <h3 class="font-bold text-sm flex items-center gap-2">
            🛡️ ${t('moderator_dashboard.my_grants_title')}
          </h3>
          <span class="badge badge--xs badge--primary">${grants.length} Active Grants</span>
        </div>

        ${
          grants.length === 0
            ? `<div class="py-4 text-center text-xs text-secondary">${t('moderator_dashboard.no_active_grants')}</div>`
            : `
          <div class="divide-y text-xs">
            ${grants
              .map(
                (g) => `
              <div class="py-2 flex items-center justify-between">
                <div>
                  <span class="font-mono font-bold text-primary">${g.permission_key}</span>
                  <div class="text-xxs text-secondary">Reason: ${g.grant_reason || 'Standard review task'}</div>
                </div>
                <div class="text-right">
                  <span class="badge badge--amber badge--xs">
                    ⏳ ${g.remaining_minutes !== null ? `${g.remaining_minutes}m left` : 'Permanent'}
                  </span>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        `
        }
      </div>
    `;
  }

  function renderMakerCheckerSubmissionsPanel() {
    const actions = dashboardData.submitted_actions || [];
    return `
      <div class="card p-4 space-y-3">
        <div class="flex items-center justify-between pb-2 border-b">
          <h3 class="font-bold text-sm flex items-center gap-2">
            📋 ${t('moderator_dashboard.maker_checker_title')}
          </h3>
          <span class="text-xxs text-secondary">Delegated Actions Tracker</span>
        </div>

        ${
          actions.length === 0
            ? `<div class="py-4 text-center text-xs text-secondary">${t('moderator_dashboard.no_submitted_actions')}</div>`
            : `
          <div class="divide-y text-xs">
            ${actions
              .map(
                (a) => `
              <div class="py-2.5 flex items-center justify-between">
                <div class="space-y-0.5">
                  <div class="flex items-center gap-2">
                    <span class="font-mono font-bold text-primary">${a.ref}</span>
                    <span class="badge badge--xs">${a.action_key}</span>
                    <span class="badge ${a.status === 'APPROVED' ? 'badge--emerald' : a.status === 'REJECTED' ? 'badge--rose' : 'badge--amber'} badge--xs">
                      ${a.status}
                    </span>
                  </div>
                  <div class="text-xxs text-secondary">
                    Target: <code>${a.target_entity} #${a.target_id || ''}</code> • Submitted: ${formatDate(a.created_at)}
                  </div>
                </div>
                <div class="text-right">
                  <span class="text-xxs text-secondary block">${a.approver_name ? `Approved by ${a.approver_name}` : 'Awaiting Sign-off'}</span>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        `
        }
      </div>
    `;
  }

  function render() {
    container.innerHTML = `
      <div class="moderator-home space-y-6 pb-12">
        <!-- Header -->
        <div class="flex items-center justify-between pb-4 border-b">
          <div>
            <h1 class="text-2xl font-bold flex items-center gap-2">
              🛡️ ${t('moderator_dashboard.page_title')}
            </h1>
            <p class="text-xs text-secondary">${t('moderator_dashboard.page_subtitle')}</p>
          </div>

          <div class="flex items-center gap-3">
            <button class="btn btn--secondary btn--xs flex items-center gap-1" id="btn-refresh-dashboard">
              🔄 ${t('common.refresh')}
            </button>
            <span class="badge badge--indigo badge--xs font-mono">Role: ${userRole.toUpperCase()}</span>
          </div>
        </div>

        <!-- Section 1: Workload Summary & Personal Performance -->
        <div id="workload-summary-mount"></div>

        <div class="grid grid-cols-3 gap-6">
          <div class="col-span-1">
            ${renderPerformanceStats()}
          </div>
          <div class="col-span-2" id="sla-monitor-mount"></div>
        </div>

        <!-- Section 2: Workspace Hub -->
        ${renderWorkspaceCards()}

        <!-- Section 3: Elevated Access & Maker-Checker Tracker -->
        <div class="grid grid-cols-2 gap-6">
          ${renderElevatedAccessPanel()}
          ${renderMakerCheckerSubmissionsPanel()}
        </div>
      </div>
    `;

    // Mount child widgets
    const workloadMount = container.querySelector('#workload-summary-mount');
    if (workloadMount) {
      workloadMount.appendChild(
        WorkloadSummary({
          workload: dashboardData.workload,
          onNavigate: (route) => {
            window.history.pushState({}, '', route);
            window.dispatchEvent(new Event('popstate'));
          },
        })
      );
    }

    const slaMount = container.querySelector('#sla-monitor-mount');
    if (slaMount) {
      slaMount.appendChild(
        SlaMonitor({
          items: dashboardData.sla_urgent_items,
          onInspectItem: (id, route) => {
            window.history.pushState({}, '', route);
            window.dispatchEvent(new Event('popstate'));
          },
        })
      );
    }

    attachListeners();
  }

  function attachListeners() {
    container.querySelector('#btn-refresh-dashboard')?.addEventListener('click', fetchAllData);

    container.querySelectorAll('.btn-open-ws').forEach((btn) => {
      btn.addEventListener('click', () => {
        const route = btn.getAttribute('data-route');
        window.history.pushState({}, '', route);
        window.dispatchEvent(new Event('popstate'));
      });
    });

    container.querySelectorAll('.btn-request-access').forEach((btn) => {
      btn.addEventListener('click', () => {
        const perm = btn.getAttribute('data-perm');
        openJitGrantDrawer(perm);
      });
    });
  }

  init();
  root.append(container);
}
