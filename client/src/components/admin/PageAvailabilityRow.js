/**
 * PageAvailabilityRow.js — one page's row on /admin/platform/pages.
 *
 * Four radio-style state buttons rather than a Switch, because the states are not a binary: a
 * toggle would have to hide COMING_SOON and LIMITED behind a second control, and those two are
 * the states the feature was actually asked for ("built but kept deactivated", "later activate it
 * for the related user").
 *
 * A locked page (services/pageAccess.js LOCKED_PATHS) renders its buttons disabled with the reason
 * stated inline, rather than being left out of the list — a page silently missing from a governance
 * screen is how someone concludes the screen is broken.
 */

import { Badge } from '../ui/Badge.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatRelativeTime } from '../../services/format.js';
import { isLockedPath } from '../../services/pageAccess.js';
import { pageLabel } from '../../config/pageRegistry.js';

/** Visual tone per state — colour is never the only carrier, each button also has its word. */
const STATE_TONE = {
  LIVE: 'success',
  COMING_SOON: 'warning',
  HIDDEN: 'neutral',
  LIMITED: 'info',
};

const STATE_ORDER = ['LIVE', 'COMING_SOON', 'HIDDEN', 'LIMITED'];

export function PageAvailabilityRow({ page, toggle, canToggle = false, onPick }) {
  const isBn = getLanguage() === 'bn';
  const state = toggle?.state ?? 'LIVE';
  const locked = isLockedPath(page.path);

  const row = document.createElement('div');
  row.className = 'page-avail-row';
  row.dataset.routePath = page.path;
  row.dataset.state = state;

  // ── Left: what this page is ───────────────────────────────────────────────
  const main = document.createElement('div');
  main.className = 'page-avail-row__main';

  const header = document.createElement('div');
  header.className = 'page-avail-row__header';

  const labelEl = document.createElement('span');
  labelEl.className = 'page-avail-row__label';
  labelEl.textContent = pageLabel(page);
  header.append(labelEl);

  if (!page.in_nav) {
    // Worth saying: these pages are reachable only by URL or by a link inside another page, so
    // "it is not in the sidebar" is not evidence that parking it worked.
    header.append(Badge({ variant: 'neutral', label: t('page_availability.no_nav_item', 'No nav item'), size: 'sm' }));
  }

  if (locked) {
    header.append(Badge({ variant: 'info', label: t('page_availability.locked', 'Always on'), size: 'sm' }));
  }

  const pathEl = document.createElement('code');
  pathEl.className = 'page-avail-row__path';
  pathEl.textContent = page.path;

  const metaEl = document.createElement('div');
  metaEl.className = 'page-avail-row__meta';
  if (locked) {
    metaEl.textContent = t(
      'page_availability.locked_hint',
      'Switching this off would lock you out, so it stays on.'
    );
  } else if (toggle?.reason) {
    const when = toggle.updated_at
      ? formatRelativeTime(new Date(toggle.updated_at).getTime(), { lang: isBn ? 'bn' : 'en' })
      : '';
    metaEl.textContent = `${t('page_availability.last_reason', 'Last reason')}: "${toggle.reason}"${when ? ` · ${when}` : ''}`;
  } else {
    // The gate the page already had before this layer existed — useful context, because a page
    // whose module is off is invisible regardless of what is picked here.
    const gates = [];
    if (page.module && page.module !== 'core') gates.push(`${t('page_availability.gate_module', 'Module')}: ${page.module}`);
    if (page.permission) gates.push(`${t('page_availability.gate_permission', 'Permission')}: ${page.permission}`);
    metaEl.textContent = gates.length ? gates.join(' · ') : t('page_availability.no_other_gates', 'No module or permission gate');
  }

  main.append(header, pathEl, metaEl);

  if (state === 'LIMITED') {
    const audience = document.createElement('div');
    audience.className = 'page-avail-row__audience';
    const roles = toggle?.allowed_roles ?? [];
    const users = toggle?.allowed_user_ids ?? [];
    const parts = [];
    if (roles.length) parts.push(`${t('page_availability.audience_roles', 'Roles')}: ${roles.join(', ')}`);
    if (users.length) parts.push(`${t('page_availability.audience_users', 'Users')}: ${users.join(', ')}`);
    audience.textContent = parts.join(' · ');
    main.append(audience);
  }

  // ── Right: the four states ────────────────────────────────────────────────
  const picker = document.createElement('div');
  picker.className = 'page-avail-row__states';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', `${t('page_availability.state_for', 'Availability for')} ${page.path}`);

  for (const value of STATE_ORDER) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `page-avail-state page-avail-state--${STATE_TONE[value]}`;
    btn.dataset.value = value;
    btn.textContent = t(`page_availability.state_${value.toLowerCase()}`, value);
    btn.setAttribute('aria-pressed', String(value === state));
    if (value === state) btn.classList.add('page-avail-state--active');

    const disabled = locked || !canToggle || (locked && value !== 'LIVE');
    if (disabled) {
      btn.disabled = true;
      btn.title = locked
        ? t('page_availability.locked_hint', 'Switching this off would lock you out, so it stays on.')
        : t('page_availability.read_only_hint', 'Super Admin privileges are required to change this.');
    } else {
      btn.addEventListener('click', () => {
        if (value === state) return; // already there — do not open a reason modal for a no-op
        onPick?.(page, value);
      });
    }

    picker.append(btn);
  }

  row.append(main, picker);
  return row;
}

export default PageAvailabilityRow;
