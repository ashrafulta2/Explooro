/**
 * developer.js — Mock handlers for Developer Portal & Webhooks (Prompt 10.7).
 */

let mockApiKeys = [
  {
    id: 1,
    ref: 'KEY-9901-ERP',
    name: 'Primary ERP Integration Key',
    user_id: 1,
    key_prefix: 'exp_live_a1b2c3...',
    scopes: ['catalog.products.read', 'catalog.stores.read', 'orders.create'],
    rate_limit_rpm: 120,
    ip_allowlist: ['192.168.1.100', '10.0.0.1'],
    status: 'ACTIVE',
    last_used_at: new Date(Date.now() - 3600000).toISOString(),
    expires_at: null,
    created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
  },
  {
    id: 2,
    ref: 'KEY-9902-BLOG',
    name: 'Affiliate Fashion Blog Widget',
    user_id: 1,
    key_prefix: 'exp_live_d4e5f6...',
    scopes: ['catalog.products.read', 'catalog.categories.read'],
    rate_limit_rpm: 60,
    ip_allowlist: [],
    status: 'ACTIVE',
    last_used_at: new Date(Date.now() - 1200000).toISOString(),
    expires_at: null,
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
];

let mockWebhooks = [
  {
    id: 1,
    ref: 'WHK-8801-PROD',
    user_id: 1,
    target_url: 'https://partner-erp.example.com/webhooks/explooro',
    secret: 'whsec_991823774812398471293847',
    events: ['order.created', 'order.delivered', 'product.updated'],
    status: 'ACTIVE',
    failure_count: 0,
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
  },
];

let mockDeliveries = [
  {
    id: 101,
    subscription_id: 1,
    subscription_ref: 'WHK-8801-PROD',
    target_url: 'https://partner-erp.example.com/webhooks/explooro',
    event_name: 'order.created',
    payload_json: {
      order_ref: 'SO-882199',
      total_amount: 4500.00,
      customer_name: 'Tanvir Hossain',
      items_count: 2,
    },
    attempt_number: 1,
    max_attempts: 3,
    response_status: 200,
    response_body: '{"received": true}',
    error_message: null,
    status: 'DELIVERED',
    delivered_at: new Date(Date.now() - 1800000).toISOString(),
    created_at: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: 102,
    subscription_id: 1,
    subscription_ref: 'WHK-8801-PROD',
    target_url: 'https://partner-erp.example.com/webhooks/explooro',
    event_name: 'order.delivered',
    payload_json: {
      order_ref: 'SO-882190',
      delivered_at: new Date().toISOString(),
    },
    attempt_number: 3,
    max_attempts: 3,
    response_status: 503,
    response_body: '{"error": "Service Unavailable"}',
    error_message: 'Exhausted 3 attempts (HTTP 503)',
    status: 'DEAD_LETTER',
    delivered_at: null,
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 103,
    subscription_id: 1,
    subscription_ref: 'WHK-8801-PROD',
    target_url: 'https://partner-erp.example.com/webhooks/explooro',
    event_name: 'payout.completed',
    payload_json: {
      payout_ref: 'PAY-7712',
      amount: 15000.00,
    },
    attempt_number: 2,
    max_attempts: 3,
    response_status: 500,
    response_body: 'Internal Server Error',
    error_message: 'HTTP 500',
    status: 'FAILED',
    delivered_at: null,
    created_at: new Date(Date.now() - 600000).toISOString(),
  },
];

export const developerHandlers = [
  {
    method: 'GET',
    path: '/developer/api-keys',
    handler: () => ({ success: true, data: mockApiKeys }),
  },
  {
    method: 'POST',
    path: '/developer/api-keys',
    handler: (req) => {
      const body = req.body || {};
      const newKey = {
        id: mockApiKeys.length + 1,
        ref: `KEY-${Math.floor(1000 + Math.random() * 9000)}`,
        name: body.name || 'New API Key',
        user_id: 1,
        key_prefix: 'exp_live_99aabb...',
        scopes: body.scopes || ['catalog.products.read'],
        rate_limit_rpm: body.rate_limit_rpm || 60,
        ip_allowlist: body.ip_allowlist || [],
        status: 'ACTIVE',
        last_used_at: null,
        expires_at: null,
        created_at: new Date().toISOString(),
      };
      mockApiKeys.unshift(newKey);
      return {
        success: true,
        data: {
          key: newKey,
          raw_token: `exp_live_99aabb${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/developer/api-keys/:id/rotate',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      const k = mockApiKeys.find((x) => x.id === id);
      if (k) {
        k.key_prefix = 'exp_live_rotated...';
        k.last_used_at = null;
      }
      return {
        success: true,
        data: {
          key: k,
          raw_token: `exp_live_rotated_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
        },
      };
    },
  },
  {
    method: 'DELETE',
    path: '/developer/api-keys/:id',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      const k = mockApiKeys.find((x) => x.id === id);
      if (k) k.status = 'REVOKED';
      return { success: true, data: k };
    },
  },
  {
    method: 'GET',
    path: '/developer/webhooks',
    handler: () => ({ success: true, data: mockWebhooks }),
  },
  {
    method: 'POST',
    path: '/developer/webhooks',
    handler: (req) => {
      const body = req.body || {};
      const newSub = {
        id: mockWebhooks.length + 1,
        ref: `WHK-${Math.floor(1000 + Math.random() * 9000)}`,
        user_id: 1,
        target_url: body.target_url || 'https://example.com/webhook',
        secret: `whsec_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
        events: body.events || ['order.created'],
        status: 'ACTIVE',
        failure_count: 0,
        created_at: new Date().toISOString(),
      };
      mockWebhooks.unshift(newSub);
      return { success: true, data: newSub };
    },
  },
  {
    method: 'DELETE',
    path: '/developer/webhooks/:id',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      mockWebhooks = mockWebhooks.filter((x) => x.id !== id);
      return { success: true, data: { id, deleted: true } };
    },
  },
  {
    method: 'GET',
    path: '/developer/webhooks/deliveries',
    handler: (req) => {
      const status = req.query?.status;
      const filtered = status ? mockDeliveries.filter((d) => d.status === status) : mockDeliveries;
      return { success: true, data: filtered };
    },
  },
  {
    method: 'POST',
    path: '/developer/webhooks/deliveries/:id/replay',
    handler: (req) => {
      const id = parseInt(req.params.id, 10);
      const d = mockDeliveries.find((x) => x.id === id);
      if (d) {
        d.status = 'DELIVERED';
        d.response_status = 200;
        d.error_message = null;
        d.delivered_at = new Date().toISOString();
      }
      return { success: true, data: d };
    },
  },
];
