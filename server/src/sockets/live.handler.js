/**
 * live.handler.js — WebSocket Protocol Message Handler for Live Stream Commerce (Prompt 10.1 / DFD Subsystem 15.0).
 *
 * Implements:
 * - live:join — Subscribes socket to live stream room, sends initial stream state.
 * - live:leave — Unsubscribes socket from stream room.
 * - live:chat — Validates mute status, persists message, and broadcasts to room.
 * - live:pin — Host pins product, broadcasts pin update immediately (< 1s latency).
 * - live:unpin — Host unpins product, broadcasts update to all viewers.
 * - live:reaction — Dispatches floating heart reaction to all viewers & updates stats.
 * - live:mute — Moderator/Host mutes abusive participant.
 * - live:terminate — Moderator terminates violating stream immediately.
 */

import * as liveRepo from '../repositories/liveStream.repository.js';
import {
  joinStreamRoom,
  leaveStreamRoom,
  broadcastToStream,
  isUserMutedInStream,
  muteUserInStream,
  getStreamViewerCount,
} from './presence.js';

export async function handleLiveSocketMessage(ws, user, message, db) {
  const { type, payload } = message;
  const streamId = Number(payload?.stream_id || payload?.streamId);

  if (!streamId && type !== 'ping') {
    ws.send(JSON.stringify({ type: 'live:error', error: 'STREAM_ID_REQUIRED' }));
    return;
  }

  switch (type) {
    // 1. Join Live Stream Room
    case 'live:join': {
      joinStreamRoom(streamId, user, ws);

      // Fetch current stream state & pinned product
      try {
        const stream = await liveRepo.findStreamById(db, streamId);
        const pinnedProduct = await liveRepo.getPinnedProduct(db, streamId);
        const viewerCount = getStreamViewerCount(streamId);

        // Update DB viewer count
        liveRepo.updateViewersCount(db, streamId, viewerCount).catch(() => {});

        ws.send(
          JSON.stringify({
            type: 'live:joined',
            payload: {
              streamId,
              status: stream?.status || 'LIVE',
              title: stream?.title,
              pinnedProduct,
              viewerCount,
              totalLikes: stream?.total_likes_count || 0,
              totalSales: stream?.total_sales_count || 0,
              isMuted: isUserMutedInStream(streamId, user.id),
            },
          })
        );
      } catch (err) {
        ws.send(JSON.stringify({ type: 'live:error', error: err.message }));
      }
      break;
    }

    // 2. Leave Live Stream Room
    case 'live:leave': {
      leaveStreamRoom(streamId, ws);
      ws.send(JSON.stringify({ type: 'live:left', payload: { streamId } }));
      break;
    }

    // 3. Send Live Chat Message
    case 'live:chat': {
      const { content, client_msg_id } = payload || {};
      if (!content || !content.trim()) return;

      // Check if user is muted by moderator
      if (isUserMutedInStream(streamId, user.id)) {
        ws.send(
          JSON.stringify({
            type: 'live:error',
            code: 'USER_MUTED',
            message: 'You have been muted in this stream by a moderator.',
            messageBn: 'আপনাকে এই লাইভ স্ট্রিমে মডারেটর কর্তৃক মিউট করা হয়েছে।',
            clientMsgId: client_msg_id,
          })
        );
        return;
      }

      try {
        const savedMsg = await liveRepo.createMessage(db, {
          streamId,
          userId: user.id,
          messageType: 'CHAT',
          content: content.trim(),
          metadataJson: {
            userName: user.full_name || 'Participant',
            userRole: user.role,
          },
        });

        // Broadcast to all viewers in room
        broadcastToStream(streamId, {
          type: 'live:chat_message',
          payload: {
            id: savedMsg.id,
            streamId,
            userId: user.id,
            userName: user.full_name || 'Viewer',
            userRole: user.role,
            content: savedMsg.content,
            createdAt: savedMsg.created_at,
          },
        });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'live:error', error: err.message }));
      }
      break;
    }

    // 4. Pin Product (Host action)
    case 'live:pin': {
      const { product_id, productId } = payload || {};
      const pId = Number(product_id || productId);
      if (!pId) return;

      try {
        const pinned = await liveRepo.pinProduct(db, streamId, pId);
        const pinnedProduct = await liveRepo.getPinnedProduct(db, streamId);

        // Record system message
        await liveRepo.createMessage(db, {
          streamId,
          userId: user.id,
          messageType: 'PIN_PRODUCT',
          content: `Pinned product: ${pinnedProduct?.title_en || 'Featured Item'}`,
          metadataJson: { productId: pId, product: pinnedProduct },
        });

        // Broadcast to all viewers within < 1s
        broadcastToStream(streamId, {
          type: 'live:pinned_product',
          payload: {
            streamId,
            pinnedProduct,
            timestamp: Date.now(),
          },
        });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'live:error', error: err.message }));
      }
      break;
    }

    // 5. Unpin Product (Host action)
    case 'live:unpin': {
      try {
        await liveRepo.unpinProduct(db, streamId);
        broadcastToStream(streamId, {
          type: 'live:pinned_product',
          payload: {
            streamId,
            pinnedProduct: null,
            timestamp: Date.now(),
          },
        });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'live:error', error: err.message }));
      }
      break;
    }

    // 6. Floating Reaction / Like
    case 'live:reaction': {
      const { emoji = '❤️', delta = 1 } = payload || {};
      liveRepo.incrementLikes(db, streamId, Number(delta) || 1).then((totalLikes) => {
        broadcastToStream(streamId, {
          type: 'live:reaction_broadcast',
          payload: {
            streamId,
            userId: user.id,
            userName: user.full_name || 'Viewer',
            emoji,
            totalLikes,
            timestamp: Date.now(),
          },
        });
      });
      break;
    }

    // 7. Moderate: Mute User
    case 'live:mute': {
      const { target_user_id, targetUserId, duration_minutes = 15 } = payload || {};
      const tId = Number(target_user_id || targetUserId);
      if (!tId) return;

      muteUserInStream(streamId, tId, duration_minutes * 60 * 1000);

      await liveRepo.createMessage(db, {
        streamId,
        userId: user.id,
        messageType: 'MODERATION',
        content: `Participant was muted for ${duration_minutes} minutes.`,
        metadataJson: { targetUserId: tId, moderatorId: user.id },
      });

      broadcastToStream(streamId, {
        type: 'live:user_muted',
        payload: {
          streamId,
          targetUserId: tId,
          moderatorId: user.id,
          durationMinutes: duration_minutes,
        },
      });
      break;
    }

    // 8. Moderate: Terminate Stream
    case 'live:terminate': {
      const { reason = 'Policy Violation' } = payload || {};
      try {
        await liveRepo.updateStreamStatus(db, streamId, 'TERMINATED', {
          terminatedBy: user.id,
          terminationReason: reason,
        });

        await liveRepo.createMessage(db, {
          streamId,
          userId: user.id,
          messageType: 'MODERATION',
          content: `Stream was terminated by moderator. Reason: ${reason}`,
          metadataJson: { moderatorId: user.id, reason },
        });

        broadcastToStream(streamId, {
          type: 'live:stream_terminated',
          payload: {
            streamId,
            moderatorId: user.id,
            reason,
            timestamp: Date.now(),
          },
        });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'live:error', error: err.message }));
      }
      break;
    }

    default:
      break;
  }
}
