/**
 * liveStream.routes.js — Fastify routes for Live Stream Commerce (Prompt 10.1 / DFD Subsystem 15.0).
 *
 * Enforces:
 * - Module check: requireModule('live_commerce')
 * - Permissions: live.stream.host, live.stream.view, moderation.live.handle, live.stream.terminate
 * - Restrictions: can_place_order
 */

import * as liveCtrl from '../controllers/liveStream.controller.js';
import { requireRestriction } from '../middlewares/requireRestriction.js';

export default async function liveStreamRoutes(fastify) {
  const reqMod = fastify.requireModule ? fastify.requireModule('live_commerce') : async () => {};
  const reqHost = fastify.requirePermission ? fastify.requirePermission('live.stream.host') : async () => {};
  const reqModLive = fastify.requirePermission ? fastify.requirePermission('moderation.live.handle') : async () => {};
  const reqTermLive = fastify.requirePermission ? fastify.requirePermission('live.stream.terminate') : async () => {};
  const checkCanOrder = requireRestriction('can_place_order');

  // 1. List Live Streams (Public / Filterable)
  fastify.get(
    '/live/streams',
    {
      preHandler: [reqMod],
    },
    liveCtrl.listStreams
  );

  // 2. Schedule / Create Live Stream (Host)
  fastify.post(
    '/live/streams',
    {
      preHandler: [
        fastify.authenticate,
        reqMod,
        reqHost,
      ],
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            cover_image: { type: 'string' },
            store_id: { type: ['number', 'null'] },
            scheduled_for: { type: ['string', 'null'] },
            products: { type: 'array' },
          },
        },
      },
    },
    liveCtrl.scheduleStream
  );

  // 3. Get Single Stream Details & Tokens (Viewer / Host)
  fastify.get(
    '/live/streams/:id',
    {
      preHandler: [
        // Optional auth: parse user if present
        async (req) => {
          try {
            if (req.headers.authorization) {
              await fastify.authenticate(req);
            }
          } catch {}
        },
        reqMod,
      ],
    },
    liveCtrl.getStream
  );

  // 4. Start Live Stream (Host)
  fastify.post(
    '/live/streams/:id/start',
    {
      preHandler: [
        fastify.authenticate,
        reqMod,
        reqHost,
      ],
    },
    liveCtrl.startStream
  );

  // 5. End Live Stream (Host)
  fastify.post(
    '/live/streams/:id/end',
    {
      preHandler: [
        fastify.authenticate,
        reqMod,
        reqHost,
      ],
    },
    liveCtrl.endStream
  );

  // 6. Pin Featured Product (Host)
  fastify.post(
    '/live/streams/:id/pin',
    {
      preHandler: [
        fastify.authenticate,
        reqMod,
        reqHost,
      ],
      schema: {
        body: {
          type: 'object',
          required: ['product_id'],
          properties: {
            product_id: { type: 'number' },
          },
        },
      },
    },
    liveCtrl.pinProduct
  );

  // 7. Unpin Product (Host)
  fastify.post(
    '/live/streams/:id/unpin',
    {
      preHandler: [
        fastify.authenticate,
        reqMod,
        reqHost,
      ],
    },
    liveCtrl.unpinProduct
  );

  // 8. Stream Reaction / Heart
  fastify.post(
    '/live/streams/:id/reaction',
    {
      preHandler: [
        async (req) => {
          try {
            if (req.headers.authorization) {
              await fastify.authenticate(req);
            }
          } catch {}
        },
        reqMod,
      ],
    },
    liveCtrl.recordReaction
  );

  // 9. In-Stream 1-Click Buy Now
  fastify.post(
    '/live/streams/:id/in-stream-buy',
    {
      preHandler: [
        fastify.authenticate,
        reqMod,
        checkCanOrder,
      ],
      schema: {
        body: {
          type: 'object',
          required: ['product_id'],
          properties: {
            product_id: { type: 'number' },
            variant_id: { type: ['number', 'null'] },
            quantity: { type: 'number' },
            recipient_name: { type: 'string' },
            recipient_phone: { type: 'string' },
            division: { type: 'string' },
            district: { type: 'string' },
            address_line: { type: 'string' },
            payment_method: { type: 'string' },
          },
        },
      },
    },
    liveCtrl.executeInStreamBuy
  );

  // 10. Moderation: Mute Participant
  fastify.post(
    '/live/streams/:id/moderate/mute',
    {
      preHandler: [
        fastify.authenticate,
        reqMod,
        reqModLive,
      ],
      schema: {
        body: {
          type: 'object',
          required: ['target_user_id'],
          properties: {
            target_user_id: { type: 'number' },
            duration_minutes: { type: 'number' },
          },
        },
      },
    },
    liveCtrl.moderateMute
  );

  // 11. Moderation: Force-Terminate Stream
  fastify.post(
    '/live/streams/:id/moderate/terminate',
    {
      preHandler: [
        fastify.authenticate,
        reqMod,
        reqTermLive,
      ],
      schema: {
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
      },
    },
    liveCtrl.moderateTerminate
  );
}
