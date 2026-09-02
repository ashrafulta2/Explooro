/**
 * appStore.js — the one shared client-side session/UI store.
 *
 * Responsibility: mocked auth (role + granted permissions), module-enabled map, and shell UI state
 * (sidebar collapse, Simple/Advanced mode, an elevated-access grant) — everything the router's
 * guards, the shell components, and the command palette read. Deliberately not persisted: per
 * docs/api-contract.md §8 auth state belongs in memory only, and there is no real session yet
 * (Prompt 2.1+) for any of this to be "per user" rather than per browser tab.
 *
 * `setMockRole()` is Prompt 1.7's role switcher (PREVIEW: "a role switcher ... lets the developer
 * preview all six role shells live"). It grants every permission the role holds BY DEFAULT
 * (config/permissions.mock.js, sourced from docs/permission-catalog.json) minus a couple of
 * `DEMO_WITHHELD` keys per role — so the sidebar shows the real Prompt-1.7 locked-item states
 * (ia-sitemap.md §5.1) rather than either "everything unlocked" or "everything locked".
 */
import { createStore } from '../core/store.js';
import { defaultPermissionsForRole } from '../config/permissions.mock.js';

// One MEDIUM/HIGH (delegable — shows "Request access") and one CRITICAL (not delegable — no
// affordance) withheld permission per role that actually appears in navigation.js, so both
// locked-state branches in ia-sitemap.md §5.1 are visible without an all-or-nothing demo.
//
// Only super_admin, moderator, and editor get one: every Supplier/Saler/Customer nav item checked
// against docs/permission-catalog.json turned out to be LOW tier — self-scoped "manage_own" /
// "view_own" actions are LOW by design, always granted with the role. Withholding one of those
// would demo a state the real permission model never produces. Risk tiers above LOW concentrate
// in admin/moderator/editor domains, which is where delegation actually matters.
const DEMO_WITHHELD = {
  super_admin: ['users.kyc.approve', 'staff.role.assign'],
  admin: ['users.kyc.approve'],
  moderator: ['moderation.live.handle'],
  editor: ['content.announcement.publish'],
  supplier: [],
  saler: [],
  customer: [],
};

// Every module key navigation.js references, enabled by default. Two are OFF so the "module
// disabled -> hidden entirely" branch of ia-sitemap.md §5.1 (distinct from the locked-but-visible
// branch above) is also demonstrated live, per Prompt 1.7 ACCEPTANCE.
const DEMO_MODULES = {
  core: true,
  product_moderation: true,
  fefo_batches: true,
  multi_warehouse: true,
  returns_engine: true,
  dispute_panel: true,
  courier_hub: true,
  cod_reconciliation: true,
  escrow_engine: true,
  b2b_escrow: true,
  subscription_fees: true,
  sponsored_ads: true,
  coupons: true,
  flash_sale: true,
  referral_engine: true,
  loyalty_coins: true,
  daily_quests: true,
  group_buying: true,
  content_commerce: true,
  seller_academy: true,
  whats_new: true,
  i18n: true,
  live_commerce: true,
  theme_studio: true,
  open_api: true,
  review_integrity: true,
  ugc_video_wall: true,
  user_reports: true,
  ai_forecasting: false, // OFF — hides supplier.forecasting entirely (module-disabled demo)
  digital_warranty: true,
  chat: true,
  physical_shop_status: true,
  virtual_storefront: true,
  sourcing: true,
  product_bundling: true,
  ai_creative_studio: true,
  social_seller_kit: true,
  gamification: false, // OFF — hides saler.leaderboard entirely (module-disabled demo)
  whatsapp_bridge: true,
  wishlist: true,
  follow_feed: true,
  cart_recovery: true,
  // Prompt 4.6: gates the "1-Click Quick Buy" CTA on ProductDetailPage.js. Not referenced by any
  // navigation.js item (it's a product-detail affordance, not a nav entry) — added here anyway so
  // the comment above ("every module key navigation.js references") is now slightly stale for this
  // one key; every OTHER key in this object still is.
  quick_buy: true,
  // WHY: Prompt 7.5's KYC routes (/admin/verification, /admin/users/verification, /moderator/kyc,
  // /seller/kyc, /account/kyc) declare `module: 'supplier_verification'`, but the key was never
  // added here. core/router.js's hasModule() is strict — `ctx.modules[key] === true`, an absent
  // key is NOT "enabled by default" the way featureFlags.js's isFeatureEnabled() treats it — so
  // all five routes failed their module guard and silently redirected to `/`. In mock mode nothing
  // ever repairs this: initFeatureFlags() fetches GET /modules, mocks/index.js has no handler for
  // that path, and the 404 lands in the catch that falls back to exactly this object.
  // client/test/moduleGates.test.js asserts every route module key has an entry here.
  supplier_verification: true,
};

// Mock "live" badge counts (real ones come from list endpoints in Phase 2+) — wires up the
// ⁽ᵇᵃᵈᵍᵉ⁾ items ia-sitemap.md §2 marks per role, so Sidebar/TopBar/MobileNav have something to
// show without inventing a badge system this early.
const DEMO_BADGES = {
  approvals: 3,
  catalog_moderation: 12,
  disputes: 2,
  reports: 5,
  payouts: 1,
  cart: 2,
  saler_orders: 4,
  supplier_orders: 6,
};

export const appStore = createStore({
  auth: { isAuthenticated: false, role: null, permissions: [] },
  modules: DEMO_MODULES,
  badges: DEMO_BADGES,
  shell: {
    sidebarCollapsed: false,
    collapsedGroups: [],
    uiMode: { saler: 'simple', supplier: 'simple' },
    elevatedGrant: null, // { feature, permission, expiresAt } while a JIT window is active
  },
});

/** Prompt 1.7's role switcher — logs in as the mocked role's default user for shell preview. */
export function setMockRole(role) {
  const withheld = new Set(DEMO_WITHHELD[role] ?? []);
  const permissions = defaultPermissionsForRole(role).filter((key) => !withheld.has(key));
  appStore.update({ auth: { isAuthenticated: true, role, permissions } });
}

export function logOutMock() {
  appStore.update({ auth: { isAuthenticated: false, role: null, permissions: [] } });
}

export function toggleSidebarCollapsed() {
  appStore.update((s) => ({ shell: { ...s.shell, sidebarCollapsed: !s.shell.sidebarCollapsed } }));
}

export function toggleGroupCollapsed(groupKey) {
  appStore.update((s) => {
    const set = new Set(s.shell.collapsedGroups);
    if (set.has(groupKey)) set.delete(groupKey);
    else set.add(groupKey);
    return { shell: { ...s.shell, collapsedGroups: [...set] } };
  });
}

/**
 * Icon-rail mode: a group header click while the sidebar is collapsed must open the rail rather
 * than silently toggling a group's collapsed flag that has no visible effect until the rail
 * itself reopens (see Sidebar.js renderAdvancedMode). Also un-collapses the clicked group so its
 * items are visible immediately in the newly-expanded sidebar.
 */
export function expandSidebarToGroup(groupKey) {
  appStore.update((s) => {
    const set = new Set(s.shell.collapsedGroups);
    set.delete(groupKey);
    return { shell: { ...s.shell, sidebarCollapsed: false, collapsedGroups: [...set] } };
  });
}

export function setUiMode(role, mode) {
  appStore.update((s) => ({ shell: { ...s.shell, uiMode: { ...s.shell.uiMode, [role]: mode } } }));
}

/** Grants a mock JIT window — the real grant/expiry comes from the server in Prompt 2.8. */
export function grantElevatedAccess({ feature, permission, minutes = 120 }) {
  appStore.update((s) => ({
    shell: { ...s.shell, elevatedGrant: { feature, permission, expiresAt: Date.now() + minutes * 60_000 } },
  }));
}

export function releaseElevatedAccess() {
  appStore.update((s) => ({ shell: { ...s.shell, elevatedGrant: null } }));
}
