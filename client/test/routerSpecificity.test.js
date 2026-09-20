/**
 * routerSpecificity.test.js — a static route must win over a `:param` sibling registered before it.
 *
 * The bug: `/admin/users/:id` came first in main.js, so `/admin/users/verification` (KYC) and
 * `/admin/users/restrictions` rendered the user-detail page's "User not found".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { pickRoute } from '../src/core/router.js';

const routes = [
  { path: '/admin/users', id: 'list' },
  { path: '/admin/users/:id', id: 'detail' },
  { path: '/admin/users/restrictions', id: 'restrictions' },
  { path: '/admin/users/verification', id: 'kyc' },
  { path: '/shop/:slug/:productId', id: 'product' },
  { path: '/shop/:slug/reviews', id: 'reviews' },
];

describe('pickRoute', () => {
  it('prefers a static sibling registered after a :param route', () => {
    assert.equal(pickRoute(routes, '/admin/users/verification').route.id, 'kyc');
    assert.equal(pickRoute(routes, '/admin/users/restrictions').route.id, 'restrictions');
  });

  it('still routes a real id to the param route and extracts it', () => {
    const hit = pickRoute(routes, '/admin/users/USR-89210');
    assert.equal(hit.route.id, 'detail');
    assert.deepEqual(hit.params, { id: 'USR-89210' });
  });

  it('prefers fewer params when both routes have some', () => {
    assert.equal(pickRoute(routes, '/shop/acme/reviews').route.id, 'reviews');
    assert.equal(pickRoute(routes, '/shop/acme/p-1').route.id, 'product');
  });

  it('returns null when nothing matches, and the first of equally specific routes otherwise', () => {
    assert.equal(pickRoute(routes, '/nope'), null);
    const twins = [{ path: '/a/:x', id: 'first' }, { path: '/a/:y', id: 'second' }];
    assert.equal(pickRoute(twins, '/a/1').route.id, 'first');
  });
});

describe('main.js route table', () => {
  it('has no static route left unreachable behind a :param route', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const paths = [...readFileSync(join(root, 'src/main.js'), 'utf8').matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
    const table = paths.map((path) => ({ path }));
    for (const p of paths.filter((x) => !x.includes(':'))) {
      assert.equal(pickRoute(table, p).route.path, p, `${p} resolves to a different route`);
    }
  });
});
