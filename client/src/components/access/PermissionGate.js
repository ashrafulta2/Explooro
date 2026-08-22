/**
 * PermissionGate.js — Wrapper component for conditional access rendering (Prompt 2.8).
 *
 * Implements Prompt 2.8 Requirement 4:
 * - Renders children, a locked placeholder, a restriction banner, or nothing based on whyDenied().
 * - Locked placeholders explain what the permission is and offer "Request Access".
 */

import { whyDenied, getPermissionMetadata, getRestriction } from '../../services/permissions.js';
import { openRequestAccessModal } from './RequestAccessModal.js';
import { t, getLanguage } from '../../services/i18n.js';
import { Button } from '../ui/Button.js';

export function PermissionGate({
  permission = null,
  module = 'core',
  fallback = null,
  renderContent,
  renderLocked = null,
  onUnlocked = null,
}) {
  const status = whyDenied(permission, module);

  if (status === 'held') {
    return renderContent();
  }

  if (status === 'module_off') {
    return fallback ? fallback() : document.createDocumentFragment();
  }

  if (renderLocked) {
    return renderLocked(status);
  }

  const meta = getPermissionMetadata(permission) || {};
  const isBn = getLanguage() === 'bn';
  const label = (isBn ? meta.label_bn : meta.label_en) || permission || 'Feature';
  const plainLanguage = isBn ? meta.plain_bn || meta.plain_en : meta.plain_en || meta.plain_bn;

  if (status === 'restricted') {
    const restriction = getRestriction(permission);
    const card = document.createElement('div');
    card.className = 'permission-gate-restricted';

    const title = document.createElement('div');
    title.className = 'permission-gate-restricted__title';
    title.textContent = t('access.gate.restricted_title');

    const body = document.createElement('div');
    body.className = 'permission-gate-restricted__body';
    const reasonText = (isBn ? restriction?.reason_bn : restriction?.reason) || 'Temporarily disabled by administration.';
    body.textContent = t('access.restricted.body', { reason: reasonText });

    card.append(title, body);
    return card;
  }

  const card = document.createElement('div');
  card.className = 'permission-gate-locked';

  const icon = document.createElement('div');
  icon.className = 'permission-gate-locked__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>' +
    '<path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  const title = document.createElement('h3');
  title.className = 'permission-gate-locked__title';
  title.textContent = label;

  const desc = document.createElement('p');
  desc.className = 'permission-gate-locked__desc';

  if (status === 'critical_locked') {
    desc.textContent = t('access.gate.critical_desc');
    card.append(icon, title, desc);
  } else {
    desc.textContent = t('access.gate.locked_desc', {
      permission: label,
      plainLanguage: plainLanguage || label,
    });

    const requestBtn = Button({
      label: t('access.gate.request_btn'),
      variant: 'primary',
      onClick: () => {
        openRequestAccessModal({
          permission,
          trigger: requestBtn,
          onSuccess: onUnlocked,
        });
      },
    });

    card.append(icon, title, desc, requestBtn);
  }

  return card;
}
