/**
 * homeSummary.test.js — the home page's role-specific top band numbers.
 *
 * Invariants: each role gets only its own keys; a role with nothing to count gets `stats: null`
 * (never invented zeros); money stays a string; super admin sees the approvals queue while an
 * admin sees their own pending requests.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getHomeSummary } from '../src/services/homeSummary.service.ts';

function mockDb(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: handler(sql, params) };
    },
  };
}

describe('home summary — role bands', () => {
  test('supplier gets stock and fulfilment keys scoped to their own id', async () => {
    const db = mockDb((sql) => {
      if (sql.includes('FROM products')) return [{ products: 12, low_stock: 3, out_of_stock: 1 }];
      return [{ to_fulfil: 4, today_earnings: '1250.50', settled_earnings: '9000.00' }];
    });
    const out = await getHomeSummary(db, { userId: 77, role: 'supplier' });
    assert.deepEqual(out.stats, {
      products: 12,
      low_stock: 3,
      out_of_stock: 1,
      to_fulfil: 4,
      today_earnings: '1250.50',
      settled_earnings: '9000.00',
    });
    // WHY not params[0]: the ranking queries put the window first, but every one is still scoped to 77.
    assert.ok(db.calls.every((c) => c.params.includes(77)), 'every query is filtered by the caller');
    assert.deepEqual(Object.keys(out.insights), ['top_salers', 'top_products']);
  });

  test('moderator counts come from the queue', async () => {
    const db = mockDb(() => [{ my_queue: 2, unassigned: 9, sla_at_risk: 1, resolved_today: 5 }]);
    const out = await getHomeSummary(db, { userId: 5, role: 'moderator' });
    assert.deepEqual(out.stats, { my_queue: 2, unassigned: 9, sla_at_risk: 1, resolved_today: 5 });
  });

  test('super admin sees waiting approvals, admin sees their own pending requests', async () => {
    const handler = (sql) => {
      if (sql.includes('FROM orders')) return [{ orders: 40, gmv: '85000.00' }];
      if (sql.includes('kyc_verifications')) {
        return [{ pending_kyc: 3, pending_products: 8, disputes_past_sla: 2, failed_payouts: 1 }];
      }
      return [{ waiting: 6, mine: 2 }];
    };
    const sa = await getHomeSummary(mockDb(handler), { userId: 1, role: 'super_admin' });
    assert.equal(sa.stats.approvals_waiting, 6);
    assert.equal('my_pending_requests' in sa.stats, false);
    assert.equal(sa.stats.gmv_today, '85000.00');

    const admin = await getHomeSummary(mockDb(handler), { userId: 2, role: 'admin' });
    assert.equal(admin.stats.my_pending_requests, 2);
    assert.equal('approvals_waiting' in admin.stats, false);
  });

  test('a role with nothing to count gets null stats and runs no queries', async () => {
    const db = mockDb(() => {
      throw new Error('must not query');
    });
    for (const role of ['finance', 'unknown']) {
      const out = await getHomeSummary(db, { userId: 9, role });
      assert.deepEqual(out, { role, stats: null, insights: null });
    }
    assert.equal(db.calls.length, 0);
  });

  test('an editor has no counts but still gets its rankings', async () => {
    const db = mockDb(() => [{ id: 1, name_en: 'saree', count: 40 }]);
    const out = await getHomeSummary(db, { userId: 4, role: 'editor' });
    assert.equal(out.stats, null);
    assert.deepEqual(Object.keys(out.insights), ['trending_searches', 'top_categories']);
    assert.deepEqual(out.insights.trending_searches[0], { id: '1', name_en: 'saree', name_bn: 'saree', count: 40, amount: null });
  });

  test('each role gets the rankings meant for it', async () => {
    const db = mockDb(() => []);
    const keys = async (role) => Object.keys((await getHomeSummary(db, { userId: 1, role })).insights);
    assert.deepEqual(await keys('saler'), ['top_products', 'trending_products', 'trending_searches']);
    assert.deepEqual(await keys('admin'), ['top_suppliers', 'top_salers', 'top_categories']);
    assert.deepEqual(await keys('super_admin'), ['top_suppliers', 'top_salers', 'top_categories']);
    assert.deepEqual(await keys('moderator'), ['queue_by_type', 'repeat_rejections']);
    assert.equal((await getHomeSummary(db, { userId: 1, role: 'customer' })).insights, null);
  });

  test('a search phrase needs several different shoppers before it is shown', async () => {
    const db = mockDb(() => []);
    await getHomeSummary(db, { userId: 4, role: 'editor' });
    const search = db.calls.find((c) => c.sql.includes('FROM search_events'));
    assert.match(search.sql, /HAVING COUNT\(DISTINCT COALESCE\(user_id::text, session_id\)\) >= \$3/);
    assert.ok(search.params[2] >= 2, 'one person alone never surfaces a query');
  });

  test('one broken ranking leaves the counts and the other rankings intact', async () => {
    const db = mockDb((sql) => {
      if (sql.includes('FROM search_events')) throw new Error('boom');
      if (sql.includes('FROM moderation_queue mq')) return [{ id: 8, name_en: 'Rahim', count: 3 }];
      return [{ my_queue: 1, unassigned: 2, sla_at_risk: 0, resolved_today: 4 }];
    });
    const editor = await getHomeSummary(db, { userId: 4, role: 'editor' });
    assert.equal(editor.insights.trending_searches, null);
    assert.ok(Array.isArray(editor.insights.top_categories));
    const mod = await getHomeSummary(db, { userId: 3, role: 'moderator' });
    assert.equal(mod.stats.resolved_today, 4);
    assert.equal(mod.insights.repeat_rejections[0].count, 3);
  });
});
