/**
 * homeSummary.ts — Mock handler for GET /home/summary (server/src/routes/homeSummary.routes.ts).
 *
 * Mirrors the live envelope `{ data: { role, stats } }` and the live key names per role, so the
 * home top band is fully previewable under VITE_API_MODE=mock for every dev account.
 */

import { getMockSessionUser } from './auth.ts';
import type { MockRoute } from '../types.ts';

export const MOCK_HOME_STATS = {
  customer: { active_orders: 1, delivered_orders: 4, latest_order_ref: 'ORD-DH-90123', latest_order_status: 'SHIPPED', price_drops: 2, wishlist_items: 6, active_teams: 1, active_returns: 0, coins: 340 },
  saler: { today_orders: 7, pending_fulfillment: 3, escrow_balance: '4820.00', available_balance: '2150.00', profit_30d: '18400.00', unread_messages: 5, link_clicks: 342 },
  supplier: { products: 48, low_stock: 6, out_of_stock: 1, to_fulfil: 12, today_earnings: '3250.00', settled_earnings: '152300.00' },
  moderator: { my_queue: 4, unassigned: 11, sla_at_risk: 2, resolved_today: 38 },
  admin: { orders_today: 1206, gmv_today: '840000.00', pending_kyc: 8, pending_products: 23, disputes_past_sla: 3, failed_payouts: 2, my_pending_requests: 2 },
  super_admin: { orders_today: 1206, gmv_today: '840000.00', pending_kyc: 8, pending_products: 23, disputes_past_sla: 3, failed_payouts: 2, approvals_waiting: 5 },
};

// Ranked lists for the centre slider, keyed exactly as the live `insights` object
// (server/src/services/homeSummary.service.ts INSIGHT_BOARDS). Entry shape: { id, name_en, name_bn,
// count, amount|null, code? }. `amount: null` means the board ranks a count, not money.
const row = (id, en, bn, count, amount = null, extra = {}) => ({ id, name_en: en, name_bn: bn ?? en, count, amount, ...extra });

const PLATFORM_PRODUCTS = [
  row('301', 'Jamdani Saree - Red', 'জামদানি শাড়ি - লাল', 212, '1484000.00'),
  row('302', 'Smart Watch S9', 'স্মার্ট ওয়াচ এস৯', 168, '504000.00'),
  row('303', 'Cotton Panjabi - Navy', 'কটন পাঞ্জাবি - নেভি', 151, '166100.00'),
  row('304', 'Kids School Bag', 'বাচ্চাদের স্কুল ব্যাগ', 97, '82450.00'),
  row('305', 'Mustard Oil 5L', 'সরিষার তেল ৫ লিটার', 88, '79200.00'),
];
const SEARCHES = [
  row('401', 'eid panjabi', null, 1840),
  row('402', 'jamdani saree', null, 1325),
  row('403', 'smart watch', null, 910),
  row('404', 'baby diaper', null, 644),
  row('405', 'gaming headphone', null, 402),
];
const CATEGORIES = [
  row('501', "Women's Fashion", 'নারীদের ফ্যাশন', 1420, '3820000.00'),
  row('502', 'Electronics', 'ইলেকট্রনিক্স', 610, '2960000.00'),
  row('503', "Men's Fashion", 'পুরুষদের ফ্যাশন', 980, '1710000.00'),
  row('504', 'Food & Grocery', 'খাদ্য ও মুদি', 2210, '940000.00'),
  row('505', 'Kids', 'শিশু', 455, '512000.00'),
];
const OPERATIONS = {
  top_suppliers: [
    row('601', 'Tangail Weavers Ltd', null, 412, '2140000.00'),
    row('602', 'Gadget Point BD', null, 288, '1765000.00'),
    row('603', 'Fresh Farm Foods', null, 940, '820000.00'),
    row('604', 'Heritage Crafts BD', null, 133, '610500.00'),
    row('605', 'Little Steps Kids', null, 201, '398000.00'),
  ],
  top_salers: [
    row('201', 'Dhaka Trends', null, 64, '182500.00'),
    row('202', 'Rafi Mobile Hub', null, 51, '149200.00'),
    row('203', 'Sylhet Bazar', null, 37, '96400.00'),
    row('204', 'Nusrat Boutique', null, 22, '58700.00'),
    row('205', 'Green Basket', null, 11, '30100.00'),
  ],
  top_categories: CATEGORIES,
};

export const MOCK_HOME_INSIGHTS = {
  saler: {
    top_products: [
      row('101', 'Cotton Panjabi - Navy', 'কটন পাঞ্জাবি - নেভি', 38, '41800.00'),
      row('102', 'Wireless Earbuds Pro', 'ওয়্যারলেস ইয়ারবাড প্রো', 24, '36000.00'),
      row('103', 'Leather Wallet - Brown', 'লেদার ওয়ালেট - ব্রাউন', 31, '24800.00'),
      row('104', 'Organic Honey 500g', 'অর্গানিক মধু ৫০০ গ্রাম', 19, '13300.00'),
      row('105', 'Yoga Mat 6mm', 'যোগা ম্যাট ৬ মিমি', 9, '8100.00'),
    ],
    trending_products: PLATFORM_PRODUCTS,
    trending_searches: SEARCHES,
  },
  supplier: {
    top_salers: OPERATIONS.top_salers,
    top_products: [
      row('701', 'Smart Watch S9', 'স্মার্ট ওয়াচ এস৯', 96, '230400.00'),
      row('702', 'Wireless Earbuds Pro', 'ওয়্যারলেস ইয়ারবাড প্রো', 71, '85200.00'),
      row('703', 'Power Bank 20000mAh', 'পাওয়ার ব্যাংক ২০০০০ এমএএইচ', 54, '59400.00'),
      row('704', 'USB-C Cable 2m', 'ইউএসবি-সি ক্যাবল ২ মিটার', 120, '24000.00'),
      row('705', 'Phone Stand', 'ফোন স্ট্যান্ড', 33, '8250.00'),
    ],
  },
  admin: OPERATIONS,
  super_admin: OPERATIONS,
  moderator: {
    queue_by_type: [
      row('PRODUCT_NEW', 'PRODUCT_NEW', null, 14, null, { code: 'PRODUCT_NEW' }),
      row('REVIEW', 'REVIEW', null, 9, null, { code: 'REVIEW' }),
      row('UGC_VIDEO', 'UGC_VIDEO', null, 6, null, { code: 'UGC_VIDEO' }),
      row('PRODUCT_EDIT', 'PRODUCT_EDIT', null, 4, null, { code: 'PRODUCT_EDIT' }),
      row('CHAT_REPORT', 'CHAT_REPORT', null, 2, null, { code: 'CHAT_REPORT' }),
      // All seven kinds: the live board sends every kind with work waiting (no LIMIT), so the share
      // legend must fit the worst case.
      row('STOREFRONT_ASSET', 'STOREFRONT_ASSET', null, 1, null, { code: 'STOREFRONT_ASSET' }),
      row('LIVE_STREAM', 'LIVE_STREAM', null, 1, null, { code: 'LIVE_STREAM' }),
    ],
    repeat_rejections: [
      row('801', 'Quick Deals Shop', null, 6),
      row('802', 'Bargain Bazar', null, 4),
      row('803', 'Star Electronics', null, 3),
      row('804', 'Moni Collection', null, 2),
    ],
  },
  editor: {
    trending_searches: SEARCHES,
    top_categories: CATEGORIES,
  },
};

export const homeSummaryHandlers = [
  {
    method: 'GET',
    path: '/home/summary',
    handler() {
      const user = getMockSessionUser();
      const role = user?.roles?.[0] || user?.role || 'customer';
      return { status: 200, body: { data: { role, stats: MOCK_HOME_STATS[role] || null, insights: MOCK_HOME_INSIGHTS[role] || null } } };
    },
  },
] satisfies MockRoute[];
