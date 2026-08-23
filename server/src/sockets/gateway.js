/**
 * gateway.js — Fastify WebSocket Gateway (Prompt 8.1 / Prompt 10.1 / DFD Subsystem 7.0 & 15.0).
 *
 * Implements:
 * 1. Zero-leak ticket-based handshake authentication.
 * 2. Socket registration and presence binding.
 * 3. Connection lifecycle & protocol routing (Chat & Live Stream Commerce).
 */

import { consumeTicket, registerUserSocket, unregisterUserSocket } from './presence.js';
import { handleSocketMessage } from './chat.handler.js';
import { handleLiveSocketMessage } from './live.handler.js';

export default async function websocketGateway(app) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const ticket = req.query.ticket || req.headers['sec-websocket-protocol'];

    const userData = consumeTicket(ticket);
    if (!userData) {
      socket.send(
        JSON.stringify({
          type: 'error',
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired WebSocket ticket. Please obtain a fresh ticket via POST /api/v1/chat/ticket.',
        })
      );
      try {
        socket.close(4001, 'INVALID_TICKET');
      } catch {}
      return;
    }

    const user = {
      id: Number(userData.userId || userData.id),
      role: userData.role,
      full_name: userData.full_name || userData.name,
    };

    // Register active socket connection
    registerUserSocket(user.id, socket);

    // Send ready handshake
    socket.send(
      JSON.stringify({
        type: 'connection:ready',
        userId: user.id,
        connectedAt: new Date().toISOString(),
      })
    );

    // Bind event handlers
    socket.on('message', (rawData) => {
      let parsed;
      try {
        parsed = typeof rawData === 'string' ? JSON.parse(rawData) : JSON.parse(rawData.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'INVALID_JSON_PAYLOAD' }));
        return;
      }

      if (parsed.type && parsed.type.startsWith('live:')) {
        handleLiveSocketMessage(socket, user, parsed, app.db);
      } else {
        handleSocketMessage(socket, user, rawData, app.db);
      }
    });

    socket.on('close', () => {
      unregisterUserSocket(user.id, socket);
    });

    socket.on('error', () => {
      unregisterUserSocket(user.id, socket);
    });
  });
}
