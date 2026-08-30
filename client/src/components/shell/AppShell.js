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
import { appStore, releaseElevatedAccess } from '../../state/appStore.js';
import { subscribe as subscribeLang, getLanguage, t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Sidebar } from './Sidebar.js';
import { TopBar, formatRemaining } from './TopBar.js';
import { MobileNav } from './MobileNav.js';
import { createCommandPalette } from './CommandPalette.js';
import { CartDrawer } from '../cart/CartDrawer.js';
import { initCart } from '../../services/cart.js';

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
    return { permissions: s.auth.permissions, modules: s.modules, badges: s.badges };
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

  function render() {
    const s = appStore.get();
    if (!s.auth.isAuthenticated || !s.auth.role) {
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
      elevatedGrant: s.shell.elevatedGrant,
      badges: s.badges,
      navigate,
      onOpenPalette: () => palette.open(),
    });
    mobileNavSlot.replaceChildren(
      MobileNav({ role: s.auth.role, ctx, currentPath, navigate, collapsedGroups: s.shell.collapsedGroups })
    );
  }

  appStore.subscribe(render);
  subscribeLang(render);
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
