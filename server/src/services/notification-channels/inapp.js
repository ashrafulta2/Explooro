/**
 * inapp.js — In-App Live WebSocket Notification Channel (Prompt 8.2).
 */

import { sendToUser } from '../../sockets/presence.js';

export async function sendInApp(notification) {
  const payload = {
    type: 'notification:new',
    notification: {
      id: notification.id,
      ref: notification.ref,
      category: notification.category,
      priority: notification.priority,
      titleEn: notification.title_en,
      titleBn: notification.title_bn,
      bodyEn: notification.body_en,
      bodyBn: notification.body_bn,
      data: notification.data_json,
      createdAt: notification.created_at,
    },
  };

  const deliveredLive = sendToUser(notification.user_id, payload);
  return {
    channel: 'INAPP',
    status: deliveredLive ? 'DELIVERED' : 'STORED_INBOX',
    timestamp: new Date().toISOString(),
  };
}
