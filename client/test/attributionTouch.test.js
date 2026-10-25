/**
 * attributionTouch.test.js — captureTouchFromQuery in services/attribution.ts.
 *
 * A shop partner's sponsored ad lands on /product/:id?store=<slug> (server adDestination.service.ts),
 * so `store` must become a STORE touch, or the partner who paid for the ad is never credited.
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { captureTouchFromQuery, currentTouch } = await import('../src/services/attribution.ts');

describe('captureTouchFromQuery', () => {
  beforeEach(() => store.clear());

  test('?store= records a STORE touch', () => {
    captureTouchFromQuery({ store: 'Rina-Fashion' });
    const t = currentTouch();
    assert.equal(t.type, 'STORE');
    assert.equal(t.ref, 'rina-fashion');
  });

  test('?ref= wins over ?store= when both are present', () => {
    captureTouchFromQuery({ ref: 'abc123', store: 'rina-fashion' });
    assert.deepEqual([currentTouch().type, currentTouch().ref], ['LINK', 'abc123']);
  });

  test('a query with neither leaves the last touch alone', () => {
    captureTouchFromQuery({ store: 'rina-fashion' });
    captureTouchFromQuery({ q: 'saree' });
    assert.equal(currentTouch().ref, 'rina-fashion');
  });
});
