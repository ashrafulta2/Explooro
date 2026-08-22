/**
 * UsersPage.js — Searchable, filterable users table with bulk selection & quick actions (Prompt 3.3).
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';
import { openRestrictionEditor } from '../../components/admin/RestrictionEditor.js';

export default function UsersPage({ navigate }) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-users';

  let users = [];
  let selectedUserIds = new Set();
  let permissionsList = [];

  let query = '';
  let selectedRole = 'ALL';
  let selectedTier = 'ALL';
  let selectedDistrict = 'ALL';
  let selectedRestriction = 'ALL';

  // Header
  const header = document.createElement('div');
  header.className = 'admin-users__header';

  const title = document.createElement('h1');
  title.className = 'admin-users__title';
  title.textContent = t('admin_users.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'admin-users__subtitle';
  subtitle.textContent = t('admin_users.subtitle');

  header.append(title, subtitle);

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'admin-users__toolbar';

  // Search row
  const searchRow = document.createElement('div');
  searchRow.className = 'admin-users__search-row';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'admin-users__search';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = t('admin_users.search_placeholder');
  searchInput.setAttribute('aria-label', t('admin_users.search_placeholder'));
  searchInput.addEventListener('input', (e) => {
    query = e.target.value.trim();
    loadUsers();
  });
  searchWrap.append(searchInput);

  searchRow.append(searchWrap);

  // Filters row
  const filtersRow = document.createElement('div');
  filtersRow.className = 'admin-users__filters-row';

  // Role select
  const roleSelect = document.createElement('select');
  roleSelect.className = 'admin-users__select';
  roleSelect.setAttribute('aria-label', t('admin_users.all_roles'));
  roleSelect.innerHTML = `
    <option value="ALL">${t('admin_users.all_roles')}</option>
    <option value="customer">Customer</option>
    <option value="saler">Saler</option>
    <option value="supplier">Supplier</option>
    <option value="moderator">Moderator</option>
    <option value="editor">Editor</option>
    <option value="admin">Admin</option>
    <option value="super_admin">Super Admin</option>
  `;
  roleSelect.addEventListener('change', (e) => {
    selectedRole = e.target.value;
    loadUsers();
  });

  // District select
  const districtSelect = document.createElement('select');
  districtSelect.className = 'admin-users__select';
  districtSelect.setAttribute('aria-label', t('admin_users.all_districts'));
  districtSelect.innerHTML = `<option value="ALL">${t('admin_users.all_districts')}</option>` +
    ['Dhaka', 'Chittagong', 'Sylhet', 'Rajshahi', 'Khulna', 'Barisal', 'Rangpur', 'Mymensingh', 'Comilla', 'Bogura', 'Gazipur', 'Narayanganj']
      .map((d) => `<option value="${d}">${d}</option>`)
      .join('');
  districtSelect.addEventListener('change', (e) => {
    selectedDistrict = e.target.value;
    loadUsers();
  });

  // Restriction select
  const restrictionSelect = document.createElement('select');
  restrictionSelect.className = 'admin-users__select';
  restrictionSelect.setAttribute('aria-label', t('admin_users.all_restrictions'));
  restrictionSelect.innerHTML = `
    <option value="ALL">${t('admin_users.all_restrictions')}</option>
    <option value="CLEAN">${t('admin_users.clean_only')}</option>
    <option value="RESTRICTED">${t('admin_users.restricted_only')}</option>
  `;
  restrictionSelect.addEventListener('change', (e) => {
    selectedRestriction = e.target.value;
    loadUsers();
  });

  filtersRow.append(roleSelect, districtSelect, restrictionSelect);
  toolbar.append(searchRow, filtersRow);

  // Bulk actions bar
  const bulkBar = document.createElement('div');
  bulkBar.style.display = 'none';
  bulkBar.style.alignItems = 'center';
  bulkBar.style.justifyContent = 'space-between';
  bulkBar.style.padding = 'var(--space-3) var(--space-4)';
  bulkBar.style.background = 'var(--surface-subtle)';
  bulkBar.style.borderRadius = 'var(--radius-md)';

  const bulkText = document.createElement('span');
  bulkText.className = 'text-sm font-semibold';

  const bulkRestrictBtn = Button({
    label: t('admin_users.bulk_restrict'),
    variant: 'danger',
    size: 'sm',
    onClick: () => {
      openRestrictionEditor({
        user: null,
        onSuccess: loadUsers,
      });
    },
  });

  bulkBar.append(bulkText, bulkRestrictBtn);

  // Users Table
  const tableWrap = document.createElement('div');
  tableWrap.className = 'perm-matrix__table-wrap';

  const table = document.createElement('table');
  table.className = 'perm-matrix__table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th style="width: 40px; text-align: center;"><input type="checkbox" id="select-all-users" /></th>
      <th>${t('admin_users.table_user')}</th>
      <th>${t('admin_users.table_role')}</th>
      <th>${t('admin_users.table_district')}</th>
      <th>${t('admin_users.table_status')}</th>
      <th>${t('admin_users.table_restrictions')}</th>
      <th>${t('admin_users.table_actions')}</th>
    </tr>
  `;
  table.append(thead);

  const tbody = document.createElement('tbody');
  table.append(tbody);
  tableWrap.append(table);

  container.append(header, toolbar, bulkBar, tableWrap);

  const selectAllBox = thead.querySelector('#select-all-users');
  selectAllBox.addEventListener('change', (e) => {
    const checked = e.target.checked;
    if (checked) {
      for (const u of users) selectedUserIds.add(u.id);
    } else {
      selectedUserIds.clear();
    }
    updateBulkBar();
    renderTable();
  });

  function updateBulkBar() {
    if (selectedUserIds.size > 0) {
      bulkBar.style.display = 'flex';
      bulkText.textContent = t('admin_users.bulk_actions', { count: selectedUserIds.size });
    } else {
      bulkBar.style.display = 'none';
    }
  }

  async function loadUsers() {
    try {
      const res = await api.get('/admin/users', {
        params: {
          q: query,
          role: selectedRole,
          district: selectedDistrict,
          restriction: selectedRestriction,
        },
      });
      users = res.users || [];
      renderTable();
    } catch {
      // Fallback sample users
      users = [
        { id: 1, ref: 'USR-8F2K9QX7', phone: '01711000001', full_name: 'Rahim Khan', role_key: 'moderator', role_label_en: 'Moderator', role_label_bn: 'মডারেটর', district: 'Dhaka', status: 'ACTIVE', active_restrictions_count: 0 },
        { id: 2, ref: 'USR-3M7V2WQ1', phone: '01711000002', full_name: 'Fatima Fashion', role_key: 'saler', role_label_en: 'Saler', role_label_bn: 'সেলার', district: 'Sylhet', status: 'ACTIVE', active_restrictions_count: 1 },
        { id: 3, ref: 'USR-9K4P8ZN2', phone: '01711000003', full_name: 'Karim Textile', role_key: 'supplier', role_label_en: 'Supplier', role_label_bn: 'সাপ্লায়ার', district: 'Chittagong', status: 'ACTIVE', active_restrictions_count: 0 },
      ];
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
    const isLangBn = getLanguage() === 'bn';

    if (users.length === 0) {
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = 7;
      emptyTd.style.textAlign = 'center';
      emptyTd.style.padding = 'var(--space-6)';
      emptyTd.className = 'text-sm text-muted';
      emptyTd.textContent = t('admin_users.no_users_found');
      emptyTr.append(emptyTd);
      tbody.append(emptyTr);
      return;
    }

    for (const u of users) {
      const tr = document.createElement('tr');

      // Checkbox
      const tdCheck = document.createElement('td');
      tdCheck.style.textAlign = 'center';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = selectedUserIds.has(u.id);
      chk.setAttribute('aria-label', `Select user ${u.full_name || u.phone}`);
      chk.addEventListener('change', (e) => {
        if (e.target.checked) selectedUserIds.add(u.id);
        else selectedUserIds.delete(u.id);
        updateBulkBar();
      });
      tdCheck.append(chk);

      // User
      const tdUser = document.createElement('td');
      tdUser.style.textAlign = 'left';
      tdUser.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-weight: 600; color: var(--text-primary); cursor: pointer;" class="user-link">${u.full_name || u.phone}</span>
          <span style="font-size: 11px; color: var(--text-muted); font-family: monospace;">${u.ref} · ${u.phone}</span>
        </div>
      `;
      tdUser.querySelector('.user-link').addEventListener('click', () => {
        if (navigate) navigate(`/admin/users/${u.id}`);
      });

      // Role
      const tdRole = document.createElement('td');
      const roleLabel = isLangBn ? (u.role_label_bn || u.role_label_en || u.role_key) : (u.role_label_en || u.role_key);
      const roleBadge = Badge({ label: roleLabel, variant: u.role_key === 'super_admin' ? 'danger' : 'neutral' });
      tdRole.append(roleBadge);

      // District
      const tdDistrict = document.createElement('td');
      tdDistrict.textContent = u.district || 'Dhaka';

      // Status
      const tdStatus = document.createElement('td');
      const statusBadge = Badge({ label: u.status, variant: u.status === 'ACTIVE' ? 'success' : 'warning' });
      tdStatus.append(statusBadge);

      // Restrictions
      const tdRestrictions = document.createElement('td');
      if (u.active_restrictions_count > 0) {
        const rBadge = Badge({ label: `⚠️ ${u.active_restrictions_count} Restricted`, variant: 'danger' });
        tdRestrictions.append(rBadge);
      } else {
        tdRestrictions.innerHTML = '<span style="color: var(--color-success, #10b981); font-size: 11px;">✓ Clean</span>';
      }

      // Actions
      const tdActions = document.createElement('td');
      const actionWrap = document.createElement('div');
      actionWrap.style.display = 'flex';
      actionWrap.style.gap = '6px';
      actionWrap.style.justifyContent = 'center';

      const viewBtn = Button({
        label: t('admin_users.view_profile'),
        variant: 'secondary',
        size: 'sm',
        onClick: () => {
          if (navigate) navigate(`/admin/users/${u.id}`);
        },
      });

      const grantBtn = Button({
        label: '🎁',
        variant: 'ghost',
        size: 'sm',
        onClick: () => {
          openGrantDrawer({
            user: u,
            permissions: permissionsList,
            onSuccess: loadUsers,
          });
        },
      });

      const restrictBtn = Button({
        label: '🚫',
        variant: 'ghost',
        size: 'sm',
        onClick: () => {
          openRestrictionEditor({
            user: u,
            onSuccess: loadUsers,
          });
        },
      });

      actionWrap.append(viewBtn, grantBtn, restrictBtn);
      tdActions.append(actionWrap);

      tr.append(tdCheck, tdUser, tdRole, tdDistrict, tdStatus, tdRestrictions, tdActions);
      tbody.append(tr);
    }
  }

  loadUsers();
  loadPermissions();

  return container;
}
