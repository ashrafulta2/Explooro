/**
 * analyticsBreakdown.test.js — invariants for the executive dashboard's category/channel breakdowns.
 *
 * WHY: these bars used to be hardcoded percentages, so they looked right while reporting nothing.
 * The invariants that keep them honest: shares add up to 100% of what actually sold, nothing is
 * invented when there is no data, and a legacy (pre-v2) row contributes nothing.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BREAKDOWN_VERSION,
  SALES_CHANNELS,
  aggregateBreakdown,
  computeDailyBreakdown,
} from '../src/services/analytics.service.js';

const cat = (id, slug, sales, units = 1) => ({ id, slug, name_en: slug.toUpperCase(), name_bn: `bn-${slug}`, sales, units });
const day = (categories, channels) => ({ breakdown_json: { version: BREAKDOWN_VERSION, categories, channels } });

describe('aggregateBreakdown', () => {
  test('no rollup data yields empty lists, never invented bars', () => {
    assert.deepEqual(aggregateBreakdown([]), { categories: [], channels: [] });
    assert.deepEqual(aggregateBreakdown([{ breakdown_json: '{}' }, { breakdown_json: null }]), { categories: [], channels: [] });
  });

  test('a pre-v2 row (old invented percentages) contributes nothing', () => {
    const legacy = { breakdown_json: { top_categories: [{ name: 'Fashion', percentage: 38 }] } };
    const real = day([cat(1, 'fashion', 100)], [{ key: 'DIRECT', orders: 1, sales: 100 }]);
    const out = aggregateBreakdown([legacy, real]);
    assert.equal(out.categories.length, 1);
    assert.equal(out.categories[0].revenue, 100);
  });

  test('sums days, ranks by sales, and shares total 100', () => {
    const out = aggregateBreakdown([
      day([cat(1, 'fashion', 300), cat(2, 'gadgets', 100)], [{ key: 'DIRECT', orders: 2, sales: 400 }]),
      day([cat(1, 'fashion', 100), cat(2, 'gadgets', 100)], [{ key: 'LIVE', orders: 1, sales: 200 }]),
    ]);
    assert.deepEqual(out.categories.map((c) => [c.key, c.revenue]), [['fashion', 400], ['gadgets', 200]]);
    assert.equal(out.categories.reduce((a, c) => a + c.share_pct, 0), 100);
    assert.equal(out.channels.reduce((a, c) => a + c.share_pct, 0), 100);
  });

  test('categories beyond the top N fold into Other and shares still total 100', () => {
    const cats = [1, 2, 3, 4].map((i) => cat(i, `c${i}`, 100 * (5 - i)));
    const out = aggregateBreakdown([day(cats, [])], { topCategories: 2 });
    assert.deepEqual(out.categories.map((c) => c.key), ['c1', 'c2', 'other']);
    const other = out.categories.at(-1);
    assert.equal(other.revenue, 300); // c3 (200) + c4 (100)
    assert.equal(Math.round(out.categories.reduce((a, c) => a + c.share_pct, 0)), 100);
  });

  test('every known channel is listed, in order, once any channel has sales', () => {
    const out = aggregateBreakdown([day([], [{ key: 'TEAM', orders: 1, sales: 50 }])]);
    assert.deepEqual(out.channels.map((c) => c.key), SALES_CHANNELS.map((c) => c.key));
    assert.equal(out.channels.find((c) => c.key === 'TEAM').share_pct, 100);
    assert.equal(out.channels.find((c) => c.key === 'LIVE').share_pct, 0);
  });

  test('accepts breakdown_json as a JSON string (pg may return text)', () => {
    const raw = JSON.stringify({ version: BREAKDOWN_VERSION, categories: [cat(1, 'a', 10)], channels: [] });
    assert.equal(aggregateBreakdown([{ breakdown_json: raw }]).categories[0].revenue, 10);
  });
});

describe('computeDailyBreakdown', () => {
  test('maps query rows to the versioned stored shape with numeric coercion', async () => {
    const db = {
      async query(sql) {
        if (sql.includes('AS channel')) return { rows: [{ channel: 'LIVE', orders: '2', sales: '1500.50' }] };
        return { rows: [{ id: '7', slug: 'fashion', name_en: 'Fashion', name_bn: 'ফ্যাশন', sales: '900.10', units: '3' }] };
      },
    };
    const out = await computeDailyBreakdown(db, '2026-09-19');
    assert.equal(out.version, BREAKDOWN_VERSION);
    assert.deepEqual(out.channels, [{ key: 'LIVE', orders: 2, sales: 1500.5 }]);
    assert.deepEqual(out.categories, [{ id: 7, slug: 'fashion', name_en: 'Fashion', name_bn: 'ফ্যাশন', sales: 900.1, units: 3 }]);
  });

  test('a failing breakdown query fails the rollup instead of falling back to fake data', async () => {
    const db = { async query() { throw new Error('boom'); } };
    await assert.rejects(() => computeDailyBreakdown(db, '2026-09-19'), /boom/);
  });
});
