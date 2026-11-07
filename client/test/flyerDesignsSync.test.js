/**
 * flyerDesignsSync.test.js — saved Flyer Studio designs, client side.
 *
 * The mock driver (mocks/handlers/flyerDesigns.ts) must behave like the server
 * (server/src/services/flyerDesign.service.ts), or mock mode would demonstrate a sync the real API
 * does not do. The two share no code, so their rules are compared here: the key pattern and the
 * limit read straight from the server's source, and the mock's answers for save, re-save, unsave,
 * the limit and a merge.
 *
 * Runs on node:test; no test-runner dependency is added to the client.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

// The mock reads and writes localStorage; give Node one.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { default: handlers } = await import('../src/mocks/handlers/flyerDesigns.ts');
const { designAt, designKey, OCCASIONS } = await import('../src/config/flyerTemplates.ts');

const route = (method, path) => handlers.find((h) => h.method === method && h.path === path).handler;
const list = () => route('GET', '/me/flyer-designs')({}).data;
const save = (key) => route('PUT', '/me/flyer-designs/:key')({ params: { key } });
const remove = (key) => route('DELETE', '/me/flyer-designs/:key')({ params: { key } });
const merge = (keys) => route('POST', '/me/flyer-designs/merge')({ body: { keys } }).data;
const key = (i) => designKey(designAt(OCCASIONS[0], i));

test('the mock uses the server\'s key pattern and limit', () => {
  const server = read('../../server/src/services/flyerDesign.service.ts');
  const mock = read('../src/mocks/handlers/flyerDesigns.ts');
  const serverRe = server.match(/DESIGN_KEY_RE = (\/.+\/);/)[1];
  const mockRe = mock.match(/const KEY_RE = (\/.+\/);/)[1];
  assert.equal(mockRe, serverRe);
  assert.equal(mock.match(/const LIMIT = (\d+);/)[1], server.match(/SAVED_LIMIT = (\d+);/)[1]);
});

test('save puts a design on top, saving again moves it, unsave removes it', () => {
  store.clear();
  save(key(1));
  save(key(2));
  assert.deepEqual(save(key(1)).data.keys, [key(1), key(2)]);
  assert.deepEqual(remove(key(1)).data.keys, [key(2)]);
  assert.deepEqual(remove(key(1)).data.keys, [key(2)], 'unsaving twice is harmless');
});

test('a malformed key is refused with the server\'s error', () => {
  const res = save('eid.hero_card');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('past the limit the oldest design goes', () => {
  store.clear();
  for (let i = 0; i < 65; i += 1) save(key(i));
  const { keys, limit } = list();
  assert.equal(keys.length, limit);
  assert.equal(keys[0], key(64));
  assert.ok(!keys.includes(key(0)));
});

test('a merge puts new designs on top and keeps the saved ones', () => {
  store.clear();
  save(key(1));
  assert.deepEqual(merge([key(5), 'junk', key(1), key(6)]).keys, [key(5), key(6), key(1)]);
});

test('the studio keeps no limit of its own and reads the server\'s', () => {
  const studio = read('../src/components/flyer/FlyerStudio.ts');
  assert.doesNotMatch(studio, /SAVED_LIMIT\s*=/);
  assert.match(studio, /flyerDesignsApi\.(save|remove|list|merge)/);
});
