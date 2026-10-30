/**
 * adDensity.test.js — how often sponsored cards appear in a product grid (migration 090).
 *
 *   1. Reads are forgiving: a missing or out-of-range value falls back to the default per field.
 *   2. Writes are strict: out of range is refused, never clamped; every >= 4 so ads never touch.
 *   3. A write needs a reason, refuses a stale form (409), and writes one audit row with before/after.
 *   4. The client fallback, the mock and the migration seed all equal the server's default and bounds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_DENSITY, DENSITY_LIMITS, PLACEMENTS, resolveDensity, validateDensity, updateDensity,
} from '../src/services/adDensity.service.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');
const plain = (o) => JSON.parse(JSON.stringify(o));

test('a missing or broken stored value falls back to the default, field by field', () => {
  assert.deepEqual(resolveDensity(null), plain(DEFAULT_DENSITY));
  const r = resolveDensity({ SEARCH_RESULTS: { first_at: 3, every: 2 }, FEED: 'junk' });
  assert.equal(r.SEARCH_RESULTS.first_at, 3);
  assert.equal(r.SEARCH_RESULTS.every, DEFAULT_DENSITY.SEARCH_RESULTS.every);
  assert.deepEqual(r.FEED, plain(DEFAULT_DENSITY.FEED));
});

test('a write out of range is refused, never clamped', () => {
  const ok = plain(DEFAULT_DENSITY);
  assert.deepEqual(validateDensity(ok), ok);
  for (const [p, f, v] of [['FEED', 'every', 3], ['FEED', 'every', 41], ['SEARCH_RESULTS', 'first_at', -1], ['SEARCH_RESULTS', 'first_at', 1.5]]) {
    const bad = plain(DEFAULT_DENSITY);
    bad[p][f] = v;
    assert.throws(() => validateDensity(bad), (e) => e.code === 'VALIDATION_FAILED', `${p}.${f}=${v}`);
  }
  assert.throws(() => validateDensity({ SEARCH_RESULTS: ok.SEARCH_RESULTS }), (e) => e.code === 'VALIDATION_FAILED');
});

test('the smallest allowed gap still keeps two ads apart', () => {
  assert.ok(DENSITY_LIMITS.every.min >= 2);
});

function fakePool(row) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push(sql);
      if (/FOR UPDATE/.test(sql)) return { rows: row ? [row] : [] };
      if (/INSERT INTO platform_settings/.test(sql)) {
        return { rows: [{ key: params[0], value_json: JSON.parse(params[1]), updated_at: '2026-10-30T10:00:00.000Z' }] };
      }
      return { rows: [{ id: 1 }] };
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client, query: client.query } };
}

test('a write needs a reason, refuses a stale form, and is audited', async () => {
  const stored = { value_json: plain(DEFAULT_DENSITY), updated_at: '2026-10-01T00:00:00.000Z' };
  const next = plain(DEFAULT_DENSITY);
  next.FEED.every = 12;

  await assert.rejects(updateDensity(fakePool(stored).pool, { input: next, reason: 'short' }), (e) => e.code === 'VALIDATION_FAILED');
  await assert.rejects(
    updateDensity(fakePool(stored).pool, { input: next, reason: 'Fewer ads in the feed', expectedUpdatedAt: '2026-09-01T00:00:00.000Z' }),
    (e) => e.code === 'PRECONDITION_CHANGED'
  );

  const { pool, calls } = fakePool(stored);
  const saved = await updateDensity(pool, { input: next, reason: 'Fewer ads in the feed', userId: 7, expectedUpdatedAt: stored.updated_at });
  assert.equal(saved.FEED.every, 12);
  assert.equal(calls.filter((s) => /audit_logs/i.test(s)).length, 1, 'one audit row');
  assert.ok(calls.includes('COMMIT'));
});

test('the client fallback, the mock and the seed equal the server default and bounds', () => {
  const client = read('client/src/components/ads/adPlacement.ts');
  for (const p of PLACEMENTS) {
    const d = DEFAULT_DENSITY[p];
    assert.match(client, new RegExp(`${p}: \\{ firstAt: ${d.first_at}, every: ${d.every} \\}`), `client ${p}`);
  }
  const mock = read('client/src/mocks/handlers/ads.ts');
  const L = DENSITY_LIMITS;
  assert.ok(mock.includes(`first_at: { min: ${L.first_at.min}, max: ${L.first_at.max} }, every: { min: ${L.every.min}, max: ${L.every.max} }`), 'mock limits');
  const seed = read('server/src/db/migrations/090_ad_density.sql').match(/'(\{"SEARCH_RESULTS".*?\})'::jsonb/)[1];
  assert.deepEqual(JSON.parse(seed), plain(DEFAULT_DENSITY));
});
