/**
 * paymentTransactionUpdate.test.js — updatePaymentTransaction touches only the columns passed.
 *
 * Regression for a bug `// @ts-check` caught: `gatewayRef = null` / `rawResponse = null` defaults made
 * every omitted field look passed, so a reconcile that sent only `{ reconciledAt }`, or any FAILED
 * update, set gateway_ref and raw_response to NULL. Refunds and callback lookup read gateway_ref.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as paymentRepo from '../src/repositories/payment.repository.js';

function captureDb() {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: 5 }] };
    },
  };
}

test('a reconcile-only update leaves gateway_ref and raw_response alone', async () => {
  const db = captureDb();
  await paymentRepo.updatePaymentTransaction(db, 5, { reconciledAt: new Date() });

  const { sql } = db.calls[0];
  assert.match(sql, /reconciled_at = \$2/);
  assert.doesNotMatch(sql, /gateway_ref/);
  assert.doesNotMatch(sql, /raw_response/);
});

test('a FAILED update keeps the gateway reference', async () => {
  const db = captureDb();
  await paymentRepo.updatePaymentTransaction(db, 5, { status: 'FAILED', rawResponse: { error: 'x' } });

  const { sql, values } = db.calls[0];
  assert.doesNotMatch(sql, /gateway_ref/);
  assert.doesNotMatch(sql, /reconciled_at/);
  assert.deepEqual(values, [5, 'FAILED', JSON.stringify({ error: 'x' })]);
});

test('an explicit null still clears a column', async () => {
  const db = captureDb();
  await paymentRepo.updatePaymentTransaction(db, 5, { gatewayRef: null });

  const { sql, values } = db.calls[0];
  assert.match(sql, /gateway_ref = \$2/);
  assert.deepEqual(values, [5, null]);
});
