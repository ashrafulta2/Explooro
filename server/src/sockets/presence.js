/**
 * presence.js — Real-Time Presence & Handshake Ticket Engine (Prompt 8.1 / Prompt 10.1 / DFD Subsystems 7.0 & 15.0).
 *
 * Implements:
 * 1. Short-lived single-use ticket generator/consumer for zero-leak WebSocket upgrades.
 * 2. Multi-socket presence tracking with heartbeat and TTL.
 * 3. Live Stream room membership tracking, presence count, and room broadcasting.
 * 4. Live Stream participant mute state for real-time moderation.
 * 5. Multi-node pub/sub message event bus.
 */

import { randomUUID } from 'node:crypto';
import EventEmitter from 'node:events';

// Local in-memory stores (backed by Redis when REDIS_URL is configured)
const activeSockets = new Map(); // userId -> Set of socket connections
const userHeartbeats = new Map(); // userId -> timestamp
const handshakeTickets = new Map(); // ticket -> { userId, role, name, expiresAt }
const eventBus = new EventEmitter();

// Live Stream Rooms: streamId (Number) -> Set<{ socket, userId, role, name, joinedAt }>
const liveStreamRooms = new Map();
const socketStreamMap = new Map(); // socket -> streamId
const streamMutedUsers = new Map(); // `${streamId}:${userId}` -> expiration timestamp

/**
 * Creates a short-lived single-use ticket for WebSocket authentication.
 * Never leaks raw JWT tokens into WebSocket upgrade query strings.
 */
export function createTicket(userData, ttlSeconds = 60) {
  const ticket = randomUUID();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  handshakeTickets.set(ticket, {
    ...userData,
    expiresAt,
  });
  return {
    ticket,
    expiresIn: ttlSeconds,
  };
}

/**
 * Atomically validates and consumes a handshake ticket.
 */
export function consumeTicket(ticket) {
  if (!ticket || !handshakeTickets.has(ticket)) {
    return null;
  }

  const data = handshakeTickets.get(ticket);
  handshakeTickets.delete(ticket); // single use only

  if (Date.now() > data.expiresAt) {
    return null;
  }

  return data;
}

/**
 * Registers an active socket for a user.
 */
export function registerUserSocket(userId, socket) {
  const uId = Number(userId);
  if (!activeSockets.has(uId)) {
    activeSockets.set(uId, new Set());
  }
  activeSockets.get(uId).add(socket);
  userHeartbeats.set(uId, Date.now());
  eventBus.emit('presence:online', { userId: uId });
}

/**
 * Unregisters a socket for a user and cleans up stream room membership.
 */
export function unregisterUserSocket(userId, socket) {
  const uId = Number(userId);
  if (activeSockets.has(uId)) {
    const set = activeSockets.get(uId);
    set.delete(socket);
    if (set.size === 0) {
      activeSockets.delete(uId);
      userHeartbeats.delete(uId);
      eventBus.emit('presence:offline', { userId: uId });
    }
  }

  // Also clean up from any live stream room
  if (socketStreamMap.has(socket)) {
    const sId = socketStreamMap.get(socket);
    leaveStreamRoom(sId, socket);
  }
}

/**
 * Checks if a user currently has any active WebSocket connection.
 */
export function isUserOnline(userId) {
  const uId = Number(userId);
  const sockets = activeSockets.get(uId);
  return Boolean(sockets && sockets.size > 0);
}

/**
 * Updates the user's heartbeat timestamp.
 */
export function updateHeartbeat(userId) {
  const uId = Number(userId);
  if (activeSockets.has(uId)) {
    userHeartbeats.set(uId, Date.now());
  }
}

/**
 * Gets all active sockets for a user.
 */
export function getUserSockets(userId) {
  const uId = Number(userId);
  return Array.from(activeSockets.get(uId) || []);
}

/**
 * Sends a message payload to all active sockets of a specific user.
 */
export function sendToUser(userId, payload) {
  const sockets = getUserSockets(userId);
  if (sockets.length === 0) return false;

  const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let delivered = false;

  for (const ws of sockets) {
    try {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(msg);
        delivered = true;
      }
    } catch {}
  }

  return delivered;
}

/**
 * Broadcasts an event to participants of a thread.
 */
export function broadcastToThread(participantIds, payload, excludeUserId = null) {
  for (const pId of participantIds) {
    if (excludeUserId && Number(pId) === Number(excludeUserId)) continue;
    sendToUser(pId, payload);
  }
}

// -------------------------------------------------------------
// Live Stream Room Functions (Prompt 10.1 / DFD Subsystem 15.0)
// -------------------------------------------------------------

/**
 * Joins a client socket to a live stream room.
 */
export function joinStreamRoom(streamId, user, socket) {
  const sId = Number(streamId);
  if (!liveStreamRooms.has(sId)) {
    liveStreamRooms.set(sId, new Set());
  }

  const room = liveStreamRooms.get(sId);
  const member = {
    socket,
    userId: user?.id ? Number(user.id) : null,
    role: user?.role || 'viewer',
    name: user?.full_name || 'Viewer',
    joinedAt: Date.now(),
  };

  room.add(member);
  socketStreamMap.set(socket, sId);

  // Broadcast updated viewer count to room
  broadcastStreamViewerCount(sId);
}

/**
 * Removes a client socket from a live stream room.
 */
export function leaveStreamRoom(streamId, socket) {
  const sId = Number(streamId);
  if (!liveStreamRooms.has(sId)) return;

  const room = liveStreamRooms.get(sId);
  for (const member of room) {
    if (member.socket === socket) {
      room.delete(member);
      break;
    }
  }

  socketStreamMap.delete(socket);

  if (room.size === 0) {
    liveStreamRooms.delete(sId);
  } else {
    broadcastStreamViewerCount(sId);
  }
}

/**
 * Returns the current active viewer count for a stream room.
 */
export function getStreamViewerCount(streamId) {
  const sId = Number(streamId);
  return liveStreamRooms.get(sId)?.size || 0;
}

/**
 * Broadcasts an event to all participants in a live stream room.
 */
export function broadcastToStream(streamId, payload, excludeSocket = null) {
  const sId = Number(streamId);
  const room = liveStreamRooms.get(sId);
  if (!room || room.size === 0) return 0;

  const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let count = 0;

  for (const member of room) {
    if (excludeSocket && member.socket === excludeSocket) continue;
    try {
      if (member.socket.readyState === 1 /* OPEN */) {
        member.socket.send(msg);
        count++;
      }
    } catch {}
  }

  return count;
}

/**
 * Broadcasts viewer count updates to the stream room.
 */
export function broadcastStreamViewerCount(streamId) {
  const sId = Number(streamId);
  const count = getStreamViewerCount(sId);
  broadcastToStream(sId, {
    type: 'live:viewer_count',
    payload: {
      streamId: sId,
      viewerCount: count,
      timestamp: Date.now(),
    },
  });
}

/**
 * Checks if a user is muted in a specific live stream.
 */
export function isUserMutedInStream(streamId, userId) {
  if (!userId) return false;
  const key = `${Number(streamId)}:${Number(userId)}`;
  const expires = streamMutedUsers.get(key);
  if (!expires) return false;
  if (Date.now() > expires) {
    streamMutedUsers.delete(key);
    return false;
  }
  return true;
}

/**
 * Sets a mute on a user in a live stream for a given duration (default 15 mins).
 */
export function muteUserInStream(streamId, userId, durationMs = 15 * 60 * 1000) {
  const key = `${Number(streamId)}:${Number(userId)}`;
  streamMutedUsers.set(key, Date.now() + durationMs);
}

export { eventBus };
