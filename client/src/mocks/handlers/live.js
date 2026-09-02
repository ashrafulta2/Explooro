/**
 * live.js — Mock API handlers for Live Stream Commerce (Prompt 10.1 / DFD Subsystem 15.0).
 */

import { getMockSessionUser } from './auth.js';

let mockLiveStreams = [
  {
    id: 1,
    title: 'Dhakai Jamdani Live Showcase & Exclusive Flash Sale 🔥',
    description: 'Live weaving demo and real-time showcase of pure cotton Dhakai Jamdani Sarees with special instant discounts.',
    cover_image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80',
    status: 'LIVE',
    host_user_id: 6,
    host_name: 'Priyo Fashion Live',
    store_id: 1,
    store_name: 'Priyo Collection',
    viewer_count: 142,
    like_count: 850,
    started_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    scheduled_for: null,
    pinned_product_id: 1,
    pinned_product: {
      id: 1,
      title: 'Authentic Handloom Dhakai Jamdani Saree',
      title_en: 'Authentic Handloom Dhakai Jamdani Saree',
      title_bn: 'খাঁটি তাঁতের ঢাকাই জামদানি শাড়ি',
      price: '3500.00',
      regular_price: '4200.00',
      stock: 15,
      image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=400&auto=format&fit=crop&q=80',
      supplier_name: 'Dhakai Heritage Weavers Ltd.',
    },
    products: [
      {
        id: 1,
        title: 'Authentic Handloom Dhakai Jamdani Saree',
        price: '3500.00',
        stock: 15,
        is_pinned: true,
      },
      {
        id: 2,
        title: 'Pure Rajshahi Silk Dupatta / Scarf',
        price: '1200.00',
        stock: 24,
        is_pinned: false,
      },
    ],
  },
  {
    id: 2,
    title: 'Rajshahi Pure Silk & Traditional Festive Wear Launch',
    description: 'Introducing festive silk collection directly from Rajshahi master artisans with live Q&A.',
    cover_image: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=800&auto=format&fit=crop&q=80',
    status: 'SCHEDULED',
    host_user_id: 5,
    host_name: 'Silk Heritage Studio',
    store_id: 2,
    store_name: 'Silk Heritage',
    viewer_count: 0,
    like_count: 45,
    started_at: null,
    scheduled_for: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    pinned_product_id: null,
    pinned_product: null,
    products: [
      {
        id: 2,
        title: 'Pure Rajshahi Silk Dupatta / Scarf',
        price: '1200.00',
        stock: 24,
        is_pinned: false,
      },
    ],
  },
  // Two settled broadcasts, present so the console's ENDED/TERMINATED tabs are not dead ends and so
  // both post-hoc review outcomes are reachable in mock: one with a recording to watch, one where
  // the cut came before anything was captured.
  {
    id: 3,
    title: 'Winter Shawl Clearance — Final Hour',
    description: 'Closing stock of Kashmiri-style shawls at wholesale rates.',
    cover_image: 'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=800&auto=format&fit=crop&q=80',
    status: 'ENDED',
    host_user_id: 6,
    host_name: 'Priyo Fashion Live',
    store_id: 1,
    store_name: 'Priyo Collection',
    viewer_count: 0,
    peak_viewer_count: 318,
    like_count: 1204,
    started_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    ended_at: new Date(Date.now() - 3 * 86400000 + 3600000).toISOString(),
    scheduled_for: null,
    total_sales_amount: '48750.00',
    pinned_product_id: null,
    pinned_product: null,
    products: [],
  },
  {
    id: 4,
    title: 'Imported Cosmetics Mega Deal 💄',
    description: 'Branded skincare and makeup at import prices.',
    cover_image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&auto=format&fit=crop&q=80',
    status: 'TERMINATED',
    host_user_id: 5,
    host_name: 'Glow Bazar BD',
    store_id: 2,
    store_name: 'Glow Bazar',
    viewer_count: 0,
    peak_viewer_count: 96,
    like_count: 88,
    started_at: new Date(Date.now() - 86400000).toISOString(),
    ended_at: new Date(Date.now() - 86400000 + 480000).toISOString(),
    scheduled_for: null,
    termination_reason: 'Counterfeit branded goods offered on stream',
    pinned_product_id: null,
    pinned_product: null,
    products: [],
  },
];

let nextStreamId = 5;

/**
 * Live-moderation fixtures for /moderator/live.
 *
 * `flags` are pre-computed here rather than re-derived in the mock layer. The real detectors live
 * server-side (chat.service.js's detectContactInfoLeak and moderation.service.js's banned-keyword
 * blocklist) and the client must never import server code, so re-implementing the regexes here
 * would create a second copy that silently drifts from the one that actually governs. A mock's job
 * is to reproduce the API's *shape*, not its logic.
 */
let mockStreamMessages = {
  1: [
    {
      id: 501,
      message_type: 'CHAT',
      content: 'Apu eta ki khati cotton? Dam koto pordbe delivery soho?',
      user_id: 21,
      user_name: 'Shopper_Dhaka_99',
      user_roles: ['customer'],
      created_at: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
      deleted_at: null,
      flags: [],
    },
    {
      id: 502,
      message_type: 'CHAT',
      content: 'Direct kotha bolen amar sathe — 01711998877, WhatsApp e cheaper dibo.',
      user_id: 44,
      user_name: 'WholesaleBroker_BD',
      user_roles: ['customer'],
      created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      deleted_at: null,
      flags: [
        {
          code: 'EXTERNAL_CONTACT_LEAK',
          severity: 'HIGH',
          label_en: 'Off-platform contact details shared in chat',
          label_bn: 'চ্যাটে প্ল্যাটফর্মের বাইরের যোগাযোগের তথ্য শেয়ার করা হয়েছে',
          matches: ['PHONE: 01711998877', 'OFF_PLATFORM_KEYWORD: WhatsApp'],
        },
      ],
    },
    {
      id: 503,
      message_type: 'PIN_PRODUCT',
      content: 'Host pinned: Authentic Handloom Dhakai Jamdani Saree',
      user_id: 6,
      user_name: 'Priyo Fashion Live',
      user_roles: ['saler'],
      created_at: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
      deleted_at: null,
      flags: [],
    },
    {
      id: 504,
      message_type: 'CHAT',
      content: 'Eta to first copy replica, original na. Sobai savdhan thakben!',
      user_id: 58,
      user_name: 'Rakib_Hasan_01',
      user_roles: ['customer'],
      created_at: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
      deleted_at: null,
      flags: [
        {
          code: 'PROHIBITED_KEYWORD_EN',
          severity: 'HIGH',
          label_en: 'Contains prohibited term: "replica"',
          label_bn: 'নিষিদ্ধ শব্দ পাওয়া গেছে: "replica"',
          term: 'replica',
        },
      ],
    },
    {
      id: 505,
      message_type: 'BUY',
      content: 'Nusrat J. just bought Authentic Handloom Dhakai Jamdani Saree',
      user_id: 31,
      user_name: 'Nusrat Jahan',
      user_roles: ['customer'],
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      deleted_at: null,
      flags: [],
    },
    {
      id: 506,
      message_type: 'CHAT',
      content: 'এটা নকল মাল, কেউ কিনবেন না।',
      user_id: 58,
      user_name: 'Rakib_Hasan_01',
      user_roles: ['customer'],
      created_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
      deleted_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      deleted_by: 3,
      deleted_by_name: 'Dev Moderator',
      deletion_reason: 'Unsubstantiated counterfeit claim during live sale',
      flags: [],
    },
    {
      id: 507,
      message_type: 'CHAT',
      content: 'Saree ta sundor! Ami 2 ta nilam. Delivery Chattogram e koto din lagbe?',
      user_id: 77,
      user_name: 'Farhana_Ctg',
      user_roles: ['customer'],
      created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      deleted_at: null,
      flags: [],
    },
  ],
  2: [],
};

/** MODERATION rows live in the same table as chat on the server; kept separate here for clarity. */
let mockStreamActionLog = {
  1: [
    {
      id: 9002,
      action: 'REMOVE_MESSAGE',
      content: 'A chat message was removed. Reason: Unsubstantiated counterfeit claim during live sale',
      actor_id: 3,
      actor_name: 'Dev Moderator',
      metadata: { action: 'REMOVE_MESSAGE', messageId: 506, targetUserId: 58 },
      created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    },
    {
      id: 9001,
      action: 'MUTE',
      content: 'Participant muted for 15 minutes. Reason: Sharing off-platform contact details',
      actor_id: 3,
      actor_name: 'Dev Moderator',
      metadata: { action: 'MUTE', targetUserId: 44, durationMinutes: 15 },
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    },
  ],
  2: [],
};

/** streamId -> Map(userId -> expiry ms). Mirrors sockets/presence.js's in-memory mute registry. */
const mockStreamMutes = new Map([[1, new Map([[44, Date.now() + 5 * 60 * 1000]])]]);

function mutesFor(streamId) {
  const registry = mockStreamMutes.get(streamId);
  if (!registry) return [];
  const now = Date.now();
  const out = [];
  for (const [userId, expires] of registry.entries()) {
    if (now > expires) {
      registry.delete(userId);
      continue;
    }
    out.push({ user_id: userId, expires_at: new Date(expires).toISOString() });
  }
  return out;
}

function nextLogId() {
  return 9100 + Math.floor(Math.random() * 899);
}


/**
 * Mirrors buildPreview() in server/src/services/liveStream.service.js. The console renders straight
 * off this shape, so if it drifts from the server the mock stops being a rehearsal of the real
 * thing. An observer token is hidden from the room by design — see the service for why.
 */
function mockModerationPreview(stream, audioOnly = false) {
  if (stream.status === 'LIVE') {
    return {
      mode: 'LIVE',
      driver: 'mock',
      room_id: stream.room_id ?? `room_mock_${stream.id}`,
      playback_url: stream.playback_url ?? null,
      audio_only: Boolean(audioOnly),
      token: `mock_obs_token_${stream.id}_3_${Date.now()}`,
      identity: 'moderator_3',
      hidden: true,
      can_publish_data: false,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  }
  if (stream.status === 'ENDED' || stream.status === 'TERMINATED') {
    // Stream 4 stands in for the case that actually bites: the broadcast was cut before the
    // recorder captured anything, so there is nothing to review afterwards.
    if (stream.id === 4) return { mode: 'UNAVAILABLE', reason: 'RECORDING_NOT_READY' };
    return {
      mode: 'RECORDING',
      driver: 'mock',
      recording_url: stream.recording_url ?? `/api/v1/media/recordings/mock_stream_${stream.id}.mp4`,
      duration_seconds: 3600,
      recorded_at: stream.ended_at ?? new Date(Date.now() - 86400000).toISOString(),
    };
  }
  return { mode: 'NOT_STARTED' };
}

export const liveHandlers = [
  {
    method: 'GET',
    path: '/live/streams',
    handler({ query }) {
      const status = query?.status;
      let streams = mockLiveStreams;
      if (status && status !== 'all') {
        streams = streams.filter((s) => s.status === status);
      }
      return {
        status: 200,
        body: {
          data: {
            streams,
            total: streams.length,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/live/streams/:id',
    handler({ params, query }) {
      const streamId = Number(params.id);
      const stream = mockLiveStreams.find((s) => s.id === streamId) || mockLiveStreams[0];
      if (!stream) {
        return {
          status: 404,
          body: {
            error: {
              code: 'STREAM_NOT_FOUND',
              message_en: 'Live stream not found',
            },
          },
        };
      }

      return {
        status: 200,
        body: {
          data: {
            stream,
            viewer_token: 'mock-webrtc-viewer-jwt-token',
            audio_only: query?.audio_only === 'true',
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams',
    handler({ body }) {
      const b = body || {};
      const newStream = {
        id: nextStreamId++,
        title: b.title || 'New Live Broadcast',
        description: b.description || '',
        cover_image: b.cover_image || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800',
        status: b.scheduled_for ? 'SCHEDULED' : 'LIVE',
        host_user_id: 6,
        host_name: 'My Store Live',
        store_id: b.store_id || 1,
        viewer_count: 1,
        like_count: 0,
        started_at: b.scheduled_for ? null : new Date().toISOString(),
        scheduled_for: b.scheduled_for || null,
        pinned_product_id: null,
        pinned_product: null,
        products: b.products || [],
      };

      mockLiveStreams.unshift(newStream);

      return {
        status: 201,
        body: {
          data: {
            stream: newStream,
            host_token: 'mock-webrtc-host-publisher-token',
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/start',
    handler({ params }) {
      const streamId = Number(params.id);
      const stream = mockLiveStreams.find((s) => s.id === streamId);
      if (stream) {
        stream.status = 'LIVE';
        stream.started_at = new Date().toISOString();
      }
      return {
        status: 200,
        body: { data: { stream } },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/end',
    handler({ params }) {
      const streamId = Number(params.id);
      const stream = mockLiveStreams.find((s) => s.id === streamId);
      if (stream) {
        stream.status = 'ENDED';
        stream.ended_at = new Date().toISOString();
      }
      return {
        status: 200,
        body: { data: { stream } },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/pin',
    handler({ params, body }) {
      const streamId = Number(params.id);
      const productId = Number(body?.product_id);
      const stream = mockLiveStreams.find((s) => s.id === streamId);
      if (stream) {
        stream.pinned_product_id = productId;
        stream.pinned_product = {
          id: productId,
          title: 'Authentic Handloom Dhakai Jamdani Saree',
          price: '3500.00',
          regular_price: '4200.00',
          stock: 15,
          image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=400',
        };
      }
      return {
        status: 200,
        body: { data: { stream } },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/unpin',
    handler({ params }) {
      const streamId = Number(params.id);
      const stream = mockLiveStreams.find((s) => s.id === streamId);
      if (stream) {
        stream.pinned_product_id = null;
        stream.pinned_product = null;
      }
      return {
        status: 200,
        body: { data: { stream } },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/reaction',
    handler({ params }) {
      const streamId = Number(params.id);
      const stream = mockLiveStreams.find((s) => s.id === streamId);
      if (stream) {
        stream.like_count += 1;
      }
      return {
        status: 200,
        body: { data: { success: true, like_count: stream?.like_count || 1 } },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/in-stream-buy',
    handler({ params, body }) {
      const streamId = Number(params.id);
      const b = body || {};
      const orderRef = `ORD-LIVE-${Date.now().toString().slice(-6)}`;
      return {
        status: 201,
        body: {
          data: {
            order: {
              ref: orderRef,
              stream_id: streamId,
              product_id: b.product_id,
              total_amount: b.total_amount || '3500.00',
              status: 'PLACED',
            },
            message_en: 'In-stream order placed successfully!',
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/moderate/terminate',
    handler({ params, body }) {
      const streamId = Number(params.id);
      const stream = mockLiveStreams.find((s) => s.id === streamId);
      const reason = body?.reason || 'Policy Violation';

      // WHY the 202: `live.stream.terminate` is a HIGH-tier permission, so on the real server
      // requirePermission intercepts a non-super_admin and files a pending_admin_action instead of
      // executing (middlewares/requirePermission.js). A mock that always terminated would hide the
      // maker-checker path from every moderator testing in dev — the exact path they will hit in
      // production.
      const roles = getMockSessionUser()?.roles ?? [];
      if (!roles.includes('super_admin')) {
        return {
          status: 202,
          body: {
            deferred: {
              code: 'PERMISSION_PENDING_APPROVAL',
              pending_action_ref: `PAA-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
              action_key: 'live.stream.terminate',
              message_en: 'Sent for approval. Your Admin must approve this before it takes effect.',
              message_bn: 'অনুমোদনের জন্য পাঠানো হয়েছে। কার্যকর হওয়ার আগে আপনার অ্যাডমিনকে এটি অনুমোদন করতে হবে।',
              expires_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
              trace_id: `MOCK-${Date.now().toString(36).toUpperCase()}`,
            },
          },
        };
      }

      if (stream) {
        stream.status = 'TERMINATED';
        stream.termination_reason = reason;
        (mockStreamActionLog[streamId] ??= []).unshift({
          id: nextLogId(),
          action: 'TERMINATE',
          content: `Stream was terminated by moderation. Reason: ${reason}`,
          actor_id: 3,
          actor_name: 'Dev Moderator',
          metadata: { action: 'TERMINATE', reason },
          created_at: new Date().toISOString(),
        });
      }

      return {
        status: 200,
        body: {
          data: { stream },
          meta: { message_en: 'Stream has been force-terminated.', message_bn: 'স্ট্রিমটি জোরপূর্বক বন্ধ করা হয়েছে।' },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/moderate/mute',
    handler({ params, body }) {
      const streamId = Number(params.id);
      const targetUserId = Number(body?.target_user_id);
      const durationMinutes = Number(body?.duration_minutes) || 15;
      const reason = body?.reason || 'Chat policy violation';

      if (!mockStreamMutes.has(streamId)) mockStreamMutes.set(streamId, new Map());
      mockStreamMutes.get(streamId).set(targetUserId, Date.now() + durationMinutes * 60 * 1000);

      (mockStreamActionLog[streamId] ??= []).unshift({
        id: nextLogId(),
        action: 'MUTE',
        content: `Participant muted for ${durationMinutes} minutes. Reason: ${reason}`,
        actor_id: 3,
        actor_name: 'Dev Moderator',
        metadata: { action: 'MUTE', targetUserId, durationMinutes, reason },
        created_at: new Date().toISOString(),
      });

      return {
        status: 200,
        body: {
          data: { success: true, target_user_id: targetUserId, duration_minutes: durationMinutes },
          meta: { message_en: 'User muted successfully.', message_bn: 'ব্যবহারকারীকে সফলভাবে মিউট করা হয়েছে।' },
        },
      };
    },
  },
  // ── Live Moderation Console (/moderator/live) ──────────────────────────────
  {
    method: 'GET',
    path: '/live/moderation/streams',
    handler({ query }) {
      const status = query?.status;
      let streams = mockLiveStreams;
      if (status && status !== 'ALL') {
        streams = streams.filter((s) => s.status === status);
      }

      const enriched = streams.map((s) => {
        const messages = mockStreamMessages[s.id] ?? [];
        return {
          ...s,
          chat_message_count: messages.filter((m) => m.message_type === 'CHAT' && !m.deleted_at).length,
          removed_message_count: messages.filter((m) => m.deleted_at).length,
          flagged_count: messages.filter((m) => !m.deleted_at && m.flags?.length > 0).length,
          muted_count: mutesFor(s.id).length,
        };
      });

      // Same ordering the server applies: a running broadcast is the only one still stoppable.
      enriched.sort((a, b) => {
        const rank = (s) => (s.status === 'LIVE' ? 1 : s.status === 'SCHEDULED' ? 2 : 3);
        return rank(a) - rank(b) || b.chat_message_count - a.chat_message_count || b.id - a.id;
      });

      return { status: 200, body: { data: { streams: enriched, total: enriched.length } } };
    },
  },
  {
    method: 'GET',
    path: '/live/moderation/streams/:id',
    handler({ params, query }) {
      const streamId = Number(params.id);
      const stream = mockLiveStreams.find((s) => s.id === streamId);
      if (!stream) {
        return {
          status: 404,
          body: {
            error: {
              code: 'STREAM_NOT_FOUND',
              message_en: 'Live stream not found.',
              message_bn: 'লাইভ স্ট্রিমটি খুঁজে পাওয়া যায়নি।',
            },
          },
        };
      }

      const messages = mockStreamMessages[streamId] ?? [];
      return {
        status: 200,
        body: {
          data: {
            stream,
            preview: mockModerationPreview(stream, query?.audio_only === 'true'),
            messages,
            action_log: mockStreamActionLog[streamId] ?? [],
            mutes: mutesFor(streamId),
            flagged_count: messages.filter((m) => !m.deleted_at && m.flags?.length > 0).length,
            removed_count: messages.filter((m) => m.deleted_at).length,
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/moderate/messages/:messageId/remove',
    handler({ params, body }) {
      const streamId = Number(params.id);
      const messageId = Number(params.messageId);
      const message = (mockStreamMessages[streamId] ?? []).find((m) => m.id === messageId);

      if (!message || message.deleted_at) {
        return {
          status: 404,
          body: {
            error: {
              code: 'MESSAGE_NOT_FOUND',
              message_en: 'That message is not in this stream, or has already been removed.',
              message_bn: 'বার্তাটি এই স্ট্রিমে নেই, অথবা এটি ইতিমধ্যে সরানো হয়েছে।',
            },
          },
        };
      }

      const reason = body?.reason || 'Policy Violation';
      message.deleted_at = new Date().toISOString();
      message.deleted_by = 3;
      message.deleted_by_name = 'Dev Moderator';
      message.deletion_reason = reason;
      message.flags = [];

      (mockStreamActionLog[streamId] ??= []).unshift({
        id: nextLogId(),
        action: 'REMOVE_MESSAGE',
        content: `A chat message was removed. Reason: ${reason}`,
        actor_id: 3,
        actor_name: 'Dev Moderator',
        metadata: { action: 'REMOVE_MESSAGE', messageId, targetUserId: message.user_id, reason },
        created_at: new Date().toISOString(),
      });

      return {
        status: 200,
        body: {
          data: { message_id: messageId, deleted_at: message.deleted_at },
          meta: {
            message_en: 'Message removed from the live chat.',
            message_bn: 'লাইভ চ্যাট থেকে বার্তাটি সরানো হয়েছে।',
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/moderate/unmute',
    handler({ params, body }) {
      const streamId = Number(params.id);
      const targetUserId = Number(body?.target_user_id);
      const registry = mockStreamMutes.get(streamId);
      const wasMuted = Boolean(registry?.delete(targetUserId));

      if (wasMuted) {
        (mockStreamActionLog[streamId] ??= []).unshift({
          id: nextLogId(),
          action: 'UNMUTE',
          content: 'Participant mute lifted by moderation.',
          actor_id: 3,
          actor_name: 'Dev Moderator',
          metadata: { action: 'UNMUTE', targetUserId },
          created_at: new Date().toISOString(),
        });
      }

      return {
        status: 200,
        body: {
          data: { target_user_id: targetUserId, was_muted: wasMuted },
          meta: {
            message_en: wasMuted ? 'Mute lifted.' : 'That participant was not muted.',
            message_bn: wasMuted ? 'মিউট তুলে নেওয়া হয়েছে।' : 'এই অংশগ্রহণকারী মিউট করা ছিল না।',
          },
        },
      };
    },
  },
];


export default liveHandlers;
