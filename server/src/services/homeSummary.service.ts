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

const BUILDERS = {
  customer: customerStats,
  saler: salerStats,
  supplier: supplierStats,
  moderator: moderatorStats,
  admin: (db, userId) => adminStats(db, userId, 'admin'),
  super_admin: (db, userId) => adminStats(db, userId, 'super_admin'),
};

/**
 * @returns {{ role: string, stats: object|null }} `stats` is null for a role with nothing to count
 * (editor, finance, guests); the client then draws links only instead of inventing numbers.
 */
export async function getHomeSummary(db, { userId, role }): Promise<{ role: string; stats: any | null; }> {
  const build = BUILDERS[role];
  if (!build) return { role, stats: null };
  return { role, stats: await build(db, userId) };
}
