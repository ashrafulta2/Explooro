/**
 * routerOverlap.test.js — two overlapping navigations must mount ONE page, the newest.
 *
 * The bug: render() empties `root`, awaits the lazy page import, then mounts. Two navigations in
 * flight (a link click that also pushed its own history entry) both passed the await and both
 * mounted, so a 404 showed up twice, stacked.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createRouter } from '../src/core/router.js';

function installDom() {
  const location = { pathname: '/', search: '', hash: '', origin: 'http://localhost', href: 'http://localhost/' };
  globalThis.window = {
    location,
    scrollY: 0,
    scrollTo() {},
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = { title: '', addEventListener() {}, removeEventListener() {} };
  globalThis.history = {
    state: null,
    pushState(state, _t, url) {
      this.state = state;
      const u = new URL(url, 'http://localhost');
      location.pathname = u.pathname;
      location.search = u.search;
    },
    replaceState(state) {
      this.state = state;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('router overlapping renders', () => {
  beforeEach(installDom);

  it('mounts only the newest of two in-flight navigations', async () => {
    const mounted = [];
    const cleaned = [];
    const slow = deferred();
    const root = { style: {}, replaceChildren() {} };

    const page = (name) => ({
      default: () => {
        mounted.push(name);
        return () => cleaned.push(name);
      },
    });

    const router = createRouter({
      root,
      routes: [
        { path: '/a', permission: null, module: 'core', load: () => slow.promise.then(() => page('a')) },
        { path: '/b', permission: null, module: 'core', load: async () => page('b') },
      ],
      notFound: { path: '*', title: '404', load: async () => page('404') },
    });

    const first = router.navigate('/a'); // stalls on its lazy import
    const second = router.navigate('/b'); // finishes immediately
    await second;
    slow.resolve();
    await first;

    assert.deepEqual(mounted, ['b'], 'the stale render must not mount after the newer one');
  });

  it('runs a page cleanup once when renders overlap', async () => {
    const cleaned = [];
    const gate = deferred();
    const root = { style: {}, replaceChildren() {} };

    const router = createRouter({
      root,
      routes: [
        { path: '/one', permission: null, module: 'core', load: async () => ({ default: () => () => cleaned.push('one') }) },
        { path: '/two', permission: null, module: 'core', load: () => gate.promise.then(() => ({ default: () => {} })) },
        { path: '/three', permission: null, module: 'core', load: async () => ({ default: () => {} }) },
      ],
      notFound: { path: '*', title: '404', load: async () => ({ default: () => {} }) },
    });

    await router.navigate('/one');
    const stalled = router.navigate('/two');
    await router.navigate('/three');
    gate.resolve();
    await stalled;

    assert.deepEqual(cleaned, ['one'], 'the page that was torn down is cleaned up exactly once');
  });
});
