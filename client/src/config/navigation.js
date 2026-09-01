/**
 * navigation.js — the nav tree as DATA, per docs/ia-sitemap.md §2 and docs/prompt.md Prompt 1.7
 * REQUIREMENT 1. Sidebar/MobileNav/CommandPalette all render from this file; adding a feature
 * later means adding one object here, never editing a component.
 *
 * Every item's `path`/`permission`/`module` is taken verbatim from ia-sitemap.md's per-role route
 * tables (§1.4–§1.9), which the doc itself states carries an explicit perm+module for every one of
 * its ~120 routes (§1 note). `permission: null` is itself explicit — it means "no permission
 * required", not "unspecified" (core/router.js's registration guard rejects the field being
 * missing entirely, only accepting an explicit `null`).
 *
 * Field shape (docs/prompt.md Prompt 1.7 REQUIREMENT 1 — note ia-sitemap.md's own illustrative
 * block uses `labelKey`; this file follows prompt.md's `label_i18n_key` since prompt.md is the
 * master blueprint, per CLAUDE.md):
 *   { key, label_i18n_key, icon, path, group, permission, module, roles: [], order, simpleMode? }
 *
 * Not every route in ia-sitemap's tables gets a nav entry — only the ones §2's per-role group
 * listings actually name. Detail routes (`/admin/orders/:id`), the sourcing "profit calculator"
 * (folded into the Sourcing page itself), and account-portal routes §2.6 doesn't name
 * (`/account`, `/account/concierge`, `/account/settings/notifications`) are real routes without a
 * sidebar entry, reached from within a page rather than the tree — normal, not an omission.
 *
 * Two inferences beyond a literal table lookup, both flagged where they occur:
 *  - `saler.store_status` — §2.5 lists "Physical Shop Status" under Saler's My Store group, but
 *    §1.5's saler route table has no such row. Mirrors supplier's identical `/supplier/store-status`
 *    concept 1:1 (same perm shape, same module) under the `/saler/` prefix.
 *  - Module keys for the ten `/admin/*` oversight routes that mirror a toggleable feature (catalog
 *    moderation, batches, warehouses, returns, disputes, courier, b2b escrow, growth items, theme
 *    studio, api keys) — §1.9's table has no `module` column at all (only `perm`), unlike every
 *    other role's table. Assigned by matching the same feature's module key used elsewhere in this
 *    same file (e.g. admin catalog moderation ↔ moderator's `product_moderation`). Pure governance
 *    pages with no customer-facing module of their own (Users, Staff, Roles, Grants, Approvals,
 *    Restrictions, KYC, Ledger, Payouts, Splits, Security, Settings, Integrations, Module toggle
 *    panel itself) are `core` — a Super Admin must always be able to reach them, including to turn
 *    a module ON in the first place.
 */

export const navGroups = [
  // ---- Super Admin (9 groups, ia-sitemap.md §2.1) ----
  { key: 'admin.overview', role: 'super_admin', icon: '📊', label_i18n_key: 'nav.group.overview', order: 1 },
  { key: 'admin.users', role: 'super_admin', icon: '👥', label_i18n_key: 'nav.group.admin.users', order: 2 },
  { key: 'admin.catalog', role: 'super_admin', icon: '📦', label_i18n_key: 'nav.group.catalog', order: 3 },
  { key: 'admin.orders', role: 'super_admin', icon: '🛒', label_i18n_key: 'nav.shared.orders', order: 4 },
  { key: 'admin.finance', role: 'super_admin', icon: '💰', label_i18n_key: 'nav.group.finance', order: 5 },
  { key: 'admin.growth', role: 'super_admin', icon: '📣', label_i18n_key: 'nav.group.growth', order: 6 },
  { key: 'admin.content', role: 'super_admin', icon: '✍️', label_i18n_key: 'nav.group.content', order: 7 },
  { key: 'admin.platform', role: 'super_admin', icon: '⚙️', label_i18n_key: 'nav.group.admin.platform', order: 8 },
  { key: 'admin.security', role: 'super_admin', icon: '🔒', label_i18n_key: 'nav.group.admin.security', order: 9 },

  // ---- Moderator (4 groups + personal, ia-sitemap.md §2.2) ----
  { key: 'moderator.overview', role: 'moderator', icon: '📊', label_i18n_key: 'nav.group.overview', order: 1 },
  { key: 'moderator.queues', role: 'moderator', icon: '📦', label_i18n_key: 'nav.group.moderator.queues', order: 2 },
  { key: 'moderator.cases', role: 'moderator', icon: '🛒', label_i18n_key: 'nav.group.moderator.cases', order: 3 },
  { key: 'moderator.enforcement', role: 'moderator', icon: '⚠️', label_i18n_key: 'nav.group.moderator.enforcement', order: 4 },
  { key: 'moderator.my_access', role: 'moderator', icon: '🔑', label_i18n_key: 'nav.group.my_access', order: 5 },

  // ---- Editor (2 groups, ia-sitemap.md §2.3) ----
  { key: 'editor.content', role: 'editor', icon: '📰', label_i18n_key: 'nav.group.content', order: 1 },
  { key: 'editor.localization', role: 'editor', icon: '🌐', label_i18n_key: 'nav.group.editor.localization', order: 2 },

  // ---- Supplier (7 groups, ia-sitemap.md §2.4) ----
  { key: 'supplier.overview', role: 'supplier', icon: '📊', label_i18n_key: 'nav.group.overview', order: 1 },
  { key: 'supplier.inventory', role: 'supplier', icon: '📦', label_i18n_key: 'nav.group.supplier.inventory', order: 2 },
  { key: 'supplier.orders', role: 'supplier', icon: '🛒', label_i18n_key: 'nav.shared.orders', order: 3 },
  { key: 'supplier.aftercare', role: 'supplier', icon: '🛡️', label_i18n_key: 'nav.group.supplier.aftercare', order: 4 },
  { key: 'supplier.finance', role: 'supplier', icon: '💰', label_i18n_key: 'nav.group.finance', order: 5 },
  { key: 'supplier.engage', role: 'supplier', icon: '💬', label_i18n_key: 'nav.group.supplier.engage', order: 6 },
  { key: 'supplier.my_shop', role: 'supplier', icon: '🏪', label_i18n_key: 'nav.group.supplier.my_shop', order: 7 },

  // ---- Saler (7 groups, ia-sitemap.md §2.5) ----
  { key: 'saler.overview', role: 'saler', icon: '📊', label_i18n_key: 'nav.group.overview', order: 1 },
  { key: 'saler.my_store', role: 'saler', icon: '🏪', label_i18n_key: 'nav.group.saler.my_store', order: 2 },
  { key: 'saler.sourcing', role: 'saler', icon: '🔍', label_i18n_key: 'nav.group.saler.sourcing', order: 3 },
  { key: 'saler.marketing', role: 'saler', icon: '📣', label_i18n_key: 'nav.group.saler.marketing', order: 4 },
  { key: 'saler.orders', role: 'saler', icon: '🛒', label_i18n_key: 'nav.shared.orders', order: 5 },
  { key: 'saler.vault', role: 'saler', icon: '💰', label_i18n_key: 'nav.group.saler.vault', order: 6 },
  { key: 'saler.growth', role: 'saler', icon: '🚀', label_i18n_key: 'nav.group.growth', order: 7 },

  // ---- Customer (4 groups, ia-sitemap.md §2.6 — flat and icon-led by design) ----
  { key: 'customer.shopping', role: 'customer', icon: '🛒', label_i18n_key: 'nav.group.customer.shopping', order: 1 },
  { key: 'customer.rewards', role: 'customer', icon: '🎁', label_i18n_key: 'nav.group.customer.rewards', order: 2 },
  { key: 'customer.protection', role: 'customer', icon: '🛡️', label_i18n_key: 'nav.group.customer.protection', order: 3 },
  { key: 'customer.me', role: 'customer', icon: '👤', label_i18n_key: 'nav.group.customer.me', order: 4 },
];

export const navItems = [
  // ================= SUPER ADMIN — 49 items =================
  { key: 'admin.dashboard', label_i18n_key: 'nav.shared.dashboard', icon: null, path: '/admin', group: 'admin.overview', permission: 'admin.dashboard.view', module: 'core', roles: ['super_admin'], order: 1 },
  { key: 'admin.health', label_i18n_key: 'nav.admin.health', icon: null, path: '/admin/health', group: 'admin.overview', permission: 'system.health.view', module: 'core', roles: ['super_admin'], order: 2 },

  { key: 'admin.users.list', label_i18n_key: 'nav.admin.users_list', icon: null, path: '/admin/users', group: 'admin.users', permission: 'users.account.view', module: 'core', roles: ['super_admin'], order: 1 },
  { key: 'admin.staff', label_i18n_key: 'nav.admin.staff', icon: null, path: '/admin/staff', group: 'admin.users', permission: 'staff.account.view', module: 'core', roles: ['super_admin'], order: 2 },
  { key: 'admin.roles', label_i18n_key: 'nav.admin.roles', icon: null, path: '/admin/roles', group: 'admin.users', permission: 'staff.role.assign', module: 'core', roles: ['super_admin'], order: 3 },
  { key: 'admin.grants', label_i18n_key: 'nav.admin.grants', icon: null, path: '/admin/grants', group: 'admin.users', permission: 'users.permission.grant', module: 'core', roles: ['super_admin'], order: 4 },
  { key: 'admin.approvals', label_i18n_key: 'nav.admin.approvals', icon: null, path: '/admin/approvals', group: 'admin.users', permission: 'admin.approval.decide', module: 'core', roles: ['super_admin'], order: 5, badge: 'approvals' },
  { key: 'admin.restrictions', label_i18n_key: 'nav.admin.restrictions', icon: null, path: '/admin/restrictions', group: 'admin.users', permission: 'users.restriction.manage', module: 'core', roles: ['super_admin'], order: 6 },
  { key: 'admin.verification', label_i18n_key: 'nav.admin.verification', icon: null, path: '/admin/verification', group: 'admin.users', permission: 'users.kyc.approve', module: 'core', roles: ['super_admin'], order: 7 },

  { key: 'admin.catalog.products', label_i18n_key: 'nav.shared.products', icon: null, path: '/admin/catalog/products', group: 'admin.catalog', permission: 'catalog.product.view_all', module: 'core', roles: ['super_admin'], order: 1 },
  { key: 'admin.catalog.categories', label_i18n_key: 'nav.admin.categories', icon: null, path: '/admin/catalog/categories', group: 'admin.catalog', permission: 'catalog.category.manage', module: 'core', roles: ['super_admin'], order: 2 },
  { key: 'admin.catalog.moderation', label_i18n_key: 'nav.admin.catalog_moderation', icon: null, path: '/admin/catalog/moderation', group: 'admin.catalog', permission: 'moderation.product.approve', module: 'product_moderation', roles: ['super_admin'], order: 3, badge: 'catalog_moderation' },
  { key: 'admin.catalog.batches', label_i18n_key: 'nav.admin.batches', icon: null, path: '/admin/catalog/batches', group: 'admin.catalog', permission: 'catalog.batch.govern', module: 'fefo_batches', roles: ['super_admin'], order: 4 },
  { key: 'admin.catalog.warehouses', label_i18n_key: 'nav.shared.warehouses', icon: null, path: '/admin/catalog/warehouses', group: 'admin.catalog', permission: 'catalog.warehouse.govern', module: 'multi_warehouse', roles: ['super_admin'], order: 5 },

  { key: 'admin.orders.list', label_i18n_key: 'nav.shared.orders', icon: null, path: '/admin/orders', group: 'admin.orders', permission: 'orders.order.view_all', module: 'core', roles: ['super_admin'], order: 1 },
  { key: 'admin.returns', label_i18n_key: 'nav.shared.returns', icon: null, path: '/admin/returns', group: 'admin.orders', permission: 'orders.return.view_all', module: 'returns_engine', roles: ['super_admin'], order: 2 },
  { key: 'admin.disputes', label_i18n_key: 'nav.shared.disputes', icon: null, path: '/admin/disputes', group: 'admin.orders', permission: 'orders.dispute.view_all', module: 'dispute_panel', roles: ['super_admin'], order: 3, badge: 'disputes' },
  { key: 'admin.courier', label_i18n_key: 'nav.admin.courier', icon: null, path: '/admin/courier', group: 'admin.orders', permission: 'logistics.carrier.manage', module: 'courier_hub', roles: ['super_admin'], order: 4 },
  { key: 'admin.cod_reconciliation', label_i18n_key: 'nav.admin.cod_reconciliation', icon: null, path: '/admin/cod-reconciliation', group: 'admin.orders', permission: 'orders.cod.reconcile', module: 'cod_reconciliation', roles: ['super_admin'], order: 5 },

  { key: 'admin.finance.overview', label_i18n_key: 'nav.shared.overview', icon: null, path: '/admin/finance', group: 'admin.finance', permission: 'finance.overview.view', module: 'core', roles: ['super_admin'], order: 1 },
  { key: 'admin.finance.ledger', label_i18n_key: 'nav.admin.ledger', icon: null, path: '/admin/finance/ledger', group: 'admin.finance', permission: 'finance.ledger.view', module: 'core', roles: ['super_admin'], order: 2 },
  { key: 'admin.finance.escrow', label_i18n_key: 'nav.admin.escrow', icon: null, path: '/admin/finance/escrow', group: 'admin.finance', permission: 'finance.escrow.view', module: 'escrow_engine', roles: ['super_admin'], order: 3 },
  { key: 'admin.finance.payouts', label_i18n_key: 'nav.admin.payouts', icon: null, path: '/admin/finance/payouts', group: 'admin.finance', permission: 'finance.payout.approve', module: 'core', roles: ['super_admin'], order: 4, badge: 'payouts' },
  { key: 'admin.finance.splits', label_i18n_key: 'nav.admin.splits', icon: null, path: '/admin/finance/splits', group: 'admin.finance', permission: 'finance.split.update', module: 'core', roles: ['super_admin'], order: 5 },
  { key: 'admin.finance.b2b_escrow', label_i18n_key: 'nav.shared.b2b_escrow', icon: null, path: '/admin/finance/b2b-escrow', group: 'admin.finance', permission: 'finance.b2b_escrow.manage', module: 'b2b_escrow', roles: ['super_admin'], order: 6 },
  { key: 'admin.finance.subscriptions', label_i18n_key: 'nav.admin.subscriptions', icon: null, path: '/admin/finance/subscriptions', group: 'admin.finance', permission: 'finance.subscription.manage', module: 'subscription_fees', roles: ['super_admin'], order: 7 },

  { key: 'admin.growth.ads', label_i18n_key: 'nav.admin.ads', icon: null, path: '/admin/growth/ads', group: 'admin.growth', permission: 'growth.ad.govern', module: 'sponsored_ads', roles: ['super_admin'], order: 1 },
  { key: 'admin.growth.coupons', label_i18n_key: 'nav.shared.coupons', icon: null, path: '/admin/growth/coupons', group: 'admin.growth', permission: 'growth.coupon.manage', module: 'coupons', roles: ['super_admin'], order: 2 },
  { key: 'admin.growth.campaigns', label_i18n_key: 'nav.admin.campaigns', icon: null, path: '/admin/growth/campaigns', group: 'admin.growth', permission: 'growth.campaign.manage', module: 'flash_sale', roles: ['super_admin'], order: 3 },
  { key: 'admin.growth.referrals', label_i18n_key: 'nav.shared.referrals', icon: null, path: '/admin/growth/referrals', group: 'admin.growth', permission: 'growth.referral.govern', module: 'referral_engine', roles: ['super_admin'], order: 4 },
  { key: 'admin.growth.coins', label_i18n_key: 'nav.admin.coins', icon: null, path: '/admin/growth/coins', group: 'admin.growth', permission: 'growth.coins.govern', module: 'loyalty_coins', roles: ['super_admin'], order: 5 },
  { key: 'admin.growth.quests', label_i18n_key: 'nav.shared.quests', icon: null, path: '/admin/growth/quests', group: 'admin.growth', permission: 'growth.quest.govern', module: 'daily_quests', roles: ['super_admin'], order: 6 },
  { key: 'admin.growth.groupbuy', label_i18n_key: 'nav.admin.groupbuy', icon: null, path: '/admin/growth/group-buy', group: 'admin.growth', permission: 'growth.groupbuy.govern', module: 'group_buying', roles: ['super_admin'], order: 7 },

  { key: 'admin.content.banners', label_i18n_key: 'nav.shared.banners', icon: null, path: '/admin/content/banners', group: 'admin.content', permission: 'content.banner.publish', module: 'core', roles: ['super_admin'], order: 1 },
  { key: 'admin.content.stories', label_i18n_key: 'nav.shared.stories', icon: null, path: '/admin/content/stories', group: 'admin.content', permission: 'content.story.curate', module: 'content_commerce', roles: ['super_admin'], order: 2 },
  { key: 'admin.content.academy', label_i18n_key: 'nav.shared.academy', icon: null, path: '/admin/content/academy', group: 'admin.content', permission: 'content.academy.manage', module: 'seller_academy', roles: ['super_admin'], order: 3 },
  { key: 'admin.content.whats_new', label_i18n_key: 'nav.shared.whats_new', icon: null, path: '/admin/content/whats-new', group: 'admin.content', permission: 'content.announcement.publish', module: 'whats_new', roles: ['super_admin'], order: 4 },
  { key: 'admin.content.translations', label_i18n_key: 'nav.shared.translations', icon: null, path: '/admin/content/translations', group: 'admin.content', permission: 'content.i18n.update', module: 'i18n', roles: ['super_admin'], order: 5 },
  { key: 'admin.content.live', label_i18n_key: 'nav.admin.live', icon: null, path: '/admin/live', group: 'admin.content', permission: 'live.stream.govern', module: 'live_commerce', roles: ['super_admin'], order: 6 },

  { key: 'admin.platform.modules', label_i18n_key: 'nav.admin.modules', icon: null, path: '/admin/platform/modules', group: 'admin.platform', permission: 'platform.module.toggle', module: 'core', roles: ['super_admin'], order: 1 },
  { key: 'admin.platform.theme', label_i18n_key: 'nav.admin.theme', icon: null, path: '/admin/platform/theme', group: 'admin.platform', permission: 'platform.theme.view', module: 'theme_studio', roles: ['super_admin'], order: 2 },
  { key: 'admin.platform.integrations', label_i18n_key: 'nav.admin.integrations', icon: null, path: '/admin/platform/integrations', group: 'admin.platform', permission: 'platform.integration.manage', module: 'core', roles: ['super_admin'], order: 3 },
  { key: 'admin.platform.apikeys', label_i18n_key: 'nav.admin.apikeys', icon: null, path: '/admin/platform/api-keys', group: 'admin.platform', permission: 'platform.apikey.manage', module: 'open_api', roles: ['super_admin'], order: 4 },
  { key: 'admin.platform.settings', label_i18n_key: 'nav.shared.settings', icon: null, path: '/admin/platform/settings', group: 'admin.platform', permission: 'platform.settings.update', module: 'core', roles: ['super_admin'], order: 5 },

  { key: 'admin.security.audit', label_i18n_key: 'nav.admin.audit', icon: null, path: '/admin/security/audit', group: 'admin.security', permission: 'security.audit.view', module: 'core', roles: ['super_admin'], order: 1 },
  { key: 'admin.security.sessions', label_i18n_key: 'nav.admin.sessions', icon: null, path: '/admin/security/sessions', group: 'admin.security', permission: 'security.session.revoke', module: 'core', roles: ['super_admin'], order: 2 },
  { key: 'admin.security.2fa', label_i18n_key: 'nav.admin.2fa', icon: null, path: '/admin/security/2fa', group: 'admin.security', permission: 'security.2fa.manage', module: 'core', roles: ['super_admin'], order: 3 },
  { key: 'admin.security.ip_allowlist', label_i18n_key: 'nav.admin.ip_allowlist', icon: null, path: '/admin/security/ip-allowlist', group: 'admin.security', permission: 'security.ip.manage', module: 'core', roles: ['super_admin'], order: 4 },
  { key: 'admin.security.backups', label_i18n_key: 'nav.admin.backups', icon: null, path: '/admin/security/backups', group: 'admin.security', permission: 'system.backup.manage', module: 'core', roles: ['super_admin'], order: 5 },

  // ================= MODERATOR — 10 items =================
  { key: 'moderator.dashboard', label_i18n_key: 'nav.shared.dashboard', icon: null, path: '/moderator', group: 'moderator.overview', permission: 'moderation.dashboard.view', module: 'core', roles: ['moderator'], order: 1 },
  { key: 'moderator.queue', label_i18n_key: 'nav.moderator.queue', icon: null, path: '/moderator/queue', group: 'moderator.queues', permission: 'moderation.product.approve', module: 'product_moderation', roles: ['moderator'], order: 1, badge: 'catalog_moderation' },
  { key: 'moderator.reviews', label_i18n_key: 'nav.moderator.reviews', icon: null, path: '/moderator/reviews', group: 'moderator.queues', permission: 'moderation.review.handle', module: 'review_integrity', roles: ['moderator'], order: 2 },
  { key: 'moderator.ugc', label_i18n_key: 'nav.moderator.ugc', icon: null, path: '/moderator/ugc', group: 'moderator.queues', permission: 'moderation.ugc.approve', module: 'ugc_video_wall', roles: ['moderator'], order: 3 },
  { key: 'moderator.live', label_i18n_key: 'nav.moderator.live', icon: null, path: '/moderator/live', group: 'moderator.queues', permission: 'moderation.live.handle', module: 'live_commerce', roles: ['moderator'], order: 4 },
  { key: 'moderator.disputes', label_i18n_key: 'nav.shared.disputes', icon: null, path: '/moderator/disputes', group: 'moderator.cases', permission: 'orders.dispute.arbitrate', module: 'dispute_panel', roles: ['moderator'], order: 1, badge: 'disputes' },
  { key: 'moderator.returns', label_i18n_key: 'nav.shared.returns', icon: null, path: '/moderator/returns', group: 'moderator.cases', permission: 'orders.return.review', module: 'returns_engine', roles: ['moderator'], order: 2 },
  { key: 'moderator.reports', label_i18n_key: 'nav.moderator.reports', icon: null, path: '/moderator/reports', group: 'moderator.cases', permission: 'moderation.report.handle', module: 'user_reports', roles: ['moderator'], order: 3, badge: 'reports' },
  { key: 'moderator.penalties', label_i18n_key: 'nav.moderator.penalties', icon: null, path: '/moderator/penalties', group: 'moderator.enforcement', permission: 'users.account.penalise', module: 'core', roles: ['moderator'], order: 1 },
  { key: 'moderator.my_access', label_i18n_key: 'nav.group.my_access', icon: null, path: '/moderator/my-access', group: 'moderator.my_access', permission: null, module: 'core', roles: ['moderator'], order: 1 },

  // ================= EDITOR — 7 items =================
  { key: 'editor.dashboard', label_i18n_key: 'nav.shared.dashboard', icon: null, path: '/editor', group: 'editor.content', permission: 'content.dashboard.view', module: 'core', roles: ['editor'], order: 1 },
  { key: 'editor.banners', label_i18n_key: 'nav.shared.banners', icon: null, path: '/editor/banners', group: 'editor.content', permission: 'content.banner.publish', module: 'core', roles: ['editor'], order: 2 },
  { key: 'editor.stories', label_i18n_key: 'nav.shared.stories', icon: null, path: '/editor/stories', group: 'editor.content', permission: 'content.story.curate', module: 'content_commerce', roles: ['editor'], order: 3 },
  { key: 'editor.academy', label_i18n_key: 'nav.shared.academy', icon: null, path: '/editor/academy', group: 'editor.content', permission: 'content.academy.manage', module: 'seller_academy', roles: ['editor'], order: 4 },
  { key: 'editor.whats_new', label_i18n_key: 'nav.shared.whats_new', icon: null, path: '/editor/whats-new', group: 'editor.content', permission: 'content.announcement.publish', module: 'whats_new', roles: ['editor'], order: 5 },
  { key: 'editor.help_center', label_i18n_key: 'nav.editor.help_center', icon: null, path: '/editor/help-center', group: 'editor.content', permission: 'content.help.manage', module: 'core', roles: ['editor'], order: 6 },
  { key: 'editor.translations', label_i18n_key: 'nav.shared.translations', icon: null, path: '/editor/translations', group: 'editor.localization', permission: 'content.i18n.update', module: 'i18n', roles: ['editor'], order: 1 },

  // ================= SUPPLIER — 16 items =================
  { key: 'supplier.dashboard', label_i18n_key: 'nav.shared.dashboard', icon: null, path: '/supplier', group: 'supplier.overview', permission: 'supplier.dashboard.view', module: 'core', roles: ['supplier'], order: 1 },
  { key: 'supplier.resellers', label_i18n_key: 'nav.supplier.resellers', icon: null, path: '/supplier/resellers', group: 'supplier.overview', permission: 'supplier.analytics.view', module: 'core', roles: ['supplier'], order: 2 },
  { key: 'supplier.forecasting', label_i18n_key: 'nav.supplier.forecasting', icon: null, path: '/supplier/forecasting', group: 'supplier.overview', permission: 'supplier.analytics.view', module: 'ai_forecasting', roles: ['supplier'], order: 3 },
  { key: 'supplier.products', label_i18n_key: 'nav.shared.products', icon: null, path: '/supplier/products', group: 'supplier.inventory', permission: 'catalog.product.manage_own', module: 'core', roles: ['supplier'], order: 1 },
  { key: 'supplier.stock', label_i18n_key: 'nav.supplier.stock', icon: null, path: '/supplier/inventory', group: 'supplier.inventory', permission: 'catalog.inventory.manage', module: 'core', roles: ['supplier'], order: 2 },
  { key: 'supplier.batches', label_i18n_key: 'nav.supplier.batches', icon: null, path: '/supplier/batches', group: 'supplier.inventory', permission: 'catalog.batch.manage', module: 'fefo_batches', roles: ['supplier'], order: 3 },
  { key: 'supplier.warehouses', label_i18n_key: 'nav.shared.warehouses', icon: null, path: '/supplier/warehouses', group: 'supplier.inventory', permission: 'catalog.warehouse.manage', module: 'multi_warehouse', roles: ['supplier'], order: 4 },
  { key: 'supplier.orders.incoming', label_i18n_key: 'nav.supplier.incoming_orders', icon: null, path: '/supplier/orders', group: 'supplier.orders', permission: 'supplier.order.view', module: 'core', roles: ['supplier'], order: 1 },
  { key: 'supplier.fulfilment', label_i18n_key: 'nav.supplier.fulfilment', icon: null, path: '/supplier/fulfilment', group: 'supplier.orders', permission: 'logistics.consignment.create', module: 'courier_hub', roles: ['supplier'], order: 2 },
  { key: 'supplier.shipments', label_i18n_key: 'nav.supplier.shipments', icon: null, path: '/supplier/shipments', group: 'supplier.orders', permission: 'logistics.shipment.view', module: 'courier_hub', roles: ['supplier'], order: 3 },
  { key: 'supplier.warranty_claims', label_i18n_key: 'nav.supplier.warranty_claims', icon: null, path: '/supplier/warranty-claims', group: 'supplier.aftercare', permission: 'support.warranty.manage', module: 'digital_warranty', roles: ['supplier'], order: 1 },
  { key: 'supplier.vault', label_i18n_key: 'nav.supplier.vault', icon: null, path: '/supplier/vault', group: 'supplier.finance', permission: 'finance.wallet.view_own', module: 'core', roles: ['supplier'], order: 1 },
  { key: 'supplier.b2b_escrow', label_i18n_key: 'nav.shared.b2b_escrow', icon: null, path: '/supplier/b2b-escrow', group: 'supplier.finance', permission: 'finance.b2b_escrow.view_own', module: 'b2b_escrow', roles: ['supplier'], order: 2 },
  { key: 'supplier.inquiries', label_i18n_key: 'nav.supplier.inquiries', icon: null, path: '/supplier/inquiries', group: 'supplier.engage', permission: 'chat.thread.view_own', module: 'chat', roles: ['supplier'], order: 1 },
  { key: 'supplier.live_studio', label_i18n_key: 'nav.supplier.live_studio', icon: null, path: '/supplier/live-studio', group: 'supplier.engage', permission: 'live.stream.host', module: 'live_commerce', roles: ['supplier'], order: 2 },
  { key: 'supplier.store_status', label_i18n_key: 'nav.shared.store_status', icon: null, path: '/supplier/store-status', group: 'supplier.my_shop', permission: 'supplier.store.manage', module: 'physical_shop_status', roles: ['supplier'], order: 1 },

  // ================= SALER — 20 items =================
  { key: 'saler.dashboard', label_i18n_key: 'nav.shared.dashboard', icon: null, path: '/saler', group: 'saler.overview', permission: 'saler.dashboard.view', module: 'core', roles: ['saler'], order: 1 },
  { key: 'saler.analytics', label_i18n_key: 'nav.saler.analytics', icon: null, path: '/saler/analytics', group: 'saler.overview', permission: 'saler.analytics.view', module: 'core', roles: ['saler'], order: 2 },
  { key: 'saler.cart_insights', label_i18n_key: 'nav.saler.cart_insights', icon: null, path: '/saler/cart-insights', group: 'saler.overview', permission: 'saler.analytics.view', module: 'cart_recovery', roles: ['saler'], order: 3, simpleMode: false },
  { key: 'saler.store_builder', label_i18n_key: 'nav.saler.store_builder', icon: null, path: '/saler/store-builder', group: 'saler.my_store', permission: 'saler.store.manage', module: 'virtual_storefront', roles: ['saler'], order: 1 },
  { key: 'saler.products', label_i18n_key: 'nav.saler.my_products', icon: null, path: '/saler/products', group: 'saler.my_store', permission: 'saler.store.manage', module: 'virtual_storefront', roles: ['saler'], order: 2 },
  // Inferred route — see file header note: mirrors supplier's `/supplier/store-status` 1:1.
  { key: 'saler.store_status', label_i18n_key: 'nav.shared.store_status', icon: null, path: '/saler/store-status', group: 'saler.my_store', permission: 'saler.store.manage', module: 'physical_shop_status', roles: ['saler'], order: 3 },
  { key: 'saler.sourcing', label_i18n_key: 'nav.saler.sourcing', icon: null, path: '/saler/sourcing', group: 'saler.sourcing', permission: 'saler.sourcing.view', module: 'sourcing', roles: ['saler'], order: 1 },
  { key: 'saler.bundles', label_i18n_key: 'nav.saler.bundles', icon: null, path: '/saler/bundles', group: 'saler.sourcing', permission: 'saler.bundle.manage', module: 'product_bundling', roles: ['saler'], order: 2, simpleMode: false },
  { key: 'saler.creative_studio', label_i18n_key: 'nav.saler.creative_studio', icon: null, path: '/saler/creative-studio', group: 'saler.marketing', permission: 'ai.creative.use', module: 'ai_creative_studio', roles: ['saler'], order: 1, simpleMode: false },
  { key: 'saler.social_kit', label_i18n_key: 'nav.saler.social_kit', icon: null, path: '/saler/social-kit', group: 'saler.marketing', permission: null, module: 'social_seller_kit', roles: ['saler'], order: 2 },
  { key: 'saler.ads', label_i18n_key: 'nav.saler.ads', icon: null, path: '/saler/ads', group: 'saler.marketing', permission: 'growth.ad.manage_own', module: 'sponsored_ads', roles: ['saler'], order: 3, simpleMode: false },
  { key: 'saler.live_studio', label_i18n_key: 'nav.supplier.live_studio', icon: null, path: '/saler/live-studio', group: 'saler.marketing', permission: 'live.stream.host', module: 'live_commerce', roles: ['saler'], order: 4, simpleMode: false },
  { key: 'saler.orders', label_i18n_key: 'nav.shared.orders', icon: null, path: '/saler/orders', group: 'saler.orders', permission: 'saler.order.view', module: 'core', roles: ['saler'], order: 1 },
  { key: 'saler.vault.balance', label_i18n_key: 'nav.saler.vault_balance', icon: null, path: '/saler/vault', group: 'saler.vault', permission: 'finance.wallet.view_own', module: 'core', roles: ['saler'], order: 1 },
  { key: 'saler.vault.payouts', label_i18n_key: 'nav.saler.withdrawals', icon: null, path: '/saler/vault/payouts', group: 'saler.vault', permission: 'finance.payout.request', module: 'core', roles: ['saler'], order: 2 },
  { key: 'saler.referrals', label_i18n_key: 'nav.shared.referrals', icon: null, path: '/saler/referrals', group: 'saler.growth', permission: 'growth.referral.view_own', module: 'referral_engine', roles: ['saler'], order: 1, simpleMode: false },
  { key: 'saler.quests', label_i18n_key: 'nav.shared.quests', icon: null, path: '/saler/quests', group: 'saler.growth', permission: null, module: 'daily_quests', roles: ['saler'], order: 2, simpleMode: false },
  { key: 'saler.leaderboard', label_i18n_key: 'nav.saler.leaderboard', icon: null, path: '/saler/leaderboard', group: 'saler.growth', permission: null, module: 'gamification', roles: ['saler'], order: 3, simpleMode: false },
  { key: 'saler.academy', label_i18n_key: 'nav.shared.academy', icon: null, path: '/saler/academy', group: 'saler.growth', permission: null, module: 'seller_academy', roles: ['saler'], order: 4 },
  { key: 'saler.inbox', label_i18n_key: 'nav.saler.inbox', icon: null, path: '/saler/inbox', group: 'saler.growth', permission: 'chat.thread.view_own', module: 'whatsapp_bridge', roles: ['saler'], order: 5 },

  // ================= CUSTOMER — 13 items =================
  { key: 'customer.orders', label_i18n_key: 'nav.shared.orders', icon: null, path: '/account/orders', group: 'customer.shopping', permission: null, module: 'core', roles: ['customer'], order: 1 },
  { key: 'customer.returns', label_i18n_key: 'nav.shared.returns', icon: null, path: '/account/returns', group: 'customer.shopping', permission: null, module: 'returns_engine', roles: ['customer'], order: 2 },
  { key: 'customer.wishlist', label_i18n_key: 'nav.customer.wishlist', icon: null, path: '/account/wishlist', group: 'customer.shopping', permission: null, module: 'wishlist', roles: ['customer'], order: 3 },
  { key: 'customer.coupons', label_i18n_key: 'nav.shared.coupons', icon: null, path: '/account/coupons', group: 'customer.shopping', permission: null, module: 'coupons', roles: ['customer'], order: 4 },
  { key: 'customer.team_purchases', label_i18n_key: 'nav.customer.team_purchases', icon: null, path: '/account/team-purchases', group: 'customer.shopping', permission: null, module: 'group_buying', roles: ['customer'], order: 5 },
  { key: 'customer.live', label_i18n_key: 'nav.customer.live', icon: null, path: '/live', group: 'customer.shopping', permission: null, module: 'live_commerce', roles: ['customer'], order: 6 },
  { key: 'customer.coins', label_i18n_key: 'nav.customer.coins', icon: null, path: '/account/coins', group: 'customer.rewards', permission: null, module: 'loyalty_coins', roles: ['customer'], order: 1 },
  { key: 'customer.referrals', label_i18n_key: 'nav.shared.referrals', icon: null, path: '/account/referrals', group: 'customer.rewards', permission: null, module: 'referral_engine', roles: ['customer'], order: 2 },
  { key: 'customer.warranties', label_i18n_key: 'nav.customer.warranties', icon: null, path: '/account/warranties', group: 'customer.protection', permission: null, module: 'digital_warranty', roles: ['customer'], order: 1 },
  { key: 'customer.following', label_i18n_key: 'nav.customer.following', icon: null, path: '/account/following', group: 'customer.me', permission: null, module: 'follow_feed', roles: ['customer'], order: 1 },
  { key: 'customer.reviews', label_i18n_key: 'nav.customer.reviews', icon: null, path: '/account/reviews', group: 'customer.me', permission: null, module: 'ugc_video_wall', roles: ['customer'], order: 2 },
  { key: 'customer.addresses', label_i18n_key: 'nav.customer.addresses', icon: null, path: '/account/addresses', group: 'customer.me', permission: null, module: 'core', roles: ['customer'], order: 3 },
  { key: 'customer.settings', label_i18n_key: 'nav.shared.settings', icon: null, path: '/account/settings', group: 'customer.me', permission: null, module: 'core', roles: ['customer'], order: 4 },
  { key: 'customer.become_saler', label_i18n_key: 'nav.customer.become_saler', icon: null, path: '/account/become-saler', group: 'customer.me', permission: null, module: 'virtual_storefront', roles: ['customer'], order: 5, highlight: true },
];

/** All 6 roles this file has a tree for, in the same order the role switcher (Prompt 1.7 PREVIEW) lists them. */
export const NAV_ROLES = ['super_admin', 'moderator', 'editor', 'supplier', 'saler', 'customer'];

/** Roles whose sidebar has a Simple/Advanced mode split (ia-sitemap.md §4). */
export const PROGRESSIVE_DISCLOSURE_ROLES = ['saler', 'supplier'];

/**
 * Simple Mode's exact 6 items per ia-sitemap.md §4 — a hand-picked subset, not derived from
 * `simpleMode: false` alone, because Simple Mode also drops groups entirely (flat list) and the
 * §4 lists are shorter/reworded ("My Orders" not "Orders") rather than a strict filter of the
 * Advanced tree.
 */
export const SIMPLE_MODE_ITEMS = {
  saler: [
    { key: 'saler.simple.add_product', label_i18n_key: 'nav.simple.saler.add_product', path: '/saler/products', permission: 'saler.store.manage', module: 'virtual_storefront' },
    { key: 'saler.simple.share_store', label_i18n_key: 'nav.simple.saler.share_store', path: '/saler/store-builder', permission: 'saler.store.manage', module: 'virtual_storefront' },
    { key: 'saler.simple.my_orders', label_i18n_key: 'nav.simple.saler.my_orders', path: '/saler/orders', permission: 'saler.order.view', module: 'core' },
    { key: 'saler.simple.my_earnings', label_i18n_key: 'nav.simple.saler.my_earnings', path: '/saler/vault', permission: 'finance.wallet.view_own', module: 'core' },
    { key: 'saler.simple.messages', label_i18n_key: 'nav.simple.messages', path: '/saler/inbox', permission: 'chat.thread.view_own', module: 'whatsapp_bridge' },
    { key: 'saler.simple.help', label_i18n_key: 'nav.simple.help', path: '/saler/academy', permission: null, module: 'seller_academy' },
  ],
  supplier: [
    { key: 'supplier.simple.add_product', label_i18n_key: 'nav.simple.supplier.add_product', path: '/supplier/products', permission: 'catalog.product.create', module: 'core' },
    { key: 'supplier.simple.stock', label_i18n_key: 'nav.supplier.stock', path: '/supplier/inventory', permission: 'catalog.inventory.manage', module: 'core' },
    { key: 'supplier.simple.orders_to_pack', label_i18n_key: 'nav.simple.supplier.orders_to_pack', path: '/supplier/orders', permission: 'supplier.order.view', module: 'core' },
    { key: 'supplier.simple.print_labels', label_i18n_key: 'nav.simple.supplier.print_labels', path: '/supplier/fulfilment', permission: 'logistics.consignment.create', module: 'courier_hub' },
    { key: 'supplier.simple.my_earnings', label_i18n_key: 'nav.simple.supplier.my_earnings', path: '/supplier/vault', permission: 'finance.wallet.view_own', module: 'core' },
    { key: 'supplier.simple.help', label_i18n_key: 'nav.simple.help', path: '/supplier/help', permission: null, module: 'core' },
  ],
};

/** Bottom tab bar per role — ia-sitemap.md §6, max 5 including the always-present "More" sentinel. */
export const MOBILE_TABS = {
  customer: [
    { key: 'home', label_i18n_key: 'nav.mobile.home', path: '/' },
    { key: 'search', label_i18n_key: 'nav.mobile.search', path: '/search' },
    // Cart is a drawer, not a page — `action` tells MobileNav to open it instead of navigating.
    { key: 'cart', label_i18n_key: 'nav.mobile.cart', action: 'openCart', badge: 'cart' },
    { key: 'orders', label_i18n_key: 'nav.shared.orders', path: '/account/orders' },
    { key: 'more', label_i18n_key: 'nav.mobile.more', more: true },
  ],
  saler: [
    { key: 'dashboard', label_i18n_key: 'nav.shared.dashboard', path: '/saler' },
    { key: 'my_store', label_i18n_key: 'nav.mobile.my_store', path: '/saler/store-builder' },
    { key: 'orders', label_i18n_key: 'nav.shared.orders', path: '/saler/orders', badge: 'saler_orders' },
    { key: 'vault', label_i18n_key: 'nav.mobile.vault', path: '/saler/vault' },
    { key: 'more', label_i18n_key: 'nav.mobile.more', more: true },
  ],
  supplier: [
    { key: 'dashboard', label_i18n_key: 'nav.shared.dashboard', path: '/supplier' },
    { key: 'stock', label_i18n_key: 'nav.supplier.stock', path: '/supplier/inventory' },
    { key: 'orders', label_i18n_key: 'nav.shared.orders', path: '/supplier/orders', badge: 'supplier_orders' },
    { key: 'vault', label_i18n_key: 'nav.mobile.vault', path: '/supplier/vault' },
    { key: 'more', label_i18n_key: 'nav.mobile.more', more: true },
  ],
  moderator: [
    { key: 'dashboard', label_i18n_key: 'nav.shared.dashboard', path: '/moderator' },
    { key: 'queues', label_i18n_key: 'nav.mobile.queues', path: '/moderator/queue', badge: 'catalog_moderation' },
    { key: 'cases', label_i18n_key: 'nav.mobile.cases', path: '/moderator/disputes', badge: 'disputes' },
    { key: 'my_access', label_i18n_key: 'nav.group.my_access', path: '/moderator/my-access' },
    { key: 'more', label_i18n_key: 'nav.mobile.more', more: true },
  ],
  editor: [
    { key: 'content', label_i18n_key: 'nav.group.content', path: '/editor' },
    { key: 'translations', label_i18n_key: 'nav.shared.translations', path: '/editor/translations' },
    { key: 'more', label_i18n_key: 'nav.mobile.more', more: true },
  ],
  super_admin: [
    { key: 'overview', label_i18n_key: 'nav.shared.overview', path: '/admin' },
    { key: 'approvals', label_i18n_key: 'nav.admin.approvals', path: '/admin/approvals', badge: 'approvals' },
    { key: 'orders', label_i18n_key: 'nav.shared.orders', path: '/admin/orders' },
    { key: 'finance', label_i18n_key: 'nav.group.finance', path: '/admin/finance' },
    { key: 'more', label_i18n_key: 'nav.mobile.more', more: true },
  ],
};
