/**
 * MobileNav — bottom tab bar, ia-sitemap.md §6. Max 5 items (always true here — MOBILE_TABS
 * caps every role at 5, "More" included), 44px targets via --control-height under (pointer:
 * coarse) same as every other control (design-system.md §9), safe-area inset in shell.css.
 *
 * The 5th "More" slot opens a bottom sheet with the Sidebar itself, in the user's own mode (Prompt
 * 13.5: Simple shows core items, pins and "More"; Advanced the full grouped tree), rather than
 * duplicating the group/lock/badge logic a second time.
 */
import { MOBILE_TABS } from '../../config/navigation.ts';
import { t } from '../../services/i18n.ts';
import { Badge } from '../ui/Badge.ts';
import { Drawer } from '../ui/Drawer.ts';
import { Sidebar } from './Sidebar.ts';
import type { NavContext } from './Sidebar.ts';
import { openCart } from '../../services/cart.ts';
import { appStore } from '../../state/appStore.ts';

// Non-navigation tab actions — a tab with `action` opens UI in place instead of routing.
const TAB_ACTIONS = {
  openCart: () => openCart(),
};

// WHY: a count badge that never leaves the tab bar becomes wallpaper and nags. It pops in when the
// count grows, then comes back at most three more times with widening gaps (≈2, 5, 15 min) until
// the user opens the tab. [start, end) offsets in ms from the moment the count last grew.
export const BADGE_SHOW_WINDOWS = [
  [0, 4000],
  [120000, 124000],
  [300000, 304000],
  [900000, 904000],
];

export function isBadgeShown(elapsedMs: number): boolean {
  return BADGE_SHOW_WINDOWS.some(([from, to]) => elapsedMs >= from && elapsedMs < to);
}

// Survives MobileNav re-renders (the shell rebuilds it on every store change), keyed by tab key.
const badgeState = new Map();
const badgeTimers = new Map();

function trackBadge(key, count, seen) {
  const prev = badgeState.get(key);
  if (!count) {
    badgeState.delete(key);
    return null;
  }
  if (!prev || count > prev.count) {
    const next = { count, since: Date.now(), seen: false };
    badgeState.set(key, next);
    return next;
  }
  prev.count = count;
  if (seen) prev.seen = true;
  return prev;
}

function scheduleBadge(key, badge, state) {
  clearTimeout(badgeTimers.get(key));
  const apply = () => {
    if (!badge.isConnected) return;
    const elapsed = Date.now() - state.since;
    badge.classList.toggle('is-shown', !state.seen && isBadgeShown(elapsed));
    const edges = BADGE_SHOW_WINDOWS.flat().filter((ms) => ms > elapsed);
    if (!state.seen && edges.length) badgeTimers.set(key, setTimeout(apply, Math.min(...edges) - elapsed));
  };
  // WHY deferred: the nav is built detached and mounted after this returns, and the pop-in
  // transition needs one painted frame at opacity 0 first.
  badgeTimers.set(key, setTimeout(apply, 60));
}

export interface MobileNavOptions {
  role: string;
  ctx: NavContext;
  currentPath: string;
  navigate: (path: string) => void;
  collapsedGroups?: string[];
}

export function MobileNav({ role, ctx, currentPath, navigate }: MobileNavOptions): HTMLElement {
  const tabs = MOBILE_TABS[role] ?? [];
  const nav = document.createElement('nav');
  nav.className = 'mobile-nav';
  nav.setAttribute('aria-label', 'Primary');

  let sheet = null;
  let stopWatching = null;

  function openMoreSheet(trigger) {
    if (sheet) {
      sheet.remove();
      sheet = null;
    }
    // Prompt 13.5: the sheet follows the same tiers as the desktop sidebar (Simple: core items, pins
    // and "More"; Advanced: the full tree), read from the store each time it draws.
    const draw = () => {
      const { shell } = appStore.get();
      return Sidebar({
        role,
        ctx,
        currentPath,
        navigate: (path) => {
          sheet.closeDrawer(false);
          navigate(path);
        },
        uiMode: shell.uiMode,
        sidebarCollapsed: false,
        collapsedGroups: shell.collapsedGroups,
        journeyState: shell.journeyState,
        navPins: shell.navPins,
        navMoreOpen: shell.navMoreOpen,
      });
    };
    let content = draw();
    // WHY watch the store: the sheet is appended to <body> and outlives the tab bar's rebuilds, so
    // without this a pin, a mode switch or opening "More" inside it would change nothing on screen.
    stopWatching?.();
    stopWatching = appStore.selector(
      (s) => ({ mode: s.shell.uiMode, pins: s.shell.navPins, more: s.shell.navMoreOpen, groups: s.shell.collapsedGroups, journey: s.shell.journeyState }),
      () => {
        const next = draw();
        content.replaceWith(next);
        content = next;
      }
    );
    sheet = Drawer({
      title: t('shell.more_sheet_title'),
      side: 'bottom',
      content,
      onClose: () => {
        stopWatching?.();
        stopWatching = null;
      },
    });
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
    let badge = null;
    let badgeKey = null;
    let state = null;
    if (count) {
      badge = Badge({ variant: 'count', count });
      btn.append(badge);
      if (tab.action) {
        badge.classList.add('is-shown'); // cart: a running total, always visible
      } else {
        badgeKey = tab.key;
        state = trackBadge(badgeKey, count, tab.path === currentPath);
        scheduleBadge(badgeKey, badge, state);
      }
    } else if (tab.badge && !tab.action) {
      trackBadge(tab.key, 0, false);
    }

    btn.addEventListener('click', () => {
      if (state) {
        state.seen = true;
        badge.classList.remove('is-shown');
      }
      if (tab.more) return openMoreSheet(btn);
      if (tab.action && TAB_ACTIONS[tab.action]) return TAB_ACTIONS[tab.action]();
      navigate(tab.path);
    });
    nav.append(btn);
  }

  return nav;
}
