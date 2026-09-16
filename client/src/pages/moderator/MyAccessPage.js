/**
 * MyAccessPage.js — Moderator Personal Access & Permission Dashboard (Prompt 7.7).
 *
 * Implements:
 * 1. Current Role & Permission Summary — shows the moderator assigned role and all
 *    granted permissions grouped by category (Queues, Cases, Enforcement).
 * 2. Active Elevated Grants panel — lists time-boxed JIT grants with expiry countdowns
 *    and a revoke option.
 * 3. Pending Grant Requests tracker — shows submitted requests awaiting Maker-Checker approval.
 * 4. Request Access — one-click JIT grant request via the shared GrantDrawer.
 * 5. Access History — last 20 grant events (issued, revoked, expired) for auditability.
 *
 * Strings resolve through the i18n engine (en/bn); colours use semantic design tokens so the page
 * follows the active theme (the earlier `--brand-primary` / `--border` tokens were undefined and
 * silently fell back to hardcoded amber/grey).
 */

import { api } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatDate } from '../../services/format.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';
import { appStore } from '../../state/appStore.js';

// labelKey/categoryKey resolve through i18n at render; risk_tier drives the badge colour.
const MODERATOR_PERMISSIONS = [
  { key: 'moderation.product.approve', labelKey: 'mod_access.perm_product', categoryKey: 'mod_access.cat_queues',      category: 'Queues',      risk_tier: 'MEDIUM' },
  { key: 'moderation.review.handle',   labelKey: 'mod_access.perm_review',  categoryKey: 'mod_access.cat_queues',      category: 'Queues',      risk_tier: 'LOW'    },
  { key: 'moderation.ugc.approve',     labelKey: 'mod_access.perm_ugc',     categoryKey: 'mod_access.cat_queues',      category: 'Queues',      risk_tier: 'LOW'    },
  { key: 'moderation.live.handle',     labelKey: 'mod_access.perm_live',    categoryKey: 'mod_access.cat_queues',      category: 'Queues',      risk_tier: 'MEDIUM' },
  { key: 'orders.return.review',       labelKey: 'mod_access.perm_returns', categoryKey: 'mod_access.cat_cases',       category: 'Cases',       risk_tier: 'MEDIUM' },
  { key: 'orders.dispute.arbitrate',   labelKey: 'mod_access.perm_dispute', categoryKey: 'mod_access.cat_cases',       category: 'Cases',       risk_tier: 'HIGH'   },
  { key: 'moderation.report.handle',   labelKey: 'mod_access.perm_report',  categoryKey: 'mod_access.cat_cases',       category: 'Cases',       risk_tier: 'MEDIUM' },
  { key: 'users.account.penalise',     labelKey: 'mod_access.perm_penalty', categoryKey: 'mod_access.cat_enforcement', category: 'Enforcement', risk_tier: 'HIGH'   },
  { key: 'users.kyc.approve',          labelKey: 'mod_access.perm_kyc',     categoryKey: 'mod_access.cat_enforcement', category: 'Enforcement', risk_tier: 'HIGH'   },
];

// Semantic tokens (with hex fallbacks) so risk badges track the theme, not a fixed palette.
const RISK_COLORS = {
  LOW:    { bg: 'var(--success-100,#dcfce7)', text: 'var(--success-700,#15803d)', border: 'var(--success-300,#86efac)', labelKey: 'mod_access.risk_low' },
  MEDIUM: { bg: 'var(--warning-100,#fef9c3)', text: 'var(--warning-700,#854d0e)', border: 'var(--warning-300,#fde047)', labelKey: 'mod_access.risk_medium' },
  HIGH:   { bg: 'var(--danger-100,#fee2e2)',  text: 'var(--danger-700,#b91c1c)',  border: 'var(--danger-300,#fca5a5)',  labelKey: 'mod_access.risk_high' },
};

export default function MyAccessPage(root) {
  const container = document.createElement('div');
  container.className = 'my-access-page';
  container.style.cssText = `
    max-width:1100px;margin:0 auto;padding:24px 20px 56px;
    display:flex;flex-direction:column;gap:24px;
    color:var(--text-primary,#0f172a);background:var(--surface-0,transparent);font-family:inherit;
  `;

  let myPermissions   = [];
  const currentRole = appStore.get()?.auth?.role || 'moderator';
  let myRoles         = [currentRole];
  let activeGrants    = [];
  let pendingRequests = [];
  let accessHistory   = [];
  let loading         = true;

  async function fetchData() {
    loading = true;
    render();
    try {
      const permRes = await api.get('/me/permissions');
      if (permRes?.data?.permissions) myPermissions = permRes.data.permissions;
      if (Array.isArray(permRes?.data?.roles) && permRes.data.roles.length > 0) myRoles = permRes.data.roles;
    } catch {}
    try {
      const gr = await api.get('/me/grants');
      activeGrants = Array.isArray(gr?.data) ? gr.data : (Array.isArray(gr?.data?.active) ? gr.data.active : []);
    } catch {}
    try {
      const pr = await api.get('/me/grants/pending');
      if (Array.isArray(pr?.data)) pendingRequests = pr.data;
    } catch {}
    try {
      const hr = await api.get('/me/grants/history?limit=20');
      if (Array.isArray(hr?.data)) accessHistory = hr.data;
    } catch {}
    loading = false;
    render();
  }

  function hasPermission(key) {
    if (myRoles.includes('super_admin') || myRoles.includes('admin')) return true;
    return myPermissions.includes(key);
  }

  function permLabel(p) {
    // Prefer the client i18n label; fall back to any server-provided label, then a humanized key.
    return t(p.labelKey, p.label || p.key);
  }

  function formatExpiry(expiresAt) {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return t('mod_access.expired', 'Expired');
    const hours = Math.floor(ms / 3600000);
    const days  = Math.floor(hours / 24);
    if (days > 0) return t('mod_access.expires_days', 'Expires in {{days}}d {{hours}}h', { days, hours: hours % 24 });
    return t('mod_access.expires_hours', 'Expires in {{hours}}h {{minutes}}m', { hours, minutes: Math.floor((ms % 3600000) / 60000) });
  }

  async function revokeGrant(grantId) {
    if (!confirm(t('mod_access.revoke_confirm', 'Revoke this elevated access grant? This cannot be undone.'))) return;
    try {
      await api.delete('/me/grants/' + grantId);
      toast.success(t('mod_access.revoke_success', 'Grant revoked successfully.'));
      fetchData();
    } catch (err) {
      toast.error(err?.message || t('mod_access.revoke_failed', 'Failed to revoke grant.'));
    }
  }

  function renderSkeleton() {
    return Array.from({ length: 3 }, () =>
      '<div style="height:120px;border-radius:12px;background:var(--surface-1,#f1f5f9);animation:mac-pulse 1.4s ease-in-out infinite;"></div>'
    ).join('');
  }

  function renderHeader() {
    const roleLabel = (myRoles[0] || 'moderator').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    return `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="margin:0 0 4px;font-size:1.6rem;font-weight:700;color:var(--text-primary,#0f172a);letter-spacing:-0.3px;">
            ${t('mod_access.title', 'My Access')}
          </h1>
          <p style="margin:0;font-size:0.93rem;color:var(--text-secondary,#64748b);">
            ${t('mod_access.subtitle', 'Your current role, permissions and elevated access grants.')}
          </p>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;
            background:var(--warning-100,#fef3c7);color:var(--warning-800,#92400e);
            font-size:0.8rem;font-weight:600;border:1px solid var(--warning-300,#fcd34d);">
            🔒 ${roleLabel}
          </span>
          <button id="btn-request-access" style="display:inline-flex;align-items:center;gap:6px;
            padding:8px 18px;border-radius:8px;border:none;cursor:pointer;font-size:0.875rem;
            font-weight:600;background:var(--brand,#f59e0b);color:var(--brand-contrast,#fff);">
            + ${t('mod_access.request_access', 'Request Access')}
          </button>
          <button id="btn-refresh-access" style="display:inline-flex;align-items:center;gap:6px;
            padding:8px 14px;border-radius:8px;border:1px solid var(--border-default,#e2e8f0);cursor:pointer;
            font-size:0.875rem;font-weight:500;background:var(--surface-1,#fff);
            color:var(--text-secondary,#64748b);">
            ↻ ${t('mod_access.refresh', 'Refresh')}
          </button>
        </div>
      </div>
    `;
  }

  function renderPermissionsSection() {
    const grantedCount = MODERATOR_PERMISSIONS.filter(p => hasPermission(p.key)).length;
    const categories   = [...new Set(MODERATOR_PERMISSIONS.map(p => p.category))];
    return `
      <div style="background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:14px;padding:20px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <h2 style="margin:0 0 16px;font-size:1rem;font-weight:700;color:var(--text-primary,#0f172a);
          display:flex;align-items:center;gap:8px;">
          🛡️ ${t('mod_access.permissions_title', 'My Permissions')}
          <span style="font-size:0.75rem;font-weight:500;color:var(--text-secondary,#64748b);
            background:var(--surface-2,#f1f5f9);padding:2px 10px;border-radius:999px;">
            ${t('mod_access.granted_ratio', '{{granted}} / {{total}} granted', { granted: grantedCount, total: MODERATOR_PERMISSIONS.length })}
          </span>
        </h2>
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${categories.map(cat => {
            const perms = MODERATOR_PERMISSIONS.filter(p => p.category === cat);
            const catLabel = t(perms[0].categoryKey, cat);
            return `
              <div>
                <p style="margin:0 0 8px;font-size:0.72rem;font-weight:700;letter-spacing:0.08em;
                  text-transform:uppercase;color:var(--text-secondary,#64748b);">${catLabel}</p>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  ${perms.map(p => {
                    const granted = hasPermission(p.key);
                    const risk    = RISK_COLORS[p.risk_tier] || RISK_COLORS.LOW;
                    return `
                      <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:10px 14px;border-radius:9px;gap:12px;
                        background:${granted?'var(--surface-0,#f8fafc)':'var(--surface-2,#f1f5f9)'};
                        border:1px solid ${granted?'var(--border-default,#e2e8f0)':'transparent'};
                        opacity:${granted?'1':'0.65'};">
                        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                          <span>${granted?'✅':'🔒'}</span>
                          <span style="font-size:0.875rem;font-weight:500;color:var(--text-primary,#0f172a);
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${permLabel(p)}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                          <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:999px;
                            background:${risk.bg};color:${risk.text};border:1px solid ${risk.border};">
                            ${t(risk.labelKey, p.risk_tier)}
                          </span>
                          ${!granted ? `
                            <button class="btn-request-perm" data-perm="${p.key}"
                              style="font-size:0.75rem;padding:4px 10px;border-radius:6px;
                              border:1px solid var(--border-default,#e2e8f0);background:var(--surface-1,#fff);
                              cursor:pointer;color:var(--text-primary,#0f172a);font-weight:500;">
                              ${t('mod_access.request', 'Request')}
                            </button>
                          ` : ''}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderActiveGrants() {
    return `
      <div style="background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:14px;padding:20px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <h2 style="margin:0 0 16px;font-size:1rem;font-weight:700;color:var(--text-primary,#0f172a);
          display:flex;align-items:center;gap:8px;">
          ⚡ ${t('mod_access.active_grants_title', 'Active Elevated Grants')}
          ${activeGrants.length > 0 ? `
            <span style="font-size:0.75rem;font-weight:600;padding:2px 10px;border-radius:999px;
              background:var(--success-100,#dcfce7);color:var(--success-700,#15803d);border:1px solid var(--success-300,#86efac);">
              ${t('mod_access.active_count', '{{count}} active', { count: activeGrants.length })}
            </span>
          ` : ''}
        </h2>
        ${activeGrants.length === 0 ? `
          <div style="padding:28px 0;text-align:center;">
            <div style="font-size:2rem;margin-bottom:8px;">🔓</div>
            <p style="margin:0;font-size:0.875rem;color:var(--text-secondary,#64748b);">
              ${t('mod_access.no_grants', 'No elevated grants active. All access is via your base moderator role.')}
            </p>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${activeGrants.map(g => {
              const expiresAt = g.expires_at || g.expiry;
              const expired   = expiresAt && new Date(expiresAt).getTime() <= Date.now();
              return `
                <div style="display:flex;align-items:flex-start;justify-content:space-between;
                  padding:12px 16px;border-radius:10px;gap:12px;
                  background:${expired?'var(--surface-2,#f1f5f9)':'var(--success-50,#f0fdf4)'};
                  border:1px solid ${expired?'var(--border-default,#e2e8f0)':'var(--success-300,#86efac)'};">
                  <div style="min-width:0;">
                    <p style="margin:0 0 2px;font-size:0.875rem;font-weight:600;color:var(--text-primary,#0f172a);">
                      ${g.permission_label || g.permission_key || t('mod_access.unknown_permission', 'Unknown Permission')}
                    </p>
                    <p style="margin:0;font-size:0.78rem;color:var(--text-secondary,#64748b);">
                      ${t('mod_access.issued_by', 'Issued by {{name}}', { name: g.issued_by || g.granted_by || 'System' })}
                      ${expiresAt ? ' · <span style="color:' + (expired?'var(--danger-700,#b91c1c)':'var(--success-700,#15803d)') + ';font-weight:500;">'
                        + formatExpiry(expiresAt) + '</span>' : ' · ' + t('mod_access.permanent', 'Permanent')}
                      ${g.reason ? ' · "' + g.reason + '"' : ''}
                    </p>
                  </div>
                  ${!expired ? `
                    <button class="btn-revoke-grant" data-grant-id="${g.id}"
                      style="flex-shrink:0;font-size:0.75rem;padding:5px 12px;border-radius:6px;
                      border:1px solid var(--danger-300,#fca5a5);background:var(--surface-1,#fff);cursor:pointer;color:var(--danger-700,#b91c1c);
                      font-weight:500;white-space:nowrap;">${t('mod_access.revoke', 'Revoke')}</button>
                  ` : '<span style="font-size:0.72rem;color:var(--text-secondary,#94a3b8);padding:4px 8px;">' + t('mod_access.expired', 'Expired') + '</span>'}
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  function renderPendingRequests() {
    if (pendingRequests.length === 0) return '';
    return `
      <div style="background:var(--surface-1,#fff);border:1px solid var(--warning-300,#fde047);
        border-radius:14px;padding:20px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <h2 style="margin:0 0 16px;font-size:1rem;font-weight:700;color:var(--text-primary,#0f172a);
          display:flex;align-items:center;gap:8px;">
          ⏳ ${t('mod_access.pending_title', 'Pending Grant Requests')}
          <span style="font-size:0.75rem;font-weight:600;padding:2px 10px;border-radius:999px;
            background:var(--warning-100,#fef9c3);color:var(--warning-700,#854d0e);border:1px solid var(--warning-300,#fde047);">
            ${t('mod_access.pending_count', '{{count}} awaiting approval', { count: pendingRequests.length })}
          </span>
        </h2>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${pendingRequests.map(r => `
            <div style="display:flex;align-items:center;justify-content:space-between;
              padding:10px 14px;border-radius:9px;background:var(--warning-50,#fefce8);border:1px solid var(--warning-300,#fde047);gap:12px;">
              <div>
                <p style="margin:0 0 2px;font-size:0.875rem;font-weight:600;color:var(--text-primary,#0f172a);">
                  ${r.permission_label || r.permission_key || t('mod_access.unknown_permission', 'Unknown Permission')}
                </p>
                <p style="margin:0;font-size:0.78rem;color:var(--text-secondary,#64748b);">
                  ${t('mod_access.submitted_at', 'Submitted {{date}}', { date: r.submitted_at ? formatDate(r.submitted_at) : t('mod_access.submitted_recently', 'recently') })}
                  ${r.reason ? ' · "' + r.reason + '"' : ''}
                </p>
              </div>
              <span style="font-size:0.72rem;font-weight:700;padding:3px 10px;border-radius:999px;
                background:var(--warning-100,#fef9c3);color:var(--warning-700,#854d0e);border:1px solid var(--warning-300,#fde047);white-space:nowrap;text-transform:uppercase;">
                ${t('mod_access.status_pending', 'Pending')}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderAccessHistory() {
    if (accessHistory.length === 0) return '';
    const ICONS = { granted: '✅', revoked: '❌', expired: '⏰', requested: '📨' };
    const EVENT_KEYS = { granted: 'mod_access.event_granted', revoked: 'mod_access.event_revoked', expired: 'mod_access.event_expired', requested: 'mod_access.event_requested' };
    return `
      <div style="background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:14px;padding:20px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <h2 style="margin:0 0 16px;font-size:1rem;font-weight:700;color:var(--text-primary,#0f172a);">
          📋 ${t('mod_access.history_title', 'Access History')}
        </h2>
        <div style="display:flex;flex-direction:column;">
          ${accessHistory.map((ev, i) => `
            <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;
              ${i < accessHistory.length - 1 ? 'border-bottom:1px solid var(--border-subtle,#f1f5f9);' : ''}">
              <span style="font-size:1rem;flex-shrink:0;margin-top:1px;">
                ${ICONS[ev.event_type] || '🔵'}
              </span>
              <div style="min-width:0;flex:1;">
                <p style="margin:0 0 2px;font-size:0.875rem;font-weight:500;color:var(--text-primary,#0f172a);">
                  ${ev.permission_label || ev.permission_key || t('mod_access.unknown_permission', 'Unknown Permission')}
                  <span style="font-weight:400;color:var(--text-secondary,#64748b);">
                    — ${t(EVENT_KEYS[ev.event_type] || 'mod_access.event_generic', (ev.event_type || 'event').replace(/_/g,' '))}
                  </span>
                </p>
                <p style="margin:0;font-size:0.78rem;color:var(--text-secondary,#94a3b8);">
                  ${ev.actor || ev.issued_by || 'System'} ·
                  ${ev.created_at ? formatDate(ev.created_at) : '—'}
                </p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function render() {
    container.innerHTML = `
      <style>
        @keyframes mac-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .my-access-page button { transition: opacity 0.15s; }
        .my-access-page button:hover { opacity: 0.8; }
      </style>
      ${renderHeader()}
      ${loading ? renderSkeleton() : `
        ${renderPermissionsSection()}
        ${renderActiveGrants()}
        ${renderPendingRequests()}
        ${renderAccessHistory()}
      `}
    `;
    attachListeners();
  }

  function attachListeners() {
    container.querySelector('#btn-request-access')?.addEventListener('click', () => {
      openGrantDrawer({
        permissions: MODERATOR_PERMISSIONS.map(p => ({ ...p, label: permLabel(p) })),
        onSuccess: () => { toast.success(t('mod_access.request_submitted', 'Access request submitted.')); fetchData(); },
      });
    });

    container.querySelector('#btn-refresh-access')?.addEventListener('click', fetchData);

    container.querySelectorAll('.btn-request-perm').forEach(btn => {
      btn.addEventListener('click', () => {
        const permKey  = btn.getAttribute('data-perm');
        const permMeta = MODERATOR_PERMISSIONS.find(p => p.key === permKey);
        if (!permMeta) return;
        openGrantDrawer({
          permissions: [{ ...permMeta, label: permLabel(permMeta) }],
          onSuccess: () => { toast.success(t('mod_access.request_submitted', 'Access request submitted.')); fetchData(); },
        });
      });
    });

    container.querySelectorAll('.btn-revoke-grant').forEach(btn => {
      btn.addEventListener('click', () => revokeGrant(btn.getAttribute('data-grant-id')));
    });
  }

  fetchData();
  root.append(container);
}
