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
import { openCartDrawer } from '../../services/cart.js';
import { openNotificationCenter } from '../notifications/NotificationCenter.js';
import { openAssistantPanel } from '../ai/AssistantPanel.js';
import { ICONS, getExplooroLogoSvg } from '../ui/icons.js';

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

const AI_SPARKLE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>' +
  '</svg>';

const BELL_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>' +
  '<path d="M13.73 21a2 2 0 0 1-3.46 0"></path>' +
  '</svg>';

const THEME_ICONS_SVG = {
  light:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="4"></circle>' +
    '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>' +
    '</svg>',
  dark:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>' +
    '</svg>',
  system:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect width="20" height="14" x="2" y="3" rx="2"></rect>' +
    '<line x1="8" x2="16" y1="21" y2="21"></line>' +
    '<line x1="12" x2="12" y1="17" y2="21"></line>' +
    '</svg>',
};

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

// ia-sitemap.md role set — labels sourced from server/src/db/seeds/001_roles_permissions.sql so
// they stay in sync with the RBAC `roles` table's label_en/label_bn.
const ROLE_LABEL_KEYS = {
  super_admin: 'shell.role_names.super_admin',
  admin: 'shell.role_names.admin',
  moderator: 'shell.role_names.moderator',
  editor: 'shell.role_names.editor',
  supplier: 'shell.role_names.supplier',
  saler: 'shell.role_names.saler',
  customer: 'shell.role_names.customer',
};

function roleLabel(role) {
  const key = ROLE_LABEL_KEYS[role];
  return key ? t(key) : role;
}

function AvatarMenu({ role, onNavigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'topbar__avatar-menu';

  const label = roleLabel(role);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'topbar__avatar-trigger';
  trigger.textContent = (role ?? '?').slice(0, 1).toUpperCase();
  trigger.title = label;
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', `${t('shell.account_menu')} — ${label}`);

  const panel = document.createElement('div');
  panel.className = 'topbar__avatar-panel';
  panel.hidden = true;

  const panelHeader = document.createElement('div');
  panelHeader.className = 'topbar__avatar-panel-header';
  panelHeader.innerHTML = `<span class="topbar__avatar-panel-role">${label}</span>`;
  panel.append(panelHeader);

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

  const brand = document.createElement('a');
  brand.className = 'topbar__brand';
  brand.href = '/';
  brand.innerHTML = `${getExplooroLogoSvg({ size: 28 })} <span class="topbar__brand-text">EXPLOORO</span>`;
  brand.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });
  bar.append(brand);

  const searchForm = document.createElement('form');
  searchForm.className = 'topbar__product-search';
  searchForm.setAttribute('role', 'search');

  const searchSubmitBtn = document.createElement('button');
  searchSubmitBtn.type = 'submit';
  searchSubmitBtn.className = 'topbar__product-search-btn';
  searchSubmitBtn.setAttribute('aria-label', t('marketplace.search_btn') || 'Search');
  searchSubmitBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'topbar__product-search-input';
  searchInput.placeholder = t('marketplace.search_placeholder') || 'Search products, brands, categories…';
  searchInput.setAttribute('aria-label', t('marketplace.search_placeholder') || 'Search products');
  searchInput.autocomplete = 'off';

  // Read current query param if on page
  const currentParams = new URLSearchParams(window.location.search);
  if (currentParams.get('q')) {
    searchInput.value = currentParams.get('q');
  }

  searchForm.append(searchSubmitBtn, searchInput);

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (window.location.pathname === '/') {
      const sp = new URLSearchParams(window.location.search);
      if (query) sp.set('q', query);
      else sp.delete('q');
      const newUrl = `/${sp.toString() ? '?' + sp.toString() : ''}`;
      window.history.pushState(null, '', newUrl);
      window.dispatchEvent(new CustomEvent('explooro:search', { detail: { query } }));
    } else {
      navigate(`/${query ? '?q=' + encodeURIComponent(query) : ''}`);
    }
  });

  bar.append(searchForm);

  const spacer = document.createElement('div');
  spacer.className = 'topbar__spacer';
  bar.append(spacer);

  if (elevatedGrant) bar.append(ElevatedChip({ grant: elevatedGrant }));

  // Quick Actions / Command Palette button on right utility bar
  const paletteBtn = IconButton({
    icon: ICONS.bolt,
    label: `${t('palette.trigger_btn') || 'Quick Actions'} (Ctrl+K)`,
    onClick: () => onOpenPalette(),
  });
  paletteBtn.classList.add('topbar__palette-btn');
  bar.append(paletteBtn);

  const langBtn = document.createElement('button');
  langBtn.type = 'button';
  langBtn.className = 'topbar__icon-btn topbar__lang-btn';
  langBtn.textContent = getLanguage() === 'bn' ? t('language.switch_to_en') : t('language.switch_to_bn');
  langBtn.addEventListener('click', () => setLanguage(getLanguage() === 'bn' ? 'en' : 'bn'));
  bar.append(langBtn);

  const currentTheme = getTheme();
  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'topbar__icon-btn topbar__theme-btn';
  themeBtn.innerHTML = THEME_ICONS_SVG[currentTheme] || THEME_ICONS_SVG.system;
  themeBtn.title = `Theme: ${currentTheme}`;
  themeBtn.setAttribute('aria-label', `Theme: ${currentTheme}`);
  themeBtn.addEventListener('click', () => {
    const current = getTheme();
    const next = { system: 'light', light: 'dark', dark: 'system' }[current] || 'light';
    applyTheme(next);
    themeBtn.innerHTML = THEME_ICONS_SVG[next];
    themeBtn.title = `Theme: ${next}`;
    themeBtn.setAttribute('aria-label', `Theme: ${next}`);
  });
  bar.append(themeBtn);

  if (badges && badges.cart !== undefined) {
    bar.append(
      IconButton({ icon: CART_ICON_SVG, label: t('shell.cart'), badgeCount: badges.cart, onClick: () => openCartDrawer() })
    );
  } else {
    bar.append(
      IconButton({ icon: CART_ICON_SVG, label: t('shell.cart'), onClick: () => openCartDrawer() })
    );
  }

  if (isGuest) {
    const authBtns = document.createElement('div');
    authBtns.className = 'topbar__auth-buttons';

    const loginBtn = document.createElement('button');
    loginBtn.type = 'button';
    loginBtn.className = 'btn btn--ghost btn--sm';
    loginBtn.textContent = t('auth.login.btn') || 'Sign In';
    loginBtn.addEventListener('click', () => navigate('/login'));

    const regBtn = document.createElement('button');
    regBtn.type = 'button';
    regBtn.className = 'btn btn--primary btn--sm';
    regBtn.textContent = t('auth.register.btn') || 'Sign Up';
    regBtn.addEventListener('click', () => navigate('/auth/register'));

    authBtns.append(loginBtn, regBtn);
    bar.append(authBtns);
  } else {
    bar.append(IconButton({
      icon: AI_SPARKLE_ICON_SVG,
      label: t('ai.concierge_trigger'),
      onClick: (e) => {
        openAssistantPanel({ agentType: 'concierge', trigger: e.currentTarget });
      },
    }));
    bar.append(IconButton({
      icon: BELL_ICON_SVG,
      label: t('shell.notifications'),
      onClick: () => {
        openNotificationCenter();
      },
    }));
    bar.append(AvatarMenu({ role, onNavigate: navigate }));
  }

  return bar;
}
