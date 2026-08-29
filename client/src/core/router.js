/**
 * router.js — hash-free History API router.
 *
 * Responsibility: URL <-> page with zero full-page reloads (Prompt 1.5 ACCEPTANCE). Route
 * matching, guards, lazy loading and scroll restoration are hand-rolled — no external dependency
 * (Dependency Policy §1) — because a router is exactly the place a third-party abstraction would
 * fight the module/permission guard system the rest of the app is built on.
 *
 * Route shape:
 *   {
 *     path: '/product/:id/:slug?',   // ':param' required; ':param?' optional (last segment only)
 *     title: 'Product — Explooro',   // optional, sets document.title before mount
 *     requiresAuth: false,
 *     permission: null,              // REQUIRED field (null = none). Checked against ctx.permissions
 *     module: 'core',                // REQUIRED field ('core' = always on). Checked against ctx.modules
 *     load: () => import('../pages/ProductDetailPage.js'),
 *   }
 *
 * `permission` and `module` must be present on every route — even as an explicit `null`/`'core'` —
 * or `createRouter()` throws at construction. docs/ia-sitemap.md §1 (closing note): "Every one of
 * [~120 routes] has an explicit perm and module value. A route added later without both is a
 * defect that Prompt 1.5's router guard must reject at registration time." The `notFound` route is
 * exempt — it is not a feature a permission or module could gate.
 *
 * Page module contract — the dynamic import's default export:
 *   (container, { params, query, navigate }) => (cleanup?: () => void)
 * `cleanup` runs before the next route mounts, so a page's timers/listeners never leak.
 */

/** Matches `pathname` against a route `pattern`, returning `null` or the extracted params. */
export function matchPath(pattern, pathname) {
  const paramNames = [];
  const segments = pattern
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (seg.startsWith(':')) {
        const optional = seg.endsWith('?');
        paramNames.push(optional ? seg.slice(1, -1) : seg.slice(1));
        return optional ? '(?:/([^/]+))?' : '/([^/]+)';
      }
      return `/${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
    });

  const regex = new RegExp(`^${segments.join('') || '/'}$`);
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const match = regex.exec(normalized || '/');
  if (!match) return null;

  const params = {};
  paramNames.forEach((name, i) => {
    if (match[i + 1] !== undefined) params[name] = decodeURIComponent(match[i + 1]);
  });
  return params;
}

export function parseQuery(search) {
  return Object.fromEntries(new URLSearchParams(search));
}

function hasPermission(ctx, key) {
  return !key || (ctx.permissions ?? []).includes(key);
}

function hasModule(ctx, key) {
  return !key || key === 'core' || ctx.modules?.[key] === true;
}

export function createRouter({
  root,
  routes,
  notFound,
  beforeEach,
  getAuthContext = () => ({ isAuthenticated: false, permissions: [], modules: {} }),
  onGuardFail,
  loginPath = '/login',
} = {}) {
  if (!root) throw new Error('createRouter requires a root element');
  if (!notFound) throw new Error('createRouter requires a notFound route');

  for (const route of routes) {
    if (!('permission' in route)) {
      throw new Error(
        `Route "${route.path}" is missing an explicit "permission" field (use null for "none required"). ` +
          'See docs/ia-sitemap.md §1 closing note.'
      );
    }
    if (!('module' in route)) {
      throw new Error(
        `Route "${route.path}" is missing an explicit "module" field (use 'core' for "always available"). ` +
          'See docs/ia-sitemap.md §1 closing note.'
      );
    }
  }

  let current = null; // { cleanup, key }
  const scrollPositions = new Map();

  function findRoute(pathname) {
    for (const route of routes) {
      const params = matchPath(route.path, pathname);
      if (params) return { route, params };
    }
    return null;
  }

  function guardFailure(route, ctx) {
    if (route.requiresAuth && !ctx.isAuthenticated) return 'auth';
    if (route.permission && !hasPermission(ctx, route.permission)) return 'permission';
    if (route.module && !hasModule(ctx, route.module)) return 'module';
    return null;
  }

  async function render(pathname, search, { key, isPopstate = false, preserveScroll = false } = {}) {
    const matched = findRoute(pathname);
    const ctx = getAuthContext();

    if (matched) {
      const reason = guardFailure(matched.route, ctx);
      if (reason) {
        const fallback = reason === 'auth' ? `${loginPath}?redirect=${encodeURIComponent(pathname)}` : '/';
        const dest = onGuardFail?.(reason, matched.route, ctx) ?? fallback;
        navigate(dest, { replace: true });
        return;
      }
    }

    if (current) {
      scrollPositions.set(current.key, window.scrollY);
      current.cleanup?.();
    }

    const { route, params } = matched ?? { route: notFound, params: {} };
    const query = parseQuery(search);

    beforeEach?.({ path: pathname, route, params, query });
    document.title = route.title ?? 'Explooro';

    root.replaceChildren();
    const mod = await route.load();
    if (typeof mod.default !== 'function') {
      throw new Error(
        `Route "${route.path}" loaded a module with no callable default export. A page module must ` +
          'default-export `(container, ctx) => cleanup?` — see the "Page module contract" note above.'
      );
    }
    const result = mod.default(root, { params, query, navigate });
    // WHY: a page that returns something else (an element it built but never mounted, a promise)
    // used to be stored as `cleanup` and then *called* on the next navigation — throwing mid-render
    // and wedging the router for the rest of the session. Only a function is a cleanup.
    current = { cleanup: typeof result === 'function' ? result : null, key };

    if (!preserveScroll) window.scrollTo(0, isPopstate ? scrollPositions.get(key) ?? 0 : 0);
  }

  /** Re-mounts the current route in place — no history entry, no scroll jump. For a language
   * switch or any other "the page content changed, the URL didn't" re-render. */
  function refresh() {
    if (!current) return;
    return render(window.location.pathname, window.location.search, { key: current.key, preserveScroll: true });
  }

  function navigate(path, { replace = false } = {}) {
    const url = new URL(path, window.location.origin);
    const key = crypto.randomUUID();
    // `idx` is the depth of this entry in the session's history stack — a push deepens it, a
    // replace keeps it. core/navBack.js reads it to decide between history.back() and a fallback
    // route. The browser persists history.state across reloads, so it survives a refresh.
    const currentIdx = history.state?.idx ?? 0;
    const state = { __routerKey: key, idx: replace ? currentIdx : currentIdx + 1 };
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
    return render(url.pathname, url.search, { key });
  }

  function onPopState() {
    const key = history.state?.__routerKey ?? crypto.randomUUID();
    render(window.location.pathname, window.location.search, { key, isPopstate: true });
  }

  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    if (anchor.dataset.external !== undefined) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  }

  function start() {
    if (!history.state) {
      history.replaceState({ __routerKey: crypto.randomUUID(), idx: 0 }, '', window.location.href);
    } else if (history.state.idx == null) {
      // Entry predates idx tracking (or was pushed by something other than navigate()) — seed it
      // so navBack has a baseline without clobbering the router key.
      history.replaceState({ ...history.state, idx: 0 }, '', window.location.href);
    }
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick);
    return render(window.location.pathname, window.location.search, { key: history.state.__routerKey });
  }

  function stop() {
    window.removeEventListener('popstate', onPopState);
    document.removeEventListener('click', onClick);
  }

  return { start, stop, navigate, refresh };
}
