import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import idempotencyPlugin, { isIdempotentRoute } from '../src/middlewares/idempotency.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';

// WHY: only five controllers honoured Idempotency-Key, so a retried approval, refund, escrow release
// or reconcile on the other ~230 write routes ran twice. These tests pin the shared plugin's contract.

function fakeCache() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async set(k, v) { store.set(k, v); },
    async setnx(k, v) { if (store.has(k)) return false; store.set(k, v); return true; },
    async del(k) { store.delete(k); },
  };
}

async function build() {
  const app = Fastify();
  app.decorate('cache', fakeCache());
  await app.register(errorHandlerPlugin);
  await app.register(idempotencyPlugin);
  const calls = { release: 0, fail: 0, slow: 0, checkout: 0, hook: 0 };

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: Number(id) };
  });

  app.post('/api/v1/admin/finance/escrow/:id/release', async (req) => {
    calls.release += 1;
    return { data: { released: req.params.id, n: calls.release } };
  });
  app.post('/api/v1/admin/boom', async () => {
    calls.fail += 1;
    if (calls.fail === 1) throw new Error('first attempt fails');
    return { data: { ok: true } };
  });
  app.post('/api/v1/admin/slow', async () => {
    calls.slow += 1;
    await new Promise((r) => setTimeout(r, 80));
    return { data: { ok: true } };
  });
  app.post('/api/v1/orders/checkout', async () => { calls.checkout += 1; return { data: {} }; });
  app.post('/api/v1/auth/login', async () => { calls.hook += 1; return { data: { token: 't' } }; });
  app.get('/api/v1/things', async () => { calls.hook += 1; return { data: [] }; });
  await app.ready();
  return { app, calls };
}

const J = { 'content-type': 'application/json' };
const post = (app, url, { key, user = '1', body = { amount: 10 } } = {}) =>
  app.inject({
    method: 'POST',
    url,
    headers: { ...J, ...(key ? { 'idempotency-key': key } : {}), 'x-test-user': user },
    payload: body,
  });

test('a retry with the same key and request replays the first response instead of running again', async () => {
  const { app, calls } = await build();
  const url = '/api/v1/admin/finance/escrow/5/release';
  const first = await post(app, url, { key: 'release-key-0001' });
  const second = await post(app, url, { key: 'release-key-0001' });
  assert.equal(calls.release, 1, 'the handler ran once');
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body, first.body);
  assert.equal(second.headers['idempotency-replayed'], 'true');
  assert.equal(first.headers['idempotency-replayed'], undefined);
  await app.close();
});

test('without a key every request runs, exactly as before', async () => {
  const { app, calls } = await build();
  await post(app, '/api/v1/admin/finance/escrow/5/release');
  await post(app, '/api/v1/admin/finance/escrow/5/release');
  assert.equal(calls.release, 2);
  await app.close();
});

test('the same key on a different target or body is refused, not silently answered', async () => {
  const { app, calls } = await build();
  await post(app, '/api/v1/admin/finance/escrow/5/release', { key: 'release-key-0002' });
  const otherTarget = await post(app, '/api/v1/admin/finance/escrow/6/release', { key: 'release-key-0002' });
  const otherBody = await post(app, '/api/v1/admin/finance/escrow/5/release', { key: 'release-key-0002', body: { amount: 99 } });
  assert.equal(calls.release, 1);
  // Scope is the route pattern, so a different escrow id under the same key is the same mismatch as a different body.
  for (const res of [otherTarget, otherBody]) {
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'IDEMPOTENCY_MISMATCH');
  }
  await app.close();
});

test('two different users can pick the same key without colliding', async () => {
  const { app, calls } = await build();
  const url = '/api/v1/admin/finance/escrow/5/release';
  await post(app, url, { key: 'shared-key-0001', user: '1' });
  await post(app, url, { key: 'shared-key-0001', user: '2' });
  assert.equal(calls.release, 2);
  await app.close();
});

test('a failed request frees the key so it can be retried with the same key', async () => {
  const { app, calls } = await build();
  const first = await post(app, '/api/v1/admin/boom', { key: 'boom-key-00001' });
  assert.ok(first.statusCode >= 500);
  const retry = await post(app, '/api/v1/admin/boom', { key: 'boom-key-00001' });
  assert.equal(retry.statusCode, 200);
  assert.equal(calls.fail, 2);
  await app.close();
});

test('a concurrent retry while the first is still running is a conflict, not a second run', async () => {
  const { app, calls } = await build();
  const a = post(app, '/api/v1/admin/slow', { key: 'slow-key-00001' });
  await new Promise((r) => setTimeout(r, 15));
  const b = await post(app, '/api/v1/admin/slow', { key: 'slow-key-00001' });
  const first = await a;
  assert.equal(first.statusCode, 200);
  assert.equal(b.statusCode, 409);
  assert.equal(calls.slow, 1);
  await app.close();
});

test('a malformed key is a validation error and nothing runs', async () => {
  const { app, calls } = await build();
  const res = await post(app, '/api/v1/admin/finance/escrow/5/release', { key: 'short' });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.release, 0);
  await app.close();
});

test('routes that own their key, auth routes and GETs are left alone', async () => {
  const { app, calls } = await build();
  await post(app, '/api/v1/orders/checkout', { key: 'order-key-00001' });
  await post(app, '/api/v1/orders/checkout', { key: 'order-key-00001' });
  assert.equal(calls.checkout, 2, 'checkout keeps its own database-backed handling');
  await post(app, '/api/v1/auth/login', { key: 'login-key-00001' });
  const second = await post(app, '/api/v1/auth/login', { key: 'login-key-00001' });
  assert.equal(second.headers['idempotency-replayed'], undefined, 'tokens are never cached or replayed');
  assert.equal(calls.hook, 2);
  assert.equal(isIdempotentRoute('/api/v1/things', 'GET'), false);
  assert.equal(isIdempotentRoute('/api/v1/x', 'POST', { idempotency: false }), false);
  assert.equal(isIdempotentRoute('/api/v1/payments/webhook/:gateway', 'POST'), false);
  assert.equal(isIdempotentRoute('/api/v1/admin/payouts/:id/approve', ['POST']), true);
  await app.close();
});
