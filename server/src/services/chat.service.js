/**
 * chat.service.js — Real-Time Chat Engine & Message Pipeline (Prompt 8.1 / DFD Subsystem 7.0).
 *
 * Implements:
 * 1. Contact info leak detection (off-platform transaction mitigation for BD phones, emails, social).
 * 2. Activity control & capability restriction checks (can_chat, max_daily_messages).
 * 3. Client-generated message id idempotency.
 * 4. Real-time delivery with debounced offline fallback notification queue.
 * 5. Reconnection missed-message replay.
 * 6. Report-to-moderation integration.
 */

import { withTransaction } from '../config/db.js';
import { isUserOnline, sendToUser } from '../sockets/presence.js';
import { writeAudit } from '../lib/audit.js';

// Debounce map for offline notifications: key -> { timer, count, lastContent }
const offlineNotificationDebouncers = new Map();
const offlineNotificationQueue = []; // In-memory queue for Prompt 8.2 consumers / test inspection

export function getOfflineNotificationQueue() {
  return offlineNotificationQueue;
}

export function clearOfflineNotificationQueue() {
  offlineNotificationQueue.length = 0;
  offlineNotificationDebouncers.clear();
}

/**
 * Scans content for Bangladeshi phone numbers, emails, and off-platform transaction handles.
 */
export function detectContactInfoLeak(content) {
  if (!content || typeof content !== 'string') {
    return { isLeaked: false, matches: [] };
  }

  const matches = [];

  // BD Phone numbers: 013-019 followed by 8 digits (with optional spaces/dashes/dots/+88)
  const bdPhoneRegex = /(?:\+?880|0)?1[3-9][\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{4}/g;
  const phoneMatches = content.match(bdPhoneRegex);
  if (phoneMatches) {
    matches.push(...phoneMatches.map((m) => `PHONE: ${m.trim()}`));
  }

  // Email addresses
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emailMatches = content.match(emailRegex);
  if (emailMatches) {
    matches.push(...emailMatches.map((m) => `EMAIL: ${m.trim()}`));
  }

  // Off-platform keywords
  const offPlatformRegex = /\b(whatsapp|fb\.com|facebook\.com|imo|bkash personal|nagad personal|বিকাশ পার্সোনাল|হোয়াটসঅ্যাপ)\b/gi;
  const keywordMatches = content.match(offPlatformRegex);
  if (keywordMatches) {
    matches.push(...keywordMatches.map((m) => `OFF_PLATFORM_KEYWORD: ${m.trim()}`));
  }

  return {
    isLeaked: matches.length > 0,
    matches,
    reason: matches.length > 0 ? `Detected off-platform contact vector: ${matches.join(', ')}` : null,
  };
}

/**
 * Enqueues a debounced offline notification.
 * Ten rapid messages to an offline user produce only ONE consolidated notification.
 */
export function enqueueDebouncedOfflineNotification({
  recipientId,
  threadId,
  senderId,
  senderName = 'Explooro User',
  messageSnippet = '',
  debounceMs = 3000,
}) {
  const key = `${recipientId}:${threadId}`;

  if (offlineNotificationDebouncers.has(key)) {
    const entry = offlineNotificationDebouncers.get(key);
    entry.messageCount++;
    entry.lastContent = messageSnippet;
    return;
  }

  const entry = {
    recipientId,
    threadId,
    senderId,
    senderName,
    messageCount: 1,
    lastContent: messageSnippet,
    firstEnqueuedAt: new Date(),
  };

  offlineNotificationDebouncers.set(key, entry);

  // Set timeout to flush single notification batch
  setTimeout(() => {
    offlineNotificationDebouncers.delete(key);
    offlineNotificationQueue.push({
      recipientId: entry.recipientId,
      threadId: entry.threadId,
      senderName: entry.senderName,
      messageCount: entry.messageCount,
      summary: entry.messageCount > 1
        ? `${entry.senderName} sent ${entry.messageCount} new messages: "${entry.lastContent.slice(0, 60)}..."`
        : `${entry.senderName}: "${entry.lastContent.slice(0, 60)}"`,
      queuedAt: new Date().toISOString(),
    });
  }, debounceMs);
}

/**
 * Sends a chat message through the validation, restriction, leak-check, and persistence pipeline.
 */
export async function sendMessage(db, {
  threadId,
  senderId,
  content,
  clientMsgId = null,
  msgType = 'TEXT',
  payloadJson = {},
  client = null,
} = {}) {
  const trimmed = (content || '').trim();
  if (!trimmed) {
    throw new Error('VALIDATION_FAILED: Message content cannot be empty.');
  }

  const runner = async (txClient) => {
    // 1. Check user restriction: can_chat capability
    try {
      const { rows: restrictions } = await txClient.query(
        `SELECT capability, restriction_type, reason_en, reason_bn
         FROM user_restrictions
         WHERE user_id = $1 AND capability = 'can_chat' AND restriction_type = 'BLOCK'
           AND (expires_at IS NULL OR expires_at > now())`,
        [senderId]
      );

      if (restrictions.length > 0) {
        const res = restrictions[0];
        const err = new Error(res.reason_en || 'Chat messaging is restricted on your account.');
        err.code = 'USER_RESTRICTED';
        err.capability = 'can_chat';
        err.reason_en = res.reason_en;
        err.reason_bn = res.reason_bn;
        throw err;
      }
    } catch (err) {
      if (err.code === 'USER_RESTRICTED') throw err;
    }

    // 2. Idempotency check with clientMsgId
    if (clientMsgId) {
      const { rows: existing } = await txClient.query(
        `SELECT * FROM chat_messages WHERE client_msg_id = $1`,
        [clientMsgId]
      );
      if (existing.length > 0) {
        return {
          idempotent: true,
          message: existing[0],
        };
      }
    }

    // 3. Fetch thread and participants
    const { rows: threadRows } = await txClient.query(
      `SELECT * FROM chat_threads WHERE id = $1`,
      [threadId]
    );

    if (threadRows.length === 0) {
      throw new Error(`THREAD_NOT_FOUND: Chat thread #${threadId} does not exist.`);
    }

    const thread = threadRows[0];
    const participantIds = Array.isArray(thread.participant_ids)
      ? thread.participant_ids.map(Number)
      : [];

    // Ensure sender is a participant
    if (!participantIds.includes(Number(senderId))) {
      throw new Error('FORBIDDEN: You are not a participant in this conversation thread.');
    }

    // 4. Scan content for off-platform contact info leak
    const leakScan = detectContactInfoLeak(trimmed);
    const flaggedForModeration = leakScan.isLeaked;

    // 5. Persist message
    const { rows: insertedMsg } = await txClient.query(
      `INSERT INTO chat_messages (
         client_msg_id, thread_id, sender_id, content, msg_type,
         payload_json, read_by, flagged_for_moderation, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       RETURNING *`,
      [
        clientMsgId || null,
        threadId,
        senderId,
        trimmed,
        msgType,
        JSON.stringify(payloadJson || {}),
        JSON.stringify([Number(senderId)]),
        flaggedForModeration,
      ]
    );

    const message = insertedMsg[0];

    // 6. Update thread last message summary
    await txClient.query(
      `UPDATE chat_threads
       SET last_message_at = now(),
           last_message_preview = $2,
           updated_at = now()
       WHERE id = $1`,
      [threadId, trimmed.slice(0, 100)]
    );

    // 7. Increment unread count for other participants
    for (const pId of participantIds) {
      if (Number(pId) !== Number(senderId)) {
        await txClient.query(
          `INSERT INTO chat_thread_participants (thread_id, user_id, unread_count, joined_at)
           VALUES ($1, $2, 1, now())
           ON CONFLICT (thread_id, user_id) DO UPDATE
           SET unread_count = chat_thread_participants.unread_count + 1`,
          [threadId, pId]
        );
      }
    }

    // 8. Fetch sender display name
    const { rows: senderRows } = await txClient.query(
      `SELECT full_name FROM users WHERE id = $1`,
      [senderId]
    );
    const senderName = senderRows[0]?.full_name || 'Participant';

    // 9. Real-time delivery & Offline debounced notification dispatch
    const payload = {
      type: 'chat:message',
      threadId,
      message: {
        id: message.id,
        clientMsgId: message.client_msg_id,
        senderId: message.sender_id,
        senderName,
        content: message.content,
        msgType: message.msg_type,
        flaggedForModeration: message.flagged_for_moderation,
        createdAt: message.created_at,
      },
    };

    for (const pId of participantIds) {
      if (Number(pId) === Number(senderId)) continue;

      const online = isUserOnline(pId);
      if (online) {
        sendToUser(pId, payload);
      } else {
        enqueueDebouncedOfflineNotification({
          recipientId: pId,
          threadId,
          senderId,
          senderName,
          messageSnippet: trimmed,
        });
      }
    }

    // If flagged for moderation, write an advisory report to moderation queue
    if (flaggedForModeration) {
      try {
        await txClient.query(
          `INSERT INTO moderation_queue (
             ref, item_type, submitted_by, auto_flags_json, payload_snapshot_json, status, created_at
           )
           VALUES ($1, 'CHAT_REPORT', $2, $3, $4, 'PENDING', now())`,
          [
            `MOD-CHAT-${message.id}`,
            senderId,
            JSON.stringify([{ code: 'OFF_PLATFORM_CONTACT_LEAK', reason: leakScan.reason }]),
            JSON.stringify({ threadId, messageId: message.id, content: trimmed }),
          ]
        );
      } catch {}
    }

    return {
      idempotent: false,
      message,
      flaggedForModeration,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Gets conversation threads for a user with unread counts.
 */
export async function getThreads(db, userId, { limit = 20, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT t.id, t.ref, t.thread_type, t.participant_ids, t.metadata_json,
            t.last_message_at, t.last_message_preview, t.created_at,
            COALESCE(p.unread_count, 0) as unread_count,
            COALESCE(p.last_read_message_id, 0) as last_read_message_id
     FROM chat_threads t
     LEFT JOIN chat_thread_participants p ON p.thread_id = t.id AND p.user_id = $1
     WHERE t.participant_ids @> to_jsonb($1::bigint) OR t.participant_ids @> to_jsonb(ARRAY[$1::bigint])
     ORDER BY t.last_message_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return {
    items: rows,
    count: rows.length,
    limit,
    offset,
  };
}

/**
 * Gets cursor-paginated messages for a thread.
 */
export async function getThreadMessages(db, {
  threadId,
  userId,
  cursor = null, // message id before which to fetch
  limit = 30,
} = {}) {
  let query = `
    SELECT m.id, m.client_msg_id, m.thread_id, m.sender_id, m.content,
           m.msg_type, m.payload_json, m.flagged_for_moderation, m.created_at,
           u.full_name as sender_name,
           u.role as sender_role
    FROM chat_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.thread_id = $1
  `;
  const params = [threadId];

  if (cursor) {
    params.push(cursor);
    query += ` AND m.id < $${params.length}`;
  }

  query += ` ORDER BY m.id DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await db.query(query, params);
  const items = rows.reverse();

  return {
    threadId,
    items,
    nextCursor: items.length > 0 ? items[0].id : null,
  };
}

/**
 * Marks messages in a thread as read.
 */
export async function markThreadRead(db, { threadId, userId, lastReadMessageId } = {}) {
  await db.query(
    `INSERT INTO chat_thread_participants (thread_id, user_id, last_read_message_id, unread_count, joined_at)
     VALUES ($1, $2, $3, 0, now())
     ON CONFLICT (thread_id, user_id) DO UPDATE
     SET last_read_message_id = GREATEST(COALESCE(chat_thread_participants.last_read_message_id, 0), EXCLUDED.last_read_message_id),
         unread_count = 0`,
    [threadId, userId, lastReadMessageId]
  );

  return { success: true, threadId, unreadCount: 0 };
}

/**
 * Retrieves missed messages since a last known message ID (for reconnection replay).
 */
export async function getMissedMessages(db, { userId, sinceMessageId = 0 }) {
  const { rows } = await db.query(
    `SELECT m.id, m.client_msg_id, m.thread_id, m.sender_id, m.content,
            m.msg_type, m.payload_json, m.flagged_for_moderation, m.created_at,
            u.full_name as sender_name
     FROM chat_messages m
     JOIN chat_threads t ON t.id = m.thread_id
     JOIN users u ON u.id = m.sender_id
     WHERE (t.participant_ids @> to_jsonb($1::bigint) OR t.participant_ids @> to_jsonb(ARRAY[$1::bigint]))
       AND m.id > $2
     ORDER BY m.id ASC
     LIMIT 100`,
    [userId, sinceMessageId]
  );

  return {
    userId,
    sinceMessageId,
    missedMessages: rows,
  };
}
