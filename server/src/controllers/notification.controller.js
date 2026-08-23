/**
 * notification.controller.js — Fastify controller for Unified Notification Service (Prompt 8.2).
 */

import * as service from '../services/notification.service.js';

export async function getNotifications(req, reply) {
  const { category, is_read, limit = 20, offset = 0 } = req.query || {};

  const result = await service.getNotifications(req.server.db, req.user.id, {
    category,
    isRead: is_read !== undefined ? is_read === 'true' || is_read === true : null,
    limit: parseInt(limit, 10) || 20,
    offset: parseInt(offset, 10) || 0,
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function getUnreadCount(req, reply) {
  const count = await service.getUnreadCount(req.server.db, req.user.id);
  return reply.send({
    data: { unread_count: count },
    meta: { trace_id: req.traceId },
  });
}

export async function markAsRead(req, reply) {
  const notificationId = parseInt(req.params.id, 10);
  const result = await service.markAsRead(req.server.db, req.user.id, notificationId);
  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function markAllAsRead(req, reply) {
  const result = await service.markAllAsRead(req.server.db, req.user.id);
  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function getPreferences(req, reply) {
  const prefs = await service.getPreferences(req.server.db, req.user.id);
  return reply.send({
    data: prefs,
    meta: { trace_id: req.traceId },
  });
}

export async function updatePreferences(req, reply) {
  const { preferences = [] } = req.body || {};
  const result = await service.updatePreferences(req.server.db, req.user.id, preferences);
  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function getWhatsNew(req, reply) {
  const release = await service.getLatestReleaseNotes(req.server.db, req.user.id);
  return reply.send({
    data: { releaseNote: release },
    meta: { trace_id: req.traceId },
  });
}

export async function ackWhatsNew(req, reply) {
  const { version_tag } = req.body || {};
  const result = await service.markReleaseViewed(req.server.db, req.user.id, version_tag);
  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function sendTestNotification(req, reply) {
  const { template_key, data = {}, channels = null } = req.body || {};
  const result = await service.notify(req.server.db, {
    userId: req.user.id,
    templateKey: template_key,
    data,
    channels,
  });

  return reply.status(201).send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}
