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
import { toggleGroupCollapsed, toggleSidebarCollapsed, setUiMode } from '../../state/appStore.js';

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

  if (item.icon) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'nav-item__icon';
    iconSpan.textContent = item.icon;
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

function renderAdvancedMode({ role, ctx, currentPath, navigate, collapsedGroups }) {
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
    header.innerHTML = `<span class="sidebar__group-icon" aria-hidden="true">${group.icon}</span>`;
    const headerLabel = document.createElement('span');
    headerLabel.className = 'sidebar__group-label';
    headerLabel.textContent = t(group.label_i18n_key);
    header.append(headerLabel);
    const chevron = document.createElement('span');
    chevron.className = 'sidebar__group-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = collapsed ? '▸' : '▾';
    header.append(chevron);
    header.addEventListener('click', () => toggleGroupCollapsed(group.key));
    section.append(header);

    if (!collapsed) {
      const list = document.createElement('div');
      list.className = 'sidebar__group-items';
      list.append(...nodes);
      section.append(list);
    }

    wrap.append(section);
  }
  return wrap;
}

function SidebarBrand({ navigate, sidebarCollapsed }) {
  const brand = document.createElement('a');
  brand.className = 'sidebar__brand';
  brand.href = '/';
  brand.innerHTML = sidebarCollapsed
    ? `<span aria-hidden="true">⚡</span>`
    : `<span aria-hidden="true">⚡</span> <span class="sidebar__brand-text">EXPLOORO</span>`;
  brand.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });
  return brand;
}

export function Sidebar({ role, ctx, currentPath, navigate, uiMode, sidebarCollapsed, collapsedGroups }) {
  const nav = document.createElement('nav');
  nav.className = 'sidebar';
  nav.dataset.collapsed = sidebarCollapsed ? 'true' : 'false';
  nav.setAttribute('aria-label', 'Primary');

  nav.append(SidebarBrand({ navigate, sidebarCollapsed }));

  const isProgressive = PROGRESSIVE_DISCLOSURE_ROLES.includes(role);
  const mode = isProgressive ? uiMode[role] ?? 'simple' : 'advanced';

  if (isProgressive) {
    const modeToggle = document.createElement('div');
    modeToggle.className = 'sidebar__mode-toggle';
    for (const value of ['simple', 'advanced']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sidebar__mode-btn${mode === value ? ' sidebar__mode-btn--active' : ''}`;
      btn.textContent = t(`shell.mode.${value}`);
      btn.addEventListener('click', () => setUiMode(role, value));
      modeToggle.append(btn);
    }
    nav.append(modeToggle);
  }

  nav.append(
    mode === 'simple' && isProgressive
      ? renderSimpleMode({ role, ctx, currentPath, navigate })
      : renderAdvancedMode({ role, ctx, currentPath, navigate, collapsedGroups })
  );

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'sidebar__collapse-toggle';
  collapseBtn.textContent = sidebarCollapsed ? '»' : '«';
  collapseBtn.setAttribute('aria-label', t(sidebarCollapsed ? 'shell.expand_sidebar' : 'shell.collapse_sidebar'));
  collapseBtn.addEventListener('click', () => toggleSidebarCollapsed());
  nav.append(collapseBtn);

  return nav;
}
