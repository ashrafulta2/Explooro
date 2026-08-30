/**
 * notifications.js — Mock API handlers for the Unified Notification Service (Prompt 8.2).
 *
 * Covers every route in server/src/routes/notification.routes.js so the bell drawer, the
 * What's New modal and /account/settings all resolve under `VITE_API_MODE=mock`. Response
 * envelopes mirror notification.controller.js exactly — `{ data: … }`, with the same inner
 * shapes (`{ items, count, limit, offset }` for the feed, a bare array for preferences).
 */

const CATEGORIES = ['ORDER', 'FINANCE', 'SECURITY', 'MARKETING', 'SYSTEM'];

// WHY module-level state: a mock that forgets a write is worse than no mock — saving
// preferences and then reopening the page has to show what was saved, at least for the session.
const preferences = CATEGORIES.map((category) => ({
  category,
  inapp_enabled: true,
  sms_enabled: category !== 'MARKETING',
  push_enabled: true,
  email_enabled: category !== 'ORDER',
  quiet_hours_start: category === 'MARKETING' ? '22:00' : null,
  quiet_hours_end: category === 'MARKETING' ? '08:00' : null,
}));

const ago = (mins) => new Date(Date.now() - mins * 60 * 1000).toISOString();

let notifications = [
  {
    id: 9001,
    ref: 'NTF-2026-9001',
    template_key: 'order.shipped',
    category: 'ORDER',
    priority: 'NORMAL',
    title_en: 'Your order is on the way',
    title_bn: 'আপনার অর্ডার পথে রয়েছে',
    body_en: 'Sub-order SO-1044-A has been handed to Steadfast. Tracking: STD-88912.',
    body_bn: 'SO-1044-A সাব-অর্ডারটি স্টেডফাস্টের কাছে হস্তান্তর করা হয়েছে। ট্র্যাকিং: STD-88912।',
    data_json: { linkUrl: '/account/orders/1044' },
    channels: ['inapp', 'sms'],
    delivery_status: 'DELIVERED',
    is_read: false,
    read_at: null,
    created_at: ago(12),
  },
  {
    id: 9002,
    ref: 'NTF-2026-9002',
    template_key: 'vault.escrow_released',
    category: 'FINANCE',
    priority: 'HIGH',
    title_en: 'Escrow released to your vault',
    title_bn: 'এসক্রো থেকে আপনার ভল্টে অর্থ যুক্ত হয়েছে',
    body_en: '৳1,240.00 profit from order EXP-2026-0442 has cleared the 7-day escrow hold.',
    body_bn: 'EXP-2026-0442 অর্ডারের ৳১,২৪০.০০ মুনাফা ৭ দিনের এসক্রো শেষে ছাড় হয়েছে।',
    data_json: { linkUrl: '/vault' },
    channels: ['inapp', 'push'],
    delivery_status: 'DELIVERED',
    is_read: false,
    read_at: null,
    created_at: ago(95),
  },
  {
    id: 9003,
    ref: 'NTF-2026-9003',
    template_key: 'auth.new_device_login',
    category: 'SECURITY',
    priority: 'CRITICAL',
    title_en: 'New sign-in from Dhaka',
    title_bn: 'ঢাকা থেকে নতুন লগইন',
    body_en: 'Chrome on Windows signed in to your account. If this was not you, reset your password.',
    body_bn: 'উইন্ডোজের ক্রোম থেকে আপনার অ্যাকাউন্টে লগইন হয়েছে। আপনি না করে থাকলে পাসওয়ার্ড পরিবর্তন করুন।',
    data_json: { linkUrl: '/account/settings' },
    channels: ['inapp', 'sms', 'email'],
    delivery_status: 'DELIVERED',
    is_read: false,
    read_at: null,
    created_at: ago(320),
  },
  {
    id: 9004,
    ref: 'NTF-2026-9004',
    template_key: 'campaign.flash_sale_live',
    category: 'MARKETING',
    priority: 'LOW',
    title_en: 'Eid Flash Sale is live',
    title_bn: 'ঈদ ফ্ল্যাশ সেল শুরু হয়েছে',
    body_en: 'Up to 45% off across 1,200 products for the next 6 hours.',
    body_bn: 'আগামী ৬ ঘণ্টা ১,২০০টি পণ্যে ৪৫% পর্যন্ত ছাড়।',
    data_json: { linkUrl: '/campaigns' },
    channels: ['inapp'],
    delivery_status: 'DELIVERED',
    is_read: true,
    read_at: ago(600),
    created_at: ago(720),
  },
  {
    id: 9005,
    ref: 'NTF-2026-9005',
    template_key: 'system.policy_update',
    category: 'SYSTEM',
    priority: 'NORMAL',
    title_en: 'Updated return policy',
    title_bn: 'রিটার্ন নীতিমালা হালনাগাদ',
    body_en: 'The return window for electronics moves from 3 to 7 days on 1 September.',
    body_bn: '১ সেপ্টেম্বর থেকে ইলেকট্রনিক্স পণ্যের রিটার্নের সময়সীমা ৩ দিন থেকে ৭ দিন হচ্ছে।',
    data_json: { linkUrl: '/help/returns' },
    channels: ['inapp', 'email'],
    delivery_status: 'DELIVERED',
    is_read: true,
    read_at: ago(1300),
    created_at: ago(2880),
  },
];

const releaseNote = {
  version_tag: 'v2.4',
  title_en: 'What is New in Explooro v2.4',
  title_bn: 'এক্সপ্লোরো v2.4-এ নতুন যা আছে',
  summary_en: 'Multi-gateway payments, a rebuilt notification centre, and faster search.',
  summary_bn: 'একাধিক পেমেন্ট গেটওয়ে, নতুন বিজ্ঞপ্তি কেন্দ্র এবং দ্রুততর সার্চ।',
  highlights_json: [
    {
      icon: '💳',
      title_en: 'bKash, Nagad & Rocket',
      title_bn: 'বিকাশ, নগদ ও রকেট',
      desc_en: 'Pay with any major MFS wallet, with SSLCommerz as an automatic fallback.',
      desc_bn: 'যেকোনো এমএফএস ওয়ালেট দিয়ে পরিশোধ করুন, ব্যর্থ হলে স্বয়ংক্রিয়ভাবে এসএসএলকমার্স।',
    },
    {
      icon: '🔔',
      title_en: 'Notification preferences',
      title_bn: 'বিজ্ঞপ্তি পছন্দসমূহ',
      desc_en: 'Choose the channel for every category, and set quiet hours so nothing wakes you.',
      desc_bn: 'প্রতিটি ক্যাটাগরির জন্য চ্যানেল বাছুন এবং নীরব সময় নির্ধারণ করুন।',
    },
  ],
  published_at: ago(2 * 24 * 60),
};

let releaseAcknowledged = false;

export const notificationHandlers = [
  // 1. Notification feed
  {
    method: 'GET',
    path: '/notifications',
    handler({ query }) {
      const limit = parseInt(query.limit, 10) || 20;
      const offset = parseInt(query.offset, 10) || 0;

      let rows = notifications;
      if (query.category && query.category !== 'ALL') {
        rows = rows.filter((n) => n.category === query.category);
      }
      if (query.is_read !== undefined) {
        const wantRead = query.is_read === 'true' || query.is_read === true;
        rows = rows.filter((n) => n.is_read === wantRead);
      }

      const items = rows
        .slice()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(offset, offset + limit);

      return { status: 200, body: { data: { items, count: items.length, limit, offset } } };
    },
  },

  // 2. Unread count
  {
    method: 'GET',
    path: '/notifications/unread-count',
    handler() {
      return {
        status: 200,
        body: { data: { unread_count: notifications.filter((n) => !n.is_read).length } },
      };
    },
  },

  // 3. Channel preferences
  {
    method: 'GET',
    path: '/notifications/preferences',
    handler() {
      return { status: 200, body: { data: preferences.map((p) => ({ ...p })) } };
    },
  },

  {
    method: 'PUT',
    path: '/notifications/preferences',
    handler({ body }) {
      const incoming = Array.isArray(body?.preferences) ? body.preferences : [];

      for (const pref of incoming) {
        if (!pref?.category) continue;
        // WHY SECURITY is skipped: §8.2 requirement 2 — a critical notification (OTP, payout
        // result, dispute decision) overrides preferences, so live never stores an opt-out for
        // it either. Accepting one here would make the mock lie about what the server does.
        if (pref.category === 'SECURITY') continue;

        const next = {
          inapp_enabled: pref.inapp_enabled !== false,
          sms_enabled: pref.sms_enabled !== false,
          push_enabled: pref.push_enabled !== false,
          email_enabled: pref.email_enabled !== false,
          quiet_hours_start: pref.quiet_hours_start || null,
          quiet_hours_end: pref.quiet_hours_end || null,
        };

        const existing = preferences.find((p) => p.category === pref.category);
        if (existing) Object.assign(existing, next);
        else preferences.push({ category: pref.category, ...next });
      }

      return { status: 200, body: { data: { success: true } } };
    },
  },

  // 4. Mark all as read — literal path, registered before /notifications/:id/read so the
  //    first-match-wins loop in mocks/index.js cannot bind "read-all" as an :id.
  {
    method: 'POST',
    path: '/notifications/read-all',
    handler() {
      const now = new Date().toISOString();
      notifications = notifications.map((n) =>
        n.is_read ? n : { ...n, is_read: true, read_at: now }
      );
      return { status: 200, body: { data: { success: true } } };
    },
  },

  // 5. Mark one as read
  {
    method: 'POST',
    path: '/notifications/:id/read',
    handler({ params }) {
      const id = parseInt(params.id, 10);
      const target = notifications.find((n) => n.id === id);
      if (target) {
        target.is_read = true;
        target.read_at = new Date().toISOString();
      }
      return { status: 200, body: { data: { success: Boolean(target) } } };
    },
  },

  // 6. Release announcement — null once acknowledged, so the modal shows exactly once.
  {
    method: 'GET',
    path: '/notifications/whats-new',
    handler() {
      return {
        status: 200,
        body: { data: { releaseNote: releaseAcknowledged ? null : { ...releaseNote } } },
      };
    },
  },

  {
    method: 'POST',
    path: '/notifications/whats-new/ack',
    handler({ body }) {
      if (body?.version_tag === releaseNote.version_tag) releaseAcknowledged = true;
      return { status: 200, body: { data: { success: true } } };
    },
  },

  // 7. Test send (Editor template tooling)
  {
    method: 'POST',
    path: '/notifications/test',
    handler({ body }) {
      return {
        status: 201,
        body: {
          data: {
            notification_id: 9900 + notifications.length,
            template_key: body?.template_key || 'system.test',
            channels: body?.channels || ['inapp'],
            delivery_status: 'SENT',
          },
        },
      };
    },
  },
];

export default notificationHandlers;
