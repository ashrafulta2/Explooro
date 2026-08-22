/**
 * Explooro web client — entrypoint.
 *
 * index.html now contains ONLY the #router-outlet div. The AppShell (sidebar + topbar +
 * page outlet) mounts there. The old dev-harness scaffold (design-token ramps, typography
 * specimens, static router-demo section) has been removed from index.html as part of
 * Prompt 4.5's "make the site look like a real site" pass — all those specimens are still
 * available at /dev/gallery in development builds.
 */

// Prompt 1.1/1.2 — design tokens, reset, and typography. main.css enforces the load-bearing
// import order (tokens -> themes -> reset -> typography -> components -> utilities).
import './styles/main.css';

// Prompt 1.5 — router, store, api-client.
import { createRouter } from './core/router.js';
import { appStore } from './state/appStore.js';

// Prompt 1.6 — i18n.
import { initI18n, t, subscribe as subscribeLang } from './services/i18n.js';

// Prompt 2.8 — real session and permission service.
import { initSession } from './services/session.js';

// Prompt 3.2 — live feature flags and DOM module scanner.
import { initFeatureFlags, scanDomForModuleGates } from './services/featureFlags.js';

// Prompt 3.5 — runtime theme engine.
import { initTheme } from './services/themePalette.js';

// Prompt 1.7 — role-aware shell.
import { navItems } from './config/navigation.js';
import { createAppShell } from './components/shell/AppShell.js';

// ── Dev-only status bar (shown only if there is an error / connection issue) ──
if (import.meta.env.DEV) {
  const bar = document.getElementById('dev-status-bar');
  const apiEl = document.getElementById('api-status');
  const proxyEl = document.getElementById('proxy-status');
  const modeEl = document.getElementById('api-mode');
  const outlet = document.getElementById('router-outlet');

  const showBar = (apiMsg, proxyMsg) => {
    if (bar) {
      bar.style.display = 'flex';
      if (outlet) outlet.style.paddingTop = '22px';
    }
    if (modeEl) modeEl.textContent = import.meta.env.VITE_API_MODE ?? 'mock';
    if (apiEl) apiEl.textContent = apiMsg;
    if (proxyEl) proxyEl.textContent = proxyMsg;
  };

  const hideBar = () => {
    if (bar) {
      bar.style.display = 'none';
      if (outlet) outlet.style.paddingTop = '0';
    }
  };

  fetch('/api/v1/health', { headers: { Accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) {
        showBar(`HTTP ${res.status}`, 'error');
      } else {
        const body = await res.json().catch(() => ({}));
        if (body.status && body.status !== 'ok') {
          showBar(body.status, 'reachable');
        } else {
          hideBar();
        }
      }
    })
    .catch(() => {
      showBar('unreachable', 'no response');
    });
}

/* -------------------------------------------------------------------------
 * Prompt 1.5 & 2.8 — router bootstrap.
 * ---------------------------------------------------------------------- */

const routerOutlet = document.getElementById('router-outlet');

async function bootRouterDemo() {
  // i18n loads before the first route mounts so pages never flash an untranslated frame — see
  // services/i18n.js. The static shell (data-i18n attributes in index.html) is scanned as part of
  // this same call.
  await initI18n();

  // Prompt 2.8: Proactive session bootstrap from HttpOnly refresh cookie.
  await initSession();

  // Prompt 3.2: Bootstrap live feature flags
  await initFeatureFlags();

  // Prompt 3.5: Bootstrap runtime theme palette
  await initTheme();

  // AppShell needs `navigate` before the router that provides it exists (the router, in turn,
  // needs AppShell's `pageOutlet` as its mount root) — a proxy breaks the cycle. Every real call
  // happens from a user interaction well after `router` is assigned below.
  let router = null;
  const navigate = (path, opts) => router?.navigate(path, opts);

  const appShell = createAppShell({ container: routerOutlet, navigate });

  // Prompt 1.7: every navigation.js item gets a real route. All ~115 of them lazy-load the same
  // generic placeholder (RoleStubPage — Phase 2+ replaces each with its actual page); the point
  // for THIS prompt is that the sidebar/palette/mobile-nav's permission+module guards are real,
  // not that every feature page exists yet. `/saler` keeps its richer Prompt-1.5 stub.
  const stubRoutes = navItems
    .filter(
      (item) =>
        item.path !== '/saler' &&
        item.path !== '/saler/sourcing' &&
        item.path !== '/saler/store-builder' &&
        item.path !== '/admin/platform/modules' &&
        item.path !== '/admin/users' &&
        item.path !== '/admin/roles' &&
        item.path !== '/admin/grants' &&
        item.path !== '/admin/approvals' &&
        item.path !== '/admin/security/audit' &&
        item.path !== '/admin/audit' &&
        item.path !== '/admin/platform/theme' &&
        item.path !== '/admin/theme' &&
        item.path !== '/checkout' &&
        item.path !== '/orders' &&
        item.path !== '/customer/orders'
    )
    .map((item) => ({
      path: item.path,
      title: `${t(item.label_i18n_key)} — Explooro`,
      requiresAuth: true,
      permission: item.permission,
      module: item.module,
      load: () => import('./pages/dev/RoleStubPage.js'),
    }));

  router = createRouter({
    root: appShell.pageOutlet,
    loginPath: '/login',
    routes: [
      // Prompt 4.5: real marketplace home replaces the Prompt 1.5 stub.
      { path: '/', title: 'Explooro — Marketplace', permission: null, module: 'core', load: () => import('./pages/HomePage.js') },
      // Prompt 4.6: real product detail page replaces the Prompt 1.5 stub.
      { path: '/product/:id', title: 'Product — Explooro', permission: null, module: 'core', load: () => import('./pages/ProductDetailPage.js') },
      // Prompt 4.8: real virtual storefront page replaces the Prompt 1.5 stub.
      { path: '/store/:slug', title: 'Store — Explooro', permission: null, module: 'virtual_storefront', load: () => import('./pages/StorefrontPage.js') },
      // Prompt 5.4: Checkout & Order Tracking Pages
      { path: '/checkout', title: 'Secure Checkout — Explooro', permission: null, module: 'core', load: () => import('./pages/CheckoutPage.js') },
      { path: '/orders', title: 'My Orders — Explooro', requiresAuth: true, permission: 'orders.order.view_own', module: 'core', load: () => import('./pages/customer/OrderDetailPage.js') },
      { path: '/customer/orders', title: 'My Orders — Explooro', requiresAuth: true, permission: 'orders.order.view_own', module: 'core', load: () => import('./pages/customer/OrderDetailPage.js') },
      { path: '/orders/:id', title: 'Order Details — Explooro', permission: null, module: 'core', load: () => import('./pages/customer/OrderDetailPage.js') },
      {
        path: '/saler',
        title: 'Saler Dashboard — Explooro',
        requiresAuth: true,
        permission: 'saler.dashboard.view',
        module: 'core',
        load: () => import('./pages/dev/SalerDashboardStub.js'),
      },
      // Prompt 4.7: Saler Sourcing Catalog & Profit Calculator
      {
        path: '/saler/sourcing',
        title: 'Sourcing Catalog — Explooro',
        requiresAuth: true,
        permission: 'saler.sourcing.view',
        module: 'sourcing',
        load: () => import('./pages/saler/SourcingCatalogPage.js'),
      },
      // Prompt 4.8: Saler Virtual Storefront Builder
      {
        path: '/saler/store-builder',
        title: 'Store Builder — Explooro',
        requiresAuth: true,
        permission: 'saler.store.manage',
        module: 'virtual_storefront',
        load: () => import('./pages/saler/StoreBuilderPage.js'),
      },
      // Prompt 2.8: Real Auth Pages
      { path: '/login', title: 'Sign In — Explooro', permission: null, module: 'core', load: () => import('./pages/auth/LoginPage.js') },
      { path: '/auth/login', title: 'Sign In — Explooro', permission: null, module: 'core', load: () => import('./pages/auth/LoginPage.js') },
      { path: '/auth/register', title: 'Register — Explooro', permission: null, module: 'core', load: () => import('./pages/auth/RegisterPage.js') },
      { path: '/auth/otp', title: 'Verify OTP — Explooro', permission: null, module: 'core', load: () => import('./pages/auth/OtpPage.js') },
      { path: '/auth/2fa', title: 'Staff 2FA — Explooro', permission: null, module: 'core', load: () => import('./pages/auth/TwoFactorPage.js') },
      // Prompt 3.2: Module Control Panel
      {
        path: '/admin/platform/modules',
        title: 'Module Control — Explooro',
        requiresAuth: true,
        permission: 'platform.module.view',
        module: 'core',
        load: () => import('./pages/admin/ModuleControlPage.js'),
      },
      {
        path: '/admin/modules',
        title: 'Module Control — Explooro',
        requiresAuth: true,
        permission: 'platform.module.view',
        module: 'core',
        load: () => import('./pages/admin/ModuleControlPage.js'),
      },
      // Prompt 3.3: Users & Access Admin Pages
      {
        path: '/admin/users',
        title: 'Users & Accounts — Explooro',
        requiresAuth: true,
        permission: 'users.account.view',
        module: 'core',
        load: () => import('./pages/admin/UsersPage.js'),
      },
      {
        path: '/admin/users/:id',
        title: 'User Details — Explooro',
        requiresAuth: true,
        permission: 'users.account.view',
        module: 'core',
        load: () => import('./pages/admin/UserDetailPage.js'),
      },
      {
        path: '/admin/roles',
        title: 'Roles & Permissions — Explooro',
        requiresAuth: true,
        permission: 'staff.role.assign',
        module: 'core',
        load: () => import('./pages/admin/RolesPermissionsPage.js'),
      },
      {
        path: '/admin/grants',
        title: 'Standing Access Grants — Explooro',
        requiresAuth: true,
        permission: 'users.permission.grant',
        module: 'core',
        load: () => import('./pages/admin/AccessGrantsPage.js'),
      },
      {
        path: '/admin/approvals',
        title: 'Approval Inbox — Explooro',
        requiresAuth: true,
        permission: 'admin.approval.decide',
        module: 'core',
        load: () => import('./pages/admin/ApprovalInboxPage.js'),
      },
      // Prompt 3.4: Audit Explorer
      {
        path: '/admin/security/audit',
        title: 'Audit Explorer — Explooro',
        requiresAuth: true,
        permission: 'security.audit.view',
        module: 'core',
        load: () => import('./pages/admin/AuditLogPage.js'),
      },
      {
        path: '/admin/audit',
        title: 'Audit Explorer — Explooro',
        requiresAuth: true,
        permission: 'security.audit.view',
        module: 'core',
        load: () => import('./pages/admin/AuditLogPage.js'),
      },
      // Prompt 3.5: Theme & Color Studio
      {
        path: '/admin/platform/theme',
        title: 'Theme & Color Studio — Explooro',
        requiresAuth: true,
        permission: 'platform.theme.view',
        module: 'core',
        load: () => import('./pages/admin/ThemeStudioPage.js'),
      },
      {
        path: '/admin/theme',
        title: 'Theme & Color Studio — Explooro',
        requiresAuth: true,
        permission: 'platform.theme.view',
        module: 'core',
        load: () => import('./pages/admin/ThemeStudioPage.js'),
      },
      { path: '/dev/shell', title: 'Shell Preview — Explooro (dev)', permission: null, module: 'core', load: () => import('./pages/dev/DevShellSwitcher.js') },
      // Prompt 1.8: DEV-only.
      ...(import.meta.env.DEV
        ? [
            {
              path: '/dev/gallery',
              title: 'Component Gallery — Explooro (dev)',
              permission: null,
              module: 'core',
              load: () => import('./pages/dev/GalleryPage.js'),
            },
            {
              path: '/dev/craft',
              title: 'Craft Audit — Explooro (dev)',
              permission: null,
              module: 'core',
              load: () => import('./pages/dev/CraftAuditPage.js'),
            },
          ]
        : []),
      ...stubRoutes,
    ],
    notFound: { load: () => import('./pages/dev/NotFoundStub.js') },
    getAuthContext: () => ({ ...appStore.get().auth, modules: appStore.get().modules }),
    // Keeps Sidebar/MobileNav's active-item highlight correct after every navigation and scans DOM module gates
    beforeEach: () => {
      appShell.render();
      scanDomForModuleGates();
    },
  });

  // api.js dispatches this after a 401 it could not refresh past (see core/api.js).
  window.addEventListener('explooro:auth-required', () => {
    router.navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
  });

  // Prompt 1.6 ACCEPTANCE: "switching language updates every visible string instantly, no
  // reload". The static shell re-renders itself (i18n.js's setLanguage scans data-i18n nodes);
  // the router outlet re-mounts the current page in place — no history entry, no scroll jump.
  // AppShell subscribes to language changes itself for the sidebar/topbar/mobile-nav chrome.
  subscribeLang(() => router.refresh());

  router.start();
}

if (routerOutlet) {
  bootRouterDemo();
}

// Prompt 1.9: Dev-only in-page accessibility auditor and floating badge.
// import.meta.env.DEV is a compile-time constant dead-code-eliminated in production builds.
if (import.meta.env.DEV) {
  import('./dev/a11y-audit.js').then(({ initA11yAudit }) => {
    initA11yAudit();
  });
}

// Re-check on HMR so the panel stays truthful while the server restarts under --watch.
if (import.meta.hot) {
  import.meta.hot.accept();
}

