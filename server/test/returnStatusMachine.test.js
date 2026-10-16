/**
 * returnStatusMachine.test.js — staff steps on a return only run from the status they belong to.
 *
 * Before this, review / inspect / refund accepted a return in any status: a REJECTED return could be
 * refunded, a parcel that never came back could be refunded, a REFUNDED return could be inspected
 * again or rejected after the money went out. Each step now checks RETURN_TRANSITIONS, refuses with
 * RETURN_STATE_INVALID (409) and moves no money and writes nothing when it refuses. Every step that
 * does run leaves an audit_logs row with before/after.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as returnService from '../src/services/return.service.ts';

const RETURN_ID = 77;

function createDb(status) {
  const row = { id: RETURN_ID, ref: 'RET-STATE001', sub_order_id: 5, sub_order_ref: 'SO-5', supplier_id: 101, status, refund_amount: '500.00' };
  const writes = [];
  const audits = [];
  const db = {
    row,
    writes,
    audits,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.includes('FROM return_requests r') && q.includes('FOR UPDATE')) return { rows: [{ ...row }] };
      if (q.startsWith('INSERT INTO audit_logs')) {
        audits.push({ action: params[2], before: JSON.parse(params[5] || 'null'), after: JSON.parse(params[6] || 'null') });
        return { rows: [{ id: audits.length }] };
      }
      if (q.startsWith('UPDATE return_requests')) {
        writes.push(q);
        if (q.includes("SET status = 'REJECTED'")) row.status = 'REJECTED';
        else if (q.includes("SET status = 'PICKUP_SCHEDULED'")) row.status = 'PICKUP_SCHEDULED';
        else if (q.includes('SET status = $2')) row.status = params[1];
        return { rows: [{ ...row }] };
      }
      // Anything else (clawback, ledger, stock) is a write the refused steps must never reach
      writes.push(q);
      return { rows: [] };
    },
  };
  return db;
}

const review = (db, action) => returnService.reviewReturnRequest(db, null, { returnRequestId: RETURN_ID, action, reviewedBy: 1, client: db });
const inspect = (db) => returnService.receiveAndInspectReturn(db, { returnRequestId: RETURN_ID, conditionPass: true, inspectedBy: 1, client: db });
const refund = (db) => returnService.executeRefund(db, null, { returnRequestId: RETURN_ID, approvedBy: 1, client: db });

function refusedFrom(status) {
  return (err) => {
    assert.equal(err.code, 'RETURN_STATE_INVALID');
    assert.equal(err.details?.status, status);
    return true;
  };
}

describe('A return only moves along its status machine', () => {
  for (const status of ['REQUESTED', 'PICKUP_SCHEDULED', 'REJECTED', 'DISPUTED']) {
    test(`a ${status} return cannot be refunded, and nothing is written`, async () => {
      const db = createDb(status);
      await assert.rejects(refund(db), refusedFrom(status));
      assert.deepEqual(db.writes, [], 'no clawback, ledger, stock or status write ran');
      assert.equal(db.row.status, status);
    });
  }

  for (const status of ['REFUNDED', 'REJECTED', 'INSPECTED', 'DISPUTED']) {
    test(`a ${status} return cannot be reviewed again`, async () => {
      const db = createDb(status);
      await assert.rejects(review(db, 'REJECT'), refusedFrom(status));
      await assert.rejects(review(db, 'APPROVE'), refusedFrom(status));
      assert.deepEqual(db.writes, []);
      assert.equal(db.row.status, status);
    });
  }

  for (const status of ['REQUESTED', 'REJECTED', 'REFUNDED', 'INSPECTED']) {
    test(`a ${status} return cannot be inspected`, async () => {
      const db = createDb(status);
      await assert.rejects(inspect(db), refusedFrom(status));
      assert.deepEqual(db.writes, []);
      assert.equal(db.row.status, status);
    });
  }

  test('refunding an already refunded return stays an idempotent no-op', async () => {
    const db = createDb('REFUNDED');
    const result = await refund(db);
    assert.equal(result.alreadyRefunded, true);
    assert.deepEqual(db.writes, []);
  });

  test('the normal path still works and every staff step is audited with before/after', async () => {
    const db = createDb('REQUESTED');
    assert.equal((await review(db, 'APPROVE')).status, 'PICKUP_SCHEDULED');
    assert.equal((await inspect(db)).status, 'INSPECTED');

    assert.deepEqual(db.audits.map((a) => a.action), ['returns.request.approve', 'returns.request.inspect_pass']);
    assert.deepEqual(db.audits[0].before, { status: 'REQUESTED' });
    assert.equal(db.audits[0].after.status, 'PICKUP_SCHEDULED');
    assert.deepEqual(db.audits[1].before, { status: 'PICKUP_SCHEDULED' });
    assert.equal(db.audits[1].after.status, 'INSPECTED');
  });

  test('an auto-approved return can still be reviewed, and a rejection is audited', async () => {
    const db = createDb('APPROVED');
    assert.equal((await review(db, 'REJECT')).status, 'REJECTED');
    assert.equal(db.audits[0].action, 'returns.request.reject');
    assert.deepEqual(db.audits[0].before, { status: 'APPROVED' });
  });

  test('a missing return answers NOT_FOUND, not a 500', async () => {
    const db = createDb('REQUESTED');
    db.query = async () => ({ rows: [] });
    await assert.rejects(refund(db), (err) => err.code === 'NOT_FOUND');
    await assert.rejects(inspect(db), (err) => err.code === 'NOT_FOUND');
    await assert.rejects(review(db, 'APPROVE'), (err) => err.code === 'NOT_FOUND');
  });
});
