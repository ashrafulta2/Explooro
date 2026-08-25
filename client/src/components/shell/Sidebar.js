/**
 * Sidebar — the role-aware, grouped nav tree (ia-sitemap.md §2). Renders from `navigation.js`
 * (data), never hand-written per role. A pure render function: AppShell rebuilds it whenever
 * appStore/i18n/router state changes — the tree is small enough (≤49 items for the biggest role)
 * that a full rebuild is simpler and just as fast as fine-grained patching.
 *
 * Locked-state UX (ia-sitemap.md §5.1), enforced here so every consumer gets it for free:
 *  - module disabled  → item skipped entirely (never in the DOM)
 *  - permission missing → LockedNavItem (greyed, lock icon, visible)
 *  - otherwise        → a normal link, active-highlighted against `currentPath`
 */
import { navGroups, navItems, SIMPLE_MODE_ITEMS, PROGRESSIVE_DISCLOSURE_ROLES } from '../../config/navigation.js';
import { t } from '../../services/i18n.js';
import { LockedNavItem } from './LockedNavItem.js';
import { Badge } from '../ui/Badge.js';
import { toggleGroupCollapsed, toggleSidebarCollapsed, expandSidebarToGroup, setUiMode } from '../../state/appStore.js';
import { getGroupIcon, getItemIcon } from '../ui/icons.js';

function hasModule(modules, key) {
  return !key || key === 'core' || modules[key] === true;
}

function hasPermission(permissions, key) {
  return !key || permissions.includes(key);
}

function navLink({ item, label, currentPath, navigate, badges }) {
  const a = document.createElement('a');
  a.href = item.path;
  a.className = 'nav-item';
  if (item.highlight) a.classList.add('nav-item--highlight');
  if (item.path === currentPath) {
    a.classList.add('nav-item--active');
    a.setAttribute('aria-current', 'page');
  }
  a.title = label;

  const icon = getItemIcon(item);
  if (icon) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'nav-item__icon';
    if (typeof icon === 'string' && icon.trim().startsWith('<svg')) {
      iconSpan.innerHTML = icon;
    } else {
      iconSpan.textContent = icon;
    }
    iconSpan.setAttribute('aria-hidden', 'true');
    a.append(iconSpan);
  }

  const labelSpan = document.createElement('span');
  labelSpan.className = 'nav-item__label';
  labelSpan.textContent = label;
  a.append(labelSpan);

  const count = item.badge ? badges[item.badge] : null;
  if (count) a.append(Badge({ variant: 'count', count }));

  a.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(item.path);
  });
  return a;
}

function renderItem({ item, ctx, currentPath, navigate }) {
  if (!hasModule(ctx.modules, item.module)) return null; // module off — hidden entirely
  const label = t(item.label_i18n_key);
  if (!hasPermission(ctx.permissions, item.permission)) {
    return LockedNavItem({ item });
  }
  return navLink({ item, label, currentPath, navigate, badges: ctx.badges });
}

function renderSimpleMode({ role, ctx, currentPath, navigate }) {
  const list = document.createElement('div');
  list.className = 'sidebar__simple-list';
  for (const item of SIMPLE_MODE_ITEMS[role] ?? []) {
    const node = renderItem({ item, ctx, currentPath, navigate });
    if (node) list.append(node);
  }
  return list;
}

function renderAdvancedMode({ role, ctx, currentPath, navigate, collapsedGroups, sidebarCollapsed }) {
  const wrap = document.createElement('div');
  wrap.className = 'sidebar__groups';

  const groups = navGroups.filter((g) => g.role === role).sort((a, b) => a.order - b.order);
  for (const group of groups) {
    const items = navItems
      .filter((item) => item.group === group.key && item.roles.includes(role))
      .sort((a, b) => a.order - b.order);

    const nodes = items.map((item) => renderItem({ item, ctx, currentPath, navigate })).filter(Boolean);
    if (nodes.length === 0) continue; // every item in this group was module-hidden

    const section = document.createElement('div');
    section.className = 'sidebar__group';

    const collapsed = collapsedGroups.includes(group.key);
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'sidebar__group-header';
    header.setAttribute('aria-expanded', String(!collapsed));
    const groupIconSvg = getGroupIcon(group.key);
    header.innerHTML = `<span class="sidebar__group-icon" aria-hidden="true">${groupIconSvg}</span>`;
    const headerLabel = document.createElement('span');
    headerLabel.className = 'sidebar__group-label';
    headerLabel.textContent = t(group.label_i18n_key);
    header.append(headerLabel);
    const chevron = document.createElement('span');
    chevron.className = 'sidebar__group-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = collapsed ? '▸' : '▾';
    header.append(chevron);
    header.addEventListener('click', () => {
      // In icon-rail mode a group's items are force-hidden regardless of its own collapsed
      // state (see the sidebarCollapsed check below), so toggling that state here would be
      // invisible to the user — expand the rail itself instead.
      if (sidebarCollapsed) expandSidebarToGroup(group.key);
      else toggleGroupCollapsed(group.key);
    });
    section.append(header);

    // In icon-rail mode, item rows never show (most have no icon of their own — only group
    // headers do), so a group left expanded before collapsing the sidebar would otherwise render
    // a stack of empty-looking rows. Force the list hidden while the rail is collapsed; the
    // group's own expand/collapse state is untouched and restores once the sidebar re-opens.
    if (!collapsed && !sidebarCollapsed) {
      const list = document.createElement('div');
      list.className = 'sidebar__group-items';
      list.append(...nodes);
      section.append(list);
    }

    wrap.append(section);
  }
  return wrap;
}

export function Sidebar({ role, ctx, currentPath, navigate, uiMode, sidebarCollapsed, collapsedGroups }) {
  const nav = document.createElement('nav');
  nav.className = 'sidebar';
  nav.dataset.collapsed = sidebarCollapsed ? 'true' : 'false';
  nav.setAttribute('aria-label', 'Primary');

  const isProgressive = PROGRESSIVE_DISCLOSURE_ROLES.includes(role);
  const mode = isProgressive ? uiMode[role] ?? 'simple' : 'advanced';

  if (isProgressive) {
    const modeToggle = document.createElement('div');
    modeToggle.className = 'sidebar__mode-toggle';

    // Expanded view: Two-button switch
    const expandedGroup = document.createElement('div');
    expandedGroup.className = 'sidebar__mode-expanded';
    for (const value of ['simple', 'advanced']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sidebar__mode-btn${mode === value ? ' sidebar__mode-btn--active' : ''}`;
      btn.textContent = t(`shell.mode.${value}`);
      btn.addEventListener('click', () => setUiMode(role, value));
      expandedGroup.append(btn);
    }

    // Collapsed rail view: Sleek single icon button with tooltip
    const compactBtn = document.createElement('button');
    compactBtn.type = 'button';
    compactBtn.className = 'sidebar__mode-compact-btn';
    const nextMode = mode === 'simple' ? 'advanced' : 'simple';
    compactBtn.title = `${t('shell.mode_label') || 'Mode'}: ${t(`shell.mode.${mode}`)} (${t('common.click_to_toggle') || 'Click for'} ${t(`shell.mode.${nextMode}`)})`;
    compactBtn.setAttribute('aria-label', compactBtn.title);
    compactBtn.innerHTML = mode === 'simple'
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h6"></path></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
    compactBtn.addEventListener('click', () => setUiMode(role, nextMode));

    modeToggle.append(expandedGroup, compactBtn);
    nav.append(modeToggle);
  }

  nav.append(
    mode === 'simple' && isProgressive
      ? renderSimpleMode({ role, ctx, currentPath, navigate })
      : renderAdvancedMode({ role, ctx, currentPath, navigate, collapsedGroups, sidebarCollapsed })
  );

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'sidebar__collapse-toggle';
  collapseBtn.textContent = sidebarCollapsed ? '›' : '‹';
  collapseBtn.setAttribute('aria-label', t(sidebarCollapsed ? 'shell.expand_sidebar' : 'shell.collapse_sidebar'));
  collapseBtn.addEventListener('click', () => toggleSidebarCollapsed());

  // collapseBtn is a sibling of nav, not a child — it must sit outside nav's own overflow-y:auto
  // box so it isn't clipped where it straddles the sidebar/content border (shell.css).
  const fragment = document.createDocumentFragment();
  fragment.append(nav, collapseBtn);
  return fragment;
}
