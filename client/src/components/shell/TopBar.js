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
import { ICONS, getExplooroLogoSvg, formatExplooroBrandText } from '../ui/icons.js';
import { attachSearchSuggest } from '../search/SearchSuggest.js';

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

import { MASTER_PRESETS } from '../../config/master-themes.js';
import { switchThemePreset, getActivePresetKey } from '../../services/themePalette.js';
import { toast } from '../../services/toast.js';

function ThemeMenu() {
  const wrap = document.createElement('div');
  wrap.className = 'topbar__theme-menu topbar__avatar-menu';

  let activePreset = getActivePresetKey();

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'topbar__icon-btn topbar__theme-btn';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', t('shell.theme_menu_title') || 'Theme & Presets');
  trigger.title = t('shell.theme_menu_title') || 'Theme & Presets';

  const updateTriggerIcon = () => {
    const mode = getTheme();
    trigger.innerHTML = THEME_ICONS_SVG[mode] || THEME_ICONS_SVG.system;
  };
  updateTriggerIcon();

  const panel = document.createElement('div');
  panel.className = 'topbar__avatar-panel topbar__theme-panel';
  panel.style.minWidth = '230px';
  panel.hidden = true;

  const renderPanel = () => {
    panel.innerHTML = '';
    const isBn = getLanguage() === 'bn';
    const mode = getTheme();

    // Header
    const header = document.createElement('div');
    header.className = 'topbar__theme-panel-header';
    header.style.padding = '2px 4px 6px 4px';
    header.style.borderBottom = '1px solid var(--border-subtle)';
    header.innerHTML = `
      <span style="font-weight: 700; font-size: 11px; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;">${t('shell.theme_menu_title') || 'Theme & Presets'}</span>
    `;
    panel.append(header);

    // Mode Row (Light, Dark, System)
    const modeRow = document.createElement('div');
    modeRow.className = 'topbar__theme-mode-row';
    modeRow.style.display = 'flex';
    modeRow.style.gap = '4px';
    modeRow.style.padding = '8px 0';
    modeRow.style.borderBottom = '1px solid var(--border-subtle)';

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

    // Presets List
    const presetsList = document.createElement('div');
    presetsList.className = 'topbar__theme-presets-list';
    presetsList.style.display = 'flex';
    presetsList.style.flexDirection = 'column';
    presetsList.style.gap = '2px';
    presetsList.style.maxHeight = '280px';
    presetsList.style.overflowY = 'auto';

    const createPresetBtn = (key, preset) => {
      const pBtn = document.createElement('button');
      pBtn.type = 'button';
      pBtn.className = 'topbar__theme-preset-btn';
      pBtn.style.display = 'flex';
      pBtn.style.alignItems = 'center';
      pBtn.style.gap = '8px';
      pBtn.style.padding = '6px 8px';
      pBtn.style.borderRadius = 'var(--radius-sm)';
      pBtn.style.border = 'none';
      pBtn.style.background = activePreset === key ? 'var(--surface-2)' : 'transparent';
      pBtn.style.cursor = 'pointer';
      pBtn.style.textAlign = 'left';
      pBtn.style.width = '100%';

      const dot = document.createElement('span');
      dot.style.width = '12px';
      dot.style.height = '12px';
      dot.style.borderRadius = '50%';
      dot.style.background = preset.master.seed;
      dot.style.flexShrink = '0';
      dot.style.border = '1px solid rgba(0,0,0,0.15)';

      const name = document.createElement('span');
      name.style.fontSize = '12px';
      name.style.fontWeight = activePreset === key ? '700' : '500';
      name.style.color = activePreset === key ? 'var(--brand)' : 'var(--text-primary)';
      name.style.flex = '1';
      name.textContent = isBn ? preset.name_bn : preset.name_en;

      const check = document.createElement('span');
      check.style.fontSize = '12px';
      check.style.fontWeight = '700';
      check.style.color = 'var(--brand)';
      check.textContent = activePreset === key ? '✓' : '';

      pBtn.append(dot, name, check);

      pBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activePreset = key;
        switchThemePreset(key);
        const nameText = isBn ? preset.name_bn : preset.name_en;
        toast.info(t('shell.theme_applied_toast', { name: nameText }) || `Theme applied: ${nameText}`);
        renderPanel();
      });

      return pBtn;
    };

    // Explooro Group Header
    const explooroHeader = document.createElement('div');
    explooroHeader.style.padding = '8px 4px 4px 4px';
    explooroHeader.style.fontSize = '11px';
    explooroHeader.style.fontWeight = '600';
    explooroHeader.style.color = 'var(--text-muted)';
    explooroHeader.textContent = t('shell.theme_group_explooro') || 'Explooro';
    presetsList.append(explooroHeader);

    // Explooro Presets
    for (const [key, preset] of Object.entries(MASTER_PRESETS)) {
      if (preset.group === 'explooro' || key === 'pure_gold' || key === 'explooro_pink') {
        presetsList.append(createPresetBtn(key, preset));
      }
    }

    // Marketplace Style Header
    const marketplaceHeader = document.createElement('div');
    marketplaceHeader.style.padding = '10px 4px 4px 4px';
    marketplaceHeader.style.fontSize = '11px';
    marketplaceHeader.style.fontWeight = '600';
    marketplaceHeader.style.color = 'var(--text-muted)';
    marketplaceHeader.style.borderTop = '1px solid var(--border-subtle)';
    marketplaceHeader.style.marginTop = '4px';
    marketplaceHeader.textContent = t('shell.theme_presets_title') || 'Marketplace Style (1-Click)';
    presetsList.append(marketplaceHeader);

    // Marketplace Presets
    for (const [key, preset] of Object.entries(MASTER_PRESETS)) {
      if (preset.group !== 'explooro' && key !== 'pure_gold' && key !== 'explooro_pink') {
        presetsList.append(createPresetBtn(key, preset));
      }
    }

    panel.append(presetsList);
  };

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

export function TopBar({ role, elevatedGrant, badges, navigate, onOpenPalette }) {
  const bar = document.createElement('header');
  bar.className = 'topbar';

  const isGuest = !role;

  const brand = document.createElement('a');
  brand.className = 'topbar__brand';
  brand.href = '/';
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

  // Theme & Marketplace Preset Switcher Menu
  bar.append(ThemeMenu());

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
