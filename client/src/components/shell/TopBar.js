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
import {
  t,
  getLanguage,
  setLanguage,
  getEnabledLanguages,
  isLanguageSwitchAllowed,
} from '../../services/i18n.js';
import { formatNumber } from '../../services/format.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { logOutMock, releaseElevatedAccess } from '../../state/appStore.js';
import { logout } from '../../services/session.js';
import { getTheme, applyTheme } from '../../services/theme.ts';
import { Badge } from '../ui/Badge.ts';
import { api } from '../../core/api.ts';
import { ElevatedAccessChip } from '../access/ElevatedAccessChip.ts';
import { openCart } from '../../services/cart.ts';
import { openNotificationCenter } from '../notifications/NotificationCenter.ts';
import { openAssistantPanel } from '../ai/AssistantPanel.ts';
import { ICONS, getExplooroLogoSvg, formatExplooroBrandText } from '../ui/icons.ts';
import { attachSearchSuggest } from '../search/SearchSuggest.ts';

// Grace period before an emptied search box resets the results page. Long enough that
// select-all-and-retype (or a fast backspace-then-type) doesn't bounce through the home page
// mid-keystroke, short enough that a deliberate clear feels immediate.
const SEARCH_CLEAR_RESET_MS = 250;

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

const DISCOVER_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="10"></circle>' +
  '<polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>' +
  '</svg>';

// Storefront — the "back to the marketplace grid" face of the discover/market context toggle.
const MARKET_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 9.5 4.5 4h15L21 9.5"></path>' +
  '<path d="M4.5 9.5V19a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V9.5"></path>' +
  '<path d="M9 20v-5h6v5"></path>' +
  '<path d="M3 9.5h18"></path>' +
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

const COMMUNITY_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>' +
  '<circle cx="9" cy="7" r="4"></circle>' +
  '<path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>' +
  '<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>' +
  '</svg>';

// Staff land on the moderation-capable route; everyone else on the public timeline.
const COMMUNITY_STAFF_ROLES = ['super_admin', 'admin', 'moderator'];

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

// WHY: GET /notifications/unread-count had no caller, so the bell showed no badge until the drawer
// was opened. The count is fetched once per TopBar render and then kept live by the same
// `explooro:notification` event the drawer listens to.
function setBellBadge(btn, count) {
  btn.querySelector('.badge')?.remove();
  if (count > 0) btn.append(Badge({ variant: 'count', size: 'sm', count }));
  btn.dataset.unread = String(Math.max(0, count));
}

async function initBellBadge(btn) {
  try {
    const res = await api.get('/notifications/unread-count');
    setBellBadge(btn, Number(res?.data?.unread_count) || 0);
  } catch {
    /* no badge is the safe fallback */
  }
  const onLive = () => {
    if (!btn.isConnected) {
      window.removeEventListener('explooro:notification', onLive);
      return;
    }
    setBellBadge(btn, (Number(btn.dataset.unread) || 0) + 1);
  };
  window.addEventListener('explooro:notification', onLive);
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

/** Up to two initials from a name, in whatever script it is written in. */
function initialsFor(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function AvatarMenu({ role, user, onNavigate }) {
  const wrap = document.createElement('div');
  wrap.className = 'topbar__avatar-menu';

  const label = roleLabel(role);
  // The person's own name when there is a real session behind the shell; the role otherwise
  // (Prompt 1.7's mock switcher signs in a role, not a user).
  const displayName = user?.display_name || user?.name || user?.full_name || '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'topbar__avatar-trigger';
  const initials = document.createElement('span');
  initials.className = 'topbar__avatar-initials';
  initials.textContent = initialsFor(displayName) || (role ?? '?').slice(0, 1).toUpperCase();
  // The chevron is what tells a first-time user this picture opens a menu.
  const chevron = document.createElement('span');
  chevron.className = 'topbar__avatar-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>';
  trigger.append(initials, chevron);
  trigger.title = displayName ? `${displayName} — ${label}` : label;
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', `${t('shell.account_menu')} — ${displayName || label}`);

  const panel = document.createElement('div');
  panel.className = 'topbar__avatar-panel';
  panel.style.minWidth = '248px';
  panel.hidden = true;

  const panelHeader = document.createElement('div');
  panelHeader.className = 'topbar__avatar-panel-header';
  if (displayName) {
    const nameEl = document.createElement('span');
    nameEl.className = 'topbar__avatar-panel-name';
    // textContent, not innerHTML: this is user-supplied and lands in the shell on every page.
    nameEl.textContent = displayName;
    panelHeader.append(nameEl);
  }
  const roleEl = document.createElement('span');
  roleEl.className = 'topbar__avatar-panel-role';
  roleEl.textContent = label;
  panelHeader.append(roleEl);
  panel.append(panelHeader);

  const DASHBOARDS = {
    super_admin: '/admin',
    admin: '/admin',
    moderator: '/moderator',
    editor: '/editor',
    supplier: '/supplier',
    saler: '/saler',
    customer: '/account',
  };

  // First item, above the dashboard: a user looking for "where do I change my name" reaches for
  // their own picture, so My Profile has to be the first thing under it — for every role, not just
  // customers, since staff accounts carry a profile too.
  const profileLink = document.createElement('a');
  profileLink.href = '/account/profile';
  profileLink.textContent = t('shell.my_profile', 'My Profile');
  profileLink.addEventListener('click', (e) => {
    e.preventDefault();
    close();
    onNavigate('/account/profile');
  });
  panel.append(profileLink);

  const dashPath = DASHBOARDS[role];
  if (dashPath) {
    const dashLink = document.createElement('a');
    dashLink.href = dashPath;
    dashLink.textContent = (role === 'customer') ? (t('nav.group.customer.me') || 'My Account') : (t('nav.shared.dashboard') || 'Dashboard');
    dashLink.addEventListener('click', (e) => {
      e.preventDefault();
      close();
      onNavigate(dashPath);
    });
    panel.append(dashLink);
  }

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

  panel.append(settingsLink);

  // Preferences live here, not in the topbar: people set them once and rarely touch them again.
  // A pick is stored (i18n.js / theme.ts write it to this browser) and becomes the default the next
  // visit opens with — the hint below says so, because nothing else on screen would.
  const prefs = document.createElement('div');
  prefs.className = 'topbar__prefs';

  if (isLanguageSwitchAllowed()) {
    const langSection = document.createElement('div');
    langSection.className = 'topbar__prefs-section';
    const langTitle = document.createElement('span');
    langTitle.className = 'topbar__prefs-title';
    langTitle.textContent = t('shell.pref_language', 'Language');
    const langRow = document.createElement('div');
    langRow.className = 'topbar__prefs-row';
    const names = { en: t('language.name_en', 'English'), bn: t('language.name_bn', 'বাংলা') };
    for (const code of getEnabledLanguages()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn btn--sm ${code === getLanguage() ? 'btn--primary' : 'btn--ghost'}`;
      btn.textContent = names[code] || code;
      btn.setAttribute('aria-pressed', String(code === getLanguage()));
      btn.addEventListener('click', () => {
        if (code === getLanguage()) return;
        // AppShell rebuilds the TopBar when the language changes, which closes this menu.
        setLanguage(code);
      });
      langRow.append(btn);
    }
    langSection.append(langTitle, langRow);
    prefs.append(langSection);
  }

  const themeHost = document.createElement('div');
  themeHost.className = 'topbar__prefs-section topbar__prefs-theme';
  renderThemeControls(themeHost);
  prefs.append(themeHost);

  const hint = document.createElement('p');
  hint.className = 'topbar__prefs-hint';
  hint.textContent = t('shell.pref_saved_hint', 'Your choices are saved as your default on this device.');
  prefs.append(hint);

  panel.append(prefs, logoutBtn);

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

// WHY one renderer for two homes: signed-in people reach theme + language from the avatar menu
// (they change rarely, so they do not earn a permanent topbar slot), while guests have no avatar
// menu and keep the standalone theme button. Both draw the same controls so they cannot drift.
// WHY no colour presets here: the long preset list pushed Sign out below the fold of the avatar
// menu, and a platform colour is changed rarely. Super admins switch it from Theme Studio
// (sidebar) or the command palette instead.
function renderThemeControls(panel, { onModeApplied } = {}) {
  const menuTitle = t('shell.theme_menu_title_plain') || 'Theme';
  const updateTriggerIcon = () => onModeApplied?.();
  const renderPanel = () => renderThemeControls(panel, { onModeApplied });

  {
    panel.innerHTML = '';
    const mode = getTheme();

    // Header
    const header = document.createElement('div');
    header.className = 'topbar__theme-panel-header';
    header.style.padding = '2px 4px 6px 4px';
    header.style.borderBottom = '1px solid var(--border-subtle)';
    header.innerHTML = `
      <span style="font-weight: 700; font-size: 11px; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;">${menuTitle}</span>
    `;
    panel.append(header);

    // Mode Row (Light, Dark, System)
    const modeRow = document.createElement('div');
    modeRow.className = 'topbar__theme-mode-row';
    modeRow.style.display = 'flex';
    modeRow.style.gap = '4px';
    modeRow.style.padding = '8px 0';

    const modes = [
      { id: 'light', label: t('shell.theme_mode_light') || 'Light', icon: THEME_ICONS_SVG.light },
      { id: 'dark', label: t('shell.theme_mode_dark') || 'Dark', icon: THEME_ICONS_SVG.dark },
      { id: 'system', label: t('shell.theme_mode_system') || 'System', icon: THEME_ICONS_SVG.system },
    ];

    modes.forEach((m) => {
      const modeBtn = document.createElement('button');
      modeBtn.type = 'button';
      modeBtn.className = `btn btn--sm ${mode === m.id ? 'btn--primary' : 'btn--ghost'}`;
      modeBtn.style.flex = '1';
      modeBtn.style.padding = '4px 6px';
      modeBtn.style.fontSize = '11px';
      modeBtn.style.display = 'flex';
      modeBtn.style.alignItems = 'center';
      modeBtn.style.justifyContent = 'center';
      modeBtn.style.gap = '4px';
      modeBtn.innerHTML = `<span>${m.icon}</span> <span>${m.label}</span>`;
      modeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTheme(m.id);
        updateTriggerIcon();
        renderPanel();
      });
      modeRow.append(modeBtn);
    });
    panel.append(modeRow);
  }
}

function ThemeMenu() {
  const wrap = document.createElement('div');
  wrap.className = 'topbar__theme-menu topbar__avatar-menu';

  const menuTitle = t('shell.theme_menu_title_plain') || 'Theme';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'topbar__icon-btn topbar__theme-btn';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', menuTitle);
  trigger.title = menuTitle;

  const updateTriggerIcon = () => {
    trigger.innerHTML = THEME_ICONS_SVG[getTheme()] || THEME_ICONS_SVG.system;
  };
  updateTriggerIcon();

  const panel = document.createElement('div');
  panel.className = 'topbar__avatar-panel topbar__theme-panel';
  panel.style.minWidth = '230px';
  panel.hidden = true;

  const renderPanel = () => renderThemeControls(panel, { onModeApplied: updateTriggerIcon });

  function open() {
    renderPanel();
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

export function TopBar({
  role,
  user,
  elevatedGrant,
  badges,
  navigate,
  sidebarCollapsed = false,
  onToggleSidebar = null,
}) {
  const bar = document.createElement('header');
  bar.className = 'topbar';

  const isGuest = !role;

  if (onToggleSidebar) {
    const sidebarToggleBtn = IconButton({
      icon: ICONS.menu,
      label: t(sidebarCollapsed ? 'shell.expand_sidebar' : 'shell.collapse_sidebar'),
      onClick: (e) => onToggleSidebar(e.currentTarget),
    });
    sidebarToggleBtn.classList.add('topbar__sidebar-toggle');
    sidebarToggleBtn.setAttribute('aria-expanded', String(!sidebarCollapsed));
    sidebarToggleBtn.setAttribute('aria-controls', 'sidebar-nav');
    bar.append(sidebarToggleBtn);
  }

  const brand = document.createElement('a');
  brand.className = 'topbar__brand';
  brand.href = '/';
  brand.setAttribute('aria-label', 'Explooro');
  brand.innerHTML = `${getExplooroLogoSvg({ size: 28 })} <span class="topbar__brand-text">${formatExplooroBrandText('EXPLOORO')}</span>`;
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

  // Typeahead dropdown (Prompt 4.4, plan A). Self-contained inside the form — no cleanup contract
  // needed because AppShell rebuilds the whole TopBar on every store/lang change.
  attachSearchSuggest({ form: searchForm, input: searchInput, navigate });

  // WHY: emptying the box has to undo the search, not just blank the input. Without this, the
  // results page keeps rendering the old term's grid under an empty search box, which reads as
  // "clearing did nothing" — the box and the page disagree about what is being searched.
  // Covers every way to empty it: backspacing, Ctrl+A + Delete, the native type=search "x", and
  // Escape (the last two fire `search`, not just `input`, in Chromium).
  let clearResetTimer = null;
  function cancelClearReset() {
    if (clearResetTimer) {
      clearTimeout(clearResetTimer);
      clearResetTimer = null;
    }
  }
  function resetToUnsearchedState() {
    cancelClearReset();
    // Only the results page has a search to undo, and re-checking the path here is also what
    // keeps a stale timer from a replaced TopBar from pushing a second history entry.
    if (searchInput.value.trim()) return;
    if (window.location.pathname !== '/search') return;
    navigate('/');
  }
  searchInput.addEventListener('input', () => {
    cancelClearReset();
    if (searchInput.value.trim()) return;
    clearResetTimer = setTimeout(resetToUnsearchedState, SEARCH_CLEAR_RESET_MS);
  });
  // The "x" button and Escape are unambiguous — reset without waiting out the grace period.
  searchInput.addEventListener('search', resetToUnsearchedState);

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    cancelClearReset();
    const query = searchInput.value.trim();
    // Empty submit from the results page clears back to the marketplace home.
    if (!query) {
      if (window.location.pathname === '/search') navigate('/');
      return;
    }
    navigate(`/search?q=${encodeURIComponent(query)}`);
  });

  bar.append(searchForm);

  const spacer = document.createElement('div');
  spacer.className = 'topbar__spacer';
  bar.append(spacer);

  // Community timeline — one click from anywhere, for guests too (they can read it). The shell
  // rebuilds the TopBar on every navigation, so the current-page mark below needs no listener.
  // Hidden only when the `community_posts` module is off; the route is gated by the same module.
  if (isFeatureEnabled('community_posts')) {
    const path = window.location.pathname;
    const onCommunity = path === '/community' || path.startsWith('/community/') || path.startsWith('/admin/community');
    const target = COMMUNITY_STAFF_ROLES.includes(role) ? '/admin/community' : '/community';
    const communityBtn = IconButton({
      icon: COMMUNITY_ICON_SVG,
      label: t('nav.community'),
      onClick: () => navigate(target),
    });
    communityBtn.classList.add('topbar__community-btn');
    // WHY: a guest's row also carries Sign in and Sign up; on a narrow phone that row must not wrap,
    // so the guest's button steps aside there (shell.css) while a signed-in person keeps it.
    if (isGuest) communityBtn.classList.add('topbar__community-btn--guest');
    if (onCommunity) communityBtn.setAttribute('aria-current', 'page');
    bar.append(communityBtn);
  }

  // Discovery ⇄ Marketplace — a single context-aware toggle. On the discovery feed it offers a way
  // back to the marketplace grid; everywhere else it points into the feed. The label/icon/target all
  // flip on the current route, and the shell rebuilds the TopBar on every navigation (AppShell's
  // router beforeEach), so this re-reads location.pathname and stays in sync without its own listener.
  // Available to everyone (guests included); gated by the `discovery_feed` module on its route.
  if (isFeatureEnabled('discovery_feed')) {
    const onDiscover = window.location.pathname.startsWith('/discover');
    const switchBtn = IconButton({
      icon: onDiscover ? MARKET_ICON_SVG : DISCOVER_ICON_SVG,
      label: onDiscover ? t('nav.marketplace') : t('nav.discover'),
      onClick: () => navigate(onDiscover ? '/' : '/discover'),
    });
    switchBtn.classList.add('topbar__discover-btn');
    bar.append(switchBtn);
  }

  if (elevatedGrant) bar.append(ElevatedChip({ grant: elevatedGrant }));

  // Signed-in people set language and theme from the avatar menu (see AvatarMenu). Guests have no
  // avatar menu, so they keep the standalone controls. The switcher exists only while the platform
  // policy lets visitors choose their own language and there is more than one enabled locale
  // (/admin/platform/language).
  if (isGuest && isLanguageSwitchAllowed()) {
    const enabled = getEnabledLanguages();
    const nextLang = enabled.find((l) => l !== getLanguage()) || getLanguage();
    const langBtn = document.createElement('button');
    langBtn.type = 'button';
    langBtn.className = 'topbar__icon-btn topbar__lang-btn';
    langBtn.textContent = nextLang === 'bn' ? t('language.switch_to_bn') : t('language.switch_to_en');
    langBtn.setAttribute(
      'aria-label',
      nextLang === 'bn' ? t('language.aria_switch_to_bn') : t('language.aria_switch_to_en')
    );
    langBtn.addEventListener('click', () => setLanguage(nextLang));
    bar.append(langBtn);
  }

  // Theme & Marketplace Preset Switcher Menu
  if (isGuest) bar.append(ThemeMenu());

  if (badges && badges.cart !== undefined) {
    bar.append(
      IconButton({ icon: CART_ICON_SVG, label: t('shell.cart'), badgeCount: badges.cart, onClick: () => openCart() })
    );
  } else {
    bar.append(
      IconButton({ icon: CART_ICON_SVG, label: t('shell.cart'), onClick: () => openCart() })
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
    const bellBtn = IconButton({
      icon: BELL_ICON_SVG,
      label: t('shell.notifications'),
      onClick: () => {
        openNotificationCenter({ onUnreadCountChanged: (n) => setBellBadge(bellBtn, n) });
      },
    });
    bar.append(bellBtn);
    initBellBadge(bellBtn);
    bar.append(AvatarMenu({ role, user, onNavigate: navigate }));
  }

  return bar;
}
