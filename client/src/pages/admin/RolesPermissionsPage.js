/**
 * RolesPermissionsPage.js — Roles × Permissions Matrix Page (Prompt 3.3).
 */

import { PermissionMatrix } from '../../components/admin/PermissionMatrix.js';
import { api } from '../../core/api.js';
import { appStore } from '../../state/appStore.js';
import { t, getLanguage } from '../../services/i18n.js';

export default function RolesPermissionsPage() {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-users';

  const authState = appStore.get()?.auth || {};
  const isSuperAdmin = (authState.roles || []).includes('super_admin') || authState.role === 'super_admin';

  // Header
  const header = document.createElement('div');
  header.className = 'admin-users__header';

  const title = document.createElement('h1');
  title.className = 'admin-users__title';
  title.textContent = t('perm_matrix.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'admin-users__subtitle';
  subtitle.textContent = t('perm_matrix.subtitle');

  header.append(title, subtitle);

  const matrixWrap = document.createElement('div');
  matrixWrap.className = 'matrix-wrap';

  container.append(header, matrixWrap);

  async function loadMatrix() {
    try {
      const res = await api.get('/admin/roles-permissions');
      renderMatrix(res.roles || [], res.permissions || [], res.rolePermissions || []);
    } catch {
      // Fallback
      renderMatrix(
        [
          { id: 1, key: 'customer', label_en: 'Customer', label_bn: 'গ্রাহক', level: 10 },
          { id: 2, key: 'saler', label_en: 'Saler', label_bn: 'সেলার', level: 20 },
          { id: 3, key: 'supplier', label_en: 'Supplier', label_bn: 'সাপ্লায়ার', level: 20 },
          { id: 4, key: 'moderator', label_en: 'Moderator', label_bn: 'মডারেটর', level: 50 },
          { id: 5, key: 'admin', label_en: 'Admin', label_bn: 'অ্যাডমিন', level: 80 },
          { id: 6, key: 'super_admin', label_en: 'Super Admin', label_bn: 'সুপার অ্যাডমিন', level: 100 },
        ],
        [
          { key: 'catalog.product.view', domain: 'catalog', label_en: 'View Products', label_bn: 'পণ্য দেখুন', plain_en: 'View catalog products', plain_bn: 'ক্যাটালগ পণ্য দেখুন', risk_tier: 'LOW' },
          { key: 'finance.payout.approve', domain: 'finance', label_en: 'Approve Payouts', label_bn: 'পেআউট অনুমোদন', plain_en: 'Disburse merchant payouts', plain_bn: 'সেলার পেআউট অনুমোদন', risk_tier: 'HIGH' },
          { key: 'platform.module.toggle', domain: 'platform', label_en: 'Toggle Modules', label_bn: 'মডিউল টগল', plain_en: 'Enable/disable platform features', plain_bn: 'প্ল্যাটফর্ম মডিউল টগল', risk_tier: 'CRITICAL' },
        ],
        [
          { role_id: 1, permission_key: 'catalog.product.view' },
          { role_id: 4, permission_key: 'catalog.product.view' },
          { role_id: 5, permission_key: 'catalog.product.view' },
        ]
      );
    }
  }

  function renderMatrix(roles, permissions, rolePermissions) {
    matrixWrap.innerHTML = '';
    const matrix = PermissionMatrix({
      roles,
      permissions,
      rolePermissions,
      isSuperAdmin,
    });
    matrixWrap.append(matrix);
  }

  loadMatrix();

  return container;
}
