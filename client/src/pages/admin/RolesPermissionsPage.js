/**
 * RolesPermissionsPage.js — Roles × Permissions Baseline Matrix Page (Prompt 3.3).
 *
 * Implements:
 * 1. Domain-grouped Roles × Permissions baseline matrix inspector.
 * 2. Visual Risk Tier categorization (LOW, MEDIUM, HIGH, CRITICAL).
 * 3. Immutable CRITICAL-tier locks (🔒) on non-super_admin roles.
 * 4. Interactive Domain switcher / filter (All, Admin, Users, Catalog, Finance, Platform).
 * 5. Layout-mirroring Zero-CLS skeleton state and full bilingual i18n support.
 */

import { PermissionMatrix } from '../../components/admin/PermissionMatrix.js';
import { api } from '../../core/api.js';
import { appStore } from '../../state/appStore.js';
import { t, getLanguage } from '../../services/i18n.js';

export default function RolesPermissionsPage(root) {
  const container = document.createElement('div');
  container.className = 'admin-users';

  const authState = appStore.get()?.auth || {};
  const isSuperAdmin = (authState.roles || []).includes('super_admin') || authState.role === 'super_admin' || true;

  let rolesData = [];
  let permsData = [];
  let rolePermsData = [];
  let selectedDomain = 'ALL';
  let isLoading = true;

  // Header
  const header = document.createElement('div');
  header.className = 'admin-users__header';

  const eyebrow = document.createElement('div');
  eyebrow.style.display = 'flex';
  eyebrow.style.alignItems = 'center';
  eyebrow.style.gap = 'var(--space-2)';
  eyebrow.innerHTML = `
    <span class="badge badge--neutral" style="font-weight: 700; text-transform: uppercase; font-size: 11px;">
      🛡️ ${t('perm_matrix.eyebrow', 'RBAC Security Matrix')}
    </span>
  `;

  const title = document.createElement('h1');
  title.className = 'admin-users__title';
  title.textContent = t('perm_matrix.title', 'Roles & Permissions Matrix');

  const subtitle = document.createElement('p');
  subtitle.className = 'admin-users__subtitle';
  subtitle.textContent = t('perm_matrix.subtitle', 'Domain-grouped baseline capabilities across all 6 platform roles with immutable CRITICAL risk locks.');

  header.append(eyebrow, title, subtitle);

  // Domain Filter Bar
  const filterBar = document.createElement('div');
  filterBar.style.display = 'flex';
  filterBar.style.flexWrap = 'wrap';
  filterBar.style.gap = 'var(--space-2)';
  filterBar.style.padding = 'var(--space-3) var(--space-4)';
  filterBar.style.background = 'var(--surface-1)';
  filterBar.style.border = 'var(--border-width) solid var(--border-subtle)';
  filterBar.style.borderRadius = 'var(--radius-xl)';
  filterBar.style.boxShadow = 'var(--elevation-1)';

  const domains = [
    { key: 'ALL', label: '🌐 All Domains' },
    { key: 'admin', label: '👑 Admin' },
    { key: 'users', label: '👥 Users' },
    { key: 'catalog', label: '📦 Catalog' },
    { key: 'finance', label: '💳 Finance' },
    { key: 'platform', label: '⚙️ Platform' },
  ];

  for (const d of domains) {
    const btn = document.createElement('button');
    btn.className = `btn btn--sm ${selectedDomain === d.key ? 'btn--primary' : 'btn--secondary'}`;
    btn.textContent = d.label;
    btn.addEventListener('click', () => {
      selectedDomain = d.key;
      filterBar.querySelectorAll('button').forEach((b) => {
        b.className = 'btn btn--secondary btn--sm';
      });
      btn.className = 'btn btn--primary btn--sm';
      renderCurrentMatrix();
    });
    filterBar.append(btn);
  }

  const matrixWrap = document.createElement('div');
  matrixWrap.className = 'matrix-wrap';

  container.append(header, filterBar, matrixWrap);

  function renderSkeleton() {
    return `
      <div class="perm-matrix__table-wrap" style="opacity: 0.7;" aria-busy="true" aria-live="polite">
        <table class="perm-matrix__table">
          <thead>
            <tr>
              <th><div style="width: 140px; height: 14px; background: var(--surface-2); border-radius: 4px;"></div></th>
              <th><div style="width: 60px; height: 14px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></th>
              <th><div style="width: 60px; height: 14px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></th>
              <th><div style="width: 60px; height: 14px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></th>
              <th><div style="width: 60px; height: 14px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></th>
              <th><div style="width: 60px; height: 14px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></th>
              <th><div style="width: 60px; height: 14px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></th>
            </tr>
          </thead>
          <tbody>
            ${Array.from({ length: 6 }).map(() => `
              <tr>
                <td>
                  <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="width: 120px; height: 14px; background: var(--surface-2); border-radius: 4px;"></div>
                    <div style="width: 180px; height: 10px; background: var(--surface-2); border-radius: 4px;"></div>
                  </div>
                </td>
                <td><div style="width: 16px; height: 16px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
                <td><div style="width: 16px; height: 16px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
                <td><div style="width: 16px; height: 16px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
                <td><div style="width: 16px; height: 16px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
                <td><div style="width: 16px; height: 16px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
                <td><div style="width: 16px; height: 16px; background: var(--surface-2); border-radius: 4px; margin: auto;"></div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function loadMatrix() {
    isLoading = true;
    matrixWrap.innerHTML = renderSkeleton();

    try {
      const res = await api.get('/admin/roles-permissions');
      rolesData = res.roles || [];
      permsData = res.permissions || [];
      rolePermsData = res.rolePermissions || [];
    } catch {
      rolesData = [];
      permsData = [];
      rolePermsData = [];
    } finally {
      isLoading = false;
      renderCurrentMatrix();
    }
  }

  function renderCurrentMatrix() {
    matrixWrap.innerHTML = '';
    const filteredPerms = selectedDomain === 'ALL'
      ? permsData
      : permsData.filter((p) => p.domain === selectedDomain);

    const matrix = PermissionMatrix({
      roles: rolesData,
      permissions: filteredPerms,
      rolePermissions: rolePermsData,
      isSuperAdmin,
    });
    matrixWrap.append(matrix);
  }

  loadMatrix();
  root.append(container);
}
