/**
 * integrations.ts — Mock API for /admin/platform/integrations.
 *
 * Mirrors server/src/routes/integration.routes.ts and services/integration.service.ts (migration
 * 108) so the page works with VITE_API_MODE=mock. The catalog below is a copy of
 * server/src/config/integrations.ts; client/test/adminPlatformSuite.test.js fails if they drift.
 *
 * Like a fresh local server: every driver is `mock`, no .env credential is set, nothing is paused.
 * WHY saved values live only in memory: they stand in for secrets, and a mock that wrote them to
 * localStorage would teach the opposite of what the real page guarantees.
 */

import type { MockRoute } from '../types.ts';

const PAYMENT_PAUSE_EN = 'Shoppers are no longer offered this way to pay. Payments already started still finish.';
const PAYMENT_PAUSE_BN = 'ক্রেতারা আর এভাবে পেমেন্টের অপশন পাবেন না। আগে শুরু হওয়া পেমেন্ট শেষ হবে।';
const COURIER_PAUSE_EN = 'No new parcels or return pickups are booked with this courier. Parcels already booked keep updating.';
const COURIER_PAUSE_BN = 'এই কুরিয়ারে নতুন পার্সেল বা রিটার্ন পিকআপ বুক হবে না। আগে বুক করা পার্সেলের আপডেট আসতে থাকবে।';

const f = (key, env, label_en, label_bn, { secret = false, required = true } = {}) => ({ key, env, label_en, label_bn, secret, required });

export const MOCK_INTEGRATION_CATALOG = [
  {
    key: 'bkash_checkout', name: 'bKash Tokenized Checkout', type: 'PAYMENTS',
    category_en: 'Mobile Financial Service', category_bn: 'মোবাইল ফিন্যান্সিয়াল সার্ভিস',
    description_en: 'Shoppers pay for orders and vault top-ups with their bKash account.',
    description_bn: 'ক্রেতারা বিকাশ অ্যাকাউন্ট দিয়ে অর্ডার ও ভল্ট টপ-আপের পেমেন্ট করেন।',
    driver_env: 'PAYMENT_DRIVER', webhook_path: '/api/v1/payments/webhook/bkash', pausable: true,
    pause_effect_en: PAYMENT_PAUSE_EN, pause_effect_bn: PAYMENT_PAUSE_BN,
    fields: [
      f('app_key', 'BKASH_APP_KEY', 'App key', 'অ্যাপ কী'),
      f('app_secret', 'BKASH_APP_SECRET', 'App secret', 'অ্যাপ সিক্রেট', { secret: true }),
      f('username', 'BKASH_USERNAME', 'Merchant username', 'মার্চেন্ট ইউজারনেম'),
      f('password', 'BKASH_PASSWORD', 'Merchant password', 'মার্চেন্ট পাসওয়ার্ড', { secret: true }),
      f('base_url', 'BKASH_BASE_URL', 'API base URL', 'API বেস URL'),
      f('webhook_secret', 'BKASH_WEBHOOK_SECRET', 'Webhook signature secret', 'ওয়েবহুক সিগনেচার সিক্রেট', { secret: true }),
    ],
  },
  {
    key: 'nagad_direct', name: 'Nagad Direct MFS', type: 'PAYMENTS',
    category_en: 'Mobile Financial Service', category_bn: 'মোবাইল ফিন্যান্সিয়াল সার্ভিস',
    description_en: 'Shoppers pay for orders and vault top-ups with their Nagad account.',
    description_bn: 'ক্রেতারা নগদ অ্যাকাউন্ট দিয়ে অর্ডার ও ভল্ট টপ-আপের পেমেন্ট করেন।',
    driver_env: 'PAYMENT_DRIVER', webhook_path: '/api/v1/payments/webhook/nagad', pausable: true,
    pause_effect_en: PAYMENT_PAUSE_EN, pause_effect_bn: PAYMENT_PAUSE_BN,
    fields: [
      f('merchant_id', 'NAGAD_MERCHANT_ID', 'Merchant ID', 'মার্চেন্ট আইডি'),
      f('public_key', 'NAGAD_PGW_PUBLIC_KEY', 'Nagad public key', 'নগদ পাবলিক কী'),
      f('private_key', 'NAGAD_MERCHANT_PRIVATE_KEY', 'Merchant private key', 'মার্চেন্ট প্রাইভেট কী', { secret: true }),
      f('base_url', 'NAGAD_BASE_URL', 'API base URL', 'API বেস URL'),
      f('webhook_secret', 'NAGAD_WEBHOOK_SECRET', 'Webhook signature secret', 'ওয়েবহুক সিগনেচার সিক্রেট', { secret: true }),
    ],
  },
  {
    key: 'sslcommerz_cards', name: 'SSLCommerz Gateway', type: 'PAYMENTS',
    category_en: 'Cards & Net Banking', category_bn: 'কার্ড ও নেট ব্যাংকিং',
    description_en: 'Visa, Mastercard, Amex and internet banking payments through SSLCommerz.',
    description_bn: 'SSLCommerz এর মাধ্যমে ভিসা, মাস্টারকার্ড, অ্যামেক্স ও ইন্টারনেট ব্যাংকিং পেমেন্ট।',
    driver_env: 'PAYMENT_DRIVER', webhook_path: '/api/v1/payments/webhook/sslcommerz', pausable: true,
    pause_effect_en: PAYMENT_PAUSE_EN, pause_effect_bn: PAYMENT_PAUSE_BN,
    fields: [
      f('store_id', 'SSLCOMMERZ_STORE_ID', 'Store ID', 'স্টোর আইডি'),
      f('store_password', 'SSLCOMMERZ_STORE_PASSWORD', 'Store password', 'স্টোর পাসওয়ার্ড', { secret: true }),
    ],
  },
  {
    key: 'steadfast_courier', name: 'Steadfast Courier', type: 'LOGISTICS',
    category_en: 'Courier', category_bn: 'কুরিয়ার',
    description_en: 'Books parcels and return pickups and receives delivery updates from Steadfast.',
    description_bn: 'স্টেডফাস্টে পার্সেল ও রিটার্ন পিকআপ বুক করে এবং ডেলিভারির আপডেট পায়।',
    driver_env: 'COURIER_DRIVER', webhook_path: '/api/v1/webhooks/courier/steadfast', pausable: true,
    pause_effect_en: COURIER_PAUSE_EN, pause_effect_bn: COURIER_PAUSE_BN,
    fields: [
      f('api_key', 'STEADFAST_API_KEY', 'API key', 'API কী'),
      f('secret_key', 'STEADFAST_SECRET_KEY', 'Secret key (also signs webhooks)', 'সিক্রেট কী (ওয়েবহুকও সাইন করে)', { secret: true }),
    ],
  },
  {
    key: 'pathao_logistics', name: 'Pathao Courier', type: 'LOGISTICS',
    category_en: 'Courier', category_bn: 'কুরিয়ার',
    description_en: 'Books parcels and return pickups and receives delivery updates from Pathao.',
    description_bn: 'পাঠাওতে পার্সেল ও রিটার্ন পিকআপ বুক করে এবং ডেলিভারির আপডেট পায়।',
    driver_env: 'COURIER_DRIVER', webhook_path: '/api/v1/webhooks/courier/pathao', pausable: true,
    pause_effect_en: COURIER_PAUSE_EN, pause_effect_bn: COURIER_PAUSE_BN,
    fields: [
      f('client_id', 'PATHAO_CLIENT_ID', 'Client ID', 'ক্লায়েন্ট আইডি'),
      f('client_secret', 'PATHAO_CLIENT_SECRET', 'Client secret', 'ক্লায়েন্ট সিক্রেট', { secret: true }),
      f('webhook_token', 'PATHAO_WEBHOOK_TOKEN', 'Webhook token', 'ওয়েবহুক টোকেন', { secret: true }),
    ],
  },
  {
    key: 'redx_delivery', name: 'RedX Delivery', type: 'LOGISTICS',
    category_en: 'Courier', category_bn: 'কুরিয়ার',
    description_en: 'Books parcels and return pickups and receives delivery updates from RedX.',
    description_bn: 'রেডএক্সে পার্সেল ও রিটার্ন পিকআপ বুক করে এবং ডেলিভারির আপডেট পায়।',
    driver_env: 'COURIER_DRIVER', webhook_path: '/api/v1/webhooks/courier/redx', pausable: true,
    pause_effect_en: COURIER_PAUSE_EN, pause_effect_bn: COURIER_PAUSE_BN,
    fields: [
      f('api_token', 'REDX_API_TOKEN', 'API token', 'API টোকেন', { secret: true }),
      f('webhook_token', 'REDX_WEBHOOK_TOKEN', 'Webhook token', 'ওয়েবহুক টোকেন', { secret: true }),
    ],
  },
  {
    key: 'greenweb_sms', name: 'Greenweb SMS', type: 'MESSAGING',
    category_en: 'SMS', category_bn: 'এসএমএস',
    description_en: 'Sends sign-in codes and order updates by SMS.',
    description_bn: 'এসএমএসে সাইন-ইন কোড ও অর্ডারের আপডেট পাঠায়।',
    driver_env: 'SMS_DRIVER', webhook_path: null, pausable: false,
    pause_effect_en: 'Cannot be paused here: sign-in codes go out by SMS.',
    pause_effect_bn: 'এখান থেকে পজ করা যায় না: সাইন-ইন কোড এসএমএসে যায়।',
    fields: [
      f('api_key', 'SMS_API_KEY', 'API token', 'API টোকেন', { secret: true }),
      f('sender_id', 'SMS_SENDER_ID', 'Sender ID', 'সেন্ডার আইডি', { required: false }),
    ],
  },
  {
    key: 'whatsapp_cloud', name: 'WhatsApp Cloud API', type: 'MESSAGING',
    category_en: 'Messaging', category_bn: 'মেসেজিং',
    description_en: 'Sends order messages on WhatsApp and receives shopper replies.',
    description_bn: 'হোয়াটসঅ্যাপে অর্ডারের মেসেজ পাঠায় এবং ক্রেতার উত্তর গ্রহণ করে।',
    driver_env: 'WHATSAPP_DRIVER', webhook_path: '/api/v1/integrations/whatsapp/webhook', pausable: false,
    pause_effect_en: 'Switch it off with WHATSAPP_DRIVER; messages already queued would otherwise be lost.',
    pause_effect_bn: 'WHATSAPP_DRIVER দিয়ে বন্ধ করুন; না হলে লাইনে থাকা মেসেজ হারিয়ে যাবে।',
    fields: [
      f('phone_number_id', 'WHATSAPP_PHONE_NUMBER_ID', 'Phone number ID', 'ফোন নম্বর আইডি'),
      f('access_token', 'WHATSAPP_ACCESS_TOKEN', 'Access token', 'অ্যাক্সেস টোকেন', { secret: true }),
      f('app_secret', 'WHATSAPP_APP_SECRET', 'App secret (signs webhooks)', 'অ্যাপ সিক্রেট (ওয়েবহুক সাইন করে)', { secret: true }),
      f('verify_token', 'WHATSAPP_VERIFY_TOKEN', 'Webhook verify token', 'ওয়েবহুক ভেরিফাই টোকেন', { secret: true }),
    ],
  },
];

const API_BASE = 'http://localhost:5000';
const MAX_VALUE_LENGTH = 8192;

// key -> { is_enabled, values, last_test, updated_at }
const state = new Map();
const stateOf = (key) => {
  if (!state.has(key)) state.set(key, { is_enabled: true, values: {}, last_test: null, updated_at: null });
  return state.get(key);
};

/** Same rule as integration.service.ts hintFor. */
export function mockHintFor(secret, value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!secret) return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  return text.length >= 12 ? `••••${text.slice(-4)}` : '••••';
}

function shape(def) {
  const s = stateOf(def.key);
  const fields = def.fields.map((fd) => {
    const saved = s.values[fd.key];
    return {
      key: fd.key, label_en: fd.label_en, label_bn: fd.label_bn, env: fd.env,
      secret: fd.secret, required: fd.required,
      source: saved ? 'SAVED' : 'MISSING',
      hint: saved ? mockHintFor(fd.secret, saved) : null,
    };
  });
  return {
    key: def.key, name: def.name, type: def.type,
    category_en: def.category_en, category_bn: def.category_bn,
    description_en: def.description_en, description_bn: def.description_bn,
    driver_env: def.driver_env,
    driver_mode: 'MOCK',
    is_enabled: s.is_enabled,
    pausable: def.pausable,
    pause_effect_en: def.pause_effect_en, pause_effect_bn: def.pause_effect_bn,
    webhook_url: def.webhook_path ? `${API_BASE}${def.webhook_path}` : null,
    fields,
    missing_required: fields.filter((x) => x.required && x.source === 'MISSING').map((x) => x.key),
    last_test: s.last_test,
    updated_at: s.updated_at,
  };
}

const fail = (status, code, message_en, message_bn, details = undefined) => ({
  status,
  body: { error: { code, message_en, message_bn, ...(details ? { details } : {}) } },
});

const defOf = (key) => MOCK_INTEGRATION_CATALOG.find((d) => d.key === key);
const notFound = () => fail(404, 'NOT_FOUND', 'No such integration.', 'এই ইন্টিগ্রেশনটি পাওয়া যায়নি।');
const shortReason = (reason) =>
  typeof reason !== 'string' || reason.trim().length < 10
    ? fail(400, 'VALIDATION_FAILED', 'Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।')
    : null;

export const integrationHandlers: MockRoute[] = [
  {
    method: 'GET',
    path: '/admin/platform/integrations',
    handler() {
      const integrations = MOCK_INTEGRATION_CATALOG.map(shape);
      const count = (pred) => integrations.filter(pred).length;
      return {
        status: 200,
        body: {
          integrations,
          metrics: {
            total: integrations.length,
            live: count((i) => i.driver_mode === 'LIVE'),
            mock: count((i) => i.driver_mode === 'MOCK'),
            off: count((i) => i.driver_mode === 'OFF'),
            paused: count((i) => !i.is_enabled),
            needs_attention: count((i) => i.driver_mode === 'LIVE' && i.missing_required.length > 0),
            webhooks_24h: 0,
            webhooks_24h_valid: 0,
          },
          can_manage: true,
        },
      };
    },
  },

  {
    method: 'GET',
    path: '/admin/platform/integrations/logs',
    handler() {
      // A fresh local database has received no gateway webhook yet.
      return { status: 200, body: { logs: [] } };
    },
  },

  {
    method: 'PUT',
    path: '/admin/platform/integrations/:key/status',
    handler({ params = {}, body = {} } = {}) {
      const def = defOf(params.key);
      if (!def) return notFound();
      if (typeof body.enabled !== 'boolean') {
        return fail(400, 'VALIDATION_FAILED', 'enabled must be true or false.', 'enabled অবশ্যই true বা false হতে হবে।');
      }
      const bad = shortReason(body.reason);
      if (bad) return bad;
      if (!def.pausable && body.enabled === false) {
        return fail(409, 'CONFLICT', def.pause_effect_en, def.pause_effect_bn, { reason: 'NOT_PAUSABLE', key: def.key });
      }
      const s = stateOf(def.key);
      s.is_enabled = body.enabled;
      s.updated_at = new Date().toISOString();
      return { status: 200, body: { integration: shape(def) } };
    },
  },

  {
    method: 'PUT',
    path: '/admin/platform/integrations/:key',
    handler({ params = {}, body = {} } = {}) {
      const def = defOf(params.key);
      if (!def) return notFound();
      const bad = shortReason(body.reason);
      if (bad) return bad;
      const known = new Set(def.fields.map((x) => x.key));
      const set = {};
      for (const [k, v] of Object.entries(body.values || {})) {
        if (!known.has(k)) return fail(400, 'VALIDATION_FAILED', `${def.name} has no field "${k}".`, `${def.name} এ "${k}" নামে কোনো ঘর নেই।`);
        const text = typeof v === 'string' ? v.trim() : '';
        if (!text) continue;
        if (text.length > MAX_VALUE_LENGTH) return fail(400, 'VALIDATION_FAILED', `"${k}" is too long.`, `"${k}" অনেক বড়।`);
        set[k] = text;
      }
      const clear = Array.isArray(body.clear) ? body.clear : [];
      for (const k of clear) {
        if (!known.has(k)) return fail(400, 'VALIDATION_FAILED', `${def.name} has no field "${k}".`, `${def.name} এ "${k}" নামে কোনো ঘর নেই।`);
        if (set[k] !== undefined) return fail(400, 'VALIDATION_FAILED', `"${k}" cannot be both set and cleared.`, `"${k}" একসাথে সেট ও মুছে ফেলা যায় না।`);
      }
      if (!Object.keys(set).length && !clear.length) {
        return fail(400, 'VALIDATION_FAILED', 'Nothing to change: type a new value or clear one.', 'পরিবর্তনের কিছু নেই: নতুন মান লিখুন বা একটি মুছুন।');
      }
      const s = stateOf(def.key);
      s.values = { ...s.values, ...set };
      for (const k of clear) delete s.values[k];
      s.updated_at = new Date().toISOString();
      return { status: 200, body: { integration: shape(def), previous_credentials_unreadable: false } };
    },
  },

  {
    method: 'POST',
    path: '/admin/platform/integrations/:key/test',
    handler({ params = {} } = {}) {
      const def = defOf(params.key);
      if (!def) return notFound();
      const s = stateOf(def.key);
      let message_en = `Mock driver: nothing is sent to ${def.name}. Set ${def.driver_env} to go live.`;
      let message_bn = `মক ড্রাইভার: ${def.name} এ কিছু পাঠানো হয় না। লাইভ করতে ${def.driver_env} সেট করুন।`;
      if (!s.is_enabled) {
        message_en += ' It is paused.';
        message_bn += ' এটি পজ করা আছে।';
      }
      s.last_test = { at: new Date().toISOString(), ok: true, message: message_en };
      const integration = shape(def);
      return {
        status: 200,
        body: { ok: true, driver_mode: 'MOCK', missing: integration.missing_required, message_en, message_bn, integration },
      };
    },
  },
];
