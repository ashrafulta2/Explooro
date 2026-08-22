/**
 * AccessGrantsPage.js — Manage standing access grants (Mode A) with time-boxes and revocations (Prompt 3.3).
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate } from '../../services/format.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';

export default function AccessGrantsPage() {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-users';

  let grants = [];
  let permissionsList = [];

  // Header
  const header = document.createElement('div');
  header.className = 'admin-users__header';

  const titleRow = document.createElement('div');
  titleRow.style.display = 'flex';
  titleRow.style.alignItems = 'center';
  titleRow.style.justifyContent = 'space-between';

  const title = document.createElement('h1');
  title.className = 'admin-users__title';
  title.textContent = t('grants.title');

  const newGrantBtn = Button({
    label: `➕ ${t('grants.btn_new_grant')}`,
    variant: 'primary',
    onClick: () => {
      openGrantDrawer({
        user: null,
        permissions: permissionsList,
        onSuccess: loadGrants,
      });
    },
  });

  titleRow.append(title, newGrantBtn);

  const subtitle = document.createElement('p');
  subtitle.className = 'admin-users__subtitle';
  subtitle.textContent = t('grants.subtitle');

  header.append(titleRow, subtitle);

  // Table wrap
  const tableWrap = document.createElement('div');
  tableWrap.className = 'perm-matrix__table-wrap';

  const table = document.createElement('table');
  table.className = 'perm-matrix__table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>${t('grants.table_grantee')}</th>
      <th>${t('grants.table_perm')}</th>
      <th>${t('grants.table_expires')}</th>
      <th>${t('grants.table_reason')}</th>
      <th>${t('grants.table_status')}</th>
      <th>${t('admin_users.table_actions')}</th>
    </tr>
  `;
  table.append(thead);

  const tbody = document.createElement('tbody');
  table.append(tbody);
  tableWrap.append(table);

  container.append(header, tableWrap);

  async function loadGrants() {
    try {
      const res = await api.get('/admin/grants');
      grants = res.data || [];
      renderTable();
    } catch {
      grants = [];
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
    if (grants.length === 0) {
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = 6;
      emptyTd.style.textAlign = 'center';
      emptyTd.style.padding = 'var(--space-6)';
      emptyTd.className = 'text-sm text-muted';
      emptyTd.textContent = isBn ? 'কোনো সক্রিয় স্ট্যান্ডিং গ্রান্ট নেই।' : 'No active standing access grants found.';
      emptyTr.append(emptyTd);
      tbody.append(emptyTr);
      return;
    }

    for (const g of grants) {
      const tr = document.createElement('tr');

      const tdUser = document.createElement('td');
      tdUser.style.textAlign = 'left';
      tdUser.innerHTML = `<strong>${g.grantee_phone || `User #${g.user_id}`}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${g.grantee_ref || ''}</span>`;

      const tdPerm = document.createElement('td');
      tdPerm.innerHTML = `<code>${g.permission_key}</code>`;

      const tdExpires = document.createElement('td');
      tdExpires.textContent = formatDate(new Date(g.expires_at).getTime(), { lang: isBn ? 'bn' : 'en' });

      const tdReason = document.createElement('td');
      tdReason.style.textAlign = 'left';
      tdReason.textContent = g.reason;

      const isRevoked = Boolean(g.revoked_at);
      const isExpired = new Date(g.expires_at).getTime() <= Date.now();
      const tdStatus = document.createElement('td');
      const statusBadge = Badge({
        label: isRevoked ? 'REVOKED' : isExpired ? 'EXPIRED' : 'ACTIVE',
        variant: isRevoked ? 'danger' : isExpired ? 'neutral' : 'success',
      });
      tdStatus.append(statusBadge);

      const tdActions = document.createElement('td');
      if (!isRevoked && !isExpired) {
        const revokeBtn = Button({
          label: t('grants.btn_revoke'),
          variant: 'danger',
          size: 'sm',
          onClick: async () => {
            const conf = await confirmDialogWithReason({
              title: t('grants.confirm_revoke_title'),
              description: t('grants.confirm_revoke_desc'),
              reasonRequired: true,
              trigger: revokeBtn,
            });

            if (!conf || !conf.confirmed || !conf.reason || conf.reason.trim().length < 10) return;

            try {
              await api.delete(`/admin/grants/${g.id}`, { data: { reason: conf.reason.trim() } });
              toast.success(isBn ? 'গ্রান্ট সফলভাবে প্রত্যাহার করা হয়েছে' : 'Standing grant revoked successfully');
              loadGrants();
            } catch (err) {
              toast.error(err.message || t('common.error_generic'));
            }
          },
        });
        tdActions.append(revokeBtn);
      } else {
        tdActions.textContent = '—';
      }

      tr.append(tdUser, tdPerm, tdExpires, tdReason, tdStatus, tdActions);
      tbody.append(tr);
    }
  }

  loadGrants();
  loadPermissions();

  return container;
}
