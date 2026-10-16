/**
 * homeSummary.service.ts — the handful of numbers the marketplace home page shows a signed-in user
 * in its top band, chosen by account type.
 *
 * WHY one small endpoint instead of calling each role's dashboard: those dashboards run 6–12 queries
 * each (the admin alerts even sum the whole ledger), return six different shapes, and sit behind
 * different permissions. The home page is the most visited page, so it gets exactly the counts it
 * draws, each a single cheap aggregate, and the client maps stable keys to labels.
 *
 * Every figure is the same definition the role's own console uses (same status sets), so the home
 * band never disagrees with the dashboard it links to. Money stays a string (NUMERIC(14,2)).
 */

import { getCustomerDashboardSummary } from './customerPortal.service.ts';
import { getSalerOverview } from './salerDashboard.service.ts';

const n = (v) => Number(v) || 0;

async function customerStats(db, userId) {
  const s = await getCustomerDashboardSummary(db, userId);
  return {
    active_orders: n(s.orders.active_count),
    delivered_orders: n(s.orders.delivered_count),
    latest_order_ref: s.orders.latest_order?.ref ?? null,
    latest_order_status: s.orders.latest_order?.status ?? null,
    price_drops: n(s.wishlist.price_drops_count),
    wishlist_items: n(s.wishlist.total_items),
    active_teams: n(s.social.active_teams_count),
    active_returns: n(s.protection.active_returns_count),
    coins: n(s.rewards.coins_balance),
  };
}

async function salerStats(db, userId) {
  const { metrics } = await getSalerOverview(db, userId);
  return {
    today_orders: n(metrics.today_orders_count),
    pending_fulfillment: n(metrics.pending_fulfillment_count),
    escrow_balance: String(metrics.escrow_balance ?? '0.00'),
    available_balance: String(metrics.available_balance ?? '0.00'),
    profit_30d: String(metrics.profit_30d ?? '0.00'),
    unread_messages: n(metrics.unread_messages_count),
    link_clicks: n(metrics.total_link_clicks),
  };
}

async function supplierStats(db, userId) {
  const { rows: stock } = await db.query(
    `SELECT
       COUNT(*)::int AS products,
       COUNT(*) FILTER (WHERE stock_qty <= low_stock_threshold)::int AS low_stock,
       COUNT(*) FILTER (WHERE stock_qty = 0)::int AS out_of_stock
     FROM products
     WHERE supplier_id = $1 AND status != 'ARCHIVED'`,
    [userId],
  );
  const { rows: orders } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('PLACED', 'CONFIRMED', 'PROCESSING'))::int AS to_fulfil,
       COALESCE(SUM(wholesale_margin) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::numeric(14,2) AS today_earnings,
       COALESCE(SUM(wholesale_margin) FILTER (WHERE status = 'DELIVERED'), 0)::numeric(14,2) AS settled_earnings
     FROM sub_orders
     WHERE supplier_id = $1`,
    [userId],
  );
  const s = stock[0] || {};
  const o = orders[0] || {};
  return {
    products: n(s.products),
    low_stock: n(s.low_stock),
    out_of_stock: n(s.out_of_stock),
    to_fulfil: n(o.to_fulfil),
    today_earnings: String(o.today_earnings ?? '0.00'),
    settled_earnings: String(o.settled_earnings ?? '0.00'),
  };
}

async function moderatorStats(db, userId) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE claimed_by = $1 AND status = 'IN_REVIEW')::int AS my_queue,
       COUNT(*) FILTER (WHERE status = 'PENDING')::int AS unassigned,
       COUNT(*) FILTER (WHERE status IN ('PENDING', 'IN_REVIEW') AND sla_due_at <= now() + interval '2 hours')::int AS sla_at_risk,
       COUNT(*) FILTER (WHERE decided_by = $1 AND decided_at >= date_trunc('day', now()))::int AS resolved_today
     FROM moderation_queue`,
    [userId],
  );
  const r = rows[0] || {};
  return {
    my_queue: n(r.my_queue),
    unassigned: n(r.unassigned),
    sla_at_risk: n(r.sla_at_risk),
    resolved_today: n(r.resolved_today),
  };
}

// Admin and super admin see the same operations picture; super admin additionally sees how many
// maker-checker approvals are waiting (an admin's own pending requests are theirs to follow up).
async function adminStats(db, userId, role) {
  const { rows: today } = await db.query(
    `SELECT COUNT(*)::int AS orders,
            COALESCE(SUM(total_amount), 0)::numeric(14,2) AS gmv
     FROM orders WHERE created_at >= date_trunc('day', now())`,
  );
  const { rows: queue } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM kyc_verifications WHERE status = 'PENDING')::int AS pending_kyc,
       (SELECT COUNT(*) FROM products WHERE status = 'PENDING_APPROVAL')::int AS pending_products,
       (SELECT COUNT(*) FROM dispute_threads
         WHERE status IN ('OPEN', 'UNDER_ARBITRATION', 'AWAITING_CUSTOMER', 'AWAITING_SELLER')
           AND sla_due_at IS NOT NULL AND sla_due_at < NOW())::int AS disputes_past_sla,
       (SELECT COUNT(*) FROM payout_requests WHERE status = 'FAILED')::int AS failed_payouts`,
  );
  const stats: Record<string, any> = {
    orders_today: n(today[0]?.orders),
    gmv_today: String(today[0]?.gmv ?? '0.00'),
    pending_kyc: n(queue[0]?.pending_kyc),
    pending_products: n(queue[0]?.pending_products),
    disputes_past_sla: n(queue[0]?.disputes_past_sla),
    failed_payouts: n(queue[0]?.failed_payouts),
  };
  if (role === 'super_admin') {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS waiting FROM pending_admin_actions WHERE status = 'PENDING'`,
    );
    stats.approvals_waiting = n(rows[0]?.waiting);
  } else {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS mine FROM pending_admin_actions WHERE actor_id = $1 AND status = 'PENDING'`,
      [userId],
    );
    stats.my_pending_requests = n(rows[0]?.mine);
  }
  return stats;
}

// ── Rankings for the centre slider ─────────────────────────────────────────────────────────────
// WHY a separate `insights` object and not more `stats`: stats are flat numbers the client maps to
// labels; a ranking is a list. Each role gets the lists that tell it something its own console's
// first screen does not (see INSIGHT_BOARDS). Every sales ranking is a 30-day window over live
// parcels only, so a cancelled or returned sale never lifts anyone up a board.
const INSIGHT_DAYS = 30;
const INSIGHT_LIMIT = 5;
// WHY: a search phrase is shown only once this many different shoppers typed it. Free-text search
// can hold a phone number or a name; one person's query must never surface on someone else's screen.
const SEARCH_MIN_PEOPLE = 3;
// "Repeat" means rejected at least this many times in the window; one rejection is a mistake, not a pattern.
const REPEAT_MIN_REJECTIONS = 2;
const LIVE_PARCEL = `so.status NOT IN ('CANCELLED', 'REFUNDED', 'RETURNED')`;
const IN_WINDOW = (col) => `${col} >= now() - ($1 || ' days')::interval`;
const PERSON = (alias) => `COALESCE(MAX(${alias}.display_name), MAX(${alias}.full_name))`;

const entry = (r) => ({
  id: String(r.id),
  name_en: r.name_en ?? null,
  name_bn: r.name_bn ?? r.name_en ?? null,
  count: n(r.count),
  amount: r.amount == null ? null : String(r.amount),
  ...(r.code ? { code: r.code } : {}),
});

// `scope` narrows a sales ranking to one account: ['saler_id' | 'supplier_id', userId], or null for the whole platform.
function scoped(scope) {
  return scope ? { where: `AND so.${scope[0]} = $3`, params: [scope[1]] } : { where: '', params: [] };
}

async function productBoard(db, scope) {
  const s = scoped(scope);
  const { rows } = await db.query(
    `SELECT p.id, p.title_en AS name_en, p.title_bn AS name_bn,
            SUM(oi.qty)::int AS count, SUM(oi.line_total)::numeric(14,2) AS amount
     FROM sub_orders so
     JOIN order_items oi ON oi.sub_order_id = so.id
     JOIN products p ON p.id = oi.product_id
     WHERE ${LIVE_PARCEL} AND ${IN_WINDOW('so.created_at')} ${s.where}
       ${scope ? '' : "AND p.status = 'ACTIVE'"}
     GROUP BY p.id, p.title_en, p.title_bn
     ORDER BY count DESC, amount DESC
     LIMIT $2`,
    [INSIGHT_DAYS, INSIGHT_LIMIT, ...s.params],
  );
  return rows.map(entry);
}

// A supplier ranks Shop Partners by what they sold of its stock (base value); the platform ranks by GMV.
async function salerBoard(db, scope) {
  const s = scoped(scope);
  const money = scope ? 'so.subtotal_base' : 'so.total_amount';
  const { rows } = await db.query(
    `SELECT so.saler_id AS id, COALESCE(MAX(vs.shop_name), ${PERSON('up')}) AS name_en,
            COUNT(*)::int AS count, SUM(${money})::numeric(14,2) AS amount
     FROM sub_orders so
     LEFT JOIN virtual_stores vs ON vs.saler_id = so.saler_id AND vs.deleted_at IS NULL
     LEFT JOIN user_profiles up ON up.user_id = so.saler_id
     WHERE so.saler_id IS NOT NULL AND ${LIVE_PARCEL} AND ${IN_WINDOW('so.created_at')} ${s.where}
     GROUP BY so.saler_id
     ORDER BY amount DESC, count DESC
     LIMIT $2`,
    [INSIGHT_DAYS, INSIGHT_LIMIT, ...s.params],
  );
  return rows.map(entry);
}

async function supplierBoard(db) {
  const { rows } = await db.query(
    `SELECT so.supplier_id AS id, ${PERSON('up')} AS name_en,
            COUNT(*)::int AS count, SUM(so.total_amount)::numeric(14,2) AS amount
     FROM sub_orders so
     LEFT JOIN user_profiles up ON up.user_id = so.supplier_id
     WHERE ${LIVE_PARCEL} AND ${IN_WINDOW('so.created_at')}
     GROUP BY so.supplier_id
     ORDER BY amount DESC, count DESC
     LIMIT $2`,
    [INSIGHT_DAYS, INSIGHT_LIMIT],
  );
  return rows.map(entry);
}

async function categoryBoard(db) {
  const { rows } = await db.query(
    `SELECT c.id, c.name_en, c.name_bn,
            SUM(oi.qty)::int AS count, SUM(oi.line_total)::numeric(14,2) AS amount
     FROM sub_orders so
     JOIN order_items oi ON oi.sub_order_id = so.id
     JOIN products p ON p.id = oi.product_id
     JOIN categories c ON c.id = p.category_id
     WHERE ${LIVE_PARCEL} AND ${IN_WINDOW('so.created_at')}
     GROUP BY c.id, c.name_en, c.name_bn
     ORDER BY amount DESC, count DESC
     LIMIT $2`,
    [INSIGHT_DAYS, INSIGHT_LIMIT],
  );
  return rows.map(entry);
}

async function searchBoard(db) {
  const { rows } = await db.query(
    `SELECT MIN(id) AS id, query_normalized AS name_en, COUNT(*)::int AS count
     FROM search_events
     WHERE audience = 'customer' AND ${IN_WINDOW('created_at')}
     GROUP BY query_normalized
     HAVING COUNT(DISTINCT COALESCE(user_id::text, session_id)) >= $3
     ORDER BY count DESC
     LIMIT $2`,
    [INSIGHT_DAYS, INSIGHT_LIMIT, SEARCH_MIN_PEOPLE],
  );
  return rows.map((r) => entry({ ...r, name_bn: r.name_en }));
}

// Same open-status set as the moderator console's queue. No time window: it is what is waiting now,
// by kind, so a moderator sees which queue is piling up.
async function queueTypeBoard(db) {
  const { rows } = await db.query(
    `SELECT item_type AS id, item_type AS code, COUNT(*)::int AS count
     FROM moderation_queue
     WHERE status IN ('PENDING', 'IN_REVIEW', 'ESCALATED')
     GROUP BY item_type
     ORDER BY count DESC
     LIMIT $1`,
    [INSIGHT_LIMIT],
  );
  return rows.map(entry);
}

async function rejectionBoard(db) {
  const { rows } = await db.query(
    `SELECT mq.submitted_by AS id, ${PERSON('up')} AS name_en, COUNT(*)::int AS count
     FROM moderation_queue mq
     LEFT JOIN user_profiles up ON up.user_id = mq.submitted_by
     WHERE mq.status = 'REJECTED' AND ${IN_WINDOW('mq.decided_at')}
     GROUP BY mq.submitted_by
     HAVING COUNT(*) >= $3
     ORDER BY count DESC
     LIMIT $2`,
    [INSIGHT_DAYS, INSIGHT_LIMIT, REPEAT_MIN_REJECTIONS],
  );
  return rows.map(entry);
}

const OPERATIONS_BOARDS = {
  top_suppliers: (db) => supplierBoard(db),
  top_salers: (db) => salerBoard(db, null),
  top_categories: (db) => categoryBoard(db),
};

/**
 * Which rankings each role sees. WHY these: a Shop Partner needs to know what sells (their own, and what
 * is moving on the platform that they could add) and what shoppers look for; a supplier, who sells only
 * through Shop Partners, needs to know which partners and which of its products carry it; operations
 * staff need the platform's leaders; a moderator, where the queue is piling up and who keeps getting
 * rejected; an editor, what shoppers search and buy, which is what banners and stories should be about.
 */
export const INSIGHT_BOARDS = {
  saler: {
    top_products: (db, userId) => productBoard(db, ['saler_id', userId]),
    trending_products: (db) => productBoard(db, null),
    trending_searches: (db) => searchBoard(db),
  },
  supplier: {
    top_salers: (db, userId) => salerBoard(db, ['supplier_id', userId]),
    top_products: (db, userId) => productBoard(db, ['supplier_id', userId]),
  },
  admin: OPERATIONS_BOARDS,
  super_admin: OPERATIONS_BOARDS,
  moderator: {
    queue_by_type: (db) => queueTypeBoard(db),
    repeat_rejections: (db) => rejectionBoard(db),
  },
  editor: {
    trending_searches: (db) => searchBoard(db),
    top_categories: (db) => categoryBoard(db),
  },
};

// WHY each board fails on its own: a ranking is decoration on top of the counts. One slow or broken
// query must not blank the numbers or the other slides; that board alone comes back null and the
// client shows its empty state.
async function buildInsights(db, userId, role) {
  const boards = INSIGHT_BOARDS[role];
  if (!boards) return null;
  const keys = Object.keys(boards);
  const lists = await Promise.all(keys.map((k) => boards[k](db, userId).catch(() => null)));
  return Object.fromEntries(keys.map((k, i) => [k, lists[i]]));
}

const BUILDERS = {
  customer: customerStats,
  saler: salerStats,
  supplier: supplierStats,
  moderator: moderatorStats,
  admin: (db, userId) => adminStats(db, userId, 'admin'),
  super_admin: (db, userId) => adminStats(db, userId, 'super_admin'),
};

/**
 * @returns {{ role: string, stats: object|null, insights: object|null }} `stats` is null for a role with
 * nothing to count (editor, finance, guests); the client then draws links only instead of inventing numbers.
 * `insights` holds the ranked lists (INSIGHT_BOARDS), null for a role without any.
 */
export async function getHomeSummary(db, { userId, role }): Promise<{ role: string; stats: any | null; insights: any | null; }> {
  const build = BUILDERS[role];
  const [stats, insights] = await Promise.all([build ? build(db, userId) : null, buildInsights(db, userId, role)]);
  return { role, stats, insights };
}
