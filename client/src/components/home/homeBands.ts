/**
 * homeBands.ts — what the home top band shows each account type.
 *
 * Pure data. A guest keeps the earn panel, and a customer keeps the campaign slider in the middle
 * (both are in HomeTop.ts); every other account type gets three panels from here, because a
 * supplier, moderator or admin has no use for "start earning with zero stock".
 *
 * Rows come in two kinds:
 *   { stat, path }  — a number from GET /home/summary. Label is `marketplace.top.band.stat.<stat>`.
 *   { link, path }  — a plain shortcut, for roles with no numbers. Label is `marketplace.top.band.link.<link>`.
 * `money` formats the figure as currency; `alert` tints it when it is above zero (work waiting).
 *
 * The centre panel is a slider (`slides`), like the customer's campaign slider. Each slide is one of:
 *   kind 'leaderboard' — ranks `insights.<board>` from the same endpoint; `count` names the unit of the
 *                        figure under each name (`marketplace.top.band.board.count.<count>`), and `view`
 *                        picks how it is drawn (RoleBand.ts VIEWS: list, spotlight, bars, chips, tiles,
 *                        share). No two slides in one role use the same view, so the slider never repeats.
 *   kind 'metrics'     — the role's key figures as tinted cards.
 *   kind 'links'       — shortcut tiles, for a role with no numbers.
 * Its words are `marketplace.top.band.<role>.center.<slide id>.{kicker,title,cta}`. `tone` picks the
 * slide's fill (home-top.css `.home-band__slide--<tone>`): every slide in a role has its own, and no two
 * roles open on the same colour, so an account type is recognisable at a glance.
 *
 * Every `path` is a route in config/navigation.ts. A test (homeBands.test.js) checks that and that
 * every label exists in both locales, so a renamed route or a missing translation fails the build.
 */

/** Slide fills, all white-text safe in light and dark mode (see home-top.css). */
export const SLIDE_TONES = ['orange', 'teal', 'plum', 'success', 'info', 'accent', 'rose', 'amber'] as const;

export type SlideTone = (typeof SLIDE_TONES)[number];

/** A number from GET /home/summary; the label is `marketplace.top.band.stat.<stat>`. */
export interface StatRow {
  stat: string;
  /** A route in config/navigation.ts. */
  path: string;
  /** Format the figure as currency. */
  money?: boolean;
  /** Tint the figure when it is above zero (work waiting). */
  alert?: boolean;
  tone?: string;
}

/** A plain shortcut for a role with no numbers; the label is `marketplace.top.band.link.<link>`. */
export interface LinkRow {
  link: string;
  path: string;
  tone?: string;
}

export type BandRow = StatRow | LinkRow;

/** How a leaderboard slide is drawn (RoleBand.ts VIEWS). No two slides in one role use the same view. */
export type SlideView = 'list' | 'spotlight' | 'bars' | 'chips' | 'tiles' | 'share';

interface SlideBase {
  id: string;
  tone: SlideTone;
  cta: string;
}

/** Ranks `insights.<board>` from the same endpoint. */
export interface LeaderboardSlide extends SlideBase {
  kind: 'leaderboard';
  board: string;
  /** Names the unit under each figure (`marketplace.top.band.board.count.<count>`). */
  count: string;
  view?: SlideView;
  /** The label key for each name, when the rows are not plain names. */
  nameKey?: string;
}

/** The role's key figures as tinted cards. */
export interface MetricsSlide extends SlideBase {
  kind: 'metrics';
  metrics: StatRow[];
}

/** Shortcut tiles, for a role with no numbers. */
export interface LinksSlide extends SlideBase {
  kind: 'links';
  links: LinkRow[];
}

export type BandSlide = LeaderboardSlide | MetricsSlide | LinksSlide;

/** The left and right panels: a few rows and one call to action. */
export interface BandPanel {
  tone: 'brand' | 'dark' | string;
  rows: BandRow[];
  cta: string;
}

/** What one account type's top band shows. A customer replaces only the left panel. */
export interface RoleBand {
  left?: BandPanel;
  center?: { slides: BandSlide[] };
  right?: BandPanel;
}

const stat = (key: string, path: string, extra: Partial<StatRow> = {}): StatRow => ({ stat: key, path, ...extra });
const link = (key: string, path: string, extra: Partial<LinkRow> = {}): LinkRow => ({ link: key, path, ...extra });
const board = (
  id: string,
  tone: SlideTone,
  count: string,
  cta: string,
  extra: Partial<LeaderboardSlide> = {},
): LeaderboardSlide => ({ id, tone, kind: 'leaderboard', board: id, count, cta, ...extra });

// Admin and super admin share one picture. Only the third review-queue figure differs: a super
// admin sees the approvals waiting on them, an admin sees their own requests still pending.
const operations = (thirdMetric: StatRow): RoleBand => ({
  left: {
    tone: 'brand',
    rows: [stat('orders_today', '/admin/orders'), stat('gmv_today', '/admin/orders', { money: true })],
    cta: '/admin',
  },
  center: {
    slides: [
      {
        id: 'queue',
        tone: 'accent',
        kind: 'metrics',
        metrics: [
          stat('pending_kyc', '/admin/verification', { alert: true, tone: 'warn' }),
          stat('pending_products', '/admin/catalog/moderation', { alert: true, tone: 'info' }),
          thirdMetric,
        ],
        cta: '/admin/approvals',
      },
      board('top_suppliers', 'success', 'orders', '/admin/users', { view: 'spotlight' }),
      board('top_salers', 'orange', 'orders', '/admin/users', { view: 'bars' }),
      board('top_categories', 'plum', 'units', '/admin/catalog/categories', { view: 'tiles' }),
    ],
  },
  right: {
    tone: 'dark',
    rows: [
      stat('disputes_past_sla', '/admin/disputes', { alert: true }),
      stat('failed_payouts', '/admin/finance/payouts', { alert: true }),
    ],
    cta: '/admin/disputes',
  },
});

export const ROLE_BANDS: Record<string, RoleBand> = {
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

  // WHY no balance cards in the centre: escrow, available and 30-day profit are the first thing the
  // Shop Partner's vault and dashboard show. The centre is the band's widest panel, so it carries what
  // the console does not put up front: what sells, what is selling platform-wide, what shoppers search.
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
      slides: [
        board('top_products', 'orange', 'units', '/saler/analytics', { view: 'spotlight' }),
        board('trending_products', 'teal', 'units', '/saler/sourcing', { view: 'tiles' }),
        board('trending_searches', 'plum', 'searches', '/saler/products', { view: 'chips' }),
      ],
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
      slides: [
        board('top_salers', 'success', 'orders', '/supplier/salers', { view: 'bars' }),
        board('top_products', 'info', 'units', '/supplier/products', { view: 'list' }),
        {
          id: 'stock',
          tone: 'amber',
          kind: 'metrics',
          metrics: [
            stat('products', '/supplier/products', { tone: 'info' }),
            stat('low_stock', '/supplier/inventory', { alert: true, tone: 'warn' }),
            stat('out_of_stock', '/supplier/inventory', { alert: true, tone: 'bad' }),
          ],
          cta: '/supplier/inventory',
        },
      ],
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
      slides: [
        {
          id: 'shift',
          tone: 'info',
          kind: 'metrics',
          metrics: [
            stat('resolved_today', '/moderator', { tone: 'ok' }),
            stat('sla_at_risk', '/moderator/queue', { alert: true, tone: 'bad' }),
          ],
          cta: '/moderator',
        },
        board('queue_by_type', 'plum', 'items', '/moderator/queue', { view: 'share', nameKey: 'marketplace.top.band.board.item_type' }),
        board('repeat_rejections', 'rose', 'rejections', '/moderator/reports', { view: 'list' }),
      ],
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

  // Editor has no dashboard numbers of its own; its rankings say what banners and stories should be about.
  editor: {
    left: {
      tone: 'brand',
      rows: [link('editor_banners', '/editor/banners'), link('editor_stories', '/editor/stories')],
      cta: '/editor',
    },
    center: {
      slides: [
        {
          id: 'shortcuts',
          tone: 'teal',
          kind: 'links',
          links: [
            link('editor_academy', '/editor/academy', { tone: 'brand' }),
            link('editor_help_center', '/editor/help-center', { tone: 'info' }),
            link('editor_whats_new', '/editor/whats-new', { tone: 'ok' }),
            link('editor_translations', '/editor/translations', { tone: 'acc' }),
          ],
          cta: '/editor',
        },
        board('trending_searches', 'orange', 'searches', '/editor/banners', { view: 'chips' }),
        board('top_categories', 'accent', 'units', '/editor/stories', { view: 'tiles' }),
      ],
    },
    right: {
      tone: 'dark',
      rows: [link('editor_translations', '/editor/translations'), link('editor_whats_new', '/editor/whats-new')],
      cta: '/editor',
    },
  },

  admin: operations(stat('my_pending_requests', '/admin/approvals', { tone: 'acc' })),
  super_admin: operations(stat('approvals_waiting', '/admin/approvals', { alert: true, tone: 'acc' })),
};

/** Roles whose top band replaces ALL THREE columns (customer only replaces the left one). */
export const FULL_BAND_ROLES: string[] = ['saler', 'supplier', 'moderator', 'editor', 'admin', 'super_admin'];
