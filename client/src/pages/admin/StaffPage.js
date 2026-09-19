/**
 * StaffPage.js — Staff Management, Security Governance & Provisioning (Prompt 3.3 / Prompt 11.4).
 *
 * Implements:
 * 1. Security vitals (total, active, 2FA coverage, privileged admins) computed from the WHOLE
 *    roster — a search or filter never changes what the security posture looks like.
 * 2. Searchable roster with role / status / 2FA filters, server pagination and CSV export.
 * 3. Provision modal (validated, field-level server errors, role explainer).
 * 4. Change-role modal, suspend / reactivate / reset-2FA through reason-required confirmations,
 *    and re-send invite — every write carries a reason for the audit log.
 * 5. Detail drawer with the account's facts and its change timeline.
 * 6. Guard rails: no self-service on your own row, and the API refuses to demote or suspend the
 *    last active Super Admin.
 * 7. Layout-mirroring skeleton, empty / error states, permission-gated actions, EN ⇄ BN.
 */

import { Button } from '../../components/ui/Button.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Input } from '../../components/ui/Input.js';
import { Modal } from '../../components/ui/Modal.js';
import { Pagination } from '../../components/ui/Pagination.js';
import { Select } from '../../components/ui/Select.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { api, pickMessage } from '../../core/api.js';
import { can } from '../../services/permissions.js';
import { getCurrentUser } from '../../services/session.js';
import { toast } from '../../services/toast.js';
import { describeWriteOutcome } from '../../services/writeOutcome.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate, formatNumber, formatPhone, formatRelativeTime, normaliseBdPhone } from '../../services/format.js';
import '../../styles/components/admin-staff.css';

const PAGE_SIZE = 8;
const EXPORT_PAGE_SIZE = 50;
const EXPORT_MAX_PAGES = 20;
const SEARCH_DEBOUNCE_MS = 250;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PRIVILEGED_ROLES = new Set(['super_admin', 'admin']);

const STATUS_VARIANT = { ACTIVE: 'success', INVITED: 'warning', SUSPENDED: 'danger' };
const ROLE_VARIANT = { super_admin: 'danger', admin: 'primary', moderator: 'info', editor: 'primary' };

const ICONS = {
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  download: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  alert: '<path d="M12 4 3 19h18L12 4Z"/><path d="M12 10v4M12 17h.01"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
};

function icon(name, size = 16) {
  return `<svg class="admin-staff__icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// A cell starting with = + - @ is executed as a formula by spreadsheet apps; staff names and
// departments are typed by admins, so neutralise them. Plain numbers are left alone.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (!PLAIN_NUMBER.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}

export default function StaffPage(root, { navigate } = {}) {
  const isBn = () => getLanguage() === 'bn';
  const num = (n) => formatNumber(n);
  // formatNumber() is money-shaped and pads to two decimals (36.4 -> "36.40"); a rate wants one at most.
  const pct = (n) => new Intl.NumberFormat(isBn() ? 'bn-BD' : 'en-US', { maximumFractionDigits: 1 }).format(n);

  const state = {
    rows: [],
    roles: [],
    vitals: null,
    total: 0,
    page: 1,
    totalPages: 1,
    loading: true,
    error: null,
    query: '',
    role: 'ALL',
    status: 'ALL',
    twoFactor: 'ALL',
  };

  // Answers arrive out of order when the admin types quickly; only the newest may paint.
  let requestSeq = 0;
  let debounceTimer = null;
  let drawer = null;
  let drawerStaffId = null;
  let disposed = false;

  const container = document.createElement('div');
  container.className = 'page admin-staff-page';

  // ── Helpers ────────────────────────────────────────────────────────────────────────────────

  const roleLabel = (s) => (isBn() ? s.role_label_bn : s.role_label_en) || s.role_key;
  const roleByKey = (key) => state.roles.find((r) => r.key === key);
  const roleName = (r) => (isBn() ? r.label_bn : r.label_en) || r.key;
  const roleDesc = (r) => (isBn() ? r.description_bn : r.description_en) || '';

  function isSelf(s) {
    const me = getCurrentUser();
    if (!me) return false;
    if (me.id != null && String(me.id) === String(s.id)) return true;
    return Boolean(me.email) && String(me.email).toLowerCase() === String(s.email).toLowerCase();
  }

  function statusLabel(status) {
    return t(`admin.staff.status_${String(status).toLowerCase()}`, status);
  }

  function errorMessage(err) {
    return (err && pickMessage(err)) || err?.message || t('admin.staff.generic_error', 'Something went wrong. Please try again.');
  }

  function successMessage(res, fallback) {
    return (isBn() ? res?.message_bn : res?.message_en) || fallback;
  }

  function lastActiveText(s) {
    if (!s.last_active_at) return t('admin.staff.never_signed_in', 'Never signed in');
    return formatRelativeTime(new Date(s.last_active_at).getTime());
  }

  function absoluteTime(iso) {
    return iso ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  function hasFilters() {
    return Boolean(state.query || state.role !== 'ALL' || state.status !== 'ALL' || state.twoFactor !== 'ALL');
  }

  // ── Data ───────────────────────────────────────────────────────────────────────────────────

  function queryParams(page, limit) {
    return {
      q: state.query,
      role: state.role,
      status: state.status,
      two_factor: state.twoFactor,
      page,
      limit,
    };
  }

  async function load() {
    const seq = ++requestSeq;
    state.loading = true;
    state.error = null;
    paintList();

    try {
      const res = await api.get('/admin/staff', { query: queryParams(state.page, PAGE_SIZE) });
      if (disposed || seq !== requestSeq) return;
      state.rows = res.staff || [];
      state.roles = res.roles || state.roles;
      state.vitals = res.vitals || state.vitals;
      state.total = res.total ?? state.rows.length;
      state.page = res.page ?? state.page;
      state.totalPages = res.total_pages ?? 1;
    } catch (err) {
      if (disposed || seq !== requestSeq) return;
      // WHY no fallback roster: the previous version swapped in four invented staff on any
      // failure, so an outage looked like a healthy page of stale people. Say it failed.
      state.rows = [];
      state.error = errorMessage(err);
    } finally {
      if (!disposed && seq === requestSeq) {
        state.loading = false;
        paintVitals();
        paintFilters();
        paintList();
      }
    }
  }

  async function fetchAllForExport() {
    const all = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page += 1) {
      const res = await api.get('/admin/staff', { query: queryParams(page, EXPORT_PAGE_SIZE) });
      all.push(...(res.staff || []));
      if (page >= (res.total_pages ?? 1)) break;
    }
    return all;
  }

  // ── Static shell (rendered once, so the search box never loses focus) ─────────────────────

  function selectHtml(id, label, options, value) {
    return `
      <div class="admin-staff-select">
        <select id="${id}" aria-label="${escapeHtml(label)}">
          ${options.map(([v, text]) => `<option value="${escapeHtml(v)}" ${v === value ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}
        </select>
        <span class="admin-staff-select__chevron">${icon('chevron')}</span>
      </div>`;
  }

  function renderShell() {
    container.innerHTML = `
      <header class="admin-staff__header">
        <div class="admin-staff__heading">
          <span class="admin-staff__eyebrow">${icon('shield', 14)} ${escapeHtml(t('admin.staff.eyebrow', 'Internal Governance & Access'))}</span>
          <h1 class="admin-staff__title">${escapeHtml(t('admin.staff.title', 'Staff Management & Security Roster'))}</h1>
          <p class="admin-staff__subtitle">${escapeHtml(t('admin.staff.subtitle', 'Privileged account provisioning, two-factor enforcement, and granular role delegation.'))}</p>
        </div>
        <div class="admin-staff__header-actions" id="staff-header-actions"></div>
      </header>

      <section class="admin-staff-vitals" id="staff-vitals" aria-label="${escapeHtml(t('admin.staff.vitals_label', 'Security vitals'))}"></section>

      <section class="admin-staff-panel">
        <div class="admin-staff__toolbar" role="search">
          <label class="admin-staff-search">
            <span class="admin-staff-search__icon">${icon('search')}</span>
            <input type="search" id="staff-search" autocomplete="off"
              placeholder="${escapeHtml(t('admin.staff.search_placeholder', 'Search staff by name, email, ref ID or phone…'))}"
              aria-label="${escapeHtml(t('admin.staff.search_label', 'Search staff'))}" />
          </label>
          <div id="staff-filters" class="admin-staff__filters"></div>
        </div>

        <div class="admin-staff__table-wrap table-responsive" data-floating-scroll="true">
          <table class="admin-staff__table">
            <thead>
              <tr>
                <th scope="col">${escapeHtml(t('admin.staff.table_staff', 'Staff Member'))}</th>
                <th scope="col">${escapeHtml(t('admin.staff.table_role', 'Role & Department'))}</th>
                <th scope="col">${escapeHtml(t('admin.staff.table_2fa', '2FA Status'))}</th>
                <th scope="col">${escapeHtml(t('admin.staff.table_status', 'Status'))}</th>
                <th scope="col">${escapeHtml(t('admin.staff.table_last_active', 'Last Active'))}</th>
                <th scope="col" class="admin-staff__th-actions">${escapeHtml(t('admin.staff.table_actions', 'Actions'))}</th>
              </tr>
            </thead>
            <tbody id="staff-tbody"></tbody>
          </table>
        </div>

        <footer class="admin-staff-panel__footer" id="staff-footer"></footer>
      </section>
    `;

    const actions = container.querySelector('#staff-header-actions');
    const refreshBtn = Button({
      label: t('admin.staff.btn_refresh', 'Refresh'),
      variant: 'secondary',
      size: 'sm',
      onClick: () => load(),
    });
    const exportBtn = Button({
      label: t('admin.staff.btn_export', 'Export CSV'),
      variant: 'secondary',
      size: 'sm',
      onClick: () => exportCsv(exportBtn),
    });
    exportBtn.id = 'staff-export-btn';
    actions.append(refreshBtn, exportBtn);
    if (can('staff.account.create')) {
      actions.append(
        Button({
          label: t('admin.staff.btn_add_staff', 'Add Staff Member'),
          variant: 'primary',
          size: 'md',
          onClick: (e) => openProvisionModal(e.currentTarget),
        })
      );
    }

    const searchEl = container.querySelector('#staff-search');
    searchEl.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.query = e.target.value.trim();
        state.page = 1;
        load();
      }, SEARCH_DEBOUNCE_MS);
    });

    container.querySelector('#staff-filters').addEventListener('change', (e) => {
      const map = { 'staff-role-filter': 'role', 'staff-status-filter': 'status', 'staff-2fa-filter': 'twoFactor' };
      const key = map[e.target.id];
      if (!key) return;
      state[key] = e.target.value;
      state.page = 1;
      load();
    });
    container.querySelector('#staff-filters').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="clear"]')) clearFilters();
    });

    container.querySelector('#staff-tbody').addEventListener('click', onTableClick);
  }

  function paintFilters() {
    const wrap = container.querySelector('#staff-filters');
    if (!wrap) return;

    // The selects are built once per role list. Rebuilding them on every load would replace the
    // node the admin just used, which drops keyboard focus and closes the native popup.
    const rolesKey = state.roles.map((r) => r.key).join(',');
    if (wrap.dataset.rolesKey !== rolesKey) {
      wrap.dataset.rolesKey = rolesKey;
      const roleOptions = [['ALL', t('admin.staff.all_roles', 'All Roles')], ...state.roles.map((r) => [r.key, roleName(r)])];
      const statusOptions = [
        ['ALL', t('admin.staff.all_statuses', 'All Statuses')],
        ['ACTIVE', statusLabel('ACTIVE')],
        ['INVITED', statusLabel('INVITED')],
        ['SUSPENDED', statusLabel('SUSPENDED')],
      ];
      const twoFactorOptions = [
        ['ALL', t('admin.staff.all_2fa', 'Any 2FA state')],
        ['ENABLED', t('admin.staff.filter_2fa_enabled', '2FA active')],
        ['PENDING', t('admin.staff.filter_2fa_pending', 'Setup pending')],
      ];
      wrap.innerHTML = `
        ${selectHtml('staff-role-filter', t('admin.staff.all_roles', 'All Roles'), roleOptions, state.role)}
        ${selectHtml('staff-status-filter', t('admin.staff.all_statuses', 'All Statuses'), statusOptions, state.status)}
        ${selectHtml('staff-2fa-filter', t('admin.staff.all_2fa', 'Any 2FA state'), twoFactorOptions, state.twoFactor)}
        <span id="staff-clear-slot"></span>
      `;
    }

    const slot = wrap.querySelector('#staff-clear-slot');
    if (!slot) return;
    slot.innerHTML = hasFilters()
      ? `<button type="button" class="btn btn--secondary btn--sm" data-action="clear">${escapeHtml(t('admin.staff.clear_filters', 'Clear filters'))}</button>`
      : '';
  }

  function clearFilters() {
    state.query = '';
    state.role = 'ALL';
    state.status = 'ALL';
    state.twoFactor = 'ALL';
    state.page = 1;
    const search = container.querySelector('#staff-search');
    if (search) search.value = '';
    for (const [id, value] of [['staff-role-filter', 'ALL'], ['staff-status-filter', 'ALL'], ['staff-2fa-filter', 'ALL']]) {
      const el = container.querySelector(`#${id}`);
      if (el) el.value = value;
    }
    load();
  }

  // ── Vitals ─────────────────────────────────────────────────────────────────────────────────

  function paintVitals() {
    const el = container.querySelector('#staff-vitals');
    if (!el) return;

    if (!state.vitals) {
      el.innerHTML = Array.from({ length: 4 }, () => '<div class="admin-staff-vital admin-staff-skel" style="height:112px"></div>').join('');
      return;
    }
    const v = state.vitals;
    const twoFactorTone = v.two_factor_rate_pct >= 100 ? 'success' : v.two_factor_rate_pct >= 75 ? 'warning' : 'danger';
    // Exactly one active Super Admin is a single point of failure, not a comfortable number.
    const privilegedTone = v.privileged_roles_count <= 1 ? 'warning' : 'neutral';

    const card = (label, value, hint, tone = 'neutral') => `
      <article class="admin-staff-vital">
        <span class="admin-staff-vital__label">${escapeHtml(label)}</span>
        <span class="admin-staff-vital__value admin-staff-vital__value--${tone}">${value}</span>
        <p class="admin-staff-vital__hint">${escapeHtml(hint)}</p>
      </article>`;

    el.innerHTML = [
      card(
        t('admin.staff.total_staff', 'Total Staff'),
        num(v.total_staff),
        v.invited_staff
          ? t('admin.staff.hint_total_invited', '{{count}} invited, not signed in yet', { count: num(v.invited_staff) })
          : t('admin.staff.hint_total', 'Internal operational personnel')
      ),
      card(t('admin.staff.active_staff', 'Active Staff'), num(v.active_staff), t('admin.staff.hint_active', 'Current enabled operators'), 'success'),
      card(
        t('admin.staff.two_factor_rate', '2FA Enforcement'),
        `${pct(v.two_factor_rate_pct)}%`,
        v.two_factor_pending
          ? t('admin.staff.hint_2fa_pending', '{{count}} member(s) have not enrolled', { count: num(v.two_factor_pending) })
          : t('admin.staff.hint_2fa', 'Mandatory hardware / TOTP 2FA'),
        twoFactorTone
      ),
      card(
        t('admin.staff.privileged_roles', 'Privileged Super Admins'),
        num(v.privileged_roles_count),
        v.privileged_roles_count <= 1
          ? t('admin.staff.hint_privileged_single', 'Only one — add a backup owner')
          : t('admin.staff.hint_privileged', 'Unrestricted platform controllers'),
        privilegedTone === 'warning' ? 'warning' : 'danger'
      ),
    ].join('');
  }

  // ── Roster table ───────────────────────────────────────────────────────────────────────────

  function skeletonRows() {
    return Array.from({ length: 4 }, () => `
      <tr aria-hidden="true">
        <td><div class="admin-staff-person"><span class="admin-staff-skel admin-staff-skel--avatar"></span><span class="admin-staff-skel-stack"><span class="admin-staff-skel" style="width:140px;height:14px"></span><span class="admin-staff-skel" style="width:210px;height:11px"></span></span></div></td>
        <td><span class="admin-staff-skel" style="width:90px;height:22px"></span></td>
        <td><span class="admin-staff-skel" style="width:80px;height:14px"></span></td>
        <td><span class="admin-staff-skel" style="width:70px;height:22px"></span></td>
        <td><span class="admin-staff-skel" style="width:70px;height:14px"></span></td>
        <td><span class="admin-staff-skel" style="width:190px;height:30px;margin-left:auto"></span></td>
      </tr>`).join('');
  }

  function rowActionsHtml(s) {
    if (isSelf(s)) {
      return `<span class="admin-staff-you" title="${escapeHtml(t('admin.staff.self_hint', 'You cannot change your own access here.'))}">${escapeHtml(t('admin.staff.you', 'You'))}</span>`;
    }
    const btn = (action, label, cls = 'btn--secondary') =>
      `<button type="button" class="btn ${cls} btn--sm" data-action="${action}" data-id="${escapeHtml(s.id)}">${escapeHtml(label)}</button>`;
    const parts = [];
    if (can('staff.role.assign')) parts.push(btn('role', t('admin.staff.btn_change_role', 'Role')));
    if (can('security.2fa.reset') && s.two_factor_enabled) parts.push(btn('reset2fa', t('admin.staff.btn_reset_2fa', 'Reset 2FA')));
    if (s.status === 'INVITED' && can('staff.account.create')) parts.push(btn('reinvite', t('admin.staff.btn_resend_invite', 'Resend invite')));
    if (can('staff.account.disable')) {
      parts.push(
        s.status === 'SUSPENDED'
          ? btn('activate', t('admin.staff.btn_activate', 'Activate'), 'btn--success-outline')
          : btn('suspend', t('admin.staff.btn_deactivate', 'Suspend'), 'btn--danger-outline')
      );
    }
    return parts.length ? parts.join('') : `<span class="admin-staff-muted">—</span>`;
  }

  function rowHtml(s) {
    const variant = ROLE_VARIANT[s.role_key] || 'neutral';
    const perms = t('admin.staff.perms_count', '{{count}} permissions', { count: num(s.permissions_count ?? 0) });
    const twoFactor = s.two_factor_enabled
      ? `<span class="admin-staff-2fa admin-staff-2fa--on">${icon('lock', 14)} ${escapeHtml(t('admin.staff.2fa_active', '2FA Active'))}</span>`
      : `<span class="admin-staff-2fa admin-staff-2fa--off">${icon('alert', 14)} ${escapeHtml(t('admin.staff.2fa_pending', 'Setup pending'))}</span>`;

    return `
      <tr class="admin-staff__row ${s.status === 'SUSPENDED' ? 'is-suspended' : ''}" data-row-id="${escapeHtml(s.id)}">
        <td>
          <div class="admin-staff-person">
            <span class="admin-staff-avatar admin-staff-avatar--${escapeHtml(s.role_key)}" aria-hidden="true">${escapeHtml(initials(s.full_name))}</span>
            <div class="admin-staff-person__info">
              <button type="button" class="admin-staff-name" data-action="detail" data-id="${escapeHtml(s.id)}">${escapeHtml(s.full_name)}</button>
              <span class="admin-staff-person__sub"><span class="admin-staff-ref">${escapeHtml(s.ref)}</span>${escapeHtml(s.email)}</span>
              <span class="admin-staff-person__sub">${escapeHtml(formatPhone(s.phone))}</span>
            </div>
          </div>
        </td>
        <td data-label="${escapeHtml(t('admin.staff.table_role', 'Role & Department'))}">
          <div class="admin-staff-stack">
            <span class="badge badge--${variant}">${escapeHtml(roleLabel(s))}</span>
            <span class="admin-staff-muted">${escapeHtml(s.department || '—')} · ${escapeHtml(perms)}</span>
          </div>
        </td>
        <td data-label="${escapeHtml(t('admin.staff.table_2fa', '2FA Status'))}">${twoFactor}</td>
        <td data-label="${escapeHtml(t('admin.staff.table_status', 'Status'))}"><span class="badge badge--${STATUS_VARIANT[s.status] || 'neutral'}">${escapeHtml(statusLabel(s.status))}</span></td>
        <td class="admin-staff-muted" data-label="${escapeHtml(t('admin.staff.table_last_active', 'Last Active'))}" title="${escapeHtml(absoluteTime(s.last_active_at))}">${escapeHtml(lastActiveText(s))}</td>
        <td class="admin-staff__td-actions"><div class="admin-staff-actions">${rowActionsHtml(s)}</div></td>
      </tr>`;
  }

  function paintList() {
    const tbody = container.querySelector('#staff-tbody');
    if (!tbody) return;

    if (state.loading && state.rows.length === 0) {
      tbody.innerHTML = skeletonRows();
    } else if (state.error) {
      tbody.innerHTML = `
        <tr><td colspan="6">
          <div class="admin-staff-state" role="alert">
            <p class="admin-staff-state__title">${escapeHtml(t('admin.staff.load_failed', 'Failed to load staff roster.'))}</p>
            <p class="admin-staff-state__text">${escapeHtml(state.error)}</p>
            <button type="button" class="btn btn--primary btn--sm" data-action="retry">${escapeHtml(t('admin.staff.btn_retry', 'Try again'))}</button>
          </div>
        </td></tr>`;
    } else if (state.rows.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="6">
          <div class="admin-staff-state">
            <p class="admin-staff-state__title">${escapeHtml(t('admin.staff.no_staff_found', 'No staff members match the specified filters.'))}</p>
            ${hasFilters() ? `<button type="button" class="btn btn--secondary btn--sm" data-action="clear">${escapeHtml(t('admin.staff.clear_filters', 'Clear filters'))}</button>` : ''}
          </div>
        </td></tr>`;
    } else {
      tbody.innerHTML = state.rows.map(rowHtml).join('');
    }
    tbody.closest('.admin-staff__table-wrap')?.setAttribute('aria-busy', String(state.loading));
    tbody.classList.toggle('is-refreshing', state.loading && state.rows.length > 0);

    paintFooter();
  }

  function paintFooter() {
    const footer = container.querySelector('#staff-footer');
    if (!footer) return;
    footer.replaceChildren();
    if (state.error) return;

    const from = state.total === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1;
    const to = Math.min(state.total, state.page * PAGE_SIZE);
    const summary = document.createElement('span');
    summary.className = 'admin-staff-panel__count';
    summary.textContent = t('admin.staff.showing', 'Showing {{from}}–{{to}} of {{total}} staff', {
      from: num(from),
      to: num(to),
      total: num(state.total),
    });
    // Pagination prints its own "Showing x–y of z"; a second one beside it is just noise.
    if (state.totalPages <= 1) footer.append(summary);

    if (state.totalPages > 1) {
      footer.append(
        Pagination({
          page: state.page,
          totalPages: state.totalPages,
          totalItems: state.total,
          pageSize: PAGE_SIZE,
          onChange: ({ page }) => {
            state.page = page;
            load();
          },
        })
      );
    }
  }

  function onTableClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    if (action === 'retry') return load();
    if (action === 'clear') return clearFilters();
    const staff = state.rows.find((r) => String(r.id) === String(id));
    if (!staff) return;
    runAction(action, staff, el);
  }

  function runAction(action, staff, trigger) {
    switch (action) {
      case 'detail': return openDetailDrawer(staff, trigger);
      case 'role': return openRoleModal(staff, trigger);
      case 'reset2fa': return resetTwoFactor(staff, trigger);
      case 'suspend': return changeStatus(staff, 'SUSPENDED', trigger);
      case 'activate': return changeStatus(staff, 'ACTIVE', trigger);
      case 'reinvite': return resendInvite(staff, trigger);
      default: return undefined;
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────────────────────

  /** Runs a write, reports the outcome in the admin's language, then reloads the roster. */
  async function mutate(request, fallbackMessage) {
    try {
      const res = await request();
      const outcome = describeWriteOutcome(res, {
        bn: isBn(),
        fallback: fallbackMessage,
        deferredFallback: t('admin.staff.toast_deferred', 'Sent for approval. A Super Admin must approve this before it takes effect.'),
      });
      if (outcome.deferred) {
        // Nothing changed, so there is nothing to reload; the row keeps showing what is still true.
        toast.info(outcome.message);
        return true;
      }
      toast.success(outcome.message);
      await load();
      if (drawerStaffId != null) refreshDrawer();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  }

  async function resetTwoFactor(staff, trigger) {
    const { confirmed, reason } = await confirmDialogWithReason({
      title: t('admin.staff.reset_title', 'Reset two-factor authentication?'),
      description: t('admin.staff.reset_desc', '{{name}} will be asked to enrol a new authenticator at next sign-in. Their current codes stop working immediately.', { name: staff.full_name }),
      confirmLabel: t('admin.staff.btn_reset_2fa', 'Reset 2FA'),
      variant: 'danger',
      reasonRequired: true,
      reasonLabel: t('admin.staff.reason_label', 'Reason (kept in the audit log)'),
      trigger,
    });
    if (!confirmed) return;
    await mutate(() => api.post(`/admin/staff/${staff.id}/reset-2fa`, { reason }), t('admin.staff.toast_2fa_reset', '2FA reset.'));
  }

  async function changeStatus(staff, next, trigger) {
    const suspending = next === 'SUSPENDED';
    const privileged = PRIVILEGED_ROLES.has(staff.role_key);
    const { confirmed, reason } = await confirmDialogWithReason({
      title: suspending
        ? t('admin.staff.suspend_title', 'Suspend {{name}}?', { name: staff.full_name })
        : t('admin.staff.activate_title', 'Reactivate {{name}}?', { name: staff.full_name }),
      description: suspending
        ? t('admin.staff.suspend_desc', 'They are signed out everywhere and cannot sign in until reactivated. Nothing is deleted.')
        : t('admin.staff.activate_desc', 'They will be able to sign in again with their existing role and 2FA.'),
      confirmLabel: suspending ? t('admin.staff.btn_deactivate', 'Suspend') : t('admin.staff.btn_activate', 'Activate'),
      variant: suspending ? 'danger' : 'primary',
      // Locking out an admin is the one action here that can stall operations; make it deliberate.
      typeToConfirm: suspending && privileged ? staff.full_name : '',
      reasonRequired: true,
      reasonLabel: t('admin.staff.reason_label', 'Reason (kept in the audit log)'),
      trigger,
    });
    if (!confirmed) return;
    await mutate(() => api.patch(`/admin/staff/${staff.id}/status`, { status: next, reason }), t('admin.staff.toast_status', 'Status updated.'));
  }

  async function resendInvite(staff, trigger) {
    if (trigger) trigger.disabled = true;
    const ok = await mutate(() => api.post(`/admin/staff/${staff.id}/resend-invite`, {}), t('admin.staff.toast_invite', 'Invitation sent.'));
    if (!ok && trigger?.isConnected) trigger.disabled = false;
  }

  // ── Modals ─────────────────────────────────────────────────────────────────────────────────

  function roleOptions() {
    return state.roles.map((r) => ({
      value: r.key,
      label: `${roleName(r)} · ${t('admin.staff.perms_count', '{{count}} permissions', { count: num(r.permissions_count) })}`,
    }));
  }

  /** A one-line explainer under a role picker; privileged roles get a visible warning. */
  function roleNote() {
    const el = document.createElement('p');
    el.className = 'admin-staff-note';
    el.setAttribute('aria-live', 'polite');
    el.update = (roleKey) => {
      const r = roleByKey(roleKey);
      el.classList.toggle('admin-staff-note--warn', Boolean(r && PRIVILEGED_ROLES.has(r.key)));
      el.textContent = r
        ? PRIVILEGED_ROLES.has(r.key)
          ? `${roleDesc(r)} ${t('admin.staff.privileged_warning', 'This is a privileged role — grant it sparingly.')}`
          : roleDesc(r)
        : '';
    };
    return el;
  }

  function openProvisionModal(trigger) {
    const form = document.createElement('form');
    form.className = 'admin-staff-form';
    form.noValidate = true;

    const nameField = Input({ label: t('admin.staff.label_name', 'Full Name'), placeholder: 'e.g. Mahfuzur Rahman', required: true, autocomplete: 'off', onInput: () => nameField.setError('') });
    const emailField = Input({ label: t('admin.staff.label_email', 'Work Email'), type: 'email', placeholder: 'name@explooro.com', required: true, autocomplete: 'off', onInput: () => emailField.setError('') });
    const phoneField = Input({ label: t('admin.staff.label_phone', 'Mobile Number'), type: 'tel', inputmode: 'tel', placeholder: '01XXXXXXXXX', hint: t('admin.staff.phone_hint', 'Bangladeshi mobile number, 11 digits.'), required: true, autocomplete: 'off', onInput: () => phoneField.setError('') });
    const note = roleNote();
    const defaultRole = state.roles.find((r) => !PRIVILEGED_ROLES.has(r.key))?.key || state.roles[0]?.key || '';
    const roleField = Select({
      label: t('admin.staff.label_role', 'Assigned Role'),
      options: roleOptions(),
      value: defaultRole,
      required: true,
      onChange: (e) => note.update(e.target.value),
    });
    note.update(defaultRole);
    const deptField = Input({ label: t('admin.staff.label_dept', 'Department'), placeholder: 'e.g. Compliance & Moderation', hint: t('admin.staff.optional', 'Optional'), autocomplete: 'off' });
    form.append(nameField, emailField, phoneField, roleField, note, deptField);
    // The submit button lives in the modal footer, outside the <form>, so the browser's implicit
    // "Enter submits" never fires. Wire it explicitly, or keyboard users have to tab to the button.
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    const fields = { full_name: nameField, email: emailField, phone: phoneField, role_key: roleField, department: deptField };

    const cancelBtn = Button({ label: t('admin.staff.btn_cancel', 'Cancel'), variant: 'secondary', onClick: () => modal.closeModal(false) });
    const submitBtn = Button({ label: t('admin.staff.btn_provision', 'Create & Send Invite'), variant: 'primary', type: 'submit' });
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      form.requestSubmit();
    });
    const footer = document.createDocumentFragment();
    footer.append(cancelBtn, submitBtn);

    const modal = Modal({
      title: t('admin.staff.modal_title', 'Provision New Staff Member'),
      description: t('admin.staff.modal_desc', 'Create a new internal operator with role assignment. A one-time sign-in link is sent to their work email.'),
      content: form,
      footer,
      size: 'md',
      onClose: () => setTimeout(() => modal.remove(), 400),
    });

    function validate() {
      let firstBad = null;
      const flag = (field, message) => {
        field.setError?.(message);
        if (message && !firstBad) firstBad = field;
      };
      const name = nameField.value.trim();
      const email = emailField.value.trim();
      flag(nameField, name.length < 2 ? t('admin.staff.err_name', 'Enter the full name.') : '');
      flag(emailField, EMAIL_PATTERN.test(email) ? '' : t('admin.staff.err_email', 'Enter a valid work email.'));
      flag(phoneField, normaliseBdPhone(phoneField.value) ? '' : t('admin.staff.err_phone', 'Enter a valid mobile number (01XXXXXXXXX).'));
      flag(roleField, roleField.value ? '' : t('admin.staff.err_role', 'Choose a role.'));
      firstBad?.focus();
      return !firstBad;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate()) return;
      submitBtn.setLoading(true);
      try {
        const res = await api.post('/admin/staff', {
          full_name: nameField.value.trim(),
          email: emailField.value.trim(),
          phone: phoneField.value.trim(),
          role_key: roleField.value,
          department: deptField.value.trim(),
        });
        const message = successMessage(res, t('admin.staff.toast_created', 'Staff member added.'));
        // The account is created and audited either way; a failed invitation email is the admin's to
        // act on ("Resend invite"), so it is a warning, not a success.
        if (res.invite_sent === false) toast.warning(message);
        else toast.success(message);
        modal.closeModal(true);
        // A brand-new member sorts last; clear filters so the admin actually sees the result.
        state.query = '';
        state.role = 'ALL';
        state.status = 'ALL';
        state.twoFactor = 'ALL';
        const search = container.querySelector('#staff-search');
        if (search) search.value = '';
        state.page = Math.max(1, Math.ceil(((state.vitals?.total_staff ?? state.total) + 1) / PAGE_SIZE));
        await load();
      } catch (err) {
        submitBtn.setLoading(false);
        const target = fields[err?.details?.field];
        if (target?.setError) {
          target.setError(errorMessage(err));
          target.focus();
        } else {
          toast.error(errorMessage(err));
        }
      }
    });

    // WHY autofocus, not a rAF focus(): showModal() runs its own initial-focus step (the close
    // button) after our callback, and the panel is mid-animation. The native attribute is the one
    // thing the dialog honours.
    nameField.input.setAttribute('autofocus', '');
    document.body.append(modal);
    modal.openModal(trigger);
  }

  function openRoleModal(staff, trigger) {
    const current = roleByKey(staff.role_key);
    const body = document.createElement('div');
    body.className = 'admin-staff-form';

    const summary = document.createElement('p');
    summary.className = 'admin-staff-role-summary';
    const note = roleNote();
    const roleField = Select({
      label: t('admin.staff.label_new_role', 'New role'),
      options: roleOptions(),
      value: staff.role_key,
      onChange: () => sync(),
    });
    const reasonField = Textarea({
      label: t('admin.staff.reason_label', 'Reason (kept in the audit log)'),
      rows: 3,
      maxLength: 300,
      showCounter: true,
      required: true,
      onInput: () => sync(),
    });
    body.append(summary, roleField, note, reasonField);

    const cancelBtn = Button({ label: t('admin.staff.btn_cancel', 'Cancel'), variant: 'secondary', onClick: () => modal.closeModal(false) });
    const saveBtn = Button({ label: t('admin.staff.btn_save_role', 'Update role'), variant: 'primary', onClick: () => submit() });
    const footer = document.createDocumentFragment();
    footer.append(cancelBtn, saveBtn);

    const modal = Modal({
      title: t('admin.staff.role_modal_title', 'Change role for {{name}}', { name: staff.full_name }),
      description: t('admin.staff.role_modal_desc', 'Permissions change immediately and the member is signed out of existing sessions.'),
      content: body,
      footer,
      size: 'md',
      onClose: () => setTimeout(() => modal.remove(), 400),
    });

    function sync() {
      const next = roleByKey(roleField.value);
      note.update(roleField.value);
      if (current && next) {
        summary.innerHTML = `<strong>${escapeHtml(roleName(current))}</strong> <span class="admin-staff-role-summary__arrow">${icon('arrow', 14)}</span> <strong>${escapeHtml(roleName(next))}</strong> <span class="admin-staff-muted">(${escapeHtml(num(current.permissions_count))} → ${escapeHtml(num(next.permissions_count))} ${escapeHtml(t('admin.staff.permissions_word', 'permissions'))})</span>`;
      }
      saveBtn.setDisabled(roleField.value === staff.role_key || reasonField.value.trim().length < 3);
    }

    async function submit() {
      saveBtn.setLoading(true);
      const ok = await mutate(
        () => api.patch(`/admin/staff/${staff.id}/role`, { role_key: roleField.value, reason: reasonField.value.trim() }),
        t('admin.staff.toast_role', 'Role updated.')
      );
      if (ok) modal.closeModal(true);
      else saveBtn.setLoading(false);
    }

    sync();
    roleField.input.setAttribute('autofocus', '');
    document.body.append(modal);
    modal.openModal(trigger);
  }

  // ── Detail drawer ──────────────────────────────────────────────────────────────────────────

  const TIMELINE_LABELS = {
    'staff.account.create': ['admin.staff.evt_created', 'Account created'],
    'staff.account.disable': ['admin.staff.evt_disabled', 'Account suspended'],
    'staff.account.enable': ['admin.staff.evt_enabled', 'Account reactivated'],
    'staff.account.reinvite': ['admin.staff.evt_reinvite', 'Invitation re-sent'],
    'staff.role.assign': ['admin.staff.evt_role', 'Role changed'],
    'security.2fa.reset': ['admin.staff.evt_2fa', '2FA reset'],
  };

  // The audit row stores machine names (`role_key: moderator`, `status: SUSPENDED`, `two_factor_enabled: true`).
  // Show what the roster shows — the same labels and role names — and fall back to the raw value for
  // any field this page does not know, rather than hiding it.
  function historyLabel(field) {
    if (field === 'status') return t('admin.staff.table_status', 'Status');
    if (field === 'role_key') return t('admin.staff.btn_change_role', 'Role');
    if (field === 'two_factor_enabled') return t('admin.staff.table_2fa', '2FA Status');
    return field;
  }

  function historyValue(field, value) {
    if (value === undefined || value === null) return '—';
    if (field === 'status') return statusLabel(value);
    if (field === 'role_key') {
      const known = roleByKey(value);
      return known ? roleName(known) : value;
    }
    if (field === 'two_factor_enabled') {
      return value ? t('admin.staff.2fa_active', '2FA Active') : t('admin.staff.2fa_pending', 'Setup pending');
    }
    return value;
  }

  function timelineHtml(activity) {
    if (!activity.length) return `<p class="admin-staff-muted">${escapeHtml(t('admin.staff.timeline_empty', 'No changes recorded on this account yet.'))}</p>`;
    return `<ol class="admin-staff-timeline">${activity
      .map((a) => {
        const [key, fallback] = TIMELINE_LABELS[a.action] || ['', a.action];
        const detail = a.before && a.after && Object.keys(a.after).length
          ? Object.keys(a.after).map((k) => `${escapeHtml(historyLabel(k))}: ${escapeHtml(historyValue(k, a.before[k]))} → ${escapeHtml(historyValue(k, a.after[k]))}`).join(', ')
          : '';
        return `
          <li>
            <span class="admin-staff-timeline__title">${escapeHtml(key ? t(key, fallback) : fallback)}</span>
            ${detail ? `<span class="admin-staff-timeline__detail">${detail}</span>` : ''}
            ${a.reason ? `<span class="admin-staff-timeline__reason">“${escapeHtml(a.reason)}”</span>` : ''}
            <span class="admin-staff-muted">${escapeHtml(a.actor_name)} · ${escapeHtml(absoluteTime(a.created_at))}</span>
          </li>`;
      })
      .join('')}</ol>`;
  }

  function drawerBodyHtml(s, activity) {
    const fact = (label, value) => `<div class="admin-staff-fact"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
    return `
      <div class="admin-staff-drawer__identity">
        <span class="admin-staff-avatar admin-staff-avatar--lg admin-staff-avatar--${escapeHtml(s.role_key)}" aria-hidden="true">${escapeHtml(initials(s.full_name))}</span>
        <div>
          <h3 class="admin-staff-drawer__name">${escapeHtml(s.full_name)}</h3>
          <div class="admin-staff-drawer__badges">
            <span class="badge badge--${ROLE_VARIANT[s.role_key] || 'neutral'}">${escapeHtml(roleLabel(s))}</span>
            <span class="badge badge--${STATUS_VARIANT[s.status] || 'neutral'}">${escapeHtml(statusLabel(s.status))}</span>
          </div>
        </div>
      </div>
      <dl class="admin-staff-facts">
        ${fact(t('admin.staff.fact_ref', 'Reference'), `<span class="admin-staff-ref">${escapeHtml(s.ref)}</span>`)}
        ${fact(t('admin.staff.label_email', 'Work Email'), escapeHtml(s.email))}
        ${fact(t('admin.staff.label_phone', 'Mobile Number'), escapeHtml(formatPhone(s.phone)))}
        ${fact(t('admin.staff.label_dept', 'Department'), escapeHtml(s.department || '—'))}
        ${fact(t('admin.staff.fact_permissions', 'Permissions'), escapeHtml(num(s.permissions_count ?? 0)))}
        ${fact(t('admin.staff.table_2fa', '2FA Status'), s.two_factor_enabled ? escapeHtml(t('admin.staff.2fa_active', '2FA Active')) : escapeHtml(t('admin.staff.2fa_pending', 'Setup pending')))}
        ${fact(t('admin.staff.table_last_active', 'Last Active'), escapeHtml(lastActiveText(s)))}
        ${fact(t('admin.staff.fact_created', 'Added'), escapeHtml(absoluteTime(s.created_at)))}
      </dl>
      <h4 class="admin-staff-drawer__heading">${escapeHtml(t('admin.staff.timeline_title', 'Change history'))}</h4>
      ${timelineHtml(activity)}
    `;
  }

  function drawerFooter(s) {
    const footer = document.createDocumentFragment();
    const link = (label, path, variant = 'secondary') =>
      Button({ label, variant, size: 'sm', onClick: () => { drawer?.closeDrawer(false); navigateTo(path); } });
    if (can('users.account.view')) footer.append(link(t('admin.staff.open_profile', 'Open user profile'), `/admin/users/${s.id}`));
    if (can('security.2fa.manage')) footer.append(link(t('admin.staff.open_2fa', '2FA policy'), '/admin/security/2fa'));
    return footer;
  }

  function navigateTo(path) {
    if (navigate) navigate(path);
    else {
      history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }

  // The drawer keeps two regions: quick actions (built from the freshest copy of the member, since
  // a suspend or role change alters which buttons are valid) and the facts + history below them.
  const drawerParts = { staff: null, actions: null, content: null };

  function paintDrawer(staff, activity) {
    drawerParts.staff = staff;
    drawerParts.actions.innerHTML = rowActionsHtml(staff);
    drawerParts.content.innerHTML = drawerBodyHtml(staff, activity);
  }

  async function refreshDrawer() {
    if (!drawer || drawerStaffId == null) return;
    const id = drawerStaffId;
    try {
      const res = await api.get(`/admin/staff/${id}`);
      if (!drawer || drawerStaffId !== id) return;
      paintDrawer(res.staff, res.activity || []);
    } catch (err) {
      if (!drawer || drawerStaffId !== id) return;
      drawerParts.content.innerHTML = `<p class="admin-staff-state__text" role="alert">${escapeHtml(errorMessage(err))}</p>`;
    }
  }

  function openDetailDrawer(staff, trigger) {
    drawerStaffId = staff.id;
    const body = document.createElement('div');
    body.className = 'admin-staff-drawer';
    drawerParts.actions = document.createElement('div');
    drawerParts.actions.className = 'admin-staff-drawer__actions';
    drawerParts.content = document.createElement('div');
    body.append(drawerParts.actions, drawerParts.content);
    paintDrawer(staff, []);

    // Shares runAction with the table so the row and the drawer can never disagree.
    drawerParts.actions.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el && drawerParts.staff) runAction(el.dataset.action, drawerParts.staff, el);
    });

    drawer = Drawer({
      title: t('admin.staff.drawer_title', 'Staff member'),
      description: staff.ref,
      content: body,
      footer: drawerFooter(staff),
      side: 'right',
      size: 'md',
      className: 'admin-staff-drawer-shell',
      onClose: () => {
        const closed = drawer;
        drawer = null;
        drawerStaffId = null;
        setTimeout(() => closed?.remove(), 400);
      },
    });
    document.body.append(drawer);
    drawer.openDrawer(trigger);
    refreshDrawer();
  }

  // ── Export ─────────────────────────────────────────────────────────────────────────────────

  async function exportCsv(btn) {
    btn.setLoading(true);
    try {
      const rows = await fetchAllForExport();
      if (rows.length === 0) {
        toast.info(t('admin.staff.export_empty', 'Nothing to export for the current filters.'));
        return;
      }
      const headers = ['Ref', 'Full Name', 'Email', 'Phone', 'Role', 'Department', 'Permissions', '2FA', 'Status', 'Last Active', 'Added'];
      const lines = rows.map((s) => [
        s.ref, s.full_name, s.email, s.phone, s.role_label_en || s.role_key, s.department || '', s.permissions_count ?? 0,
        s.two_factor_enabled ? 'Active' : 'Pending', s.status, s.last_active_at || '', s.created_at || '',
      ].map(csvCell).join(','));
      const csv = `﻿${[headers.map(csvCell).join(','), ...lines].join('\r\n')}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `explooro-staff-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t('admin.staff.export_done', 'Staff roster exported to CSV.'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      btn.setLoading(false);
    }
  }

  // ── Mount ──────────────────────────────────────────────────────────────────────────────────

  renderShell();
  paintVitals();
  paintFilters();
  paintList();
  root.append(container);
  load();

  return () => {
    disposed = true;
    clearTimeout(debounceTimer);
    drawer?.remove();
    container.remove();
  };
}
