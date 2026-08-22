/**
 * LockedNavItem — the visible-but-locked row from ia-sitemap.md §5.1.
 *
 * Responsibility: render a nav item the current mocked user lacks, greyed with a lock icon and
 * (when the permission is delegable) a "Request access" affordance that opens the JIT request
 * modal. A CRITICAL-tier permission is NOT delegable — same greyed row, no affordance, informs
 * rather than invites ("Only a Super Admin can use this").
 *
 * Never used for a module-disabled item: those are hidden entirely (§5.1's first row), which
 * Sidebar/MobileNav/CommandPalette all filter out before this component is ever considered.
 */
import { getPermissionMetadata } from '../../services/permissions.js';
import { getPermissionMeta } from '../../config/permissions.mock.js';
import { t, getLanguage } from '../../services/i18n.js';
import { openRequestAccessModal } from '../access/RequestAccessModal.js';
import { Modal } from '../ui/Modal.js';

function lockIcon() {
  const span = document.createElement('span');
  span.className = 'locked-nav-item__icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/>' +
    '<path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  return span;
}

function plainLanguageFor(meta) {
  return getLanguage() === 'bn' ? meta.plain_bn ?? meta.plain_en : meta.plain_en ?? meta.plain_bn;
}

/** Informational-only modal for a CRITICAL (non-delegable) permission. */
function openCriticalModal({ feature, trigger }) {
  const body = document.createElement('p');
  body.className = 'text-sm';
  body.textContent = t('access.locked.critical');

  const modal = Modal({
    title: t('access.locked.title', { feature }),
    content: body,
  });
  document.body.append(modal);
  modal.openModal(trigger);
}

export function LockedNavItem({ item }) {
  const meta = getPermissionMetadata(item.permission) || getPermissionMeta(item.permission);
  const label = t(item.label_i18n_key);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'nav-item nav-item--locked';
  row.dataset.navKey = item.key;

  if (item.icon) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'nav-item__icon';
    iconSpan.textContent = item.icon;
    iconSpan.setAttribute('aria-hidden', 'true');
    row.append(iconSpan);
  }

  const labelSpan = document.createElement('span');
  labelSpan.className = 'nav-item__label';
  labelSpan.textContent = label;
  row.append(labelSpan, lockIcon());

  const delegable = meta?.delegable ?? (meta?.risk_tier === 'MEDIUM' || meta?.risk_tier === 'HIGH');
  row.setAttribute('aria-label', `${label} — ${t(delegable ? 'access.locked.cta' : 'access.locked.critical')}`);

  row.addEventListener('click', () => {
    if (!meta) return;
    if (delegable) {
      openRequestAccessModal({ permission: item.permission, trigger: row });
    } else {
      openCriticalModal({ feature: label, trigger: row });
    }
  });

  return row;
}
