/**
 * TopBar — search (opens CommandPalette), language toggle, theme toggle, notification bell, cart,
 * avatar menu, and — while a JIT grant is active — the persistent elevated-access chip (ia-sitemap
 * §5.4: "not dismissible", live countdown, one-click release).
 *
 * A pure render function like Sidebar. The one exception is the countdown itself: AppShell owns a
 * single long-lived interval that pokes `.elevated-chip__remaining`'s textContent directly, rather
 * than every TopBar rebuild starting its own timer (which would need a cleanup contract this
 * render-and-replace pattern doesn't otherwise have — see AppShell.js).
 */
import { t, getLanguage, setLanguage } from '../../services/i18n.js';
import { formatNumber } from '../../services/format.js';
import { logOutMock, releaseElevatedAccess } from '../../state/appStore.js';
import { logout } from '../../services/session.js';
import { getTheme, applyTheme } from '../../services/theme.js';
import { Badge } from '../ui/Badge.js';
import { ElevatedAccessChip } from '../access/ElevatedAccessChip.js';

export function formatRemaining(ms, lang = 'en') {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hUnit = lang === 'bn' ? 'ঘ' : 'h';
  const mUnit = lang === 'bn' ? 'মি' : 'm';
  const parts = [];
  if (h > 0) parts.push(`${formatNumber(h, { lang })}${hUnit}`);
  parts.push(`${formatNumber(m, { lang })}${mUnit}`);
  return parts.join(' ');
}

function ElevatedChip({ grant }) {
  return ElevatedAccessChip({ elevatedGrant: grant });
}

const CART_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="8" cy="21" r="1.5"></circle>' +
  '<circle cx="19" cy="21" r="1.5"></circle>' +
  '<path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>' +
  '</svg>';

const BELL_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>' +
  '<path d="M13.73 21a2 2 0 0 1-3.46 0"></path>' +
  '</svg>';

function IconButton({ icon, label, badgeCount, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'topbar__icon-btn';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  const span = document.createElement('span');
  span.className = 'topbar__icon-symbol';
  span.setAttribute('aria-hidden', 'true');
  if (typeof icon === 'string' && icon.trim().startsWith('<svg')) {
    span.innerHTML = icon;
  } else {
    span.textContent = icon;
  }
  btn.append(span);
  if (badgeCount !== undefined && badgeCount !== null && badgeCount > 0) {
    btn.append(Badge({ variant: 'count', size: 'sm', count: badgeCount }));
  }
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

function AvatarMenu({ role, onNavigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'topbar__avatar-menu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'topbar__avatar-trigger';
  trigger.textContent = (role ?? '?').slice(0, 1).toUpperCase();
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('div');
  panel.className = 'topbar__avatar-panel';
  panel.hidden = true;

  const settingsLink = document.createElement('a');
  settingsLink.href = '/account/settings';
  settingsLink.textContent = t('nav.shared.settings');
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    close();
    onNavigate('/account/settings');
  });

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.textContent = t('shell.log_out');
  logoutBtn.addEventListener('click', async () => {
    close();
    await logout();
    logOutMock();
    onNavigate('/login');
  });

  panel.append(settingsLink, logoutBtn);

  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onOutsideClick, { capture: true });
    document.addEventListener('keydown', onKeydown);
  }
  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick, { capture: true });
    document.removeEventListener('keydown', onKeydown);
  }
  function onOutsideClick(event) {
    if (!wrap.contains(event.target)) close();
  }
  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  trigger.addEventListener('click', () => (panel.hidden ? open() : close()));

  wrap.append(trigger, panel);
  return wrap;
}

export function TopBar({ role, elevatedGrant, badges, navigate, onOpenPalette }) {
  const bar = document.createElement('header');
  bar.className = 'topbar';

  const isGuest = !role;

  // Brand logo (shown for guests or when no sidebar)
  if (isGuest) {
    const brand = document.createElement('a');
    brand.className = 'topbar__brand';
    brand.href = '/';
    brand.innerHTML = `<span>⚡</span> <span class="topbar__brand-text">EXPLOORO</span>`;
    brand.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('/');
    });
    bar.append(brand);
  }

  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.className = 'topbar__search';
  searchBtn.setAttribute('aria-label', t('palette.trigger_label'));
  const searchIcon = document.createElement('span');
  searchIcon.setAttribute('aria-hidden', 'true');
  searchIcon.textContent = '🔍';
  const searchLabel = document.createElement('span');
  searchLabel.className = 'topbar__search-label';
  searchLabel.textContent = t('palette.trigger_label');
  searchBtn.append(searchIcon, searchLabel);
  searchBtn.addEventListener('click', () => onOpenPalette());
  bar.append(searchBtn);

  const spacer = document.createElement('div');
  spacer.className = 'topbar__spacer';
  bar.append(spacer);

  if (elevatedGrant) bar.append(ElevatedChip({ grant: elevatedGrant }));

  const langBtn = document.createElement('button');
  langBtn.type = 'button';
  langBtn.className = 'topbar__icon-btn topbar__lang-btn';
  langBtn.textContent = getLanguage() === 'bn' ? t('language.switch_to_en') : t('language.switch_to_bn');
  langBtn.addEventListener('click', () => setLanguage(getLanguage() === 'bn' ? 'en' : 'bn'));
  bar.append(langBtn);

  const currentTheme = getTheme();
  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'topbar__icon-btn';
  themeBtn.textContent = { light: '☀️', dark: '🌙', system: '🖥️' }[currentTheme];
  themeBtn.title = `Theme: ${currentTheme}`;
  themeBtn.addEventListener('click', () => {
    const next = { system: 'light', light: 'dark', dark: 'system' }[currentTheme];
    applyTheme(next);
    themeBtn.textContent = { light: '☀️', dark: '🌙', system: '🖥️' }[next];
    themeBtn.title = `Theme: ${next}`;
  });
  bar.append(themeBtn);

  if (badges && badges.cart !== undefined) {
    bar.append(
      IconButton({ icon: CART_ICON_SVG, label: t('shell.cart'), badgeCount: badges.cart, onClick: () => navigate('/cart') })
    );
  } else {
    bar.append(
      IconButton({ icon: CART_ICON_SVG, label: t('shell.cart'), onClick: () => navigate('/cart') })
    );
  }

  if (isGuest) {
    const authBtns = document.createElement('div');
    authBtns.className = 'topbar__auth-buttons';

    const loginBtn = document.createElement('button');
    loginBtn.type = 'button';
    loginBtn.className = 'btn btn--ghost btn--sm';
    loginBtn.textContent = t('auth.login.title') || 'Sign In';
    loginBtn.addEventListener('click', () => navigate('/login'));

    const regBtn = document.createElement('button');
    regBtn.type = 'button';
    regBtn.className = 'btn btn--primary btn--sm';
    regBtn.textContent = t('auth.register.title') || 'Register';
    regBtn.addEventListener('click', () => navigate('/auth/register'));

    authBtns.append(loginBtn, regBtn);
    bar.append(authBtns);
  } else {
    bar.append(IconButton({ icon: BELL_ICON_SVG, label: t('shell.notifications'), onClick: () => {} }));
    bar.append(AvatarMenu({ role, onNavigate: navigate }));
  }

  return bar;
}
