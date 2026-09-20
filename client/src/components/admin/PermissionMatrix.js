/**
 * PermissionMatrix.js — Domain-grouped roles × permissions grid with risk-tier coding and
 * CRITICAL locks (Prompt 3.3).
 *
 * Read-only by design. The baseline a role holds is seeded from docs/permission-catalog.json and
 * changed by re-seeding (or, per person and for a limited time, by a Standing Access Grant). It used
 * to render live checkboxes that changed nothing — no handler, no endpoint — so an operator could
 * tick a box, see it stay ticked, and believe they had granted something.
 *
 * Every cell carries text for assistive tech: a tick or a dash alone says nothing to a screen
 * reader, and colour is never the only carrier of meaning (WCAG 1.4.1).
 */

import { Badge } from '../ui/Badge.js';
import { t, getLanguage } from '../../services/i18n.js';
import { cellState, groupByDomain } from '../../services/permissionMatrix.js';

const RISK_VARIANT = { CRITICAL: 'danger', HIGH: 'warning', MEDIUM: 'info', LOW: 'success' };

const MARKS = {
  granted: {
    className: 'perm-matrix__mark perm-matrix__mark--granted',
    svg: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    text: () => t('perm_matrix.granted', 'Granted'),
  },
  locked: {
    className: 'perm-matrix__mark perm-matrix__mark--locked',
    svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    text: () => t('perm_matrix.locked_super_admin', 'Super Admin Only (Locked)'),
  },
  none: {
    className: 'perm-matrix__mark perm-matrix__mark--none',
    svg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 12h10"/></svg>',
    text: () => t('perm_matrix.not_granted', 'Not granted'),
  },
};

function pick(isBn, en, bn) {
  return isBn ? bn || en : en || bn;
}

export function PermissionMatrix({ roles = [], permissions = [], held = new Map(), roleTotals = new Map(), domainIcons = {} }) {
  const isBn = getLanguage() === 'bn';

  const wrap = document.createElement('div');
  wrap.className = 'perm-matrix__table-wrap';
  // A scrollable region needs a name and a tab stop, or keyboard users cannot pan a wide grid.
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', t('perm_matrix.table_aria', 'Roles and permissions matrix'));

  const table = document.createElement('table');
  table.className = 'perm-matrix__table';

  // Header ------------------------------------------------------------------------------------
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  const thPerm = document.createElement('th');
  thPerm.scope = 'col';
  thPerm.className = 'perm-matrix__perm-col';
  thPerm.textContent = t('perm_matrix.th_permission', 'Permission & Risk Tier');
  headRow.append(thPerm);

  for (const role of roles) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.className = 'perm-matrix__role-col';
    const name = document.createElement('span');
    name.className = 'perm-matrix__role-name';
    name.textContent = pick(isBn, role.label_en, role.label_bn);
    const count = document.createElement('span');
    count.className = 'perm-matrix__role-count';
    count.textContent = t('perm_matrix.role_count', { count: roleTotals.get(role.id) ?? 0 });
    th.append(name, count);
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  // Body --------------------------------------------------------------------------------------
  const tbody = document.createElement('tbody');

  for (const [domain, domainPerms] of groupByDomain(permissions)) {
    const domainRow = document.createElement('tr');
    domainRow.className = 'perm-matrix__domain-tr';
    const domainCell = document.createElement('th');
    domainCell.scope = 'colgroup';
    domainCell.colSpan = roles.length + 1;
    domainCell.className = 'perm-matrix__domain-row';

    const domainInner = document.createElement('div');
    domainInner.className = 'perm-matrix__domain-inner';
    const iconWrap = document.createElement('span');
    iconWrap.className = 'perm-matrix__domain-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.innerHTML = domainIcons[domain] ?? '';
    const domainLabel = document.createElement('span');
    domainLabel.textContent = t(`perm_matrix.domain_${domain}`, domain);
    const domainCount = document.createElement('span');
    domainCount.className = 'perm-matrix__domain-count';
    domainCount.textContent = String(domainPerms.length);
    domainInner.append(iconWrap, domainLabel, domainCount);
    domainCell.append(domainInner);
    domainRow.append(domainCell);
    tbody.append(domainRow);

    for (const perm of domainPerms) {
      const tr = document.createElement('tr');

      const th = document.createElement('th');
      th.scope = 'row';
      th.className = 'perm-matrix__perm-cell';

      const top = document.createElement('div');
      top.className = 'perm-matrix__perm-top';
      const title = document.createElement('span');
      title.className = 'perm-matrix__perm-title';
      title.textContent = pick(isBn, perm.label_en, perm.label_bn);
      top.append(title, Badge({ label: perm.risk_tier, variant: RISK_VARIANT[perm.risk_tier] ?? 'neutral' }));

      const key = document.createElement('code');
      key.className = 'perm-matrix__perm-key';
      key.textContent = perm.key;

      th.append(top, key);

      const plain = pick(isBn, perm.plain_en, perm.plain_bn);
      if (plain) {
        const desc = document.createElement('span');
        desc.className = 'perm-matrix__perm-desc';
        desc.textContent = plain;
        th.append(desc);
      }
      tr.append(th);

      for (const role of roles) {
        const td = document.createElement('td');
        td.className = 'perm-matrix__cell';
        const mark = MARKS[cellState(role, perm, held)];
        const span = document.createElement('span');
        span.className = mark.className;
        span.innerHTML = mark.svg;
        const sr = document.createElement('span');
        sr.className = 'sr-only';
        sr.textContent = mark.text();
        span.append(sr);
        // Sighted users get the same words on hover that screen-reader users get inline.
        span.title = mark.text();
        td.append(span);
        tr.append(td);
      }
      tbody.append(tr);
    }
  }

  table.append(tbody);
  wrap.append(table);
  return wrap;
}
