/**
 * AccessGrantsPage.js — Manage standing access grants (Mode A) with time-boxes and revocations (Prompt 3.3).
 *
 * Implements:
 * 1. Overview of time-boxed elevated permissions issued by Super Admins.
 * 2. Status filter tabs (All, Active, Expired, Revoked).
 * 3. Grant Issuer drawer for elevating staff privileges with mandatory justification and expiry.
 * 4. 1-Click Revocation action with mandatory reason capture and immediate cache invalidation.
 * 5. Layout-mirroring Zero-CLS skeleton loader and bilingual i18n support.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';

export default function AccessGrantsPage(root) {
  const isBn = () => getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-users';

  let grants = [];
  let permissionsList = [];
  let statusFilter = 'ALL';
  let isLoading = true;

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
      <span class="badge badge--neutral" style="font-weight: 700; text-transform: uppercase; font-size: 11px;">
        🔑 ${t('grants.eyebrow', 'Standing Privilege Delegation (Mode A)')}
      </span>
    </div>
    <h1 class="admin-users__title">${t('grants.title', 'Standing Access Grants')}</h1>
    <p class="admin-users__subtitle">${t('grants.subtitle', 'Time-boxed elevated privileges granted to operators with full audit logging and 1-click revocations.')}</p>
  `;

  const newGrantBtn = Button({
    label: `➕ ${t('grants.btn_new_grant', 'Issue Access Grant')}`,
    variant: 'primary',
    size: 'sm',
    onClick: () => {
      openGrantDrawer({
        user: null,
        permissions: permissionsList,
        onSuccess: loadGrants,
      });
    },
  });

  titleRow.append(titleWrap, newGrantBtn);
  header.append(titleRow);

  // Status Filter Bar
  const filterBar = document.createElement('div');
  filterBar.style.display = 'flex';
  filterBar.style.flexWrap = 'wrap';
  filterBar.style.gap = 'var(--space-2)';
  filterBar.style.padding = 'var(--space-3) var(--space-4)';
  filterBar.style.background = 'var(--surface-1)';
  filterBar.style.border = 'var(--border-width) solid var(--border-subtle)';
  filterBar.style.borderRadius = 'var(--radius-xl)';
  filterBar.style.boxShadow = 'var(--elevation-1)';

  const filterOptions = [
    { key: 'ALL', label: 'All Grants' },
    { key: 'ACTIVE', label: '🟢 Active' },
    { key: 'EXPIRED', label: '⏳ Expired' },
    { key: 'REVOKED', label: '🚫 Revoked' },
  ];

  for (const opt of filterOptions) {
    const btn = document.createElement('button');
    btn.className = `btn btn--sm ${statusFilter === opt.key ? 'btn--primary' : 'btn--secondary'}`;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      statusFilter = opt.key;
      filterBar.querySelectorAll('button').forEach((b) => {
        b.className = 'btn btn--secondary btn--sm';
      });
      btn.className = 'btn btn--primary btn--sm';
      loadGrants();
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
      <th style="text-align: left;">${t('grants.table_grantee', 'Grantee / Staff')}</th>
      <th style="text-align: left;">${t('grants.table_perm', 'Elevated Permission')}</th>
      <th>${t('grants.table_expires', 'Expiry Window')}</th>
      <th style="text-align: left;">${t('grants.table_reason', 'Business Justification')}</th>
      <th>${t('grants.table_status', 'Status')}</th>
      <th style="text-align: center;">${t('admin_users.table_actions', 'Actions')}</th>
    </tr>
  `;
  table.append(thead);

  const tbody = document.createElement('tbody');
  table.append(tbody);
  tableWrap.append(table);

  container.append(header, filterBar, tableWrap);

  function renderSkeleton() {
    return `
      ${Array.from({ length: 3 }).map(() => `
        <tr>
          <td>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <div style="width: 120px; height: 14px; background: var(--surface-2); border-radius: 4px;"></div>
              <div style="width: 160px; height: 10px; background: var(--surface-2); border-radius: 4px;"></div>
            </div>
          </td>
          <td><div style="width: 140px; height: 14px; background: var(--surface-2); border-radius: 4px;"></div></td>
          <td><div style="width: 90px; height: 12px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
          <td><div style="width: 180px; height: 12px; background: var(--surface-2); border-radius: 4px;"></div></td>
          <td><div style="width: 60px; height: 18px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
          <td><div style="width: 80px; height: 24px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
        </tr>
      `).join('')}
    `;
  }

  async function loadGrants() {
    isLoading = true;
    tbody.innerHTML = renderSkeleton();

    try {
      const res = await api.get('/admin/grants', {
        query: {
          status: statusFilter,
        },
      });
      grants = res.data?.grants || res.grants || [];
    } catch {
      grants = [];
    } finally {
      isLoading = false;
      renderTable();
    }
  }

  async function loadPermissions() {
    try {
      const res = await api.get('/admin/roles-permissions');
      permissionsList = res.permissions || [];
    } catch {
      permissionsList = [];
    }
  }

  function renderTable() {
    tbody.innerHTML = '';
    const isLangBn = isBn();

    if (grants.length === 0) {
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = 6;
      emptyTd.style.textAlign = 'center';
      emptyTd.style.padding = 'var(--space-8)';
      emptyTd.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <span style="font-size: 28px;">🔑</span>
          <span style="font-weight: 700; color: var(--text-primary);">${isLangBn ? 'কোনো সক্রিয় স্ট্যান্ডিং গ্রান্ট নেই।' : 'No standing access grants found.'}</span>
          <span style="font-size: 12px; color: var(--text-muted);">Privileges granted here will elevate staff capabilities with automatic time expiration.</span>
        </div>
      `;
      emptyTr.append(emptyTd);
      tbody.append(emptyTr);
      return;
    }

    for (const g of grants) {
      const tr = document.createElement('tr');

      // Grantee User
      const tdUser = document.createElement('td');
      tdUser.style.textAlign = 'left';
      tdUser.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-weight: 700; color: var(--text-primary);">${g.grantee_name || g.grantee_phone || `User #${g.user_id}`}</span>
          <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono, monospace);">${g.grantee_ref || ''} · ${g.grantee_phone || ''}</span>
        </div>
      `;

      // Elevated Permission & Scope
      const tdPerm = document.createElement('td');
      tdPerm.style.textAlign = 'left';
      const permObj = permissionsList.find((p) => p.key === g.permission_key);
      const permLabel = permObj
        ? (isLangBn ? (permObj.label_bn || permObj.label_en) : (permObj.label_en || permObj.label_bn))
        : g.permission_key.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' › ');

      const scopeBadge = g.scope_json
        ? `<br><span style="font-size: 10px; color: var(--text-secondary); background: var(--surface-2); padding: 1px 4px; border-radius: 3px;">Scope: ${JSON.stringify(g.scope_json)}</span>`
        : '';
      tdPerm.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <strong style="font-size: 13px; color: var(--text-primary);">${permLabel}</strong>
          <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono, monospace);">${g.permission_key}</span>
        </div>
        ${scopeBadge}
      `;

      // Expiry Window
      const tdExpires = document.createElement('td');
      tdExpires.style.fontSize = '12px';
      tdExpires.style.color = 'var(--text-secondary)';
      tdExpires.textContent = formatDate(new Date(g.expires_at).getTime(), { lang: isLangBn ? 'bn' : 'en' });

      // Reason / Granted By
      const tdReason = document.createElement('td');
      tdReason.style.textAlign = 'left';
      tdReason.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 12px; color: var(--text-primary); font-weight: 500;">"${g.reason}"</span>
          <span style="font-size: 10px; color: var(--text-muted);">Issued by: ${g.granted_by || 'Super Admin'}</span>
        </div>
      `;

      // Status Badge
      const isRevoked = Boolean(g.revoked_at);
      const isExpired = new Date(g.expires_at).getTime() <= Date.now();
      const tdStatus = document.createElement('td');
      const statusBadge = Badge({
        label: isRevoked ? 'REVOKED' : isExpired ? 'EXPIRED' : 'ACTIVE',
        variant: isRevoked ? 'danger' : isExpired ? 'neutral' : 'success',
      });
      tdStatus.append(statusBadge);

      // Actions
      const tdActions = document.createElement('td');
      tdActions.style.textAlign = 'center';
      if (!isRevoked && !isExpired) {
        const revokeBtn = Button({
          label: t('grants.btn_revoke', 'Revoke Grant'),
          variant: 'danger',
          size: 'sm',
          onClick: async () => {
            const conf = await confirmDialogWithReason({
              title: t('grants.confirm_revoke_title', 'Revoke standing access grant?'),
              description: t('grants.confirm_revoke_desc', 'This will immediately remove the elevated capability from the user and log this audit action.'),
              reasonRequired: true,
              trigger: revokeBtn,
            });

            if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 10) return;

            try {
              await api.delete(`/admin/grants/${g.id}`, { body: { reason: conf.reason.trim() } });
              toast.success(isLangBn ? 'গ্রান্ট সফলভাবে প্রত্যাহার করা হয়েছে' : 'Standing grant revoked successfully');
              loadGrants();
            } catch (err) {
              toast.error(err.message || 'Failed to revoke grant.');
            }
          },
        });
        tdActions.append(revokeBtn);
      } else {
        tdActions.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">—</span>';
      }

      tr.append(tdUser, tdPerm, tdExpires, tdReason, tdStatus, tdActions);
      tbody.append(tr);
    }
  }

  loadGrants();
  loadPermissions();

  root.append(container);
}
