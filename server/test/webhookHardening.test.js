import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Fastify from 'fastify';

import { loadEnv, parseTrustProxy } from '../src/config/env.js';
import { addRawJsonBody } from '../src/plugins/rawBody.js';
import { BkashPaymentDriver } from '../src/integrations/payments/bkash.js';
import { NagadPaymentDriver } from '../src/integrations/payments/nagad.js';
import { SslcommerzPaymentDriver } from '../src/integrations/payments/sslcommerz.js';
import { MockPaymentDriver } from '../src/integrations/payments/mock.js';
import { createPaymentGateway } from '../src/integrations/payments/index.js';
import { SteadfastCourierAdapter } from '../src/integrations/courier/steadfast.js';
import { PathaoCourierAdapter } from '../src/integrations/courier/pathao.js';
import { RedxCourierAdapter } from '../src/integrations/courier/redx.js';
import { MockCourierAdapter } from '../src/integrations/courier/mock.js';

// WHY: every gateway/courier driver used to fall back to a secret that is visible in the repo, or to
// "no signature means accept". These tests pin the live-mode behaviour: no secret, no signature,
// or a signature made with the repo default must all be rejected.

const KEYS = [
  'NODE_ENV', 'PAYMENT_DRIVER', 'COURIER_DRIVER', 'BKASH_WEBHOOK_SECRET', 'NAGAD_WEBHOOK_SECRET',
  'STEADFAST_SECRET_KEY', 'PATHAO_WEBHOOK_TOKEN', 'REDX_WEBHOOK_TOKEN', 'SSLCOMMERZ_STORE_PASSWORD',
  'ALLOW_MOCK_DRIVERS_IN_PRODUCTION',
];

/** Runs fn with exactly the given env vars set, then restores every one of them. */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const hmac = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('hex');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const LIVE = { NODE_ENV: 'production', PAYMENT_DRIVER: 'live', COURIER_DRIVER: 'live' };

const baseEnv = {
  NODE_ENV: 'production',
  PORT: '5000',
  HOST: '0.0.0.0',
  PUBLIC_WEB_URL: 'https://x.test',
  DATABASE_URL: 'postgres://u:p@h/db',
  CACHE_DRIVER: 'memory',
  JWT_SECRET: 'j',
  COOKIE_SECRET: 'c',
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  LOG_LEVEL: 'info',
};

test('production refuses to boot on mock payment / courier / SMS drivers', () => {
  assert.throws(
    () => loadEnv({ ...baseEnv }),
    /PAYMENT_DRIVER must not be "mock"[\s\S]*COURIER_DRIVER[\s\S]*SMS_DRIVER/
  );
  const ok = loadEnv({
    ...baseEnv, PAYMENT_DRIVER: 'live', COURIER_DRIVER: 'steadfast', SMS_DRIVER: 'greenweb', SMS_API_KEY: 'k',
  });
  assert.equal(ok.core.nodeEnv, 'production');
});

test('mock drivers stay allowed in development and with the explicit staging opt-in', () => {
  assert.doesNotThrow(() => loadEnv({ ...baseEnv, NODE_ENV: 'development' }));
  assert.doesNotThrow(() => loadEnv({ ...baseEnv, ALLOW_MOCK_DRIVERS_IN_PRODUCTION: 'true' }));
});

test('TRUST_PROXY parses to what Fastify expects, and loadEnv exposes it', () => {
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('2'), 2);
  assert.deepEqual(parseTrustProxy('10.0.0.0/8, 127.0.0.1'), ['10.0.0.0/8', '127.0.0.1']);
  const cfg = loadEnv({ ...baseEnv, ALLOW_MOCK_DRIVERS_IN_PRODUCTION: 'true', TRUST_PROXY: '1' });
  assert.equal(cfg.core.trustProxy, 1);
});

test('bKash and Nagad reject a webhook signed with the repo default secret in live mode', async () => {
  await withEnv(LIVE, () => {
    for (const [Driver, dflt] of [
      [BkashPaymentDriver, 'bkash_webhook_secret_key'],
      [NagadPaymentDriver, 'nagad_webhook_secret_key'],
    ]) {
      const raw = '{"paymentID":"P1"}';
      const ok = new Driver().verifyWebhookSignature({ rawBody: raw, payload: JSON.parse(raw), signature: hmac(dflt, raw) });
      assert.equal(ok, false);
    }
  });
});

test('bKash accepts a signature over the raw bytes, and rejects tampering or a missing signature', async () => {
  await withEnv({ ...LIVE, BKASH_WEBHOOK_SECRET: 'real-secret' }, () => {
    const d = new BkashPaymentDriver();
    const raw = '{"paymentID": "P1",  "x":1}'; // odd spacing must still verify
    const payload = JSON.parse(raw);
    assert.equal(d.verifyWebhookSignature({ rawBody: raw, payload, signature: hmac('real-secret', raw) }), true);
    assert.equal(d.verifyWebhookSignature({ rawBody: `${raw} `, payload, signature: hmac('real-secret', raw) }), false);
    assert.equal(d.verifyWebhookSignature({ rawBody: raw, payload, signature: undefined }), false);
  });
});

test('SSLCommerz in live mode needs a valid verify_sign and no longer falls back to true', async () => {
  await withEnv({ ...LIVE, SSLCOMMERZ_STORE_PASSWORD: 'store-pass' }, () => {
    const d = new SslcommerzPaymentDriver();
    assert.equal(d.verifyWebhookSignature({ payload: { tran_id: 'T1' } }), false);
    assert.equal(
      d.verifyWebhookSignature({ payload: { tran_id: 'T1', verify_key: 'tran_id', verify_sign: 'forged' } }),
      false
    );
    const sign = md5(`store_passwd=${md5('store-pass')}&tran_id=T1`);
    assert.equal(
      d.verifyWebhookSignature({ payload: { tran_id: 'T1', verify_key: 'tran_id', verify_sign: sign } }),
      true
    );
  });
});

test('the mock payment driver never verifies in production and the factory will not hand it out', async () => {
  await withEnv({ NODE_ENV: 'production' }, () => {
    const d = new MockPaymentDriver();
    const raw = '{"a":1}';
    assert.equal(d.verifyWebhookSignature({ rawBody: raw, payload: {}, signature: hmac(d.webhookSecret, raw) }), false);
    assert.throws(() => createPaymentGateway('MOCK'), /disabled in production/);
  });
  await withEnv({ NODE_ENV: 'test' }, () => {
    assert.ok(createPaymentGateway('MOCK'));
  });
});

test('courier webhooks fail closed in live mode and still work for local dev', async () => {
  await withEnv({ ...LIVE, STEADFAST_SECRET_KEY: 'sf', PATHAO_WEBHOOK_TOKEN: 'pt', REDX_WEBHOOK_TOKEN: 'rx' }, () => {
    const sf = new SteadfastCourierAdapter();
    assert.equal(sf.verifyWebhookSignature({ headers: {}, rawBody: '{}' }), false, 'unsigned');
    assert.equal(sf.verifyWebhookSignature({ headers: { 'x-signature': hmac('sf', '{}') }, rawBody: '{}' }), true);

    const pa = new PathaoCourierAdapter();
    assert.equal(pa.verifyWebhookSignature({ headers: {} }), false, 'no token');
    assert.equal(pa.verifyWebhookSignature({ headers: { 'x-pathao-token': 'xxptxx' } }), false, 'substring must not match');
    assert.equal(pa.verifyWebhookSignature({ headers: { 'x-pathao-token': 'pt' } }), true);

    const rx = new RedxCourierAdapter();
    assert.equal(rx.verifyWebhookSignature({ headers: {} }), false);
    assert.equal(rx.verifyWebhookSignature({ headers: { 'x-redx-token': 'rx' } }), true);

    // An unknown carrier key falls back to the mock adapter; it must not be an open door.
    assert.equal(new MockCourierAdapter().verifyWebhookSignature({ headers: {} }), false);
  });
  await withEnv({ NODE_ENV: 'development' }, () => {
    assert.equal(new SteadfastCourierAdapter().verifyWebhookSignature({ headers: {}, rawBody: '{}' }), true);
    assert.equal(new MockCourierAdapter().verifyWebhookSignature({ headers: {} }), true);
  });
});

test('addRawJsonBody keeps the exact bytes, only inside its own plugin, and still rejects bad JSON', async () => {
  const app = Fastify();
  await app.register(async (scope) => {
    addRawJsonBody(scope);
    scope.post('/hook', async (req) => ({ raw: req.rawBody, parsed: req.body }));
  });
  app.post('/other', async (req) => ({ raw: req.rawBody ?? null }));

  const json = { 'content-type': 'application/json' };
  const body = '{"a":  1}';
  const hook = await app.inject({ method: 'POST', url: '/hook', headers: json, payload: body });
  assert.equal(hook.json().raw, body);
  assert.deepEqual(hook.json().parsed, { a: 1 });

  const other = await app.inject({ method: 'POST', url: '/other', headers: json, payload: body });
  assert.equal(other.json().raw, null);

  const bad = await app.inject({ method: 'POST', url: '/hook', headers: json, payload: '{nope' });
  assert.equal(bad.statusCode, 400);
  await app.close();
});
