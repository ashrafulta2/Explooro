/**
 * AppShell — composes Sidebar + TopBar + MobileNav + CommandPalette around the routed page.
 *
 * Owns the one long-lived DOM structure (sidebar/topbar/mobilenav "slots" around a stable
 * `pageOutlet`) and re-renders the CHROME — never `pageOutlet` itself, which core/router.js owns
 * — whenever appStore or the active language changes. `render()` is also exported so main.js's
 * router can call it from `beforeEach`: a route change doesn't touch appStore or i18n, so without
 * this the active-link highlight in Sidebar/MobileNav would go stale after every navigation.
 *
 * The Sidebar/MobileNav split is pure CSS (shell.css media queries against the 768px breakpoint,
 * ia-sitemap.md §6) — both are always rendered; only one is ever visible at a time.
 */
import { appStore, releaseElevatedAccess, toggleSidebarCollapsed } from '../../state/appStore.js';
import {
  subscribe as subscribeLang,
  subscribeLocalePolicy,
  getLanguage,
  t,
} from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Sidebar } from './Sidebar.js';
import { TopBar, formatRemaining } from './TopBar.js';
import { MobileNav } from './MobileNav.js';
import { createCommandPalette } from './CommandPalette.js';
import { CHEVRON_LEFT_SVG, bindBackControl } from '../../core/navBack.js';
import { CartDrawer } from '../cart/CartDrawer.js';
import { initCart } from '../../services/cart.js';

const BACK_PORTAL_ROOTS = ['/admin', '/moderator', '/saler', '/supplier'];

/** The dashboard root of the portal `pathname` belongs to, or null on a root page or elsewhere. */
function portalRoot(pathname) {
  const path = pathname.replace(/\/+$/, '');
  return BACK_PORTAL_ROOTS.find((root) => path.startsWith(`${root}/`)) ?? null;
}

function isTextInput(el) {
  return Boolean(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function createAppShell({ container, navigate }) {
  container.replaceChildren();

  const shellEl = document.createElement('div');
  shellEl.className = 'app-shell';

  const sidebarSlot = document.createElement('div');
  sidebarSlot.className = 'app-shell__sidebar-slot';

  const topbarSlot = document.createElement('div');
  topbarSlot.className = 'app-shell__topbar-slot';

  const pageOutlet = document.createElement('main');
  pageOutlet.className = 'app-shell__content app-shell__page';
  pageOutlet.id = 'app-page-outlet';

  const mobileNavSlot = document.createElement('div');
  mobileNavSlot.className = 'app-shell__mobilenav-slot';

  shellEl.append(sidebarSlot, topbarSlot, pageOutlet, mobileNavSlot);
  container.append(shellEl);

  function currentCtx() {
    const s = appStore.get();
    return { role: s.auth?.role, permissions: s.auth?.permissions || [], modules: s.modules, badges: s.badges };
  }

  const palette = createCommandPalette({ getState: () => ({ ctx: currentCtx(), navigate }) });
  const cartDrawer = CartDrawer({ navigate });
  document.body.append(cartDrawer);
  initCart();

  // WHY: the TopBar is rebuilt wholesale on every store, language, and route change, so a naive
  // replaceChildren() throws away the product-search box the user is typing in — blur plus the
  // half-typed term, since the fresh input only re-seeds itself from the URL's `q`. That bites
  // hardest right after clearing the box on /search: the reset navigation rebuilds the TopBar and
  // the caret would land on <body> mid-thought.
  //
  // Focus follows the box across every rebuild, but the typed text only survives a rebuild that
  // did NOT change `q` — otherwise a Back into a results page would restore the stale text over
  // the term the page is actually showing, which is the very desync this is here to prevent.
  let lastSearchQuery = null;
  function renderTopBar(props) {
    const searchQuery = new URLSearchParams(window.location.search).get('q') || '';
    const previous = topbarSlot.querySelector('.topbar__product-search-input');
    const hadFocus = Boolean(previous) && document.activeElement === previous;
    const carriedText =
      hadFocus && searchQuery === lastSearchQuery
        ? { value: previous.value, start: previous.selectionStart, end: previous.selectionEnd }
        : null;
    lastSearchQuery = searchQuery;

    topbarSlot.replaceChildren(TopBar(props));
    if (!hadFocus) return;
    const next = topbarSlot.querySelector('.topbar__product-search-input');
    if (!next) return;
    if (carriedText) {
      next.value = carriedText.value;
      next.focus();
      if (carriedText.start != null) next.setSelectionRange(carriedText.start, carriedText.end);
      return;
    }
    next.focus();
    next.setSelectionRange(next.value.length, next.value.length);
  }

  // Back control for the sub-pages of the staff/seller portals: a bare "‹" injected at the start of
  // the page's own heading, with the destination named in its tooltip. Each portal's dashboard is
  // its root, so it has none. The customer /account pages render their own back links.
  //
  // WHY it is injected rather than rendered by each page: ~100 portal pages own their headers, and a
  // control every one of them had to remember to render is one half of them would forget (System
  // Health did). core/router.js empties `pageOutlet` on every navigation and pages re-render their
  // headers on tab switches and polling, so a MutationObserver re-attaches it; sync is idempotent so
  // its own insertion doesn't loop.
  let backRoot = null;

  function backTarget() {
    const fromPath = window.history.state?.fromPath || null;
    // fromTitle is the previous page's document.title, e.g. "Users — Explooro".
    const fromTitle = (window.history.state?.fromTitle || '').replace(/\s+[—–-]\s+Explooro$/, '').trim();
    return {
      href: fromPath || backRoot,
      name: (fromPath && fromTitle) || t('common.dashboard'),
    };
  }

  function syncBackButton() {
    const existing = pageOutlet.querySelectorAll('.shell-back');
    if (!backRoot) {
      existing.forEach((el) => el.remove());
      return;
    }
    // A page that ships its own back control (marked data-nav-back, as navBack.js's are) keeps it —
    // two competing "back" affordances on one page is worse than none.
    if (pageOutlet.querySelector('[data-nav-back]:not(.shell-back)')) {
      existing.forEach((el) => el.remove());
      return;
    }
    const heading = pageOutlet.querySelector('h1') || pageOutlet.querySelector('h2');
    // Between navigations the outlet is empty while the page module loads; a lone icon there would
    // flash on an otherwise blank screen before the heading arrives.
    if (!heading && !pageOutlet.firstElementChild) return;
    const { href, name } = backTarget();
    const label = t('common.back_to', { name });

    let link = existing[0];
    // A page that re-rendered its header leaves the old button behind in a detached node, and a
    // page with no heading gets the standalone fallback — either way, keep exactly one.
    existing.forEach((el, i) => { if (i > 0) el.remove(); });
    const wantedParent = heading || pageOutlet;
    if (link && link.parentElement !== wantedParent) {
      link.remove();
      link = null;
    }
    if (!link) {
      link = document.createElement('a');
      link.className = heading ? 'shell-back' : 'shell-back shell-back--standalone';
      link.innerHTML = CHEVRON_LEFT_SVG.replace('back-btn__chevron', 'shell-back__chevron');
      bindBackControl(link, navigate, backRoot);
      wantedParent.prepend(link);
    }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    if (link.getAttribute('aria-label') !== label) {
      link.setAttribute('aria-label', label);
      link.setAttribute('title', label);
    }
  }

  let backSyncQueued = false;
  new MutationObserver(() => {
    if (!backRoot || backSyncQueued) return;
    backSyncQueued = true;
    requestAnimationFrame(() => {
      backSyncQueued = false;
      syncBackButton();
    });
  }).observe(pageOutlet, { childList: true, subtree: true });

  function renderBackBar(root) {
    backRoot = root;
    syncBackButton();
  }

  function render() {
    const s = appStore.get();
    if (!s.auth.isAuthenticated || !s.auth.role) {
      renderBackBar(null);
      sidebarSlot.replaceChildren();
      mobileNavSlot.replaceChildren();
      shellEl.dataset.hasChrome = 'guest';
      renderTopBar({
        role: null,
        elevatedGrant: null,
        badges: s.badges || {},
        navigate,
        onOpenPalette: () => palette.open(),
      });
      return;
    }
    shellEl.dataset.hasChrome = 'true';
    const ctx = currentCtx();
    const currentPath = window.location.pathname;
    renderBackBar(portalRoot(currentPath));
    const oldSidebar = sidebarSlot.querySelector('.sidebar');
    const sidebarScrollTop = oldSidebar ? oldSidebar.scrollTop : 0;

    sidebarSlot.replaceChildren(
      Sidebar({
        role: s.auth.role,
        ctx,
        currentPath,
        navigate,
        uiMode: s.shell.uiMode,
        sidebarCollapsed: s.shell.sidebarCollapsed,
        collapsedGroups: s.shell.collapsedGroups,
      })
    );

    const newSidebar = sidebarSlot.querySelector('.sidebar');
    if (newSidebar && sidebarScrollTop > 0) {
      newSidebar.scrollTop = sidebarScrollTop;
    }
    renderTopBar({
      role: s.auth.role,
      // Undefined under Prompt 1.7's mock role switcher, which has no real user behind it — the
      // avatar menu falls back to the role label, so this stays a nicety rather than a dependency.
      user: s.auth.user,
      elevatedGrant: s.shell.elevatedGrant,
      badges: s.badges,
      navigate,
      onOpenPalette: () => palette.open(),
      sidebarCollapsed: s.shell.sidebarCollapsed,
      onToggleSidebar: (trigger) => {
        if (window.innerWidth < 768) {
          const moreBtn = mobileNavSlot.querySelector('.mobile-nav__item:last-child');
          if (moreBtn) {
            moreBtn.click();
            return;
          }
        }
        toggleSidebarCollapsed();
      },
    });
    mobileNavSlot.replaceChildren(
      MobileNav({ role: s.auth.role, ctx, currentPath, navigate, collapsedGroups: s.shell.collapsedGroups })
    );
  }

  appStore.subscribe(render);
  subscribeLang(render);
  // The platform locale policy decides whether the TopBar shows a language switcher at all,
  // so a policy change has to rebuild the shell even when the active language is unchanged.
  subscribeLocalePolicy(render);
  render();

  // Scroll-shrink topbar: more content visibility while scrolling, full height restored at the
  // top. `.is-scrolled` on the shell drives the CSS (shell.css); a ResizeObserver keeps
  // `--topbar-h` in sync with the topbar's actual (transitioning) rendered height so the sidebar's
  // sticky offset and the grid row track it smoothly — those can't reference the topbar's box size
  // directly since it's a CSS-grid sibling, not an ancestor.
  let scrollTicking = false;
  function updateScrolledState() {
    scrollTicking = false;
    shellEl.classList.toggle('is-scrolled', window.scrollY > 8);
  }
  window.addEventListener(
    'scroll',
    () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(updateScrolledState);
    },
    { passive: true }
  );
  updateScrolledState();

  const topbarResizeObserver = new ResizeObserver((entries) => {
    const height = entries[0]?.contentRect.height;
    if (height && height > 0) shellEl.style.setProperty('--topbar-h', `${Math.round(height)}px`);
  });
  const topbarEl = topbarSlot.firstElementChild || topbarSlot;
  topbarResizeObserver.observe(topbarEl);

  // ia-sitemap.md §3: "Ctrl+K / Cmd+K anywhere EXCEPT inside a text input."
  function onGlobalKeydown(event) {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    const active = document.activeElement;
    if (isTextInput(active) && !palette.dialog.contains(active)) return;
    event.preventDefault();
    palette.open();
  }
  window.addEventListener('keydown', onGlobalKeydown);

  // ia-sitemap.md §5.4: the elevated-access chip is a live countdown, and warns once at 10
  // minutes remaining. One interval for the shell's lifetime — cheaper and simpler than every
  // TopBar rebuild (on every appStore change) starting and leaking its own timer.
  let warnedForExpiry = null;
  setInterval(() => {
    const grant = appStore.get().shell.elevatedGrant;
    if (!grant) return;
    const remainingMs = grant.expiresAt - Date.now();
    if (remainingMs <= 0) {
      releaseElevatedAccess();
      return;
    }
    if (remainingMs <= 10 * 60_000 && warnedForExpiry !== grant.expiresAt) {
      warnedForExpiry = grant.expiresAt;
      toast.warning(t('access.expiring.warn', { feature: grant.feature, remaining: formatRemaining(remainingMs, getLanguage()) }));
    }
    const el = sidebarSlot.parentElement?.querySelector('.elevated-chip__remaining');
    if (el) el.textContent = t('access.elevated.chip', { remaining: formatRemaining(remainingMs, getLanguage()) });
  }, 30_000);

  return { pageOutlet, render, palette };
}
