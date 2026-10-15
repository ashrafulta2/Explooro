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
    assert.ok(db.calls.every((c) => c.params[0] === 77), 'every query is filtered by the caller');
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
    for (const role of ['editor', 'finance', 'unknown']) {
      const out = await getHomeSummary(db, { userId: 9, role });
      assert.deepEqual(out, { role, stats: null });
    }
    assert.equal(db.calls.length, 0);
  });
});
