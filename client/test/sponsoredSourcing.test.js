/**
 * sponsoredSourcing.test.js — the billable-event rules of the Sponsored Sourcing Slot client.
 *
 *   1. A click is reported once per ad however many times the saler acts on the card.
 *   2. A failing beacon never throws into the page (it must not stop "Add to Store").
 *   3. The catalog still loads when the ad lookup fails or ads are off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/core/api.js';
import { clickReporter, trackImpression, fetchSponsored } from '../src/services/sponsoredSourcing.js';

const ad = { campaign_id: 7, creative_id: 8, charged_cpc: 2.5 };

test('clickReporter sends the click once, with the ad ids', async () => {
  const sent = [];
  const original = api.post;
  api.post = async (path, body) => { sent.push([path, body]); return {}; };
  try {
    const report = clickReporter(ad);
    report();
    report();
    report();
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], '/ads/clicks');
    assert.deepEqual(sent[0][1], { campaign_id: 7, creative_id: 8, charged_cpc: 2.5 });
  } finally {
    api.post = original;
  }
});

test('a rejected click beacon does not throw or reject unhandled', async () => {
  const original = api.post;
  api.post = () => Promise.reject(new Error('network down'));
  try {
    assert.doesNotThrow(() => clickReporter(ad)());
    await new Promise((r) => setTimeout(r, 10)); // an unhandled rejection would fail the run
  } finally {
    api.post = original;
  }
});

test('each ad gets its own once-only reporter', () => {
  const sent = [];
  const original = api.post;
  api.post = async (path, body) => { sent.push(body.campaign_id); return {}; };
  try {
    clickReporter({ ...ad, campaign_id: 1 })();
    clickReporter({ ...ad, campaign_id: 2 })();
    assert.deepEqual(sent, [1, 2]);
  } finally {
    api.post = original;
  }
});

test('trackImpression without IntersectionObserver returns a callable cleanup', () => {
  const stop = trackImpression({}, ad);
  assert.equal(typeof stop, 'function');
  assert.doesNotThrow(stop);
});

test('fetchSponsored resolves to an array even when the request fails', async () => {
  const original = api.get;
  api.get = () => Promise.reject(new Error('boom'));
  try {
    assert.ok(Array.isArray(await fetchSponsored()));
  } finally {
    api.get = original;
  }
});
