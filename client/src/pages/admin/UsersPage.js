/**
 * UsersPage.js — Searchable, filterable users table with bulk selection, KPI summary & quick actions (Prompt 3.3).
 *
 * Implements:
 * 1. Executive Page Header & 4-Card KPI Summary Grid (Total, Active, Staff, Restricted).
 * 2. Granular user search by name, phone, email, or user ref ID with inline SVG search icon.
 * 3. Multi-parameter filtering by Role, District (64 districts), and Restriction status with custom SVG chevrons.
 * 4. Structured table panel with responsive card frame, initials avatar pill, and aligned columns.
 * 5. Accessible administrative actions (View Details, Issue Standing Grant, Apply Capability Restriction).
 * 6. Bulk action toolbar with multi-user selection and one-click bulk restriction.
 * 7. One-click UTF-8 BOM CSV export with formula injection prevention.
 * 8. Layout-mirroring Zero-CLS skeleton loader and bilingual i18n support.
 */

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { api } from '../../core/api.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { openGrantDrawer } from '../../components/admin/GrantDrawer.js';
import { openRestrictionEditor } from '../../components/admin/RestrictionEditor.js';
import '../../styles/components/admin-users.css';

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (!PLAIN_NUMBER.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const SVG_SEARCH = `<span class="admin-users-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg></span>`;
const SVG_CHEVRON = `<span class="admin-users-select-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>`;

const BANGLADESH_DISTRICTS = [
  'Bagerhat', 'Bandarban', 'Barguna', 'Barisal', 'Bhola', 'Bogura', 'Brahmanbaria', 'Chandpur',
  'Chittagong', 'Chuadanga', 'Comilla', "Cox's Bazar", 'Dhaka', 'Dinajpur', 'Faridpur', 'Feni',
  'Gaibandha', 'Gazipur', 'Gopalganj', 'Habiganj', 'Jamalpur', 'Jashore', 'Jhalokati', 'Jhenaidah',
  'Joypurhat', 'Khagrachhari', 'Khulna', 'Kishoreganj', 'Kurigram', 'Kushtia', 'Lakshmipur', 'Lalmonirhat',
  'Madaripur', 'Magura', 'Manikganj', 'Meherpur', 'Moulvibazar', 'Munshiganj', 'Mymensingh', 'Naogaon',
  'Narail', 'Narayanganj', 'Narsingdi', 'Natore', 'Netrokona', 'Nilphamari', 'Noakhali', 'Pabna',
  'Panchagarh', 'Patuakhali', 'Pirojpur', 'Rajbari', 'Rajshahi', 'Rangamati', 'Rangpur', 'Satkhira',
  'Shariatpur', 'Sherpur', 'Sirajganj', 'Sunamganj', 'Sylhet', 'Tangail', 'Thakurgaon'
];

export default function UsersPage(root, { navigate } = {}) {
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  const container = document.createElement('div');
  container.className = 'page admin-users-page';

  let allUsers = [];
  let users = [];
  let selectedUserIds = new Set();
  let permissionsList = [];
  let isLoading = true;

  let query = '';
  let selectedRole = 'ALL';
  let selectedDistrict = 'ALL';
  let selectedRestriction = 'ALL';

  function getRoleBadgeVariant(roleKey) {
    switch (roleKey) {
      case 'super_admin':
        return 'danger';
      case 'admin':
        return 'purple';
      case 'moderator':
      case 'editor':
        return 'info';
      case 'supplier':
      case 'saler':
        return 'primary';
      default:
        return 'neutral';
    }
  }

  function getInitials(name, phone) {
    if (name) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return name.slice(0, 2).toUpperCase();
    }
    if (phone) return phone.slice(-2);
    return 'U';
  }

  function handleExportCsv() {
    if (users.length === 0) {
      toast.info(t('admin_users.no_users_found', 'No users match the specified search and filter criteria.'));
      return;
    }

    const headers = [
      'User Ref',
      'Full Name',
      'Phone',
      'Email',
      'Role',
      'District',
      'Status',
      'Active Restrictions',
      'Created Date',
    ];

    const rows = users.map((u) => [
      csvCell(u.ref || `USR-${u.id}`),
      csvCell(u.full_name || ''),
      csvCell(u.phone || ''),
      csvCell(u.email || ''),
      csvCell(u.role_label_en || u.role_key || ''),
      csvCell(u.district || ''),
      csvCell(u.status || ''),
      csvCell(u.active_restrictions_count || 0),
      csvCell(u.created_at ? new Date(u.created_at).toISOString().slice(0, 10) : ''),
    ]);

    const csvContent = '\uFEFF' + [headers.map(csvCell).join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `explooro-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(t('admin_users.export_done', 'User roster exported to CSV.'));
  }

  function clearAllFilters() {
    query = '';
    selectedRole = 'ALL';
    selectedDistrict = 'ALL';
    selectedRestriction = 'ALL';

    const searchInput = container.querySelector('#admin-users-search-input');
    if (searchInput) searchInput.value = '';

    const roleSel = container.querySelector('#admin-users-role-filter');
    if (roleSel) roleSel.value = 'ALL';

    const distSel = container.querySelector('#admin-users-district-filter');
    if (distSel) distSel.value = 'ALL';

    const restSel = container.querySelector('#admin-users-restriction-filter');
    if (restSel) restSel.value = 'ALL';

    loadUsers();
  }

  function updateKpis() {
    const totalCount = allUsers.length || users.length;
    const activeCount = (allUsers.length ? allUsers : users).filter((u) => u.status === 'ACTIVE').length;
    const staffCount = (allUsers.length ? allUsers : users).filter((u) => ['super_admin', 'admin', 'moderator', 'editor'].includes(u.role_key)).length;
    const restrictedCount = (allUsers.length ? allUsers : users).filter((u) => (u.active_restrictions_count || 0) > 0).length;

    const elTotal = container.querySelector('#kpi-users-total-val');
    if (elTotal) elTotal.textContent = totalCount;

    const elActive = container.querySelector('#kpi-users-active-val');
    if (elActive) elActive.textContent = activeCount;

    const elStaff = container.querySelector('#kpi-users-staff-val');
    if (elStaff) elStaff.textContent = staffCount;

    const elRestricted = container.querySelector('#kpi-users-restricted-val');
    if (elRestricted) elRestricted.textContent = restrictedCount;
  }

  function updateBulkBar() {
    const bulkBar = container.querySelector('#admin-users-bulk-bar');
    const bulkText = container.querySelector('#admin-users-bulk-text');
    const exportBtn = container.querySelector('.admin-users-page__export-btn');

    if (exportBtn) {
      exportBtn.disabled = users.length === 0;
    }

    if (bulkBar && bulkText) {
      if (selectedUserIds.size > 0) {
        bulkBar.style.display = 'flex';
        bulkText.textContent = t('admin_users.bulk_actions', `Bulk Actions (${selectedUserIds.size} selected)`, { count: selectedUserIds.size });
      } else {
        bulkBar.style.display = 'none';
      }
    }

    const selectAllBox = container.querySelector('#select-all-users');
    if (selectAllBox) {
      const allSelected = users.length > 0 && users.every((u) => selectedUserIds.has(u.id));
      selectAllBox.checked = allSelected;
      selectAllBox.indeterminate = selectedUserIds.size > 0 && !allSelected;
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
      if (!query && selectedRole === 'ALL' && selectedDistrict === 'ALL' && selectedRestriction === 'ALL') {
        allUsers = [...users];
      }
    } catch {
      users = [];
    } finally {
      isLoading = false;
      renderTable();
      updateKpis();
      updateBulkBar();
      updateClearFilterButton();
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

  function updateClearFilterButton() {
    const clearWrap = container.querySelector('#admin-users-clear-wrap');
    const hasActiveFilters = Boolean(query || selectedRole !== 'ALL' || selectedDistrict !== 'ALL' || selectedRestriction !== 'ALL');
    if (clearWrap) {
      clearWrap.innerHTML = hasActiveFilters ? `
        <button type="button" class="btn btn--secondary btn--sm admin-users-clear-btn" id="admin-users-clear-btn">
          ✕ ${t('admin_users.clear_filters', 'Clear Filters')}
        </button>
      ` : '';
      clearWrap.querySelector('#admin-users-clear-btn')?.addEventListener('click', clearAllFilters);
    }

    const countBadge = container.querySelector('#admin-users-table-count');
    if (countBadge) {
      countBadge.textContent = users.length;
    }
  }

  function render() {
    container.innerHTML = `
      <!-- Page Header -->
      <div class="admin-users-page__header">
        <div>
          <div class="admin-users-page__eyebrow">
            <span>🛡️ ${t('admin_users.eyebrow_domain', 'USERS & ACCESS')}</span>
            <span>•</span>
            <span>${t('admin_users.eyebrow_sub', 'ACCOUNT GOVERNANCE')}</span>
          </div>
          <h1 class="page-title">${t('admin_users.title', 'Users & Account Governance')}</h1>
          <p class="text-secondary">${t('admin_users.subtitle', 'Search, inspect, and manage granular permissions, standing grants, and capability restrictions across all platform accounts.')}</p>
        </div>
        <div class="admin-users-page__header-actions">
          <button type="button" class="btn btn--secondary btn--sm admin-users-page__export-btn" ${users.length === 0 ? 'disabled' : ''}>
            📥 ${t('admin_users.export_csv', 'Export CSV')}
          </button>
          <button type="button" class="btn btn--secondary btn--sm admin-users-page__refresh-btn" aria-label="${t('common.refresh', 'Refresh')}">
            🔄 ${t('common.refresh', 'Refresh')}
          </button>
        </div>
      </div>

      <!-- 1. Executive KPI Summary Cards -->
      <div class="admin-users-kpis">
        <div class="admin-users-kpi-card">
          <div class="admin-users-kpi-card__head">
            <span class="admin-users-kpi-card__title">${t('admin_users.kpi_total_users', 'Total Accounts')}</span>
            <span class="badge badge--neutral" aria-hidden="true">👥 ALL</span>
          </div>
          <div class="admin-users-kpi-card__value" id="kpi-users-total-val">0</div>
          <span class="admin-users-kpi-card__hint">${t('admin_users.kpi_total_users_hint', 'Registered marketplace accounts')}</span>
        </div>

        <div class="admin-users-kpi-card">
          <div class="admin-users-kpi-card__head">
            <span class="admin-users-kpi-card__title">${t('admin_users.kpi_active_users', 'Active Accounts')}</span>
            <span class="badge badge--success" aria-hidden="true">✓ ACTIVE</span>
          </div>
          <div class="admin-users-kpi-card__value admin-users-kpi-card__value--success" id="kpi-users-active-val">0</div>
          <span class="admin-users-kpi-card__hint">${t('admin_users.kpi_active_users_hint', 'In good standing')}</span>
        </div>

        <div class="admin-users-kpi-card">
          <div class="admin-users-kpi-card__head">
            <span class="admin-users-kpi-card__title">${t('admin_users.kpi_staff_users', 'Staff & Governance')}</span>
            <span class="badge badge--purple" aria-hidden="true">🛡️ STAFF</span>
          </div>
          <div class="admin-users-kpi-card__value" id="kpi-users-staff-val">0</div>
          <span class="admin-users-kpi-card__hint">${t('admin_users.kpi_staff_users_hint', 'Admin, moderator & editor roles')}</span>
        </div>

        <div class="admin-users-kpi-card">
          <div class="admin-users-kpi-card__head">
            <span class="admin-users-kpi-card__title">${t('admin_users.kpi_restricted_users', 'Under Restriction')}</span>
            <span class="badge badge--warning" aria-hidden="true">⚠️ LIMIT</span>
          </div>
          <div class="admin-users-kpi-card__value admin-users-kpi-card__value--warning" id="kpi-users-restricted-val">0</div>
          <span class="admin-users-kpi-card__hint">${t('admin_users.kpi_restricted_users_hint', 'With active capability limits')}</span>
        </div>
      </div>

      <!-- 2. Main Table Panel -->
      <div class="admin-users-panel">
        <div class="admin-users-panel__header">
          <h2 class="admin-users-panel__title">
            <span>📋 ${t('admin_users.table_title', 'Platform User Roster')}</span>
            <span class="badge badge--neutral font-mono" id="admin-users-table-count">0</span>
          </h2>
          <div class="admin-users-panel__actions" id="admin-users-panel-meta"></div>
        </div>

        <!-- Toolbar -->
        <div class="admin-users-toolbar">
          <div class="admin-users-search-control">
            ${SVG_SEARCH}
            <input
              type="search"
              id="admin-users-search-input"
              class="admin-users-search-input"
              placeholder="${escapeHtml(t('admin_users.search_placeholder', 'Search by name, phone, email, or user ref…'))}"
              aria-label="${escapeHtml(t('admin_users.search_placeholder', 'Search by name, phone, email, or user ref…'))}"
              value="${escapeHtml(query)}"
            />
          </div>

          <div class="admin-users-select-control">
            <select id="admin-users-role-filter" aria-label="${escapeHtml(t('admin_users.all_roles', 'All Roles'))}">
              <option value="ALL" ${selectedRole === 'ALL' ? 'selected' : ''}>${t('admin_users.all_roles', 'All Roles')}</option>
              <option value="customer" ${selectedRole === 'customer' ? 'selected' : ''}>Customer</option>
              <option value="saler" ${selectedRole === 'saler' ? 'selected' : ''}>Saler</option>
              <option value="supplier" ${selectedRole === 'supplier' ? 'selected' : ''}>Supplier</option>
              <option value="moderator" ${selectedRole === 'moderator' ? 'selected' : ''}>Moderator</option>
              <option value="editor" ${selectedRole === 'editor' ? 'selected' : ''}>Editor</option>
              <option value="admin" ${selectedRole === 'admin' ? 'selected' : ''}>Admin</option>
              <option value="super_admin" ${selectedRole === 'super_admin' ? 'selected' : ''}>Super Admin</option>
            </select>
            ${SVG_CHEVRON}
          </div>

          <div class="admin-users-select-control">
            <select id="admin-users-district-filter" aria-label="${escapeHtml(t('admin_users.all_districts', 'All Districts (64)'))}">
              <option value="ALL" ${selectedDistrict === 'ALL' ? 'selected' : ''}>${t('admin_users.all_districts', 'All Districts (64)')}</option>
              ${BANGLADESH_DISTRICTS.map((d) => `<option value="${d}" ${selectedDistrict === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
            ${SVG_CHEVRON}
          </div>

          <div class="admin-users-select-control">
            <select id="admin-users-restriction-filter" aria-label="${escapeHtml(t('admin_users.all_restrictions', 'All Restrictions'))}">
              <option value="ALL" ${selectedRestriction === 'ALL' ? 'selected' : ''}>${t('admin_users.all_restrictions', 'All Restrictions')}</option>
              <option value="CLEAN" ${selectedRestriction === 'CLEAN' ? 'selected' : ''}>${t('admin_users.clean_only', 'Clean Only')}</option>
              <option value="RESTRICTED" ${selectedRestriction === 'RESTRICTED' ? 'selected' : ''}>${t('admin_users.restricted_only', 'Restricted Only')}</option>
            </select>
            ${SVG_CHEVRON}
          </div>

          <div id="admin-users-clear-wrap"></div>
        </div>

        <!-- Bulk Selection Action Bar -->
        <div class="admin-users-bulk-bar" id="admin-users-bulk-bar" style="display: none;">
          <span class="admin-users-bulk-text" id="admin-users-bulk-text"></span>
          <div class="admin-users-bulk-actions">
            <button type="button" class="btn btn--danger btn--sm" id="admin-users-bulk-restrict-btn">
              🛡️ ${t('admin_users.bulk_restrict', 'Apply Bulk Restriction')}
            </button>
            <button type="button" class="btn btn--secondary btn--sm" id="admin-users-bulk-clear-btn">
              ✕ ${t('admin_users.bulk_clear', 'Deselect All')}
            </button>
          </div>
        </div>

        <!-- Table Responsive Wrap -->
        <div class="admin-users-table-wrap admin-table-wrap table-responsive" data-floating-scroll="true">
          <table class="admin-users-table" id="admin-users-table">
            <thead>
              <tr>
                <th class="admin-users-checkbox-cell">
                  <input type="checkbox" id="select-all-users" aria-label="Select all users on this page" />
                </th>
                <th>${t('admin_users.table_user', 'User / Contact')}</th>
                <th>${t('admin_users.table_role', 'Role & Tier')}</th>
                <th>${t('admin_users.table_district', 'District')}</th>
                <th>${t('admin_users.table_status', 'Status')}</th>
                <th>${t('admin_users.table_restrictions', 'Restrictions')}</th>
                <th style="text-align: right;">${t('admin_users.table_actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody id="admin-users-tbody"></tbody>
          </table>
        </div>

        <!-- Table Footer -->
        <div class="admin-users-panel__footer" id="admin-users-footer">
          <span id="admin-users-footer-count">Showing 0 of 0 accounts</span>
          <span class="text-muted">Explooro Platform Governance Engine</span>
        </div>
      </div>
    `;

    // Event listeners
    const exportBtn = container.querySelector('.admin-users-page__export-btn');
    exportBtn?.addEventListener('click', handleExportCsv);

    const refreshBtn = container.querySelector('.admin-users-page__refresh-btn');
    refreshBtn?.addEventListener('click', loadUsers);

    const searchInput = container.querySelector('#admin-users-search-input');
    let debounceTimer = null;
    searchInput?.addEventListener('input', (e) => {
      query = e.target.value.trim();
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadUsers();
      }, 200);
    });

    const roleSelect = container.querySelector('#admin-users-role-filter');
    roleSelect?.addEventListener('change', (e) => {
      selectedRole = e.target.value;
      loadUsers();
    });

    const districtSelect = container.querySelector('#admin-users-district-filter');
    districtSelect?.addEventListener('change', (e) => {
      selectedDistrict = e.target.value;
      loadUsers();
    });

    const restrictionSelect = container.querySelector('#admin-users-restriction-filter');
    restrictionSelect?.addEventListener('change', (e) => {
      selectedRestriction = e.target.value;
      loadUsers();
    });

    const selectAllBox = container.querySelector('#select-all-users');
    selectAllBox?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      if (checked) {
        for (const u of users) selectedUserIds.add(u.id);
      } else {
        selectedUserIds.clear();
      }
      updateBulkBar();
      renderTable();
    });

    const bulkClearBtn = container.querySelector('#admin-users-bulk-clear-btn');
    bulkClearBtn?.addEventListener('click', () => {
      selectedUserIds.clear();
      updateBulkBar();
      renderTable();
    });

    const bulkRestrictBtn = container.querySelector('#admin-users-bulk-restrict-btn');
    bulkRestrictBtn?.addEventListener('click', () => {
      const firstSelectedId = Array.from(selectedUserIds)[0];
      const targetUser = users.find((u) => u.id === firstSelectedId) || null;
      openRestrictionEditor({
        user: targetUser,
        onSuccess: () => {
          selectedUserIds.clear();
          loadUsers();
        },
      });
    });
  }

  function renderTable() {
    const tbody = container.querySelector('#admin-users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const isLangBn = getLanguage() === 'bn';

    if (isLoading && users.length === 0) {
      tbody.innerHTML = Array.from({ length: 6 }).map(() => `
        <tr>
          <td class="admin-users-checkbox-cell">
            <div style="width: 16px; height: 16px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div>
          </td>
          <td>
            <div class="admin-users-user-cell">
              <div style="width: 38px; height: 38px; background: var(--surface-2); border-radius: var(--radius-full); flex-shrink: 0;"></div>
              <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
                <div style="width: 140px; height: 14px; background: var(--surface-2); border-radius: var(--radius-xs);"></div>
                <div style="width: 220px; height: 10px; background: var(--surface-2); border-radius: var(--radius-xs);"></div>
              </div>
            </div>
          </td>
          <td><div style="width: 80px; height: 22px; background: var(--surface-2); border-radius: var(--radius-sm);"></div></td>
          <td><div style="width: 70px; height: 14px; background: var(--surface-2); border-radius: var(--radius-xs);"></div></td>
          <td><div style="width: 60px; height: 22px; background: var(--surface-2); border-radius: var(--radius-sm);"></div></td>
          <td><div style="width: 70px; height: 22px; background: var(--surface-2); border-radius: var(--radius-full);"></div></td>
          <td style="text-align: right;"><div style="width: 160px; height: 30px; background: var(--surface-2); border-radius: var(--radius-sm); margin-left: auto;"></div></td>
        </tr>
      `).join('');
      return;
    }

    if (users.length === 0) {
      const hasActiveFilters = Boolean(query || selectedRole !== 'ALL' || selectedDistrict !== 'ALL' || selectedRestriction !== 'ALL');
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = 7;
      emptyTd.style.textAlign = 'center';
      emptyTd.style.padding = 'var(--space-8)';
      emptyTd.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: var(--space-2);">
          <span style="font-size: 32px;" aria-hidden="true">🔍</span>
          <span style="font-weight: var(--weight-bold); font-size: var(--text-base); color: var(--text-primary);">${t('admin_users.no_users_found', 'No users match the specified search and filter criteria.')}</span>
          <span style="font-size: var(--text-xs); color: var(--text-muted);">${t('admin_users.no_users_hint', 'Try broadening your search query or clearing role/district filters.')}</span>
          ${hasActiveFilters ? `
            <div style="margin-top: var(--space-3);">
              <button type="button" class="btn btn--secondary btn--sm" id="admin-users-empty-clear-btn">
                ✕ ${t('admin_users.clear_filters', 'Clear Filters')}
              </button>
            </div>
          ` : ''}
        </div>
      `;
      emptyTr.append(emptyTd);
      tbody.append(emptyTr);

      emptyTd.querySelector('#admin-users-empty-clear-btn')?.addEventListener('click', clearAllFilters);

      const footerCount = container.querySelector('#admin-users-footer-count');
      if (footerCount) footerCount.textContent = t('admin_users.showing_count', 'Showing 0 of 0 accounts', { count: 0, total: allUsers.length || 0 });
      return;
    }

    for (const u of users) {
      const tr = document.createElement('tr');

      // 1. Checkbox
      const tdCheck = document.createElement('td');
      tdCheck.className = 'admin-users-checkbox-cell';
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

      // 2. User Info & Contact
      const tdUser = document.createElement('td');
      const initials = getInitials(u.full_name, u.phone);
      const roleKey = u.role_key || 'customer';
      const displayName = u.full_name || u.phone || `User #${u.id}`;
      const userRef = u.ref || `USR-${u.id}`;

      tdUser.innerHTML = `
        <div class="admin-users-user-cell">
          <div class="admin-users-avatar admin-users-avatar--${roleKey}" aria-hidden="true">${initials}</div>
          <div class="admin-users-user-info">
            <a href="/admin/users/${u.id}" class="admin-users-name user-link" tabindex="0">${escapeHtml(displayName)}</a>
            <div class="admin-users-subline">
              <span class="admin-users-ref-pill">${escapeHtml(userRef)}</span>
              <span>·</span>
              <span>${escapeHtml(u.phone)}</span>
              ${u.email ? `<span>·</span><span>${escapeHtml(u.email)}</span>` : ''}
            </div>
          </div>
        </div>
      `;

      const goToDetail = (e) => {
        e?.preventDefault();
        if (typeof navigate === 'function') navigate(`/admin/users/${u.id}`);
        else {
          history.pushState({}, '', `/admin/users/${u.id}`);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      };

      const link = tdUser.querySelector('.user-link');
      link?.addEventListener('click', goToDetail);
      link?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToDetail();
        }
      });

      // 3. Role & Tier
      const tdRole = document.createElement('td');
      const roleLabel = isLangBn ? (u.role_label_bn || u.role_label_en || u.role_key) : (u.role_label_en || u.role_key);
      const roleVariant = getRoleBadgeVariant(u.role_key);
      const roleBadge = Badge({ label: roleLabel, variant: roleVariant });
      tdRole.append(roleBadge);

      // 4. District
      const tdDistrict = document.createElement('td');
      tdDistrict.textContent = u.district || 'Dhaka';
      tdDistrict.style.fontWeight = 'var(--weight-medium)';

      // 5. Status
      const tdStatus = document.createElement('td');
      const statusBadge = Badge({ label: u.status || 'ACTIVE', variant: u.status === 'ACTIVE' ? 'success' : 'warning' });
      tdStatus.append(statusBadge);

      // 6. Restrictions
      const tdRestrictions = document.createElement('td');
      if (u.active_restrictions_count > 0) {
        const rBadge = Badge({
          label: t('admin_users.restricted_count', `⚠️ ${u.active_restrictions_count} Restricted`, { count: u.active_restrictions_count }),
          variant: 'warning',
        });
        tdRestrictions.append(rBadge);
      } else {
        tdRestrictions.innerHTML = `<span class="admin-users-clean-pill">${t('admin_users.status_clean', '✓ Clean')}</span>`;
      }

      // 7. Actions
      const tdActions = document.createElement('td');
      tdActions.style.textAlign = 'right';
      const actionWrap = document.createElement('div');
      actionWrap.className = 'admin-users-actions-wrap';

      const viewBtn = Button({
        label: t('admin_users.view_profile', 'View Details'),
        variant: 'secondary',
        size: 'sm',
        onClick: goToDetail,
      });

      const grantBtn = Button({
        label: `🔑 ${t('admin_users.issue_grant', 'Grant')}`,
        variant: 'secondary',
        size: 'sm',
        title: t('admin_users.grant_title', 'Issue Standing Grant'),
        onClick: () => {
          openGrantDrawer({
            user: u,
            permissions: permissionsList,
            onSuccess: loadUsers,
          });
        },
      });

      const restrictBtn = Button({
        label: `🛡️ ${t('admin_users.apply_restriction', 'Restrict')}`,
        variant: 'secondary',
        size: 'sm',
        title: t('admin_users.restrict_title', 'Apply Capability Restriction'),
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

    const footerCount = container.querySelector('#admin-users-footer-count');
    if (footerCount) {
      const total = allUsers.length || users.length;
      footerCount.textContent = t('admin_users.showing_count', `Showing ${users.length} of ${total} accounts`, { count: users.length, total });
    }
  }

  // Initial render & fetch
  render();
  loadUsers();
  loadPermissions();

  root.append(container);
}

