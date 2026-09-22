/**
 * RestrictionsPage.js — Platform User Restrictions & Sanctions Governance (Prompt 3.3).
 *
 * Implements:
 * 1. Global registry of user capability restrictions (selling, payouts, ordering, chatting).
 * 2. Status filtering: All, Active Sanctions, Lifted / Expired.
 * 3. Human-understandable capability labels with explicit risk badges.
 * 4. Step-up 1-click Lift Sanction action with mandatory reason capture.
 * 5. 1-Click "Apply Sanction" drawer integration.
 * 6. Layout-mirroring Zero-CLS skeleton loader and bilingual i18n support.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { api, pickMessage } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';
import { escapeHtml as esc } from '../../services/html.js';
import { ICONS } from '../../components/ui/icons.js';
import { openRestrictionEditor } from '../../components/admin/RestrictionEditor.js';
import '../../styles/components/admin-access.css';

// WHY the English fallback is humanised from the key: a capability added to the API before it has a
// `restrictions.cap.*` entry should still read as a phrase, not a raw `can_foo_bar`.
function getFriendlyCapabilityLabel(key) {
  const fallback = key
    .replace('can_', 'Allow ')
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return t(`restrictions.cap.${key}`, fallback);
}

export default function RestrictionsPage(root) {
  const isBn = () => getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-users';

  let restrictions = [];
  let statusFilter = 'ALL';
  let isLoading = true;
  let loadError = false;

  // Header
  const header = document.createElement('div');
  header.className = 'admin-users__header';

  const titleRow = document.createElement('div');
  titleRow.style.display = 'flex';
  titleRow.style.alignItems = 'center';
  titleRow.style.justifyContent = 'space-between';
  titleRow.style.flexWrap = 'wrap';
  titleRow.style.gap = 'var(--space-3)';

  const titleWrap = document.createElement('div');
  titleWrap.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
      <span class="badge badge--danger" style="font-weight: 700; text-transform: uppercase; font-size: 11px;">
        ${ICONS.ban} ${t('restrictions.eyebrow', 'Platform Trust & Sanctions')}
      </span>
    </div>
    <h1 class="admin-users__title">${t('restrictions.title', 'User Restrictions & Sanctions')}</h1>
    <p class="admin-users__subtitle">${t('restrictions.subtitle', 'Granular capability controls and temporary account sanctions with automatic expiration.')}</p>
  `;

  const newSanctionBtn = Button({
    label: t('restrictions.btn_apply', 'Apply Sanction'),
    variant: 'danger',
    size: 'sm',
    onClick: () => {
      openRestrictionEditor({
        user: null,
        onSuccess: loadRestrictions,
      });
    },
  });

  titleRow.append(titleWrap, newSanctionBtn);
  header.append(titleRow);

  // Status Filter Bar
  const filterBar = document.createElement('div');
  filterBar.setAttribute('role', 'group');
  filterBar.setAttribute('aria-label', t('restrictions.filter_aria', 'Filter restrictions by status'));
  filterBar.style.display = 'flex';
  filterBar.style.flexWrap = 'wrap';
  filterBar.style.gap = 'var(--space-2)';
  filterBar.style.padding = 'var(--space-3) var(--space-4)';
  filterBar.style.background = 'var(--surface-1)';
  filterBar.style.border = 'var(--border-width) solid var(--border-subtle)';
  filterBar.style.borderRadius = 'var(--radius-xl)';
  filterBar.style.boxShadow = 'var(--elevation-1)';

  const filterOptions = [
    { key: 'ALL', label: t('restrictions.filter_all', 'All records') },
    { key: 'ACTIVE', label: t('restrictions.filter_active', 'Active sanctions') },
    { key: 'LIFTED', label: t('restrictions.filter_lifted', 'Lifted / expired') },
  ];

  for (const opt of filterOptions) {
    const btn = document.createElement('button');
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
      loadRestrictions();
    });
    filterBar.append(btn);
  }

  // Table wrap
  const tableWrap = document.createElement('div');
  tableWrap.className = 'perm-matrix__table-wrap';

  const table = document.createElement('table');
  table.className = 'perm-matrix__table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th style="text-align: left; min-width: 150px;">${t('restrictions.table_user', 'Sanctioned Account')}</th>
      <th style="text-align: left; min-width: 180px;">${t('restrictions.table_capability', 'Restricted Capability')}</th>
      <th style="min-width: 100px;">${t('restrictions.table_mode', 'Mode & Limit')}</th>
      <th style="text-align: left; min-width: 240px;">${t('restrictions.table_reason', 'Violation & Justification')}</th>
      <th style="min-width: 80px;">${t('restrictions.table_status', 'Status')}</th>
      <th style="text-align: center; min-width: 120px; white-space: nowrap;">${t('admin_users.table_actions', 'Actions')}</th>
    </tr>
  `;
  table.append(thead);

  const tbody = document.createElement('tbody');
  table.append(tbody);
  tableWrap.append(table);

  container.append(header, filterBar, tableWrap);

  function renderSkeleton() {
    return `
      ${Array.from({ length: 4 }).map(() => `
        <tr>
          <td>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div style="width: 120px; height: 14px; background: var(--surface-2); border-radius: 4px;"></div>
              <div style="width: 160px; height: 10px; background: var(--surface-2); border-radius: 4px;"></div>
            </div>
          </td>
          <td><div style="width: 160px; height: 14px; background: var(--surface-2); border-radius: 4px;"></div></td>
          <td><div style="width: 80px; height: 14px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
          <td><div style="width: 180px; height: 12px; background: var(--surface-2); border-radius: 4px;"></div></td>
          <td><div style="width: 60px; height: 18px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
          <td><div style="width: 70px; height: 24px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
        </tr>
      `).join('')}
    `;
  }

  async function loadRestrictions() {
    isLoading = true;
    tbody.innerHTML = renderSkeleton();

    try {
      const res = await api.get('/admin/restrictions', {
        query: { status: statusFilter },
      });
      restrictions = res.data?.restrictions || res.restrictions || [];
      loadError = false;
    } catch {
      // WHY a flag rather than an empty list: "No restrictions found" after a failed request reads as
      // "nobody is sanctioned", which is a claim we cannot make.
      restrictions = [];
      loadError = true;
    } finally {
      isLoading = false;
      renderTable();
    }
  }

  function renderTable() {
    tbody.innerHTML = '';
    const isLangBn = isBn();

    if (loadError || restrictions.length === 0) {
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = 6;
      emptyTd.style.textAlign = 'center';
      emptyTd.style.padding = 'var(--space-8)';
      emptyTd.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <span style="color: var(--text-secondary);">${loadError ? ICONS.enforcement : ICONS.protection}</span>
          <span style="font-weight: 700; color: var(--text-primary);">${loadError ? t('restrictions.error_title', "Couldn't load restrictions") : t('restrictions.empty_title', 'No restrictions found in this filter.')}</span>
          <span style="font-size: 12px; color: var(--text-secondary);">${loadError ? t('restrictions.error_body', 'Check your connection and try again.') : t('restrictions.empty_body', 'All marketplace accounts are operating with normal baseline permissions.')}</span>
        </div>
      `;
      if (loadError) {
        emptyTd.firstElementChild.append(Button({ label: t('common.retry', 'Retry'), variant: 'secondary', size: 'sm', onClick: loadRestrictions }));
      }
      emptyTr.append(emptyTd);
      tbody.append(emptyTr);
      return;
    }

    for (const r of restrictions) {
      const tr = document.createElement('tr');
      const isActive = !r.lifted_at && (!r.expires_at || new Date(r.expires_at).getTime() > Date.now());
      const isExpired = !r.lifted_at && r.expires_at && new Date(r.expires_at).getTime() <= Date.now();

      // Account Column
      const tdUser = document.createElement('td');
      tdUser.style.textAlign = 'left';
      tdUser.style.minWidth = '150px';
      tdUser.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <strong style="font-size: 13px; color: var(--text-primary);">${esc(r.user_name || r.user_phone || r.subject_ref)}</strong>
          <span style="font-size: 11px; color: var(--text-secondary);">${esc(r.subject_ref)} · ${esc(r.user_phone || '')}</span>
        </div>
      `;

      // Capability Column (Human-understandable Title)
      const tdCap = document.createElement('td');
      tdCap.style.textAlign = 'left';
      tdCap.style.minWidth = '180px';
      const capTitle = getFriendlyCapabilityLabel(r.capability_key);
      tdCap.innerHTML = `
        <strong style="font-size: 13px; color: var(--danger); line-height: 1.4; display: block;">${esc(capTitle)}</strong>
      `;

      // Mode Column
      const tdMode = document.createElement('td');
      tdMode.style.minWidth = '100px';
      const modeVariant = r.mode === 'HARD_BLOCK' ? 'danger' : 'warning';
      const limitBadge = r.limit_value ? ` <strong style="font-size: 11px; display: inline-block; margin-top: 4px;">(${esc(r.limit_value)})</strong>` : '';
      tdMode.innerHTML = `<span class="badge badge--${modeVariant}">${esc(t(`restrictions.mode_label.${r.mode}`, r.mode))}</span>${limitBadge}`;

      // Violation Reason
      const tdReason = document.createElement('td');
      tdReason.style.textAlign = 'left';
      tdReason.style.minWidth = '240px';
      const lang = isLangBn ? 'bn' : 'en';
      const expStr = r.expires_at
        ? `<span style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${esc(t('restrictions.expires_on', 'Expires: {{date}}', { date: formatDate(new Date(r.expires_at).getTime(), { lang }) }))}</span>`
        : `<span style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${esc(t('restrictions.permanent', 'Duration: Permanent'))}</span>`;
      const liftStr = r.lifted_at
        ? `<span style="font-size: 11px; color: var(--success); margin-top: 2px;">${esc(t('restrictions.lifted_line', 'Lifted by {{name}} on {{date}}: “{{reason}}”', {
            name: r.lifted_by || t('restrictions.default_actor', 'Admin'),
            date: formatDate(new Date(r.lifted_at).getTime(), { lang }),
            reason: r.lift_reason || t('restrictions.lift_reason_default', 'Resolved'),
          }))}</span>`
        : '';
      tdReason.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 3px;">
          <span style="font-size: 13px; color: var(--text-primary); font-weight: 500; line-height: 1.4;">“${esc(r.reason)}”</span>
          <span style="font-size: 11px; color: var(--text-secondary);">${esc(t('restrictions.applied_by', 'Applied by {{name}}', { name: r.applied_by || t('restrictions.default_actor', 'Admin') }))}</span>
          ${liftStr || expStr}
        </div>
      `;

      // Status
      const tdStatus = document.createElement('td');
      tdStatus.style.minWidth = '80px';
      const statusBadge = Badge({
        label: r.lifted_at ? t('restrictions.status_lifted', 'Lifted') : (isExpired ? t('restrictions.status_expired', 'Expired') : t('restrictions.status_active', 'Active')),
        variant: r.lifted_at ? 'success' : (isExpired ? 'neutral' : 'danger'),
      });
      tdStatus.append(statusBadge);

      // Actions
      const tdActions = document.createElement('td');
      tdActions.style.textAlign = 'center';
      tdActions.style.minWidth = '120px';
      tdActions.style.whiteSpace = 'nowrap';
      if (isActive) {
        const liftBtn = Button({
          label: t('restrictions.btn_lift', 'Lift sanction'),
          variant: 'secondary',
          size: 'sm',
          onClick: async () => {
            const conf = await confirmDialogWithReason({
              title: t('restrictions.lift_title', 'Lift account sanction?'),
              description: t('restrictions.lift_desc', 'Please specify a clear business justification for lifting this restriction.'),
              reasonRequired: true,
              trigger: liftBtn,
            });

            if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 10) return;

            try {
              await api.delete(`/admin/restrictions/${r.id}`, { body: { reason: conf.reason.trim() } });
              toast.success(t('restrictions.lifted_ok', 'Sanction lifted successfully'));
              loadRestrictions();
            } catch (err) {
              // WHY not a success toast: this used to mark the row LIFTED locally when the request had
              // failed, so an admin could believe a sanction was off an account it was still enforced on.
              toast.error((err && pickMessage(err)) || t('restrictions.lift_failed', 'Could not lift the sanction — it is still in force.'));
            }
          },
        });
        tdActions.append(liftBtn);
      } else {
        tdActions.innerHTML = '<span style="color: var(--text-secondary); font-size: 12px;">—</span>';
      }

      tr.append(tdUser, tdCap, tdMode, tdReason, tdStatus, tdActions);
      tbody.append(tr);
    }
  }

  loadRestrictions();
  root.append(container);
}
