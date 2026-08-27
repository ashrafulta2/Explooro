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
  // Prompt 3.5: the runtime palette goes FIRST. Its default mount is synchronous, so putting it
  // ahead of the three awaits below is the difference between the shell wearing the right colours
  // immediately and wearing the CSS baseline for three round trips.
  await initTheme();

  // i18n loads before the first route mounts so pages never flash an untranslated frame — see
  // services/i18n.js. The static shell (data-i18n attributes in index.html) is scanned as part of
  // this same call.
  await initI18n();

  // Prompt 2.8: Proactive session bootstrap from HttpOnly refresh cookie.
  await initSession();

  // Prompt 3.2: Bootstrap live feature flags
  await initFeatureFlags();

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
        item.path !== '/saler/creative-studio' &&
        item.path !== '/admin/platform/modules' &&
        item.path !== '/admin/users' &&
        item.path !== '/admin/staff' &&
        item.path !== '/admin/roles' &&
        item.path !== '/admin/grants' &&
        item.path !== '/admin/approvals' &&
        item.path !== '/admin/security/audit' &&
        item.path !== '/admin/audit' &&
        item.path !== '/admin/platform/theme' &&
        item.path !== '/admin/theme' &&
        item.path !== '/admin/finance/payouts' &&
        item.path !== '/admin/cod-reconciliation' &&
        item.path !== '/admin/finance' &&
        item.path !== '/vault' &&
        item.path !== '/saler/vault' &&
        item.path !== '/supplier/vault' &&
        item.path !== '/checkout' &&
        item.path !== '/orders' &&
        item.path !== '/customer/orders' &&
        item.path !== '/customer/returns' &&
        item.path !== '/admin/returns' &&
        item.path !== '/admin/growth/campaigns' &&
        item.path !== '/admin/growth/coupons' &&
        item.path !== '/saler/referrals' &&
        item.path !== '/account/coins' &&
        item.path !== '/saler/quests' &&
        item.path !== '/saler/leaderboard' &&
        item.path !== '/account/team-purchases' &&
        item.path !== '/saler/cart-insights' &&
        item.path !== '/warranties' &&
        item.path !== '/account/warranties' &&
        item.path !== '/supplier/claims' &&
        item.path !== '/saler/bundles' &&
        item.path !== '/supplier/b2b-escrow' &&
        item.path !== '/saler/b2b-escrow' &&
        item.path !== '/admin/platform/api-keys' &&
        item.path !== '/admin/api-keys' &&
        item.path !== '/stories' &&
        item.path !== '/reels' &&
        item.path !== '/academy' &&
        item.path !== '/editor' &&
        item.path !== '/editor/translations' &&
        item.path !== '/supplier' &&
        item.path !== '/supplier/inventory' &&
        item.path !== '/supplier/batches' &&
        item.path !== '/supplier/warehouses' &&
        item.path !== '/supplier/fulfilment' &&
        item.path !== '/supplier/resellers' &&
        item.path !== '/saler' &&
        item.path !== '/saler/analytics' &&
        item.path !== '/account' &&
        item.path !== '/customer' &&
        item.path !== '/account/orders' &&
        item.path !== '/account/following' &&
        item.path !== '/account/become-saler' &&
        item.path !== '/admin' &&
        item.path !== '/admin/dashboard' &&
        item.path !== '/admin/health' &&
        item.path !== '/admin/system/health' &&
        item.path !== '/admin/restrictions' &&
        item.path !== '/admin/users/restrictions' &&
        item.path !== '/admin/catalog/products' &&
        item.path !== '/admin/products' &&
        item.path !== '/supplier/products' &&
        item.path !== '/saler/products'
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
      { path: '/products/:id', title: 'Product — Explooro', permission: null, module: 'core', load: () => import('./pages/ProductDetailPage.js') },
      // Prompt 4.8: real virtual storefront page replaces the Prompt 1.5 stub.
      { path: '/store/:slug', title: 'Store — Explooro', permission: null, module: 'virtual_storefront', load: () => import('./pages/StorefrontPage.js') },
      // Prompt 5.4: Checkout & Order Tracking Pages
      { path: '/checkout', title: 'Secure Checkout — Explooro', permission: null, module: 'core', load: () => import('./pages/CheckoutPage.js') },
      { path: '/orders', title: 'My Orders — Explooro', requiresAuth: true, permission: 'orders.order.view_own', module: 'core', load: () => import('./pages/customer/OrderDetailPage.js') },
      { path: '/customer/orders', title: 'My Orders — Explooro', requiresAuth: true, permission: 'orders.order.view_own', module: 'core', load: () => import('./pages/customer/OrderDetailPage.js') },
      { path: '/orders/:id', title: 'Order Details — Explooro', permission: null, module: 'core', load: () => import('./pages/customer/OrderDetailPage.js') },
      // Prompt 10.1: Live Stream Commerce
      { path: '/live', title: 'Live Broadcasts — Explooro', permission: null, module: 'live_commerce', load: () => import('./pages/LiveStreamPage.js') },
      { path: '/live/:id', title: 'Live Shopping — Explooro', permission: null, module: 'live_commerce', load: () => import('./pages/LiveStreamPage.js') },
      { path: '/saler/live-studio', title: 'Live Studio — Explooro', requiresAuth: true, permission: 'live.stream.host', module: 'live_commerce', load: () => import('./pages/saler/LiveStudioPage.js') },
      { path: '/supplier/live-studio', title: 'Live Studio — Explooro', requiresAuth: true, permission: 'live.stream.host', module: 'live_commerce', load: () => import('./pages/saler/LiveStudioPage.js') },
      { path: '/moderator/live', title: 'Live Moderation — Explooro', requiresAuth: true, permission: 'moderation.live.handle', module: 'live_commerce', load: () => import('./pages/LiveStreamPage.js') },
      // Prompt 4.7: Saler Sourcing Catalog & Profit Calculator
      {
        path: '/saler/sourcing',
        title: 'Sourcing Catalog — Explooro',
        requiresAuth: true,
        permission: 'saler.sourcing.view',
        module: 'sourcing',
        load: () => import('./pages/saler/SourcingCatalogPage.js'),
      },
      // Prompt 10.3: AI Creative Studio (ad copy generation)
      {
        path: '/saler/creative-studio',
        title: 'Creative Studio — Explooro',
        requiresAuth: true,
        permission: 'ai.creative.use',
        module: 'ai_creative_studio',
        load: () => import('./pages/saler/CreativeStudioPage.js'),
      },
      // Prompt 10.4: Digital Warranty & Claims Engine
      {
        path: '/warranties',
        title: 'Digital Warranties — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'digital_warranty',
        load: () => import('./pages/customer/WarrantyCardsPage.js'),
      },
      {
        path: '/account/warranties',
        title: 'Digital Warranties — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'digital_warranty',
        load: () => import('./pages/customer/WarrantyCardsPage.js'),
      },
      {
        path: '/customer/warranties',
        title: 'Digital Warranties — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'digital_warranty',
        load: () => import('./pages/customer/WarrantyCardsPage.js'),
      },
      {
        path: '/supplier/claims',
        title: 'Warranty Claims — Explooro',
        requiresAuth: true,
        permission: 'support.warranty.manage',
        module: 'digital_warranty',
        load: () => import('./pages/supplier/WarrantyClaimsPage.js'),
      },
      {
        path: '/supplier/warranty',
        title: 'Warranty Claims & Hub — Explooro',
        requiresAuth: true,
        permission: 'support.warranty.manage',
        module: 'digital_warranty',
        load: () => import('./pages/supplier/WarrantyClaimsPage.js'),
      },
      {
        path: '/supplier/warranties',
        title: 'Warranty Claims & Hub — Explooro',
        requiresAuth: true,
        permission: 'support.warranty.manage',
        module: 'digital_warranty',
        load: () => import('./pages/supplier/WarrantyClaimsPage.js'),
      },
      {
        path: '/supplier/warranty-claims',
        title: 'Warranty Claims — Explooro',
        requiresAuth: true,
        permission: 'support.warranty.manage',
        module: 'digital_warranty',
        load: () => import('./pages/supplier/WarrantyClaimsPage.js'),
      },
      // Prompt 10.5: Cross-Seller Bundling & Demand Surge Pricing
      {
        path: '/saler/bundles',
        title: 'Bundle Studio — Explooro',
        requiresAuth: true,
        permission: 'saler.bundle.manage',
        module: 'product_bundling',
        load: () => import('./pages/saler/BundleStudioPage.js'),
      },
      // Prompt 10.6: B2B Wholesale Escrow & Milestone Settlement
      {
        path: '/supplier/b2b-escrow',
        title: 'B2B Wholesale Escrow — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'b2b_escrow',
        load: () => import('./pages/supplier/B2bEscrowPage.js'),
      },
      {
        path: '/saler/b2b-escrow',
        title: 'B2B Wholesale Escrow — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'b2b_escrow',
        load: () => import('./pages/supplier/B2bEscrowPage.js'),
      },
      {
        path: '/b2b-escrow',
        title: 'B2B Wholesale Escrow — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'b2b_escrow',
        load: () => import('./pages/supplier/B2bEscrowPage.js'),
      },
      // Prompt 10.7: Open Marketplace API, Webhooks & Developer SDK
      {
        path: '/admin/platform/api-keys',
        title: 'Developer Portal & API Keys — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'open_api',
        load: () => import('./pages/admin/ApiKeysPage.js'),
      },
      {
        path: '/admin/api-keys',
        title: 'Developer Portal & API Keys — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'open_api',
        load: () => import('./pages/admin/ApiKeysPage.js'),
      },
      // Prompt 10.8: Content Commerce, Reels, Academy & Editor Dashboard
      {
        path: '/stories',
        title: 'Stories & UGC Feed — Explooro',
        permission: null,
        module: 'content_commerce',
        load: () => import('./pages/StoriesFeedPage.js'),
      },
      {
        path: '/reels',
        title: 'Shoppable Video Reels — Explooro',
        permission: null,
        module: 'content_commerce',
        load: () => import('./pages/ReelsPage.js'),
      },
      {
        path: '/academy',
        title: 'Seller Academy — Explooro',
        permission: null,
        module: 'seller_academy',
        load: () => import('./pages/AcademyPage.js'),
      },
      {
        path: '/editor',
        title: 'Editor Dashboard — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'core',
        load: () => import('./pages/editor/EditorDashboardPage.js'),
      },
      {
        path: '/editor/dashboard',
        title: 'Editor Dashboard — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'core',
        load: () => import('./pages/editor/EditorDashboardPage.js'),
      },
      {
        path: '/editor/translations',
        title: 'Localization & Translations — Explooro',
        requiresAuth: true,
        permission: 'content.i18n.update',
        module: 'i18n',
        load: () => import('./pages/editor/TranslationManagerPage.js'),
      },
      {
        path: '/admin/localization',
        title: 'Localization & Translations — Explooro',
        requiresAuth: true,
        permission: 'content.i18n.update',
        module: 'i18n',
        load: () => import('./pages/editor/TranslationManagerPage.js'),
      },
      // Prompt 11.1: Supplier / Manufacturer Dashboard & Operational Pages
      {
        path: '/supplier',
        title: 'Supplier Dashboard — Explooro',
        requiresAuth: true,
        permission: 'supplier.dashboard.view',
        module: 'core',
        load: () => import('./pages/supplier/SupplierDashboardPage.js'),
      },
      {
        path: '/supplier/dashboard',
        title: 'Supplier Dashboard — Explooro',
        requiresAuth: true,
        permission: 'supplier.dashboard.view',
        module: 'core',
        load: () => import('./pages/supplier/SupplierDashboardPage.js'),
      },
      {
        path: '/supplier/inventory',
        title: 'Live Stock & Inventory — Explooro',
        requiresAuth: true,
        permission: 'catalog.inventory.manage',
        module: 'core',
        load: () => import('./pages/supplier/InventoryPage.js'),
      },
      {
        path: '/supplier/batches',
        title: 'FEFO Batch Manager — Explooro',
        requiresAuth: true,
        permission: 'catalog.batch.manage',
        module: 'fefo_batches',
        load: () => import('./pages/supplier/BatchManagerPage.js'),
      },
      {
        path: '/supplier/warehouses',
        title: 'Multi-Location Warehouses — Explooro',
        requiresAuth: true,
        permission: 'catalog.warehouse.manage',
        module: 'multi_warehouse',
        load: () => import('./pages/supplier/WarehousePage.js'),
      },
      {
        path: '/supplier/warehouse',
        title: 'Multi-Location Warehouses — Explooro',
        requiresAuth: true,
        permission: 'catalog.warehouse.manage',
        module: 'multi_warehouse',
        load: () => import('./pages/supplier/WarehousePage.js'),
      },
      {
        path: '/supplier/fulfilment',
        title: 'Fulfilment Queue & Labels — Explooro',
        requiresAuth: true,
        permission: 'logistics.consignment.create',
        module: 'courier_hub',
        load: () => import('./pages/supplier/FulfilmentPage.js'),
      },
      {
        path: '/supplier/fulfillment',
        title: 'Fulfilment Queue & Labels — Explooro',
        requiresAuth: true,
        permission: 'logistics.consignment.create',
        module: 'courier_hub',
        load: () => import('./pages/supplier/FulfilmentPage.js'),
      },
      {
        path: '/supplier/shipping',
        title: 'Fulfilment Queue & Labels — Explooro',
        requiresAuth: true,
        permission: 'logistics.consignment.create',
        module: 'courier_hub',
        load: () => import('./pages/supplier/FulfilmentPage.js'),
      },
      {
        path: '/supplier/resellers',
        title: 'Reseller Network Insights — Explooro',
        requiresAuth: true,
        permission: 'supplier.analytics.view',
        module: 'core',
        load: () => import('./pages/supplier/ResellerInsightsPage.js'),
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
      // Prompt 11.2: Saler Dashboard & Analytics
      // WHY this is the only `/saler` entry: a Prompt-1.5 guard-demo stub was also registered at
      // this path, ~200 lines earlier. The router matches first-wins, so the stub shadowed the real
      // dashboard and every saler landing on /saler saw a permissions demo. That route and the stub
      // file (pages/dev/SalerDashboardStub.js) are both deleted now — keep /saler registered once.
      {
        path: '/saler',
        title: 'Saler Dashboard — Explooro',
        requiresAuth: true,
        permission: 'saler.dashboard.view',
        module: 'core',
        load: () => import('./pages/saler/SalerDashboardPage.js'),
      },
      {
        path: '/saler/dashboard',
        title: 'Saler Dashboard — Explooro',
        requiresAuth: true,
        permission: 'saler.dashboard.view',
        module: 'core',
        load: () => import('./pages/saler/SalerDashboardPage.js'),
      },
      {
        path: '/saler/orders',
        title: 'Customer Orders — Explooro',
        requiresAuth: true,
        permission: 'saler.order.view',
        module: 'core',
        load: () => import('./pages/customer/OrdersPage.js'),
      },
      {
        path: '/saler/orders/:id',
        title: 'Order Details — Explooro',
        requiresAuth: true,
        permission: 'saler.order.view',
        module: 'core',
        load: () => import('./pages/customer/OrderDetailPage.js'),
      },
      {
        path: '/saler/analytics',
        title: 'Sales & Profit Analytics — Explooro',
        requiresAuth: true,
        permission: 'saler.order.view',
        module: 'core',
        load: () => import('./pages/saler/AnalyticsPage.js'),
      },
      // Prompt 11.3: Customer Portal, Orders & Following Feed
      {
        path: '/account',
        title: 'My Account — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'core',
        load: () => import('./pages/customer/CustomerDashboardPage.js'),
      },
      {
        path: '/customer',
        title: 'Customer Dashboard — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'core',
        load: () => import('./pages/customer/CustomerDashboardPage.js'),
      },
      {
        path: '/account/orders',
        title: 'My Orders & Tracking — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'core',
        load: () => import('./pages/customer/OrdersPage.js'),
      },
      {
        path: '/account/following',
        title: 'Followed Stores Feed — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'follow_feed',
        load: () => import('./pages/customer/FollowingFeedPage.js'),
      },
      {
        path: '/account/become-saler',
        title: '1-Click Saler Upgrade — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'virtual_storefront',
        load: () => import('./pages/customer/CustomerDashboardPage.js'),
      },
      // Prompt 11.4: Super Admin Executive Dashboard & System Health
      {
        path: '/admin',
        title: 'Executive Analytics — Explooro Admin',
        requiresAuth: true,
        permission: 'admin.dashboard.view',
        module: 'core',
        load: () => import('./pages/admin/AdminDashboardPage.js'),
      },
      {
        path: '/admin/dashboard',
        title: 'Executive Analytics — Explooro Admin',
        requiresAuth: true,
        permission: 'admin.dashboard.view',
        module: 'core',
        load: () => import('./pages/admin/AdminDashboardPage.js'),
      },
      {
        path: '/admin/health',
        title: 'System Health & Diagnostics — Explooro Admin',
        requiresAuth: true,
        permission: 'system.health.view',
        module: 'core',
        load: () => import('./pages/admin/SystemHealthPage.js'),
      },
      {
        path: '/admin/system/health',
        title: 'System Health & Diagnostics — Explooro Admin',
        requiresAuth: true,
        permission: 'system.health.view',
        module: 'core',
        load: () => import('./pages/admin/SystemHealthPage.js'),
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
        path: '/admin/staff',
        title: 'Staff Management — Explooro',
        requiresAuth: true,
        permission: 'staff.account.view',
        module: 'core',
        load: () => import('./pages/admin/StaffPage.js'),
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
      {
        path: '/admin/restrictions',
        title: 'User Restrictions & Sanctions — Explooro',
        requiresAuth: true,
        permission: 'users.restriction.manage',
        module: 'core',
        load: () => import('./pages/admin/RestrictionsPage.js'),
      },
      {
        path: '/admin/users/restrictions',
        title: 'User Restrictions & Sanctions — Explooro',
        requiresAuth: true,
        permission: 'users.restriction.manage',
        module: 'core',
        load: () => import('./pages/admin/RestrictionsPage.js'),
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
      // Prompt 6.3: Admin Payout Queue
      {
        path: '/admin/finance/payouts',
        title: 'Payouts Queue — Explooro',
        requiresAuth: true,
        permission: 'finance.payout.approve',
        module: 'core',
        load: () => import('./pages/admin/PayoutQueuePage.js'),
      },
      {
        path: '/admin/payouts',
        title: 'Payouts Queue — Explooro',
        requiresAuth: true,
        permission: 'finance.payout.approve',
        module: 'core',
        load: () => import('./pages/admin/PayoutQueuePage.js'),
      },
      // Prompt 6.4: COD Reconciliation
      {
        path: '/admin/cod-reconciliation',
        title: 'COD Reconciliation — Explooro',
        requiresAuth: true,
        permission: 'orders.cod.reconcile',
        module: 'cod_reconciliation',
        load: () => import('./pages/admin/CodReconciliationPage.js'),
      },
      {
        path: '/admin/orders/cod-reconciliation',
        title: 'COD Reconciliation — Explooro',
        requiresAuth: true,
        permission: 'orders.cod.reconcile',
        module: 'cod_reconciliation',
        load: () => import('./pages/admin/CodReconciliationPage.js'),
      },
      {
        path: '/admin/finance/cod-reconciliation',
        title: 'COD Reconciliation — Explooro',
        requiresAuth: true,
        permission: 'orders.cod.reconcile',
        module: 'cod_reconciliation',
        load: () => import('./pages/admin/CodReconciliationPage.js'),
      },
      // Prompt 6.5: Vault & Finance Dashboard
      {
        path: '/vault',
        title: 'Vault & Earnings — Explooro',
        requiresAuth: true,
        permission: 'finance.payout.request',
        module: 'core',
        load: () => import('./pages/VaultPage.js'),
      },
      {
        path: '/saler/vault',
        title: 'Vault & Earnings — Explooro',
        requiresAuth: true,
        permission: 'finance.payout.request',
        module: 'core',
        load: () => import('./pages/VaultPage.js'),
      },
      {
        path: '/supplier/vault',
        title: 'Vault & Earnings — Explooro',
        requiresAuth: true,
        permission: 'finance.payout.request',
        module: 'core',
        load: () => import('./pages/VaultPage.js'),
      },
      {
        path: '/admin/finance',
        title: 'Finance Command Center — Explooro',
        requiresAuth: true,
        permission: 'finance.overview.view',
        module: 'core',
        load: () => import('./pages/admin/FinanceDashboardPage.js'),
      },
      // Prompt 7.2: Returns & Refunds
      {
        path: '/account/returns',
        title: 'My Returns — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'returns_engine',
        load: () => import('./pages/customer/ReturnsPage.js'),
      },
      {
        path: '/customer/orders/:id/return',
        title: 'Request Return — Explooro',
        requiresAuth: true,
        permission: 'orders.view',
        module: 'returns_engine',
        load: () => import('./pages/customer/ReturnRequestPage.js'),
      },
      {
        path: '/admin/returns',
        title: 'Returns Moderation Queue — Explooro',
        requiresAuth: true,
        permission: 'orders.return.review',
        module: 'returns_engine',
        load: () => import('./pages/admin/ReturnsQueuePage.js'),
      },
      {
        path: '/admin/returns/queue',
        title: 'Returns Moderation Queue — Explooro',
        requiresAuth: true,
        permission: 'orders.return.review',
        module: 'returns_engine',
        load: () => import('./pages/admin/ReturnsQueuePage.js'),
      },
      {
        path: '/moderator/returns',
        title: 'Returns Moderation Queue — Explooro',
        requiresAuth: true,
        permission: 'orders.return.review',
        module: 'returns_engine',
        load: () => import('./pages/admin/ReturnsQueuePage.js'),
      },
      // Prompt 7.3: Dispute Arbitration (Three-Way)
      {
        path: '/disputes',
        title: 'Dispute Arbitration — Explooro',
        requiresAuth: true,
        permission: 'orders.dispute.arbitrate',
        module: 'dispute_panel',
        load: () => import('./pages/moderator/DisputePanelPage.js'),
      },
      {
        path: '/disputes/:id',
        title: 'Dispute Arbitration — Explooro',
        requiresAuth: true,
        permission: 'orders.dispute.arbitrate',
        module: 'dispute_panel',
        load: () => import('./pages/moderator/DisputePanelPage.js'),
      },
      {
        path: '/moderator/disputes',
        title: 'Dispute Arbitration — Explooro',
        requiresAuth: true,
        permission: 'orders.dispute.arbitrate',
        module: 'dispute_panel',
        load: () => import('./pages/moderator/DisputePanelPage.js'),
      },
      {
        path: '/moderator/disputes/:id',
        title: 'Dispute Arbitration — Explooro',
        requiresAuth: true,
        permission: 'orders.dispute.arbitrate',
        module: 'dispute_panel',
        load: () => import('./pages/moderator/DisputePanelPage.js'),
      },
      {
        path: '/admin/disputes',
        title: 'Dispute Oversight — Explooro',
        requiresAuth: true,
        permission: 'orders.dispute.view_all',
        module: 'dispute_panel',
        load: () => import('./pages/moderator/DisputePanelPage.js'),
      },
      // Prompt 7.4: Product Approval & Content Moderation Pipeline
      {
        path: '/moderator/queue',
        title: 'Product & Content Moderation — Explooro',
        requiresAuth: true,
        permission: 'moderation.product.approve',
        module: 'product_moderation',
        load: () => import('./pages/moderator/ModerationQueuePage.js'),
      },
      {
        path: '/moderator/moderation-queue',
        title: 'Product & Content Moderation — Explooro',
        requiresAuth: true,
        permission: 'moderation.product.approve',
        module: 'product_moderation',
        load: () => import('./pages/moderator/ModerationQueuePage.js'),
      },
      {
        path: '/admin/catalog/moderation',
        title: 'Catalog Moderation — Explooro',
        requiresAuth: true,
        permission: 'moderation.product.approve',
        module: 'product_moderation',
        load: () => import('./pages/moderator/ModerationQueuePage.js'),
      },
      // Catalog & Products Governance
      {
        path: '/admin/catalog/products',
        title: 'Catalog & Products — Explooro Admin',
        requiresAuth: true,
        permission: 'catalog.product.view_all',
        module: 'core',
        load: () => import('./pages/admin/CatalogProductsPage.js'),
      },
      {
        path: '/admin/products',
        title: 'Catalog & Products — Explooro Admin',
        requiresAuth: true,
        permission: 'catalog.product.view_all',
        module: 'core',
        load: () => import('./pages/admin/CatalogProductsPage.js'),
      },
      {
        path: '/supplier/products',
        title: 'Supplier Inventory & Products — Explooro',
        requiresAuth: true,
        permission: 'catalog.product.manage_own',
        module: 'core',
        load: () => import('./pages/admin/CatalogProductsPage.js'),
      },
      {
        path: '/saler/products',
        title: 'Saler Store Products — Explooro',
        requiresAuth: true,
        permission: 'saler.store.manage',
        module: 'virtual_storefront',
        load: () => import('./pages/saler/StoreBuilderPage.js'),
      },
      // Prompt 7.5: KYC Verification, Blue-Tick & Trust Tiers
      {
        path: '/seller/kyc',
        title: 'KYC Identity Verification — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'supplier_verification',
        load: () => import('./pages/seller/KycSubmissionPage.js'),
      },
      {
        path: '/account/kyc',
        title: 'KYC Identity Verification — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'supplier_verification',
        load: () => import('./pages/seller/KycSubmissionPage.js'),
      },
      {
        path: '/admin/verification',
        title: 'KYC Verification Center — Explooro',
        requiresAuth: true,
        permission: 'users.kyc.approve',
        module: 'supplier_verification',
        load: () => import('./pages/admin/VerificationCenterPage.js'),
      },
      {
        path: '/admin/users/verification',
        title: 'KYC Verification Center — Explooro',
        requiresAuth: true,
        permission: 'users.kyc.approve',
        module: 'supplier_verification',
        load: () => import('./pages/admin/VerificationCenterPage.js'),
      },
      {
        path: '/moderator/kyc',
        title: 'KYC Verification Center — Explooro',
        requiresAuth: true,
        permission: 'users.kyc.approve',
        module: 'supplier_verification',
        load: () => import('./pages/admin/VerificationCenterPage.js'),
      },
      // Prompt 7.6: Moderator Dashboard
      {
        path: '/moderator',
        title: 'Moderator Dashboard — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'product_moderation',
        load: () => import('./pages/moderator/ModeratorDashboardPage.js'),
      },
      {
        path: '/moderator/dashboard',
        title: 'Moderator Dashboard — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'product_moderation',
        load: () => import('./pages/moderator/ModeratorDashboardPage.js'),
      },
      // Prompt 8.2: Notification Preferences
      {
        path: '/settings/notifications',
        title: 'Notification Preferences — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'core',
        load: () => import('./pages/settings/NotificationPreferencesPage.js'),
      },
      // Prompt 8.3: WhatsApp & Messenger Unified Inbox
      {
        path: '/saler/inbox',
        title: 'Unified Commerce Inbox — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'whatsapp_bridge',
        load: () => import('./pages/saler/UnifiedInboxPage.js'),
      },
      // Prompt 8.4: Real-Time Chat Interface
      {
        path: '/chat',
        title: 'Chat & Messages — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'chat',
        load: () => import('./pages/ChatPage.js'),
      },
      // Prompt 9.1: In-Platform Sponsored Ads Engine
      {
        path: '/saler/ads',
        title: 'Sponsored Ads Manager — Explooro',
        requiresAuth: true,
        permission: 'growth.ad.manage_own',
        module: 'sponsored_ads',
        load: () => import('./pages/saler/AdCampaignPage.js'),
      },
      // Prompt 9.2: Coupons, Vouchers & Flash Sale Campaigns
      {
        path: '/admin/growth/campaigns',
        title: 'Campaign & Flash Sale Manager — Explooro',
        requiresAuth: true,
        permission: 'growth.campaign.manage',
        module: 'flash_sale',
        load: () => import('./pages/admin/CampaignManagerPage.js'),
      },
      {
        path: '/admin/growth/coupons',
        title: 'Coupon & Voucher Manager — Explooro',
        requiresAuth: true,
        permission: 'growth.coupon.manage',
        module: 'coupons',
        load: () => import('./pages/admin/CampaignManagerPage.js'),
      },
      {
        path: '/editor/campaigns',
        title: 'Visual Banner & Campaign Studio — Explooro',
        requiresAuth: true,
        permission: 'growth.campaign.manage',
        module: 'flash_sale',
        load: () => import('./pages/admin/CampaignManagerPage.js'),
      },
      {
        path: '/campaigns',
        title: 'Campaign & Promotion Manager — Explooro',
        requiresAuth: true,
        permission: 'growth.campaign.manage',
        module: 'flash_sale',
        load: () => import('./pages/admin/CampaignManagerPage.js'),
      },
      // Prompt 9.3: Multi-Tier Referral & Network Growth Engine
      {
        path: '/saler/referrals',
        title: 'Referral & Network Growth — Explooro',
        requiresAuth: true,
        permission: 'growth.referral.view_own',
        module: 'referral_engine',
        load: () => import('./pages/saler/ReferralHubPage.js'),
      },
      // Prompt 9.4: Loyalty Coins, Daily Quests & Leaderboard
      {
        path: '/account/coins',
        title: 'Loyalty Coins & Rewards — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'loyalty_coins',
        load: () => import('./pages/customer/CoinsPage.js'),
      },
      {
        path: '/coins',
        title: 'Loyalty Coins & Rewards — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'loyalty_coins',
        load: () => import('./pages/customer/CoinsPage.js'),
      },
      {
        path: '/saler/quests',
        title: 'Daily & Weekly Quests — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'daily_quests',
        load: () => import('./pages/customer/CoinsPage.js'),
      },
      {
        path: '/saler/leaderboard',
        title: 'Seller Leaderboard — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'gamification',
        load: () => import('./pages/customer/CoinsPage.js'),
      },
      // Prompt 9.5: Social Group Buying (Team Purchase)
      {
        path: '/team/:id',
        title: 'Join Team Purchase — Explooro',
        requiresAuth: false,
        permission: null,
        module: 'group_buying',
        load: () => import('./pages/TeamPurchasePage.js'),
      },
      {
        path: '/account/team-purchases',
        title: 'My Team Purchases — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'group_buying',
        load: () => import('./pages/TeamPurchasePage.js'),
      },
      // Prompt 9.6: Abandoned Cart Recovery & Insights
      {
        path: '/saler/cart-insights',
        title: 'Cart Recovery Insights — Explooro',
        requiresAuth: true,
        permission: null,
        module: 'cart_recovery',
        load: () => import('./pages/saler/CartInsightsPage.js'),
      },
      {
        path: '/cart/recover/:token',
        title: 'Restoring Cart — Explooro',
        requiresAuth: false,
        permission: null,
        module: 'cart_recovery',
        load: () => import('./pages/CheckoutPage.js'),
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

// Prompt 11.6: PWA, Service Worker, Offline Resilience & Install Prompt
import { registerServiceWorker } from './sw.js';
import { initOfflineBanner } from './services/offlineQueue.js';
import { initPwaInstallPrompt } from './components/pwa/PwaInstallPrompt.js';

registerServiceWorker();
initOfflineBanner();
initPwaInstallPrompt();

// Re-check on HMR so the panel stays truthful while the server restarts under --watch.
if (import.meta.hot) {
  import.meta.hot.accept();
}

