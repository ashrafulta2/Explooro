/**
 * integrations.ts — the gateway catalog behind /admin/platform/integrations (migration 108).
 *
 * One entry per outside service a live driver talks to. Each field names the .env variable the
 * driver read before credentials could be stored, and that variable stays the fallback: a driver
 * asks `integrations/credentialStore.ts` first (a value an admin saved, encrypted in
 * `integration_settings`), then process.env, then its own development default.
 *
 * WHY only these eight: they are the services whose driver actually reads a credential. bKash B2C
 * payouts (its live driver is a placeholder that throws), Rocket (no driver), R2 storage and the AI
 * provider are left out until a driver uses what would be saved here, so the page never offers a
 * key that nothing reads.
 *
 * WHY a field list per service and not free-form JSON: the service refuses a field the catalog does
 * not name, so a typo cannot be stored as a credential that silently does nothing.
 */

export type IntegrationType = 'PAYMENTS' | 'LOGISTICS' | 'MESSAGING';

/** What the deployment's driver switch says for a service. */
export type DriverMode = 'LIVE' | 'MOCK' | 'OFF';

export interface IntegrationField {
  key: string;
  /** The .env variable the driver falls back to. */
  env: string;
  label_en: string;
  label_bn: string;
  /** A secret is never sent back to the browser, only "set" plus its last four characters. */
  secret: boolean;
  /** Needed for the live driver to work; Test Connection reports a missing one. */
  required: boolean;
}

export interface IntegrationDef {
  key: string;
  name: string;
  type: IntegrationType;
  category_en: string;
  category_bn: string;
  description_en: string;
  description_bn: string;
  /** The .env switch that picks mock / live / off for this service. */
  driver_env: string;
  /** Values of driver_env that mean this service runs live. Empty: any value except mock/none. */
  live_values: string[];
  /** Path (under the API's public URL) the provider must be told to send webhooks to. */
  webhook_path: string | null;
  /**
   * Whether an admin may pause it here, and what pausing does. SMS and WhatsApp cannot be paused:
   * sign-in codes go out by SMS, so pausing it would lock everyone out.
   */
  pausable: boolean;
  pause_effect_en: string;
  pause_effect_bn: string;
  /** Checkout method this gateway takes money for (paymentMethods.service.ts). */
  payment_method?: string;
  /** Carrier key couriers are booked under (shipment.service.ts, reversePickup.service.ts). */
  carrier?: string;
  fields: IntegrationField[];
}

const field = (key, env, label_en, label_bn, { secret = false, required = true } = {}): IntegrationField => ({
  key,
  env,
  label_en,
  label_bn,
  secret,
  required,
});

const PAYMENT_PAUSE_EN = 'Shoppers are no longer offered this way to pay. Payments already started still finish.';
const PAYMENT_PAUSE_BN = 'ক্রেতারা আর এভাবে পেমেন্টের অপশন পাবেন না। আগে শুরু হওয়া পেমেন্ট শেষ হবে।';
const COURIER_PAUSE_EN = 'No new parcels or return pickups are booked with this courier. Parcels already booked keep updating.';
const COURIER_PAUSE_BN = 'এই কুরিয়ারে নতুন পার্সেল বা রিটার্ন পিকআপ বুক হবে না। আগে বুক করা পার্সেলের আপডেট আসতে থাকবে।';

export const INTEGRATIONS: readonly IntegrationDef[] = Object.freeze([
  {
    key: 'bkash_checkout',
    name: 'bKash Tokenized Checkout',
    type: 'PAYMENTS',
    category_en: 'Mobile Financial Service',
    category_bn: 'মোবাইল ফিন্যান্সিয়াল সার্ভিস',
    description_en: 'Shoppers pay for orders and vault top-ups with their bKash account.',
    description_bn: 'ক্রেতারা বিকাশ অ্যাকাউন্ট দিয়ে অর্ডার ও ভল্ট টপ-আপের পেমেন্ট করেন।',
    driver_env: 'PAYMENT_DRIVER',
    live_values: [],
    webhook_path: '/api/v1/payments/webhook/bkash',
    pausable: true,
    pause_effect_en: PAYMENT_PAUSE_EN,
    pause_effect_bn: PAYMENT_PAUSE_BN,
    payment_method: 'BKASH',
    fields: [
      field('app_key', 'BKASH_APP_KEY', 'App key', 'অ্যাপ কী'),
      field('app_secret', 'BKASH_APP_SECRET', 'App secret', 'অ্যাপ সিক্রেট', { secret: true }),
      field('username', 'BKASH_USERNAME', 'Merchant username', 'মার্চেন্ট ইউজারনেম'),
      field('password', 'BKASH_PASSWORD', 'Merchant password', 'মার্চেন্ট পাসওয়ার্ড', { secret: true }),
      field('base_url', 'BKASH_BASE_URL', 'API base URL', 'API বেস URL'),
      field('webhook_secret', 'BKASH_WEBHOOK_SECRET', 'Webhook signature secret', 'ওয়েবহুক সিগনেচার সিক্রেট', { secret: true }),
    ],
  },
  {
    key: 'nagad_direct',
    name: 'Nagad Direct MFS',
    type: 'PAYMENTS',
    category_en: 'Mobile Financial Service',
    category_bn: 'মোবাইল ফিন্যান্সিয়াল সার্ভিস',
    description_en: 'Shoppers pay for orders and vault top-ups with their Nagad account.',
    description_bn: 'ক্রেতারা নগদ অ্যাকাউন্ট দিয়ে অর্ডার ও ভল্ট টপ-আপের পেমেন্ট করেন।',
    driver_env: 'PAYMENT_DRIVER',
    live_values: [],
    webhook_path: '/api/v1/payments/webhook/nagad',
    pausable: true,
    pause_effect_en: PAYMENT_PAUSE_EN,
    pause_effect_bn: PAYMENT_PAUSE_BN,
    payment_method: 'NAGAD',
    fields: [
      field('merchant_id', 'NAGAD_MERCHANT_ID', 'Merchant ID', 'মার্চেন্ট আইডি'),
      field('public_key', 'NAGAD_PGW_PUBLIC_KEY', 'Nagad public key', 'নগদ পাবলিক কী'),
      field('private_key', 'NAGAD_MERCHANT_PRIVATE_KEY', 'Merchant private key', 'মার্চেন্ট প্রাইভেট কী', { secret: true }),
      field('base_url', 'NAGAD_BASE_URL', 'API base URL', 'API বেস URL'),
      field('webhook_secret', 'NAGAD_WEBHOOK_SECRET', 'Webhook signature secret', 'ওয়েবহুক সিগনেচার সিক্রেট', { secret: true }),
    ],
  },
  {
    key: 'sslcommerz_cards',
    name: 'SSLCommerz Gateway',
    type: 'PAYMENTS',
    category_en: 'Cards & Net Banking',
    category_bn: 'কার্ড ও নেট ব্যাংকিং',
    description_en: 'Visa, Mastercard, Amex and internet banking payments through SSLCommerz.',
    description_bn: 'SSLCommerz এর মাধ্যমে ভিসা, মাস্টারকার্ড, অ্যামেক্স ও ইন্টারনেট ব্যাংকিং পেমেন্ট।',
    driver_env: 'PAYMENT_DRIVER',
    live_values: [],
    webhook_path: '/api/v1/payments/webhook/sslcommerz',
    pausable: true,
    pause_effect_en: PAYMENT_PAUSE_EN,
    pause_effect_bn: PAYMENT_PAUSE_BN,
    payment_method: 'CARD',
    fields: [
      field('store_id', 'SSLCOMMERZ_STORE_ID', 'Store ID', 'স্টোর আইডি'),
      field('store_password', 'SSLCOMMERZ_STORE_PASSWORD', 'Store password', 'স্টোর পাসওয়ার্ড', { secret: true }),
    ],
  },
  {
    key: 'steadfast_courier',
    name: 'Steadfast Courier',
    type: 'LOGISTICS',
    category_en: 'Courier',
    category_bn: 'কুরিয়ার',
    description_en: 'Books parcels and return pickups and receives delivery updates from Steadfast.',
    description_bn: 'স্টেডফাস্টে পার্সেল ও রিটার্ন পিকআপ বুক করে এবং ডেলিভারির আপডেট পায়।',
    driver_env: 'COURIER_DRIVER',
    live_values: [],
    webhook_path: '/api/v1/webhooks/courier/steadfast',
    pausable: true,
    pause_effect_en: COURIER_PAUSE_EN,
    pause_effect_bn: COURIER_PAUSE_BN,
    carrier: 'STEADFAST',
    fields: [
      field('api_key', 'STEADFAST_API_KEY', 'API key', 'API কী'),
      field('secret_key', 'STEADFAST_SECRET_KEY', 'Secret key (also signs webhooks)', 'সিক্রেট কী (ওয়েবহুকও সাইন করে)', { secret: true }),
    ],
  },
  {
    key: 'pathao_logistics',
    name: 'Pathao Courier',
    type: 'LOGISTICS',
    category_en: 'Courier',
    category_bn: 'কুরিয়ার',
    description_en: 'Books parcels and return pickups and receives delivery updates from Pathao.',
    description_bn: 'পাঠাওতে পার্সেল ও রিটার্ন পিকআপ বুক করে এবং ডেলিভারির আপডেট পায়।',
    driver_env: 'COURIER_DRIVER',
    live_values: [],
    webhook_path: '/api/v1/webhooks/courier/pathao',
    pausable: true,
    pause_effect_en: COURIER_PAUSE_EN,
    pause_effect_bn: COURIER_PAUSE_BN,
    carrier: 'PATHAO',
    fields: [
      field('client_id', 'PATHAO_CLIENT_ID', 'Client ID', 'ক্লায়েন্ট আইডি'),
      field('client_secret', 'PATHAO_CLIENT_SECRET', 'Client secret', 'ক্লায়েন্ট সিক্রেট', { secret: true }),
      field('webhook_token', 'PATHAO_WEBHOOK_TOKEN', 'Webhook token', 'ওয়েবহুক টোকেন', { secret: true }),
    ],
  },
  {
    key: 'redx_delivery',
    name: 'RedX Delivery',
    type: 'LOGISTICS',
    category_en: 'Courier',
    category_bn: 'কুরিয়ার',
    description_en: 'Books parcels and return pickups and receives delivery updates from RedX.',
    description_bn: 'রেডএক্সে পার্সেল ও রিটার্ন পিকআপ বুক করে এবং ডেলিভারির আপডেট পায়।',
    driver_env: 'COURIER_DRIVER',
    live_values: [],
    webhook_path: '/api/v1/webhooks/courier/redx',
    pausable: true,
    pause_effect_en: COURIER_PAUSE_EN,
    pause_effect_bn: COURIER_PAUSE_BN,
    carrier: 'REDX',
    fields: [
      field('api_token', 'REDX_API_TOKEN', 'API token', 'API টোকেন', { secret: true }),
      field('webhook_token', 'REDX_WEBHOOK_TOKEN', 'Webhook token', 'ওয়েবহুক টোকেন', { secret: true }),
    ],
  },
  {
    key: 'greenweb_sms',
    name: 'Greenweb SMS',
    type: 'MESSAGING',
    category_en: 'SMS',
    category_bn: 'এসএমএস',
    description_en: 'Sends sign-in codes and order updates by SMS.',
    description_bn: 'এসএমএসে সাইন-ইন কোড ও অর্ডারের আপডেট পাঠায়।',
    driver_env: 'SMS_DRIVER',
    live_values: ['greenweb'],
    webhook_path: null,
    pausable: false,
    pause_effect_en: 'Cannot be paused here: sign-in codes go out by SMS.',
    pause_effect_bn: 'এখান থেকে পজ করা যায় না: সাইন-ইন কোড এসএমএসে যায়।',
    fields: [
      field('api_key', 'SMS_API_KEY', 'API token', 'API টোকেন', { secret: true }),
      field('sender_id', 'SMS_SENDER_ID', 'Sender ID', 'সেন্ডার আইডি', { required: false }),
    ],
  },
  {
    key: 'whatsapp_cloud',
    name: 'WhatsApp Cloud API',
    type: 'MESSAGING',
    category_en: 'Messaging',
    category_bn: 'মেসেজিং',
    description_en: 'Sends order messages on WhatsApp and receives shopper replies.',
    description_bn: 'হোয়াটসঅ্যাপে অর্ডারের মেসেজ পাঠায় এবং ক্রেতার উত্তর গ্রহণ করে।',
    driver_env: 'WHATSAPP_DRIVER',
    live_values: ['cloud_api'],
    webhook_path: '/api/v1/integrations/whatsapp/webhook',
    pausable: false,
    pause_effect_en: 'Switch it off with WHATSAPP_DRIVER; messages already queued would otherwise be lost.',
    pause_effect_bn: 'WHATSAPP_DRIVER দিয়ে বন্ধ করুন; না হলে লাইনে থাকা মেসেজ হারিয়ে যাবে।',
    fields: [
      field('phone_number_id', 'WHATSAPP_PHONE_NUMBER_ID', 'Phone number ID', 'ফোন নম্বর আইডি'),
      field('access_token', 'WHATSAPP_ACCESS_TOKEN', 'Access token', 'অ্যাক্সেস টোকেন', { secret: true }),
      field('app_secret', 'WHATSAPP_APP_SECRET', 'App secret (signs webhooks)', 'অ্যাপ সিক্রেট (ওয়েবহুক সাইন করে)', { secret: true }),
      field('verify_token', 'WHATSAPP_VERIFY_TOKEN', 'Webhook verify token', 'ওয়েবহুক ভেরিফাই টোকেন', { secret: true }),
    ],
  },
] as IntegrationDef[]);

export const INTEGRATION_KEYS = Object.freeze(INTEGRATIONS.map((i) => i.key));

export function integrationByKey(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}

/** The catalog entry that takes money for a checkout method (BKASH, NAGAD, CARD). */
export function integrationForPaymentMethod(method: string): IntegrationDef | undefined {
  const m = String(method || '').toUpperCase();
  return INTEGRATIONS.find((i) => i.payment_method === m);
}

/** The catalog entry for a courier carrier key (STEADFAST, PATHAO, REDX). */
export function integrationForCarrier(carrier: string): IntegrationDef | undefined {
  const c = String(carrier || '').toUpperCase();
  return INTEGRATIONS.find((i) => i.carrier === c);
}

/** What this deployment's .env switch says for a service: LIVE, MOCK, or OFF (`none`). */
export function driverModeOf(def: IntegrationDef, env: Record<string, string | undefined> = process.env): DriverMode {
  const value = String(env[def.driver_env] ?? 'mock').trim().toLowerCase();
  if (value === 'none') return 'OFF';
  if (def.live_values.length) return def.live_values.includes(value) ? 'LIVE' : 'MOCK';
  return value === 'mock' || value === '' ? 'MOCK' : 'LIVE';
}
