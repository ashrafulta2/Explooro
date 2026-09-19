/**
 * PenaltiesPage.js — Moderator Account Penalty & Suspension Enforcement (Prompt 7.7-A).
 *
 * Implements:
 * 1. Searchable user lookup by phone / email / user ID.
 * 2. Penalty type selector: Warning, Temporary Suspension, Permanent Ban, Score Deduction.
 * 3. Mandatory reason + duration for suspensions.
 * 4. Active penalty list with early-lift option.
 * 5. Penalty history log for accountability.
 *
 * Strings are i18n (en/bn); status/type colours use semantic design tokens.
 */

import { api } from '../../core/api.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatDate } from '../../services/format.js';

const PENALTY_TYPES = [
  { key: 'WARNING',      icon: '⚠️', labelKey: 'mod_penalties.ptype_warning',      color: 'var(--warning-800,#854d0e)', bg: 'var(--warning-100,#fef9c3)', border: 'var(--warning-300,#fde047)', requiresDuration: false },
  { key: 'TEMP_BAN',     icon: '🚫', labelKey: 'mod_penalties.ptype_temp_ban',     color: 'var(--danger-800,#7f1d1d)',  bg: 'var(--danger-100,#fee2e2)',  border: 'var(--danger-300,#fca5a5)',  requiresDuration: true  },
  { key: 'PERM_BAN',     icon: '🔴', labelKey: 'mod_penalties.ptype_perm_ban',     color: 'var(--danger-800,#7f1d1d)',  bg: 'var(--danger-100,#fee2e2)',  border: 'var(--danger-500,#ef4444)',  requiresDuration: false },
  { key: 'SCORE_DEDUCT', icon: '📉', labelKey: 'mod_penalties.ptype_score_deduct', color: 'var(--info-800,#005593)',    bg: 'var(--info-100,#dbeafe)',    border: 'var(--info-300,#93c5fd)',    requiresDuration: false },
];

const STATUS_COLORS = {
  ACTIVE:   { bg: 'var(--danger-100,#fee2e2)',  text: 'var(--danger-800,#7f1d1d)',    border: 'var(--danger-300,#fca5a5)',  labelKey: 'mod_penalties.status_active' },
  LIFTED:   { bg: 'var(--success-100,#dcfce7)', text: 'var(--success-800,#166534)',   border: 'var(--success-300,#86efac)', labelKey: 'mod_penalties.status_lifted' },
  EXPIRED:  { bg: 'var(--surface-2,#f1f5f9)',   text: 'var(--text-secondary,#64748b)',border: 'var(--border-default,#cbd5e1)', labelKey: 'mod_penalties.status_expired' },
};

export default function PenaltiesPage(root) {
  const container = document.createElement('div');
  container.className = 'penalties-page';
  container.style.cssText = `
    max-width:1100px;margin:0 auto;padding:24px 20px 56px;
    display:flex;flex-direction:column;gap:24px;
    color:var(--text-primary,#0f172a);background:var(--surface-0,transparent);font-family:inherit;
  `;

  let searchQuery    = '';
  let searchResults  = [];
  let selectedUser   = null;
  let penaltyType    = 'WARNING';
  let durationDays   = 7;
  let reason         = '';
  let activePenalties= [];
  let penaltyHistory = [];
  let loadingHistory = true;
  let submitting     = false;

  const ptypeLabel = (pt) => (pt.icon ? pt.icon + ' ' : '') + t(pt.labelKey, pt.key);

  async function fetchHistory() {
    loadingHistory = true;
    renderHistory();
    try {
      const res = await api.get('/moderation/penalties?limit=30');
      if (Array.isArray(res?.data)) penaltyHistory = res.data;
      else if (Array.isArray(res?.data?.items)) penaltyHistory = res.data.items;
    } catch {}
    try {
      const ar = await api.get('/moderation/penalties?status=ACTIVE&limit=20');
      if (Array.isArray(ar?.data)) activePenalties = ar.data;
      else if (Array.isArray(ar?.data?.items)) activePenalties = ar.data.items;
    } catch {}
    loadingHistory = false;
    renderHistory();
  }

  async function searchUsers() {
    if (!searchQuery.trim()) return;
    try {
      const res = await api.get('/admin/users?q=' + encodeURIComponent(searchQuery) + '&limit=8');
      searchResults = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.data?.users) ? res.data.users : []);
    } catch { searchResults = []; }
    renderSearchResults();
  }

  async function submitPenalty() {
    if (!selectedUser) { toast.error(t('mod_penalties.select_user_first', 'Select a user first.')); return; }
    if (!reason.trim())  { toast.error(t('mod_penalties.reason_required', 'Reason is required.')); return; }
    submitting = true;
    renderForm();
    try {
      const payload = { user_id: selectedUser.id, user_name: selectedUser.name, penalty_type: penaltyType, reason };
      const pt = PENALTY_TYPES.find(p => p.key === penaltyType);
      if (pt?.requiresDuration) payload.duration_days = durationDays;
      await api.post('/moderation/penalties', payload);
      toast.success(t('mod_penalties.apply_success', 'Penalty applied successfully.'));
      selectedUser = null; searchResults = []; reason = ''; penaltyType = 'WARNING';
      fetchHistory();
    } catch (err) {
      toast.error(err?.message || t('mod_penalties.apply_failed', 'Failed to apply penalty.'));
    }
    submitting = false;
    renderForm();
  }

  async function liftPenalty(penaltyId) {
    if (!confirm(t('mod_penalties.lift_confirm', 'Lift this penalty early? This action is logged.'))) return;
    try {
      await api.post('/moderation/penalties/' + penaltyId + '/lift');
      toast.success(t('mod_penalties.lift_success', 'Penalty lifted.'));
      fetchHistory();
    } catch (err) { toast.error(err?.message || t('mod_penalties.lift_failed', 'Failed to lift penalty.')); }
  }

  // ─── Render pieces ───────────────────────────────────────────────────────
  function renderSearchResults() {
    const el = container.querySelector('#user-search-results');
    if (!el) return;
    if (!searchResults.length) { el.innerHTML = `<p style="margin:0;padding:8px 12px;font-size:0.82rem;color:var(--text-secondary,#64748b);">${t('mod_penalties.no_users', 'No users found.')}</p>`; return; }
    el.innerHTML = searchResults.map(u => `
      <button class="btn-select-user" data-id="${u.id}" data-name="${u.full_name||u.phone||'User'}" data-phone="${u.phone||''}"
        style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;border-bottom:1px solid var(--border-subtle,#f1f5f9);
        background:var(--surface-1,#fff);cursor:pointer;font-size:0.875rem;color:var(--text-primary,#0f172a);">
        <strong>${u.full_name || t('mod_penalties.unnamed', 'Unnamed')}</strong>
        <span style="color:var(--text-secondary,#64748b);margin-left:8px;">${u.phone||u.email||''}</span>
        <span style="float:right;font-size:0.72rem;color:var(--text-secondary,#94a3b8);">ID:${u.id}</span>
      </button>
    `).join('');
    el.querySelectorAll('.btn-select-user').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedUser = { id: btn.getAttribute('data-id'), name: btn.getAttribute('data-name'), phone: btn.getAttribute('data-phone') };
        searchResults = [];
        el.innerHTML = '';
        renderForm();
      });
    });
  }

  function renderForm() {
    const el = container.querySelector('#penalty-form-area');
    if (!el) return;
    const pt = PENALTY_TYPES.find(p => p.key === penaltyType) || PENALTY_TYPES[0];
    el.innerHTML = `
      <div style="background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:14px;padding:20px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <h2 style="margin:0 0 18px;font-size:1rem;font-weight:700;color:var(--text-primary,#0f172a);">
          🚫 ${t('mod_penalties.form_title', 'Issue Penalty')}
        </h2>

        <!-- User Search -->
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary,#64748b);margin-bottom:6px;text-transform:uppercase;">
            ${t('mod_penalties.search_label', 'Search User')}
          </label>
          ${selectedUser ? `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
              border-radius:9px;background:var(--success-50,#f0fdf4);border:1px solid var(--success-300,#86efac);">
              <span style="font-size:0.875rem;font-weight:600;">✅ ${selectedUser.name}
                <span style="font-weight:400;color:var(--text-secondary,#64748b);margin-left:6px;">${selectedUser.phone}</span>
              </span>
              <button id="btn-clear-user" style="font-size:0.75rem;border:none;background:none;
                cursor:pointer;color:var(--danger-700,#b91c1c);font-weight:600;">✕ ${t('mod_penalties.clear', 'Clear')}</button>
            </div>
          ` : `
            <div style="position:relative;">
              <input id="inp-user-search" type="text" value="${searchQuery}"
                aria-label="${t('mod_penalties.search_label', 'Search for a user')}"
                placeholder="${t('mod_penalties.search_placeholder', 'Name, phone, email or user ID…')}"
                style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border-default,#e2e8f0);
                font-size:0.875rem;background:var(--surface-0,#f8fafc);box-sizing:border-box;">
              <button id="btn-search-user" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);
                border:none;background:var(--brand,#f59e0b);color:var(--brand-contrast,#fff);padding:4px 12px;
                border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;">${t('mod_penalties.search_btn', 'Search')}</button>
            </div>
            <div id="user-search-results" style="border:1px solid var(--border-default,#e2e8f0);border-top:none;
              border-radius:0 0 8px 8px;max-height:200px;overflow-y:auto;background:var(--surface-1,#fff);">
            </div>
          `}
        </div>

        <!-- Penalty Type -->
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary,#64748b);margin-bottom:6px;text-transform:uppercase;">
            ${t('mod_penalties.type_label', 'Penalty Type')}
          </label>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;">
            ${PENALTY_TYPES.map(p => `
              <button class="btn-penalty-type" data-key="${p.key}"
                style="padding:10px 12px;border-radius:9px;font-size:0.82rem;font-weight:600;cursor:pointer;text-align:left;
                border:2px solid ${penaltyType===p.key ? p.border : 'var(--border-default,#e2e8f0)'};
                background:${penaltyType===p.key ? p.bg : 'var(--surface-0,#f8fafc)'};
                color:${penaltyType===p.key ? p.color : 'var(--text-primary,#0f172a)'};">
                ${ptypeLabel(p)}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Duration (if applicable) -->
        ${pt.requiresDuration ? `
          <div style="margin-bottom:16px;">
            <label for="inp-duration" style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary,#64748b);margin-bottom:6px;text-transform:uppercase;">
              ${t('mod_penalties.duration_label', 'Duration (days)')}
            </label>
            <input id="inp-duration" type="number" min="1" max="365" value="${durationDays}"
              style="width:120px;padding:8px 12px;border-radius:8px;border:1px solid var(--border-default,#e2e8f0);
              font-size:0.875rem;background:var(--surface-0,#f8fafc);">
          </div>
        ` : ''}

        <!-- Reason -->
        <div style="margin-bottom:20px;">
          <label for="inp-reason" style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-secondary,#64748b);margin-bottom:6px;text-transform:uppercase;">
            ${t('mod_penalties.reason_label', 'Reason')} <span style="color:var(--danger-700,#b91c1c);">*</span>
          </label>
          <textarea id="inp-reason" rows="3"
            placeholder="${t('mod_penalties.reason_placeholder', 'Describe the violation clearly. This is sent to the user and logged for audit.')}"
            style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border-default,#e2e8f0);
            font-size:0.875rem;background:var(--surface-0,#f8fafc);resize:vertical;box-sizing:border-box;"
            >${reason}</textarea>
        </div>

        <button id="btn-submit-penalty"
          style="padding:10px 28px;border-radius:8px;border:none;cursor:${submitting?'not-allowed':'pointer'};
          font-size:0.875rem;font-weight:700;background:${submitting?'var(--text-secondary,#94a3b8)':'var(--danger,#b91c1c)'};color:var(--text-inverse,#fff);">
          ${submitting ? t('mod_penalties.submitting', 'Submitting…') : '🚫 ' + t('mod_penalties.submit', 'Apply Penalty')}
        </button>
      </div>
    `;
    attachFormListeners();
  }

  function renderHistory() {
    const el = container.querySelector('#penalty-history-area');
    if (!el) return;

    const pulse = '<div style="height:80px;border-radius:10px;background:var(--surface-1,#f1f5f9);animation:pen-pulse 1.4s ease-in-out infinite;margin-bottom:8px;"></div>';

    el.innerHTML = `
      <!-- Active Penalties -->
      <div style="background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:14px;padding:20px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <h2 style="margin:0 0 16px;font-size:1rem;font-weight:700;color:var(--text-primary,#0f172a);
          display:flex;align-items:center;gap:8px;">
          🔴 ${t('mod_penalties.active_title', 'Active Penalties')}
          ${activePenalties.length>0?`<span style="font-size:0.75rem;padding:2px 10px;border-radius:999px;background:var(--danger-100,#fee2e2);color:var(--danger-800,#7f1d1d);border:1px solid var(--danger-300,#fca5a5);">${activePenalties.length}</span>`:''}
        </h2>
        ${loadingHistory ? pulse : activePenalties.length===0 ? `
          <p style="margin:0;padding:20px 0;text-align:center;font-size:0.875rem;color:var(--text-secondary,#64748b);">
            ${t('mod_penalties.no_active', 'No active penalties at this time.')}
          </p>
        ` : activePenalties.map(p => renderPenaltyRow(p, true)).join('')}
      </div>

      <!-- History -->
      <div style="background:var(--surface-1,#fff);border:1px solid var(--border-default,#e2e8f0);
        border-radius:14px;padding:20px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
        <h2 style="margin:0 0 16px;font-size:1rem;font-weight:700;color:var(--text-primary,#0f172a);">
          📋 ${t('mod_penalties.history_title', 'Penalty History')}
        </h2>
        ${loadingHistory ? pulse+pulse : penaltyHistory.length===0 ? `
          <p style="margin:0;padding:20px 0;text-align:center;font-size:0.875rem;color:var(--text-secondary,#64748b);">${t('mod_penalties.no_history', 'No history yet.')}</p>
        ` : penaltyHistory.map(p => renderPenaltyRow(p, false)).join('')}
      </div>
    `;

    container.querySelectorAll('.btn-lift-penalty').forEach(btn => {
      btn.addEventListener('click', () => liftPenalty(btn.getAttribute('data-id')));
    });
  }

  function renderPenaltyRow(p, showLift) {
    const statusKey = p.status || (p.lifted_at ? 'LIFTED' : 'ACTIVE');
    const sc = STATUS_COLORS[statusKey] || STATUS_COLORS.EXPIRED;
    const ptDef = PENALTY_TYPES.find(x => x.key === p.penalty_type);
    return `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
        padding:12px 0;border-bottom:1px solid var(--border-subtle,#f1f5f9);">
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap;">
            <strong style="font-size:0.875rem;color:var(--text-primary,#0f172a);">
              ${p.user_name||p.user?.full_name||'User #'+p.user_id}
            </strong>
            <span style="font-size:0.7rem;padding:2px 8px;border-radius:999px;font-weight:700;text-transform:uppercase;
              background:${sc.bg};color:${sc.text};border:1px solid ${sc.border};">
              ${t(sc.labelKey, statusKey)}
            </span>
            ${ptDef?`<span style="font-size:0.72rem;font-weight:600;color:${ptDef.color};">${ptypeLabel(ptDef)}</span>`:''}
          </div>
          <p style="margin:0;font-size:0.8rem;color:var(--text-secondary,#64748b);">
            ${p.reason||t('mod_penalties.no_reason', 'No reason provided')}
            ${p.duration_days?` · ${p.duration_days}d`:''}
            ${p.created_at?` · ${formatDate(p.created_at)}`:''}
            ${p.issued_by_name?` · ${t('mod_penalties.by', 'by {{name}}', { name: p.issued_by_name })}`:''}
          </p>
        </div>
        ${showLift && statusKey==='ACTIVE' ? `
          <button class="btn-lift-penalty" data-id="${p.id}"
            style="flex-shrink:0;font-size:0.75rem;padding:5px 12px;border-radius:6px;
            border:1px solid var(--success-300,#86efac);background:var(--success-50,#f0fdf4);cursor:pointer;color:var(--success-700,#15803d);font-weight:600;">
            ${t('mod_penalties.lift', 'Lift')}
          </button>
        ` : ''}
      </div>
    `;
  }

  function attachFormListeners() {
    container.querySelector('#inp-user-search')?.addEventListener('input', e => { searchQuery = e.target.value; });
    container.querySelector('#btn-search-user')?.addEventListener('click', searchUsers);
    container.querySelector('#btn-clear-user')?.addEventListener('click', () => { selectedUser = null; renderForm(); });
    container.querySelectorAll('.btn-penalty-type').forEach(btn => {
      btn.addEventListener('click', () => { penaltyType = btn.getAttribute('data-key'); renderForm(); });
    });
    container.querySelector('#inp-duration')?.addEventListener('input', e => { durationDays = parseInt(e.target.value)||7; });
    container.querySelector('#inp-reason')?.addEventListener('input', e => { reason = e.target.value; });
    container.querySelector('#btn-submit-penalty')?.addEventListener('click', submitPenalty);
  }

  function render() {
    container.innerHTML = `
      <style>@keyframes pen-pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:0;">
        <div>
          <h1 style="margin:0 0 4px;font-size:1.6rem;font-weight:700;color:var(--text-primary,#0f172a);letter-spacing:-0.3px;">
            ${t('mod_penalties.title', 'Penalties & Suspensions')}
          </h1>
          <p style="margin:0;font-size:0.93rem;color:var(--text-secondary,#64748b);">
            ${t('mod_penalties.subtitle', 'Issue warnings, temporary suspensions, or permanent bans against violating accounts.')}
          </p>
        </div>
      </div>
      <div id="penalty-form-area"></div>
      <div id="penalty-history-area" style="display:flex;flex-direction:column;gap:16px;"></div>
    `;
    renderForm();
    fetchHistory();
  }

  render();
  root.append(container);
}
