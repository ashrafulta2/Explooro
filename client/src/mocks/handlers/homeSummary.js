/**
 * homeSummary.js — Mock handler for GET /home/summary (server/src/routes/homeSummary.routes.js).
 *
 * Mirrors the live envelope `{ data: { role, stats } }` and the live key names per role, so the
 * home top band is fully previewable under VITE_API_MODE=mock for every dev account.
 */

import { getMockSessionUser } from './auth.js';

export const MOCK_HOME_STATS = {
  customer: { active_orders: 1, delivered_orders: 4, latest_order_ref: 'ORD-DH-90123', latest_order_status: 'SHIPPED', price_drops: 2, wishlist_items: 6, active_teams: 1, active_returns: 0, coins: 340 },
  saler: { today_orders: 7, pending_fulfillment: 3, escrow_balance: '4820.00', available_balance: '2150.00', profit_30d: '18400.00', unread_messages: 5, link_clicks: 342 },
  supplier: { products: 48, low_stock: 6, out_of_stock: 1, to_fulfil: 12, today_earnings: '3250.00', settled_earnings: '152300.00' },
  moderator: { my_queue: 4, unassigned: 11, sla_at_risk: 2, resolved_today: 38 },
  admin: { orders_today: 1206, gmv_today: '840000.00', pending_kyc: 8, pending_products: 23, disputes_past_sla: 3, failed_payouts: 2, my_pending_requests: 2 },
  super_admin: { orders_today: 1206, gmv_today: '840000.00', pending_kyc: 8, pending_products: 23, disputes_past_sla: 3, failed_payouts: 2, approvals_waiting: 5 },
};

export const homeSummaryHandlers = [
  {
    method: 'GET',
    path: '/home/summary',
    handler() {
      const user = getMockSessionUser();
      const role = user?.roles?.[0] || user?.role || 'customer';
      return { status: 200, body: { data: { role, stats: MOCK_HOME_STATS[role] || null } } };
    },
  },
];
