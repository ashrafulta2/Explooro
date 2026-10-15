import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { handleWebhook } from '../src/controllers/whatsappWebhook.controller.ts';

// WHY: the webhook used to verify only when a signature header was present, so omitting it bypassed the check.
function call({ isProduction, secret, signature, body = { entry: [] }, rawBody }) {
  const prev = process.env.WHATSAPP_APP_SECRET;
  if (secret) process.env.WHATSAPP_APP_SECRET = secret; else delete process.env.WHATSAPP_APP_SECRET;
  const reply = { code: 0, status(c) { this.code = c; return this; }, send() { return this; } };
  const req = { headers: signature ? { 'x-hub-signature-256': signature } : {}, body, rawBody, server: { config: { isProduction, whatsapp: { driver: isProduction ? 'live' : 'mock' } }, db: {} } };
  return handleWebhook(req, reply).then(() => {
    if (prev === undefined) delete process.env.WHATSAPP_APP_SECRET; else process.env.WHATSAPP_APP_SECRET = prev;
    return reply.code;
  });
}

test('production rejects an unsigned webhook even when a secret is set', async () => {
  assert.equal(await call({ isProduction: true, secret: 's3cret' }), 401);
});

test('production with no secret configured fails closed', async () => {
  assert.equal(await call({ isProduction: true }), 401);
});

test('a wrong signature is refused and a correct one over the raw bytes is accepted', async () => {
  const rawBody = '{"entry": []}';
  assert.equal(await call({ isProduction: true, secret: 's', signature: 'sha256=bad', rawBody }), 401);
  const good = `sha256=${crypto.createHmac('sha256', 's').update(rawBody).digest('hex')}`;
  assert.equal(await call({ isProduction: true, secret: 's', signature: good, rawBody }), 200);
});

test('local mock mode without a secret still works', async () => {
  assert.equal(await call({ isProduction: false }), 200);
});
