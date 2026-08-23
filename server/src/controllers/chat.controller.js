/**
 * chat.controller.js — Fastify controller for Real-Time Chat (Prompt 8.1 / DFD Subsystem 7.0).
 */

import { createTicket } from '../sockets/presence.js';
import * as chatService from '../services/chat.service.js';

export async function getTicket(req, reply) {
  const result = createTicket({
    userId: req.user.id,
    role: req.user.role,
    name: req.user.full_name,
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function getThreads(req, reply) {
  const { limit = 20, offset = 0 } = req.query || {};

  const result = await chatService.getThreads(req.server.db, req.user.id, {
    limit: parseInt(limit, 10) || 20,
    offset: parseInt(offset, 10) || 0,
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function createOrGetThread(req, reply) {
  const {
    target_user_id,
    thread_type = 'CUSTOMER_SALER',
    metadata = {},
  } = req.body || {};

  const db = req.server.db;
  const currentUserId = req.user.id;
  const targetId = Number(target_user_id);

  if (!targetId || targetId === currentUserId) {
    return reply.status(400).send({
      error: { code: 'INVALID_PARTICIPANT', message_en: 'Target participant must be a distinct user.' },
    });
  }

  // Check if thread already exists between these 2 users
  const participantIds = [Math.min(currentUserId, targetId), Math.max(currentUserId, targetId)];

  const { rows: existing } = await db.query(
    `SELECT * FROM chat_threads
     WHERE participant_ids = $1 AND thread_type = $2
     LIMIT 1`,
    [JSON.stringify(participantIds), thread_type]
  );

  if (existing.length > 0) {
    return reply.send({
      data: { thread: existing[0], created: false },
      meta: { trace_id: req.traceId },
    });
  }

  // Create new thread
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let refCode = '';
  for (let i = 0; i < 8; i++) refCode += chars.charAt(Math.floor(Math.random() * chars.length));
  const ref = `THR-${refCode}`;

  const { rows: inserted } = await db.query(
    `INSERT INTO chat_threads (ref, thread_type, participant_ids, metadata_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())
     RETURNING *`,
    [ref, thread_type, JSON.stringify(participantIds), JSON.stringify(metadata || {})]
  );

  const thread = inserted[0];

  // Insert participant records
  await db.query(
    `INSERT INTO chat_thread_participants (thread_id, user_id, unread_count, joined_at)
     VALUES ($1, $2, 0, now()), ($1, $3, 0, now())
     ON CONFLICT DO NOTHING`,
    [thread.id, currentUserId, targetId]
  );

  return reply.status(201).send({
    data: { thread, created: true },
    meta: { trace_id: req.traceId },
  });
}

export async function getMessages(req, reply) {
  const threadId = parseInt(req.params.id, 10);
  const { cursor, limit = 30 } = req.query || {};

  const result = await chatService.getThreadMessages(req.server.db, {
    threadId,
    userId: req.user.id,
    cursor: cursor ? parseInt(cursor, 10) : null,
    limit: parseInt(limit, 10) || 30,
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function sendMessageHttp(req, reply) {
  const threadId = parseInt(req.params.id, 10);
  const { content, client_msg_id, msg_type, payload_json } = req.body || {};

  const result = await chatService.sendMessage(req.server.db, {
    threadId,
    senderId: req.user.id,
    content,
    clientMsgId: client_msg_id,
    msgType: msg_type || 'TEXT',
    payloadJson: payload_json || {},
  });

  return reply.status(201).send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function markRead(req, reply) {
  const threadId = parseInt(req.params.id, 10);
  const { last_read_message_id } = req.body || {};

  const result = await chatService.markThreadRead(req.server.db, {
    threadId,
    userId: req.user.id,
    lastReadMessageId: last_read_message_id ? parseInt(last_read_message_id, 10) : null,
  });

  return reply.send({
    data: result,
    meta: { trace_id: req.traceId },
  });
}

export async function reportMessage(req, reply) {
  const messageId = parseInt(req.params.id, 10);
  const { reason = 'Inappropriate content' } = req.body || {};

  const { rows } = await req.server.db.query(
    `SELECT * FROM chat_messages WHERE id = $1`,
    [messageId]
  );

  if (rows.length === 0) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message_en: `Message #${messageId} not found.` },
    });
  }

  const msg = rows[0];

  await req.server.db.query(
    `INSERT INTO moderation_queue (
       ref, item_type, submitted_by, auto_flags_json, payload_snapshot_json, status, created_at
     )
     VALUES ($1, 'CHAT_REPORT', $2, $3, $4, 'PENDING', now())`,
    [
      `MOD-REP-${messageId}`,
      req.user.id,
      JSON.stringify([{ code: 'USER_REPORT', reason }]),
      JSON.stringify({ messageId, senderId: msg.sender_id, content: msg.content }),
    ]
  );

  return reply.send({
    data: { success: true, reportedMessageId: messageId },
    meta: { trace_id: req.traceId },
  });
}
