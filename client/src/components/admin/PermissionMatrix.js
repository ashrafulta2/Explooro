/**
 * PermissionMatrix.js — Domain-grouped roles × permissions grid with risk-tier coding and CRITICAL locks (Prompt 3.3).
 */

import { Badge } from '../ui/Badge.js';
import { t, getLanguage } from '../../services/i18n.js';

export function PermissionMatrix({
  roles = [],
  permissions = [],
  rolePermissions = [],
  isSuperAdmin = false,
  onToggle = null,
}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'perm-matrix';

  // Group permissions by domain
  const byDomain = new Map();
  for (const p of permissions) {
    const domain = p.domain || 'system';
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(p);
  }

  // Fast lookup set: `${roleId}:${permKey}`
  const heldSet = new Set();
  for (const rp of rolePermissions) {
    heldSet.add(`${rp.role_id}:${rp.permission_key}`);
  }

  const tableWrap = document.createElement('div');
  tableWrap.className = 'perm-matrix__table-wrap';

  const table = document.createElement('table');
  table.className = 'perm-matrix__table';

  // Table Header
  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');

  const thPerm = document.createElement('th');
  thPerm.textContent = isBn ? 'পারমিশন ও ঝুঁকি স্তর' : 'Permission & Risk Tier';
  trHead.append(thPerm);

  for (const r of roles) {
    const thRole = document.createElement('th');
    thRole.textContent = isBn ? (r.label_bn || r.label_en) : (r.label_en || r.label_bn);
    trHead.append(thRole);
  }
  thead.append(trHead);
  table.append(thead);

  // Table Body
  const tbody = document.createElement('tbody');

  for (const [domain, domainPerms] of byDomain.entries()) {
    // Domain section row
    const trDomain = document.createElement('tr');
    const tdDomain = document.createElement('td');
    tdDomain.colSpan = roles.length + 1;
    tdDomain.className = 'perm-matrix__domain-row';
    const domainKey = `perm_matrix.domain_${domain}`;
    tdDomain.textContent = `📁 ${t(domainKey) || domain.toUpperCase()}`;
    trDomain.append(tdDomain);
    tbody.append(trDomain);

    for (const perm of domainPerms) {
      const tr = document.createElement('tr');

      // First Column: Permission label, key, description & risk badge
      const tdLabel = document.createElement('td');
      tdLabel.style.textAlign = 'left';

      const labelWrap = document.createElement('div');
      labelWrap.style.display = 'flex';
      labelWrap.style.flexDirection = 'column';
      labelWrap.style.gap = '2px';

      const topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.style.alignItems = 'center';
      topRow.style.gap = '6px';

      const permTitle = document.createElement('span');
      permTitle.style.fontWeight = '600';
      permTitle.textContent = isBn ? (perm.label_bn || perm.label_en) : (perm.label_en || perm.label_bn);

      const riskVariant =
        perm.risk_tier === 'CRITICAL'
          ? 'danger'
          : perm.risk_tier === 'HIGH'
          ? 'warning'
          : perm.risk_tier === 'MEDIUM'
          ? 'info'
          : 'success';

      const riskBadge = Badge({
        label: perm.risk_tier,
        variant: riskVariant,
      });

      topRow.append(permTitle, riskBadge);

      const codeKey = document.createElement('code');
      codeKey.style.fontSize = '10px';
      codeKey.style.color = 'var(--text-muted)';
      codeKey.textContent = perm.key;

      const desc = document.createElement('span');
      desc.style.fontSize = '11px';
      desc.style.color = 'var(--text-secondary)';
      desc.textContent = isBn ? (perm.plain_bn || perm.plain_en) : (perm.plain_en || perm.plain_bn);

      labelWrap.append(topRow, codeKey, desc);
      tdLabel.append(labelWrap);
      tr.append(tdLabel);

      // Role Checkbox Columns
      for (const r of roles) {
        const tdCheck = document.createElement('td');
        const isSuperAdminRole = r.key === 'super_admin';
        const isCritical = perm.risk_tier === 'CRITICAL';
        const isHeld = isSuperAdminRole || heldSet.has(`${r.id}:${perm.key}`);

        if (isCritical && !isSuperAdminRole) {
          // CRITICAL permissions are locked for all non-super_admin roles
          tdCheck.innerHTML = `<span title="${t('perm_matrix.locked_super_admin')}" style="opacity: 0.4; cursor: not-allowed;">🔒</span>`;
        } else if (isSuperAdminRole) {
          // Super admin always has everything
          tdCheck.innerHTML = `<span style="color: var(--color-success, #10b981); font-weight: bold;">✓</span>`;
        } else {
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = isHeld;
          checkbox.disabled = !isSuperAdmin;
          checkbox.setAttribute('aria-label', `${perm.key} for ${r.name}`);
          checkbox.addEventListener('change', () => {
            if (onToggle) onToggle(r, perm, checkbox.checked);
          });
          tdCheck.append(checkbox);
        }

        tr.append(tdCheck);
      }

      tbody.append(tr);
    }
  }

  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);

  return container;
}
