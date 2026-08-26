/**
 * live.js — Mock API handlers for Live Stream Commerce (Prompt 10.1 / DFD Subsystem 15.0).
 */

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
];

let nextStreamId = 3;

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
      if (stream) {
        stream.status = 'TERMINATED';
        stream.termination_reason = body?.reason || 'Policy Violation';
      }
      return {
        status: 200,
        body: { data: { stream, message_en: 'Stream terminated by moderator' } },
      };
    },
  },
  {
    method: 'POST',
    path: '/live/streams/:id/moderate/mute',
    handler() {
      return {
        status: 200,
        body: { data: { success: true, message_en: 'User muted from chat' } },
      };
    },
  },
];

export default liveHandlers;
