/**
 * AccessGrantsPage.js — Manage standing access grants (Mode A) with time-boxes and revocations (Prompt 3.3).
 *
 * Implements:
 * 1. Overview of time-boxed elevated permissions issued by Super Admins.
 * 2. Status filter tabs (All, Active, Expired, Revoked), search, and server-side pagination.
 * 3. Grant Issuer drawer for elevating staff privileges with mandatory justification and expiry.
 * 4. 1-Click Revocation action with mandatory reason capture and immediate cache invalidation.
 * 5. Layout-mirroring Zero-CLS skeleton loader and bilingual i18n support.
 *
 * Nothing on this page prints a raw permission key or scope JSON — see docs/super-admin-audit.md §5.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Pagination } from '../../components/ui/Pagination.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate, formatRelativeTime, formatCurrency, formatPhone, formatNumber } from '../../services/format.js';
import { escapeHtml as esc } from '../../services/html.js';
import { ICONS } from '../../components/ui/icons.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';
import { describeScope } from '../../config/grant-scopes.js';
import '../../styles/components/admin-users.css';
import '../../styles/components/admin-access.css';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
// Must equal the API's minimum (delegation.routes.js `minLength: 10`), or the dialog accepts a
// reason the server then refuses.
const MIN_REVOKE_REASON = 10;
// WHY a display threshold, not a business rule: it only decides when the expiry cell turns amber so
// an admin notices a grant about to lapse. It changes nothing about when the grant ends.
const EXPIRING_SOON_MS = 3 * 24 * 60 * 60 * 1000;

/** Same rule as permission.repository.js: revoked only if revoked BEFORE it expired. */
function grantStatus(g) {
  const exp = new Date(g.expires_at).getTime();
  const rev = g.revoked_at ? new Date(g.revoked_at).getTime() : null;
  if (rev !== null && rev < exp) return 'REVOKED';
  return exp <= Date.now() ? 'EXPIRED' : 'ACTIVE';
}

function humanizeKey(key) {
  return String(key || '')
    .split('.')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).replace(/_/g, ' '))
    .join(' › ');
}

export default function AccessGrantsPage(root) {
  const lang = () => (getLanguage() === 'bn' ? 'bn' : 'en');
  const container = document.createElement('div');
  container.className = 'admin-users access-grants';

  let grants = [];
  let permissionsList = [];
  let statusFilter = 'ALL';
  let search = '';
  let page = 1;
  let total = 0;
  let isLoading = true;
  let loadError = false;
  let loadSeq = 0;

  // Header
  const header = document.createElement('div');
  header.className = 'admin-users__header';

  const titleRow = document.createElement('div');
  titleRow.className = 'access-grants__title-row';

  const titleWrap = document.createElement('div');
  titleWrap.innerHTML = `
    <span class="badge badge--neutral access-grants__eyebrow">
      ${ICONS.key} ${esc(t('grants.eyebrow', 'Standing Privilege Delegation (Mode A)'))}
    </span>
    <h1 class="admin-users__title">${esc(t('grants.title', 'Standing Access Grants'))}</h1>
    <p class="admin-users__subtitle">${esc(t('grants.subtitle', 'Time-boxed elevated privileges granted to operators with full audit logging and 1-click revocations.'))}</p>
  `;

  const newGrantBtn = Button({
    label: t('grants.btn_new_grant', 'Issue Access Grant'),
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      openGrantDrawer({
        user: null,
        permissions: permissionsList,
        trigger: newGrantBtn,
        onSuccess: () => {
          page = 1;
          loadGrants();
        },
      });
    },
  });

  titleRow.append(titleWrap, newGrantBtn);
  header.append(titleRow);

  // Toolbar: status filter + search
  const toolbar = document.createElement('div');
  toolbar.className = 'access-grants__toolbar';

  const filterBar = document.createElement('div');
  filterBar.className = 'access-grants__filters';
  filterBar.setAttribute('role', 'group');
  filterBar.setAttribute('aria-label', t('grants.filter_aria', 'Filter grants by status'));

  const filterOptions = [
    { key: 'ALL', label: t('grants.status_all', 'All grants') },
    { key: 'ACTIVE', label: t('grants.status_active', 'Active') },
    { key: 'EXPIRED', label: t('grants.status_expired', 'Expired') },
    { key: 'REVOKED', label: t('grants.status_revoked', 'Revoked') },
  ];

  for (const opt of filterOptions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn--sm ${statusFilter === opt.key ? 'btn--primary' : 'btn--secondary'}`;
    btn.textContent = opt.label;
    btn.setAttribute('aria-pressed', String(statusFilter === opt.key));
    btn.addEventListener('click', () => {
      statusFilter = opt.key;
      filterBar.querySelectorAll('button').forEach((b) => {
        b.className = 'btn btn--secondary btn--sm';
        b.setAttribute('aria-pressed', 'false');
      });
      btn.className = 'btn btn--primary btn--sm';
      btn.setAttribute('aria-pressed', 'true');
      page = 1;
      loadGrants();
    });
    filterBar.append(btn);
  }

  const searchWrap = document.createElement('label');
  searchWrap.className = 'admin-users-search-control access-grants__search';
  searchWrap.innerHTML = `
    <span class="admin-users-search-icon" aria-hidden="true">${ICONS.search}</span>
    <span class="sr-only">${esc(t('grants.search_label', 'Search grants'))}</span>
  `;
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'admin-users-search-input';
  searchInput.placeholder = t('grants.search_placeholder', 'Search by name, ID, phone or permission');
  searchInput.maxLength = 100;
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const next = searchInput.value.trim();
      if (next === search) return;
      search = next;
      page = 1;
      loadGrants();
    }, SEARCH_DEBOUNCE_MS);
  });
  searchWrap.append(searchInput);

  toolbar.append(filterBar, searchWrap);

  // Table
  const tableWrap = document.createElement('div');
  tableWrap.className = 'perm-matrix__table-wrap';

  const table = document.createElement('table');
  table.className = 'perm-matrix__table access-grants__table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th scope="col">${esc(t('grants.table_grantee', 'Grantee'))}</th>
      <th scope="col">${esc(t('grants.table_perm', 'Permission'))}</th>
      <th scope="col">${esc(t('grants.table_expires', 'Expires At'))}</th>
      <th scope="col">${esc(t('grants.table_reason', 'Reason'))}</th>
      <th scope="col" class="access-grants__center">${esc(t('grants.table_status', 'Status'))}</th>
      <th scope="col" class="access-grants__center">${esc(t('admin_users.table_actions', 'Actions'))}</th>
    </tr>
  `;
  table.append(thead);

  const tbody = document.createElement('tbody');
  table.append(tbody);
  tableWrap.append(table);

  const footer = document.createElement('div');
  footer.className = 'access-grants__footer';

  container.append(header, toolbar, tableWrap, footer);

  function renderSkeleton() {
    const cell = (mod) => `<td><span class="perm-skel access-grants__skel access-grants__skel--${mod}"></span></td>`;
    return Array.from({ length: 3 })
      .map(() => `<tr>${cell('name')}${cell('perm')}${cell('date')}${cell('reason')}${cell('badge')}${cell('btn')}</tr>`)
      .join('');
  }

  async function loadGrants() {
    const seq = ++loadSeq;
    isLoading = true;
    tbody.innerHTML = renderSkeleton();
    footer.replaceChildren();

    try {
      const query = { status: statusFilter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
      if (search) query.q = search;
      const res = await api.get('/admin/grants', { query });
      if (seq !== loadSeq) return; // a newer filter/search/page superseded this response
      grants = res.data?.grants || res.grants || [];
      total = Number(res.meta?.total ?? res.total ?? grants.length);
      loadError = false;
    } catch {
      if (seq !== loadSeq) return;
      // WHY a flag rather than an empty list: a failed request used to render "No standing access
      // grants found", which tells an admin no one holds elevated access when in truth we don't know.
      grants = [];
      total = 0;
      loadError = true;
    }
    isLoading = false;
    renderTable();
  }

  async function loadPermissions() {
    try {
      const res = await api.get('/admin/roles-permissions');
      permissionsList = res.permissions || [];
    } catch {
      permissionsList = [];
    }
    // WHY re-render: this request runs alongside loadGrants(), and whichever finishes second used to
    // lose — when the grants arrived first, every row was drawn with the humanised English fallback
    // ("Finance › Payout › Approve") and never picked up its Bangla label.
    if (!isLoading) renderTable();
  }

  function permissionLabel(g) {
    const isBn = lang() === 'bn';
    const p = permissionsList.find((x) => x.key === g.permission_key);
    const en = p?.label_en || g.permission_label_en;
    const bn = p?.label_bn || g.permission_label_bn;
    return (isBn ? bn || en : en || bn) || humanizeKey(g.permission_key);
  }

  function personName(name, ref, fallbackId) {
    return name || ref || (fallbackId ? t('grants.user_fallback', 'User #{{id}}', { id: fallbackId }) : t('grants.default_issuer', 'Super Admin'));
  }

  function renderScope(g) {
    const { known, unknown } = describeScope(g.scope_json);
    const chips = known.map(({ field, value }) =>
      field === 'max_amount'
        ? `<span class="access-grants__chip">${esc(t('grants.scope_max_amount', 'Limit: up to {{amount}} per approval', { amount: formatCurrency(value, { lang: lang() }) }))}</span>`
        : ''
    );
    // WHY a warning, not the JSON: the server fails closed on a limit it can't check, so this grant
    // currently lets its holder do nothing. The admin needs that consequence, not the syntax.
    if (unknown.length) {
      chips.push(`<span class="access-grants__chip access-grants__chip--warning">${esc(t('grants.scope_unenforceable', 'Unrecognised limit: this grant is blocked. Revoke it and issue a new one.'))}</span>`);
    }
    return chips.join('');
  }

  function renderExpiry(g, status) {
    const l = lang();
    const exp = new Date(g.expires_at).getTime();
    const date = formatDate(g.expires_at, { lang: l });
    let rel = '';
    let mod = '';
    if (status === 'ACTIVE') {
      rel = t('grants.expires_in', 'Ends {{when}}', { when: formatRelativeTime(g.expires_at, { lang: l }) });
      if (exp - Date.now() <= EXPIRING_SOON_MS) mod = ' access-grants__meta--warning';
    } else if (status === 'EXPIRED') {
      rel = t('grants.expired_ago', 'Ended {{when}}', { when: formatRelativeTime(g.expires_at, { lang: l }) });
    }
    return `
      <div class="access-grants__stack">
        <span class="access-grants__date">${esc(date)}</span>
        ${rel ? `<span class="access-grants__meta${mod}">${esc(rel)}</span>` : ''}
      </div>
    `;
  }

  function renderReason(g, status) {
    const l = lang();
    const issuer = personName(g.granted_by_name, g.granted_by_ref, null);
    let html = `
      <p class="access-grants__reason">“${esc(g.reason)}”</p>
      <span class="access-grants__meta">${esc(t('grants.issued_by_on', 'Issued by {{name}} · {{date}}', { name: issuer, date: formatDate(g.created_at, { lang: l }) }))}</span>
    `;
    if (status === 'REVOKED') {
      const revoker = personName(g.revoked_by_name, g.revoked_by_ref, null);
      html += `
        <div class="access-grants__revocation">
          <span class="access-grants__meta">${esc(t('grants.revoked_by_on', 'Revoked by {{name}} · {{date}}', { name: revoker, date: formatDate(g.revoked_at, { lang: l }) }))}</span>
          ${g.revocation_reason ? `<span class="access-grants__revocation-reason">“${esc(g.revocation_reason)}”</span>` : ''}
        </div>
      `;
    }
    return html;
  }

  function renderFooter() {
    footer.replaceChildren();
    if (loadError || total === 0) return;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (totalPages <= 1) {
      const summary = document.createElement('span');
      summary.className = 'access-grants__meta';
      summary.textContent = t('grants.showing', 'Showing {{count}} of {{total}} grants', {
        count: formatNumber(grants.length, { lang: lang() }),
        total: formatNumber(total, { lang: lang() }),
      });
      footer.append(summary);
      return;
    }
    footer.append(
      Pagination({
        page,
        totalPages,
        totalItems: total,
        pageSize: PAGE_SIZE,
        onChange: ({ page: next }) => {
          page = next;
          loadGrants();
          tableWrap.scrollIntoView({ block: 'nearest' });
        },
      })
    );
  }

  function renderTable() {
    tbody.innerHTML = '';

    // A revoke on the last row of a later page can leave that page empty — step back instead of
    // showing "no grants found" while earlier pages still have rows.
    if (!loadError && grants.length === 0 && total > 0 && page > 1) {
      page = Math.max(1, Math.ceil(total / PAGE_SIZE));
      loadGrants();
      return;
    }

    if (loadError || grants.length === 0) {
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = 6;
      const filtered = Boolean(search) || statusFilter !== 'ALL';
      const title = loadError
        ? t('grants.error_title', "Couldn't load access grants")
        : filtered ? t('grants.empty_filtered_title', 'No grants match this filter.') : t('grants.empty_title', 'No standing access grants found.');
      const body = loadError
        ? t('grants.error_body', 'Check your connection and try again.')
        : filtered ? t('grants.empty_filtered_body', 'Try another status or search term.') : t('grants.empty_body', 'Privileges granted here elevate staff capabilities and expire automatically.');
      emptyTd.innerHTML = `
        <div class="access-grants__empty">
          <span class="access-grants__empty-icon" aria-hidden="true">${loadError ? ICONS.enforcement : ICONS.key}</span>
          <strong>${esc(title)}</strong>
          <span class="access-grants__meta">${esc(body)}</span>
        </div>
      `;
      if (loadError) {
        emptyTd.firstElementChild.append(Button({ label: t('common.retry', 'Retry'), variant: 'secondary', size: 'sm', onClick: loadGrants }));
      }
      emptyTr.append(emptyTd);
      tbody.append(emptyTr);
      renderFooter();
      return;
    }

    for (const g of grants) {
      const tr = document.createElement('tr');
      const status = grantStatus(g);

      const tdUser = document.createElement('td');
      const ids = [g.grantee_ref, g.grantee_phone ? formatPhone(g.grantee_phone) : ''].filter(Boolean);
      tdUser.innerHTML = `
        <div class="access-grants__stack">
          <strong class="access-grants__name">${esc(personName(g.grantee_name, null, g.user_id))}</strong>
          ${ids.map((v) => `<span class="access-grants__meta access-grants__id">${esc(v)}</span>`).join('')}
        </div>
      `;

      const tdPerm = document.createElement('td');
      const scopeHtml = renderScope(g);
      tdPerm.innerHTML = `
        <div class="access-grants__stack">
          <strong class="access-grants__name">${esc(permissionLabel(g))}</strong>
          ${scopeHtml ? `<div class="access-grants__chips">${scopeHtml}</div>` : ''}
        </div>
      `;

      const tdExpires = document.createElement('td');
      tdExpires.innerHTML = renderExpiry(g, status);

      const tdReason = document.createElement('td');
      tdReason.className = 'access-grants__reason-cell';
      tdReason.innerHTML = renderReason(g, status);

      const tdStatus = document.createElement('td');
      tdStatus.className = 'access-grants__center';
      tdStatus.append(Badge({
        label: t(`grants.status_${status.toLowerCase()}`, status),
        variant: status === 'REVOKED' ? 'danger' : status === 'EXPIRED' ? 'neutral' : 'success',
      }));

      const tdActions = document.createElement('td');
      tdActions.className = 'access-grants__center';
      if (status === 'ACTIVE') {
        const revokeBtn = Button({
          label: t('grants.btn_revoke', 'Revoke Grant'),
          variant: 'danger',
          size: 'sm',
          onClick: async () => {
            const conf = await confirmDialogWithReason({
              title: t('grants.confirm_revoke_title', 'Revoke standing access grant?'),
              description: t('grants.confirm_revoke_named', '{{name}} will immediately lose "{{permission}}". This is recorded in the audit log.', {
                name: personName(g.grantee_name, g.grantee_ref, g.user_id),
                permission: permissionLabel(g),
              }),
              confirmLabel: t('grants.btn_revoke', 'Revoke Grant'),
              cancelLabel: t('common.cancel', 'Cancel'),
              variant: 'danger',
              reasonRequired: true,
              reasonLabel: t('grants.revoke_reason_label', 'Reason for revoking'),
              reasonHint: t('grants.err_reason_short', { min: MIN_REVOKE_REASON }),
              reasonMinLength: MIN_REVOKE_REASON,
              reasonTooShortMessage: t('grants.err_reason_short', { min: MIN_REVOKE_REASON }),
              trigger: revokeBtn,
            });

            if (!conf?.confirmed) return;

            revokeBtn.setLoading?.(true);
            try {
              await api.delete(`/admin/grants/${g.id}`, { body: { reason: conf.reason } });
              toast.success(t('grants.revoked_ok', 'Standing grant revoked successfully'));
              loadGrants();
            } catch (err) {
              revokeBtn.setLoading?.(false);
              toast.error((lang() === 'bn' ? err.message_bn : err.message_en) || t('grants.revoke_failed', 'Could not revoke the grant.'));
            }
          },
        });
        tdActions.append(revokeBtn);
      } else {
        tdActions.innerHTML = `<span class="access-grants__meta" aria-label="${esc(t('grants.no_actions', 'No actions available'))}">—</span>`;
      }

      tr.append(tdUser, tdPerm, tdExpires, tdReason, tdStatus, tdActions);
      tbody.append(tr);
    }
    renderFooter();
  }

  loadGrants();
  loadPermissions();

  root.append(container);
}
