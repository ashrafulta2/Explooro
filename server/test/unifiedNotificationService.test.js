/**
 * unifiedNotificationService.test.js — Prompt 8.2 Test Suite
 *
 * Tests:
 * - Acceptance 1: Multi-channel fan-out across in-app, SMS, and push.
 * - Acceptance 2: Channel opt-out suppresses marketing SMS while critical OTP overrides opt-out.
 * - Acceptance 3: Bilingual template rendering with variable substitution.
 * - Acceptance 4: What's New release announcements shown once per version per user.
 * - Acceptance 5: Fastify HTTP REST API endpoints.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import requestContextPlugin from '../src/plugins/requestContext.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import notificationRoutes from '../src/routes/notification.routes.js';
import * as notifService from '../src/services/notification.service.js';

function createMockDb() {
  const users = [
    { id: 201, full_name: 'Habib Customer', phone: '01712345678', email: 'habib@explooro.com', locale: 'en' },
    { id: 202, full_name: 'Fatima Saler', phone: '01898765432', email: 'fatima@explooro.com', locale: 'bn' },
  ];

  const notificationTemplates = [
    { ...notifService.DEFAULT_TEMPLATES.OTP_VERIFICATION },
    { ...notifService.DEFAULT_TEMPLATES.ORDER_PLACED },
    { ...notifService.DEFAULT_TEMPLATES.PAYOUT_DISBURSED },
    { ...notifService.DEFAULT_TEMPLATES.MARKETING_PROMO },
  ];

  const notificationPreferences = [
    {
      user_id: 201,
      category: 'MARKETING',
      inapp_enabled: true,
      sms_enabled: false, // Opted out of marketing SMS
      push_enabled: true,
      email_enabled: false,
    },
  ];

  const notifications = [
    {
      id: 1,
      ref: 'NTF-INIT-01',
      user_id: 201,
      template_key: 'ORDER_PLACED',
      category: 'ORDER',
      priority: 'HIGH',
      title_en: 'Order Confirmed',
      title_bn: 'অর্ডার নিশ্চিতকরণ',
      body_en: 'Order #SO-9921 placed successfully for ৳2,500.00.',
      body_bn: 'অর্ডার #SO-9921 সফলভাবে সম্পন্ন হয়েছে। মোট ৳2,500.00।',
      data_json: { orderRef: 'SO-9921' },
      channels: ['INAPP', 'SMS'],
      delivery_status: { INAPP: 'DELIVERED', SMS: 'SENT' },
      is_read: false,
      created_at: new Date().toISOString(),
    },
  ];

  const releaseNotes = [
    {
      id: 1,
      version_tag: 'v2.4.0',
      title_en: "What's New in Explooro v2.4.0",
      title_bn: 'এক্সপ্লোরো ২.৪.০ সংস্করণে নতুন কী রয়েছে',
      summary_en: 'Real-time WebSocket chat and multi-channel notification engine.',
      summary_bn: 'রিয়েল-টাইম ওয়েবসকেট চ্যাট এবং নোটিফিকেশন ইঞ্জিন।',
      highlights_json: [{ icon: '⚡', title_en: 'Live Chat', desc_en: 'Low-latency peer chat.' }],
      published_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: new Date().toISOString(),
    },
  ];

  const userReleaseViews = [];
  let nextNotifId = 2;

  const mockDb = {
    users,
    notificationTemplates,
    notificationPreferences,
    notifications,
    releaseNotes,
    userReleaseViews,
    async query(sql, params = []) {
      const q = sql.trim();

      // SELECT users WHERE id = $1
      if (q.includes('FROM users WHERE id = $1')) {
        const uId = params[0];
        const found = users.find((u) => u.id === Number(uId));
        return { rows: found ? [found] : [] };
      }

      // SELECT notification_templates WHERE template_key = $1
      if (q.includes('FROM notification_templates WHERE template_key = $1')) {
        const key = params[0];
        const found = notificationTemplates.find((t) => t.template_key === key);
        return { rows: found ? [found] : [] };
      }

      // SELECT notification_preferences
      if (q.includes('FROM notification_preferences WHERE user_id = $1 AND category = $2')) {
        const uId = params[0];
        const cat = params[1];
        const found = notificationPreferences.find((p) => p.user_id === Number(uId) && p.category === cat);
        return { rows: found ? [found] : [] };
      }

      if (q.includes('FROM notification_preferences WHERE user_id = $1')) {
        const uId = params[0];
        const found = notificationPreferences.filter((p) => p.user_id === Number(uId));
        return { rows: found };
      }

      // INSERT INTO notifications
      if (q.startsWith('INSERT INTO notifications')) {
        const notif = {
          id: nextNotifId++,
          ref: params[0],
          user_id: params[1],
          template_key: params[2],
          category: params[3],
          priority: params[4],
          title_en: params[5],
          title_bn: params[6],
          body_en: params[7],
          body_bn: params[8],
          data_json: typeof params[9] === 'string' ? JSON.parse(params[9]) : params[9],
          channels: typeof params[10] === 'string' ? JSON.parse(params[10]) : params[10],
          delivery_status: {},
          is_read: false,
          created_at: new Date().toISOString(),
        };
        notifications.unshift(notif);
        return { rows: [notif] };
      }

      // UPDATE notifications SET delivery_status
      if (q.startsWith('UPDATE notifications SET delivery_status')) {
        const nId = params[0];
        const found = notifications.find((n) => n.id === Number(nId));
        if (found) {
          found.delivery_status = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        }
        return { rows: [found] };
      }

      // COUNT unread notifications
      if (q.toUpperCase().includes('COUNT(ID) AS UNREAD_COUNT')) {
        const uId = params[0];
        const count = notifications.filter((n) => n.user_id === Number(uId) && !n.is_read).length;
        return { rows: [{ unread_count: count }] };
      }

      // SELECT notifications for user
      if (q.includes('FROM notifications') && q.includes('WHERE user_id = $1')) {
        const uId = params[0];
        const userNotifs = notifications.filter((n) => n.user_id === Number(uId));
        return { rows: userNotifs };
      }

      // UPDATE notifications SET is_read = true (single)
      if (q.includes('UPDATE notifications') && q.includes('SET is_read = true') && q.includes('WHERE id = $1')) {
        const nId = params[0];
        const uId = params[1];
        const found = notifications.find((n) => n.id === Number(nId) && n.user_id === Number(uId));
        if (found) {
          found.is_read = true;
          found.read_at = new Date().toISOString();
        }
        return { rows: found ? [found] : [] };
      }

      // UPDATE notifications SET is_read = true (all)
      if (q.includes('UPDATE notifications SET is_read = true') && q.includes('WHERE user_id = $1')) {
        const uId = params[0];
        notifications.filter((n) => n.user_id === Number(uId)).forEach((n) => (n.is_read = true));
        return { rows: [] };
      }

      // SELECT release_notes
      if (q.includes('FROM release_notes r')) {
        return { rows: releaseNotes };
      }

      // SELECT user_release_views
      if (q.includes('FROM user_release_views WHERE user_id = $1 AND version_tag = $2')) {
        const uId = params[0];
        const tag = params[1];
        const found = userReleaseViews.filter((v) => v.user_id === Number(uId) && v.version_tag === tag);
        return { rows: found };
      }

      // INSERT INTO user_release_views
      if (q.startsWith('INSERT INTO user_release_views')) {
        userReleaseViews.push({ user_id: params[0], version_tag: params[1], viewed_at: new Date() });
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  const poolMock = {
    ...mockDb,
    async connect() {
      return {
        ...mockDb,
        release() {},
      };
    },
  };

  return {
    mockDb: poolMock,
    state: {
      users,
      notificationTemplates,
      notificationPreferences,
      notifications,
      releaseNotes,
      userReleaseViews,
    },
  };
}

test('Prompt 8.2 — Unified Notification Service', async (t) => {
  // Test 1: Variable substitution & bilingual template rendering
  await t.test('Acceptance 3: Templates render correctly in English and Bengali with variable substitution', () => {
    const tpl = notifService.DEFAULT_TEMPLATES.ORDER_PLACED;
    const data = { orderRef: 'SO-8819', amount: '1,450.00' };

    const renderedEn = notifService.renderTemplateString(tpl.body_template_en, data);
    assert.equal(renderedEn, 'Order #SO-8819 placed successfully for ৳1,450.00.');

    const renderedBn = notifService.renderTemplateString(tpl.body_template_bn, data);
    assert.equal(renderedBn, 'অর্ডার #SO-8819 সফলভাবে সম্পন্ন হয়েছে। মোট ৳1,450.00।');
  });

  // Test 2: Multi-channel fan-out according to preferences
  await t.test('Acceptance 1: One event fans out across In-App, SMS, and Push channels', async () => {
    const { mockDb } = createMockDb();

    const result = await notifService.notify(mockDb, {
      userId: 201,
      templateKey: 'ORDER_PLACED',
      data: { orderRef: 'SO-3312', amount: '4,200.00' },
    });

    assert.ok(result.notificationId);
    assert.ok(result.ref.startsWith('NTF-'));
    assert.deepEqual(result.channels, ['INAPP', 'SMS', 'PUSH']);
    assert.equal(result.deliveryStatus.INAPP, 'STORED_INBOX');
    assert.equal(result.deliveryStatus.SMS, 'SENT');
    assert.equal(result.deliveryStatus.PUSH, 'DELIVERED');
  });

  // Test 3: Acceptance 2 — Marketing SMS is suppressed on opt-out, but critical OTP overrides opt-out
  await t.test('Acceptance 2: Opting out of marketing SMS suppresses marketing SMS but critical OTP still delivers', async () => {
    const { mockDb } = createMockDb();

    // 1. Marketing promo notification for user 201 (who disabled marketing SMS)
    const promoResult = await notifService.notify(mockDb, {
      userId: 201,
      templateKey: 'MARKETING_PROMO',
      data: { discountPct: 20, categoryName: 'Silk Sarees' },
    });

    // SMS is filtered out for marketing
    assert.equal(promoResult.channels.includes('SMS'), false, 'Marketing SMS must be suppressed for opted-out user');
    assert.equal(promoResult.channels.includes('INAPP'), true);
    assert.equal(promoResult.channels.includes('PUSH'), true);

    // 2. Critical OTP notification for user 201
    const otpResult = await notifService.notify(mockDb, {
      userId: 201,
      templateKey: 'OTP_VERIFICATION',
      data: { code: '849201', validMinutes: 5 },
    });

    // OTP overrides preferences and sends SMS
    assert.equal(otpResult.channels.includes('SMS'), true, 'Critical OTP must override preference opt-out');
    assert.equal(otpResult.deliveryStatus.SMS, 'SENT');
  });

  // Test 4: Acceptance 4 — What's New modal release notes shown once per release version
  await t.test('Acceptance 4: What\'s New release notes show once per release version and vanish after ack', async () => {
    const { mockDb } = createMockDb();

    // 1. First query: release note is available
    const firstCheck = await notifService.getLatestReleaseNotes(mockDb, 201);
    assert.ok(firstCheck);
    assert.equal(firstCheck.version_tag, 'v2.4.0');

    // 2. User acknowledges / views release note
    await notifService.markReleaseViewed(mockDb, 201, 'v2.4.0');

    // 3. Second query: returns null (already viewed)
    const secondCheck = await notifService.getLatestReleaseNotes(mockDb, 201);
    assert.equal(secondCheck, null, 'Already viewed release must not show again');
  });

  // Test 5: Fastify REST API endpoints
  await t.test('Acceptance 5: Fastify HTTP REST API endpoints for notifications and preferences', async () => {
    const { mockDb } = createMockDb();
    const app = Fastify({ logger: false });

    await app.register(requestContextPlugin);
    await app.register(errorHandlerPlugin);

    app.decorate('authenticate', async (req) => {
      req.user = { id: 201, role: 'customer', full_name: 'Habib Customer' };
    });

    app.decorate('db', mockDb);
    app.decorate('cache', { get: async () => null, set: async () => 'OK', del: async () => 1 });

    await app.register(notificationRoutes, { prefix: '/api/v1' });

    // 1. GET /api/v1/notifications
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
    });
    assert.equal(listRes.statusCode, 200);
    assert.ok(listRes.json().data.items.length >= 1);

    // 2. GET /api/v1/notifications/unread-count
    const countRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
    });
    assert.equal(countRes.statusCode, 200);
    assert.ok(countRes.json().data.unread_count >= 1);

    // 3. POST /api/v1/notifications/1/read
    const readRes = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/1/read',
    });
    assert.equal(readRes.statusCode, 200);
    assert.equal(readRes.json().data.success, true);

    // 4. GET /api/v1/notifications/whats-new
    const wnRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/whats-new',
    });
    assert.equal(wnRes.statusCode, 200);

    await app.close();
  });
});
