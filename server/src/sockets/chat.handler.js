/**
 * chat.handler.js — WebSocket Protocol Message Handler (Prompt 8.1 / DFD Subsystem 7.0).
 *
 * Implements:
 * - chat:send — Validates, persists, broadcasts, and returns chat:ack.
 * - chat:read — Records read receipt and notifies participants.
 * - chat:typing — Ephemeral typing status broadcast.
 * - chat:sync — Missed message replay for mobile network reconnects.
 * - ping / pong — Heartbeat keepalive.
 */

import * as chatService from '../services/chat.service.js';
import { updateHeartbeat, broadcastToThread, sendToUser } from './presence.js';

export function handleSocketMessage(ws, user, rawData, db) {
  let message;
  try {
    message = typeof rawData === 'string' ? JSON.parse(rawData) : JSON.parse(rawData.toString());
  } catch {
    ws.send(JSON.stringify({ type: 'error', error: 'INVALID_JSON_PAYLOAD' }));
    return;
  }

  const { type, payload } = message;

  switch (type) {
    // 1. Heartbeat Keepalive
    case 'ping':
      updateHeartbeat(user.id);
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    // 2. Send Message
    case 'chat:send': {
      const { thread_id, content, client_msg_id, msg_type, payload_json } = payload || {};

      chatService
        .sendMessage(db, {
          threadId: Number(thread_id),
          senderId: user.id,
          content,
          clientMsgId: client_msg_id,
          msgType: msg_type || 'TEXT',
          payloadJson: payload_json || {},
        })
        .then((result) => {
          ws.send(
            JSON.stringify({
              type: 'chat:ack',
              clientMsgId: client_msg_id,
              messageId: result.message.id,
              threadId: Number(thread_id),
              idempotent: result.idempotent,
              flaggedForModeration: result.flaggedForModeration,
              createdAt: result.message.created_at,
            })
          );
        })
        .catch((err) => {
          ws.send(
            JSON.stringify({
              type: 'chat:error',
              clientMsgId: client_msg_id,
              code: err.code || 'SEND_FAILED',
              message: err.message,
              reasonEn: err.reason_en || null,
              reasonBn: err.reason_bn || null,
            })
          );
        });
      break;
    }

    // 3. Mark Thread Read
    case 'chat:read': {
      const { thread_id, last_read_message_id } = payload || {};
      chatService
        .markThreadRead(db, {
          threadId: Number(thread_id),
          userId: user.id,
          lastReadMessageId: last_read_message_id,
        })
        .then(() => {
          ws.send(JSON.stringify({ type: 'chat:read_ack', threadId: Number(thread_id) }));
        })
        .catch(() => {});
      break;
    }

    // 4. Typing Indicator
    case 'chat:typing': {
      const { thread_id, is_typing, participant_ids = [] } = payload || {};
      broadcastToThread(
        participant_ids,
        {
          type: 'chat:typing',
          threadId: Number(thread_id),
          userId: user.id,
          userName: user.full_name || 'Participant',
          isTyping: Boolean(is_typing),
        },
        user.id // exclude sender
      );
      break;
    }

    // 5. Reconnection Sync & Replay
    case 'chat:sync': {
      const { since_message_id = 0 } = payload || {};
      chatService
        .getMissedMessages(db, {
          userId: user.id,
          sinceMessageId: Number(since_message_id),
        })
        .then((syncRes) => {
          ws.send(
            JSON.stringify({
              type: 'chat:sync_response',
              sinceMessageId: syncRes.sinceMessageId,
              missedMessages: syncRes.missedMessages,
              count: syncRes.missedMessages.length,
            })
          );
        })
        .catch((err) => {
          ws.send(JSON.stringify({ type: 'chat:sync_error', message: err.message }));
        });
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', error: `UNKNOWN_FRAME_TYPE: ${type}` }));
  }
}
