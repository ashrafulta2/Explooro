/**
 * MobileNav — bottom tab bar, ia-sitemap.md §6. Max 5 items (always true here — MOBILE_TABS
 * caps every role at 5, "More" included), 44px targets via --control-height under (pointer:
 * coarse) same as every other control (design-system.md §9), safe-area inset in shell.css.
 *
 * The 5th "More" slot opens a bottom sheet with the full grouped tree — reuses Sidebar's advanced
 * render rather than duplicating the group/lock/badge logic a second time.
 */
import { MOBILE_TABS } from '../../config/navigation.js';
import { t } from '../../services/i18n.js';
import { Badge } from '../ui/Badge.js';
import { Drawer } from '../ui/Drawer.js';
import { Sidebar } from './Sidebar.js';

export function MobileNav({ role, ctx, currentPath, navigate, collapsedGroups }) {
  const tabs = MOBILE_TABS[role] ?? [];
  const nav = document.createElement('nav');
  nav.className = 'mobile-nav';
  nav.setAttribute('aria-label', 'Primary');

  let sheet = null;

  function openMoreSheet(trigger) {
    if (sheet) {
      sheet.remove();
      sheet = null;
    }
    const content = Sidebar({
      role,
      ctx,
      currentPath,
      navigate: (path) => {
        sheet.closeDrawer(false);
        navigate(path);
      },
      uiMode: { [role]: 'advanced' }, // the sheet always shows the full tree, regardless of Simple Mode
      sidebarCollapsed: false,
      collapsedGroups,
    });
    sheet = Drawer({ title: t('shell.more_sheet_title'), side: 'bottom', content });
    document.body.append(sheet);
    sheet.openDrawer(trigger);
  }

  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-nav__item';
    if (!tab.more && tab.path === currentPath) {
      btn.classList.add('mobile-nav__item--active');
      btn.setAttribute('aria-current', 'page');
    }

    const label = document.createElement('span');
    label.className = 'mobile-nav__label';
    label.textContent = t(tab.label_i18n_key);
    btn.append(label);

    const count = tab.badge ? ctx.badges[tab.badge] : null;
    if (count) btn.append(Badge({ variant: 'count', count }));

    btn.addEventListener('click', () => (tab.more ? openMoreSheet(btn) : navigate(tab.path)));
    nav.append(btn);
  }

  return nav;
}
