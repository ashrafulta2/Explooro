/**
 * notification.routes.js — Fastify routes for Unified Notification Service (Prompt 8.2).
 */

import * as controller from '../controllers/notification.controller.js';

export default async function notificationRoutes(app) {
  // 1. Get notifications
  app.get('/notifications', {
    preHandler: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          is_read: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
    },
    handler: controller.getNotifications,
  });

  // 2. Get unread count
  app.get('/notifications/unread-count', {
    preHandler: [app.authenticate],
    handler: controller.getUnreadCount,
  });

  // 3. Mark single notification as read
  app.post('/notifications/:id/read', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.markAsRead,
  });

  // 4. Mark all notifications as read
  app.post('/notifications/read-all', {
    preHandler: [app.authenticate],
    handler: controller.markAllAsRead,
  });

  // 5. Get notification channel preferences
  app.get('/notifications/preferences', {
    preHandler: [app.authenticate],
    handler: controller.getPreferences,
  });

  // 6. Update notification preferences
  app.put('/notifications/preferences', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['preferences'],
        properties: {
          preferences: {
            type: 'array',
            items: {
              type: 'object',
              required: ['category'],
              properties: {
                category: { type: 'string' },
                inapp_enabled: { type: 'boolean' },
                sms_enabled: { type: 'boolean' },
                push_enabled: { type: 'boolean' },
                email_enabled: { type: 'boolean' },
                quiet_hours_start: { type: 'string' },
                quiet_hours_end: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: controller.updatePreferences,
  });

  // 7. What's New release announcement
  app.get('/notifications/whats-new', {
    preHandler: [app.authenticate],
    handler: controller.getWhatsNew,
  });

  // 8. Ack What's New
  app.post('/notifications/whats-new/ack', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['version_tag'],
        properties: {
          version_tag: { type: 'string' },
        },
      },
    },
    handler: controller.ackWhatsNew,
  });

  // 9. Send test notification
  app.post('/notifications/test', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['template_key'],
        properties: {
          template_key: { type: 'string' },
          data: { type: 'object' },
          channels: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    handler: controller.sendTestNotification,
  });
}
