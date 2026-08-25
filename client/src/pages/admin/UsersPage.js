/**
 * UsersPage.js — Searchable, filterable users table with bulk selection & quick actions (Prompt 3.3).
 *
 * Implements:
 * 1. Granular user search by name, phone, email, or user ref ID.
 * 2. Multi-parameter filtering by Role, District, Verification state, and Restriction status.
 * 3. Bulk action toolbar with multi-user selection.
 * 4. Standing Grant issuing and Capability Restriction modals.
 * 5. Layout-mirroring Zero-CLS skeleton loader and bilingual i18n.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';
import { openRestrictionEditor } from '../../components/admin/RestrictionEditor.js';

export default function UsersPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-users';

  let users = [];
  let selectedUserIds = new Set();
  let permissionsList = [];
  let isLoading = true;

  let query = '';
  let selectedRole = 'ALL';
  let selectedDistrict = 'ALL';
  let selectedRestriction = 'ALL';

  // Header
  const header = document.createElement('div');
  header.className = 'admin-users__header';

  const title = document.createElement('h1');
  title.className = 'admin-users__title';
  title.textContent = t('admin_users.title', 'Users & Account Governance');

  const subtitle = document.createElement('p');
  subtitle.className = 'admin-users__subtitle';
  subtitle.textContent = t('admin_users.subtitle', 'Search, inspect, and manage granular permissions, standing grants, and capability restrictions across all platform accounts.');

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
  searchInput.placeholder = t('admin_users.search_placeholder', 'Search by name, phone, email, or user ref…');
  searchInput.setAttribute('aria-label', t('admin_users.search_placeholder', 'Search by name, phone, email, or user ref…'));
  
  let debounceTimeout = null;
  searchInput.addEventListener('input', (e) => {
    query = e.target.value.trim();
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      loadUsers();
    }, 200);
  });
  searchWrap.append(searchInput);
  searchRow.append(searchWrap);

  // Filters row
  const filtersRow = document.createElement('div');
  filtersRow.className = 'admin-users__filters-row';

  // Role select
  const roleSelect = document.createElement('select');
  roleSelect.className = 'admin-users__select';
  roleSelect.setAttribute('aria-label', t('admin_users.all_roles', 'All Roles'));
  roleSelect.innerHTML = `
    <option value="ALL">${t('admin_users.all_roles', 'All Roles')}</option>
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
  districtSelect.setAttribute('aria-label', t('admin_users.all_districts', 'All Districts (64)'));
  districtSelect.innerHTML = `<option value="ALL">${t('admin_users.all_districts', 'All Districts (64)')}</option>` +
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
  restrictionSelect.setAttribute('aria-label', t('admin_users.all_restrictions', 'All Restrictions'));
  restrictionSelect.innerHTML = `
    <option value="ALL">${t('admin_users.all_restrictions', 'All Restrictions')}</option>
    <option value="CLEAN">${t('admin_users.clean_only', 'Clean Only')}</option>
    <option value="RESTRICTED">${t('admin_users.restricted_only', 'Restricted Only')}</option>
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
  bulkBar.style.background = 'var(--surface-2)';
  bulkBar.style.borderRadius = 'var(--radius-lg)';
  bulkBar.style.border = 'var(--border-width) solid var(--border-subtle)';

  const bulkText = document.createElement('span');
  bulkText.style.fontSize = 'var(--font-size-sm)';
  bulkText.style.fontWeight = '700';
  bulkText.style.color = 'var(--text-primary)';

  const bulkRestrictBtn = Button({
    label: t('admin_users.bulk_restrict', 'Apply Bulk Restriction'),
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
      <th style="width: 44px; text-align: center;"><input type="checkbox" id="select-all-users" aria-label="Select all users on this page" /></th>
      <th style="text-align: left;">${t('admin_users.table_user', 'User / Contact')}</th>
      <th>${t('admin_users.table_role', 'Role & Tier')}</th>
      <th>${t('admin_users.table_district', 'District')}</th>
      <th>${t('admin_users.table_status', 'Status')}</th>
      <th>${t('admin_users.table_restrictions', 'Restrictions')}</th>
      <th style="text-align: center;">${t('admin_users.table_actions', 'Actions')}</th>
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
      bulkText.textContent = t('admin_users.bulk_actions', `Bulk Actions (${selectedUserIds.size} selected)`, { count: selectedUserIds.size });
    } else {
      bulkBar.style.display = 'none';
    }
  }

  async function loadUsers() {
    isLoading = true;
    renderTable();

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
    } catch {
      users = [];
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
    const isLangBn = getLanguage() === 'bn';

    if (isLoading && users.length === 0) {
      tbody.innerHTML = `
        ${Array.from({ length: 5 }).map(() => `
          <tr>
            <td style="text-align: center;"><div style="width: 16px; height: 16px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
            <td>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="width: 140px; height: 14px; background: var(--surface-2); border-radius: 4px;"></div>
                <div style="width: 180px; height: 10px; background: var(--surface-2); border-radius: 4px;"></div>
              </div>
            </td>
            <td><div style="width: 70px; height: 20px; background: var(--surface-2); border-radius: var(--radius-sm); margin: auto;"></div></td>
            <td><div style="width: 60px; height: 12px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
            <td><div style="width: 50px; height: 20px; background: var(--surface-2); border-radius: var(--radius-sm); margin: auto;"></div></td>
            <td><div style="width: 60px; height: 12px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
            <td><div style="width: 100px; height: 28px; background: var(--surface-2); border-radius: var(--radius-sm); margin: auto;"></div></td>
          </tr>
        `).join('')}
      `;
      return;
    }

    if (users.length === 0) {
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = 7;
      emptyTd.style.textAlign = 'center';
      emptyTd.style.padding = 'var(--space-8)';
      emptyTd.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <span style="font-size: 28px;">🔍</span>
          <span style="font-weight: 700; color: var(--text-primary);">${t('admin_users.no_users_found', 'No users match the specified search and filter criteria.')}</span>
          <span style="font-size: 12px; color: var(--text-muted);">Try broadening your search query or clearing role/district filters.</span>
        </div>
      `;
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

      // User Info
      const tdUser = document.createElement('td');
      tdUser.style.textAlign = 'left';
      tdUser.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-weight: 700; color: var(--text-primary); cursor: pointer;" class="user-link" tabindex="0">${u.full_name || u.phone}</span>
          <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono, monospace);">${u.ref} · ${u.phone} ${u.email ? `· ${u.email}` : ''}</span>
        </div>
      `;
      const link = tdUser.querySelector('.user-link');
      const goToDetail = () => {
        if (navigate) navigate(`/admin/users/${u.id}`);
        else {
          history.pushState({}, '', `/admin/users/${u.id}`);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      };
      link.addEventListener('click', goToDetail);
      link.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToDetail();
        }
      });

      // Role & Tier
      const tdRole = document.createElement('td');
      const roleLabel = isLangBn ? (u.role_label_bn || u.role_label_en || u.role_key) : (u.role_label_en || u.role_key);
      const roleBadge = Badge({ label: roleLabel, variant: u.role_key === 'super_admin' ? 'danger' : 'neutral' });
      tdRole.append(roleBadge);

      // District
      const tdDistrict = document.createElement('td');
      tdDistrict.textContent = u.district || 'Dhaka';
      tdDistrict.style.fontWeight = '600';

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
        tdRestrictions.innerHTML = '<span style="color: var(--status-success, #10b981); font-size: 11px; font-weight: 700;">✓ Clean</span>';
      }

      // Actions
      const tdActions = document.createElement('td');
      const actionWrap = document.createElement('div');
      actionWrap.style.display = 'flex';
      actionWrap.style.gap = '6px';
      actionWrap.style.justifyContent = 'center';

      const viewBtn = Button({
        label: t('admin_users.view_profile', 'View Details'),
        variant: 'secondary',
        size: 'sm',
        onClick: goToDetail,
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

  root.append(container);
}
