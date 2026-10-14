/**
 * homeBands.js — what the home top band shows each account type.
 *
 * Pure data. A guest keeps the earn panel, and a customer keeps the campaign slider in the middle
 * (both are in HomeTop.js); every other account type gets three panels from here, because a
 * supplier, moderator or admin has no use for "start earning with zero stock".
 *
 * Rows come in two kinds:
 *   { stat, path }  — a number from GET /home/summary. Label is `marketplace.top.band.stat.<stat>`.
 *   { link, path }  — a plain shortcut, for roles with no numbers. Label is `marketplace.top.band.link.<link>`.
 * `money` formats the figure as currency; `alert` tints it when it is above zero (work waiting).
 *
 * Every `path` is a route in config/navigation.js. A test (homeBands.test.js) checks that and that
 * every label exists in both locales, so a renamed route or a missing translation fails the build.
 */

const stat = (key, path, extra = {}) => ({ stat: key, path, ...extra });
const link = (key, path, extra = {}) => ({ link: key, path, ...extra });

const OPERATIONS = {
  // Admin and super admin share one picture. Only the third review-queue figure differs: a super
  // admin sees the approvals waiting on them, an admin sees their own requests still pending.
  left: {
    tone: 'brand',
    rows: [stat('orders_today', '/admin/orders'), stat('gmv_today', '/admin/orders', { money: true })],
    cta: '/admin',
  },
  center: {
    tone: 'soft',
    kind: 'metrics',
    cta: '/admin/approvals',
  },
  right: {
    tone: 'dark',
    rows: [
      stat('disputes_past_sla', '/admin/disputes', { alert: true }),
      stat('failed_payouts', '/admin/finance/payouts', { alert: true }),
    ],
    cta: '/admin/disputes',
  },
};

export const ROLE_BANDS = {
  // Customer: only the left panel is replaced; the slider and the right column stay as they were.
  customer: {
    left: {
      tone: 'brand',
      rows: [
        stat('price_drops', '/account/wishlist'),
        stat('coins', '/account/coins'),
        stat('active_teams', '/account/team-purchases'),
        stat('active_returns', '/account/returns'),
      ],
      cta: '/account/wishlist',
    },
  },

  saler: {
    left: {
      tone: 'brand',
      rows: [
        stat('today_orders', '/saler/orders'),
        stat('link_clicks', '/saler/analytics'),
        stat('unread_messages', '/chat', { alert: true }),
      ],
      cta: '/saler',
    },
    center: {
      tone: 'soft',
      kind: 'metrics',
      metrics: [
        stat('escrow_balance', '/saler/vault', { money: true, tone: 'info' }),
        stat('available_balance', '/saler/vault', { money: true, tone: 'ok' }),
        stat('profit_30d', '/saler/analytics', { money: true, tone: 'acc' }),
      ],
      cta: '/saler/vault',
    },
    right: {
      tone: 'dark',
      rows: [
        stat('pending_fulfillment', '/saler/orders', { alert: true }),
        link('saler_products', '/saler/products'),
        link('saler_social_kit', '/saler/social-kit'),
        link('saler_ads', '/saler/ads'),
      ],
      cta: '/saler',
    },
  },

  supplier: {
    left: {
      tone: 'brand',
      rows: [
        stat('to_fulfil', '/supplier/fulfilment', { alert: true }),
        stat('today_earnings', '/supplier/vault', { money: true }),
        stat('settled_earnings', '/supplier/vault', { money: true }),
      ],
      cta: '/supplier/fulfilment',
    },
    center: {
      tone: 'soft',
      kind: 'metrics',
      metrics: [
        stat('products', '/supplier/products', { tone: 'info' }),
        stat('low_stock', '/supplier/inventory', { alert: true, tone: 'warn' }),
        stat('out_of_stock', '/supplier/inventory', { alert: true, tone: 'bad' }),
      ],
      cta: '/supplier/inventory',
    },
    right: {
      tone: 'dark',
      rows: [
        link('supplier_orders', '/supplier/orders'),
        link('supplier_salers', '/supplier/salers'),
        link('supplier_scorecard', '/supplier/scorecard'),
        link('supplier_shipments', '/supplier/shipments'),
      ],
      cta: '/supplier',
    },
  },

  moderator: {
    left: {
      tone: 'brand',
      rows: [stat('my_queue', '/moderator/queue'), stat('unassigned', '/moderator/queue')],
      cta: '/moderator/queue',
    },
    center: {
      tone: 'soft',
      kind: 'metrics',
      metrics: [
        stat('resolved_today', '/moderator', { tone: 'ok' }),
        stat('sla_at_risk', '/moderator/queue', { alert: true, tone: 'bad' }),
      ],
      cta: '/moderator',
    },
    right: {
      tone: 'dark',
      rows: [
        link('moderator_reports', '/moderator/reports'),
        link('moderator_reviews', '/moderator/reviews'),
        link('moderator_live', '/moderator/live'),
        link('moderator_disputes', '/moderator/disputes'),
      ],
      cta: '/moderator',
    },
  },

  // Editor has no dashboard numbers, so every panel is shortcuts; no invented figures.
  editor: {
    left: {
      tone: 'brand',
      rows: [link('editor_banners', '/editor/banners'), link('editor_stories', '/editor/stories')],
      cta: '/editor',
    },
    center: {
      tone: 'soft',
      kind: 'links',
      links: [
        link('editor_academy', '/editor/academy', { tone: 'brand' }),
        link('editor_help_center', '/editor/help-center', { tone: 'info' }),
        link('editor_whats_new', '/editor/whats-new', { tone: 'ok' }),
        link('editor_translations', '/editor/translations', { tone: 'acc' }),
      ],
      cta: '/editor',
    },
    right: {
      tone: 'dark',
      rows: [link('editor_translations', '/editor/translations'), link('editor_whats_new', '/editor/whats-new')],
      cta: '/editor',
    },
  },

  admin: {
    ...OPERATIONS,
    center: {
      ...OPERATIONS.center,
      metrics: [
        stat('pending_kyc', '/admin/verification', { alert: true, tone: 'warn' }),
        stat('pending_products', '/admin/catalog/moderation', { alert: true, tone: 'info' }),
        stat('my_pending_requests', '/admin/approvals', { tone: 'acc' }),
      ],
    },
  },
  super_admin: {
    ...OPERATIONS,
    center: {
      ...OPERATIONS.center,
      metrics: [
        stat('pending_kyc', '/admin/verification', { alert: true, tone: 'warn' }),
        stat('pending_products', '/admin/catalog/moderation', { alert: true, tone: 'info' }),
        stat('approvals_waiting', '/admin/approvals', { alert: true, tone: 'acc' }),
      ],
    },
  },
};

/** Roles whose top band replaces ALL THREE columns (customer only replaces the left one). */
export const FULL_BAND_ROLES = ['saler', 'supplier', 'moderator', 'editor', 'admin', 'super_admin'];
