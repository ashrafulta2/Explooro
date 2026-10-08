/**
 * fastPayoutReturnProtection.test.js — the rules behind early escrow release and return protection.
 *
 *   1. A fast-payout fee and the net the earner receives always add up to the amount, to the paisa.
 *   2. Money is released early only when it has a reason to be safe, and each refusal names its own reason.
 *   3. The fee follows the supplier's scorecard grade; a grade with no fee (or a blocked one) cannot take it.
 *   4. A protection claim never pays more than was insured, taken from the saler, or allowed per order.
 *   5. Every number is a platform setting; a malformed stored value falls back field by field.
 *
 * The ledger moves, locking and races are exercised against a real Postgres in the step-5 end-to-end run;
 * these tests cover the pure rules that decide them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fast from '../src/services/fastPayout.service.js';
import * as prot from '../src/services/returnProtection.service.js';

const rules = fast.resolveRules(null);
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-08T00:00:00Z');

function entry(over = {}) {
  return {
    entry_id: 1,
    status: 'LOCKED',
    amount: '1000.00',
    hold_until: new Date(NOW.getTime() + 6 * DAY).toISOString(),
    sub_order_status: 'DELIVERED',
    payment_method: 'BKASH',
    cod_status: null,
    has_open_return: false,
    has_open_dispute: false,
    ...over,
  };
}
const judge = (over, { grade = null, outstandingPaisa = 0, r = rules } = {}) =>
  fast.evaluateEntry({ entry: entry(over), grade, rules: r, outstandingPaisa, now: NOW });

test('fast payout: fee and net always reconcile to the amount, to the paisa', () => {
  for (const amount of ['100.00', '333.33', '999.99', '12345.67', '0.07']) {
    for (const pct of [0, 1, 1.5, 2.5, 33.33, 50]) {
      const s = fast.splitFastPayout({ amount, feePct: pct });
      assert.equal(s.feePaisa + s.netPaisa, s.grossPaisa, `${amount} @ ${pct}%`);
      assert.equal(s.gross, amount);
    }
  }
  assert.deepEqual(fast.splitFastPayout({ amount: '1000.00', feePct: 2 }), {
    grossPaisa: 100000, feePaisa: 2000, netPaisa: 98000, gross: '1000.00', fee: '20.00', net: '980.00',
  });
});

test('fast payout: the fee follows the grade; an unlisted or blocked grade cannot take it', () => {
  assert.equal(fast.feePctFor('A', rules), 1);
  assert.equal(fast.feePctFor('B', rules), 1.5);
  assert.equal(fast.feePctFor('C', rules), 2.5);
  assert.equal(fast.feePctFor('D', rules), null);
  assert.equal(fast.feePctFor(null, rules), rules.ungraded_fee_pct);
  // A grade removed from the fee map has no price, so it cannot be offered.
  assert.equal(fast.feePctFor('C', fast.resolveRules({ fee_pct_by_grade: { A: 1 } })), null);
  // Blocked beats priced.
  assert.equal(fast.feePctFor('A', fast.resolveRules({ blocked_grades: ['A'] })), null);
});

test('fast payout: an eligible entry is quoted, with the days it saves', () => {
  const ev = judge({}, { grade: 'B' });
  assert.deepEqual([ev.eligible, ev.fee_pct, ev.fee, ev.net, ev.days_saved], [true, 1.5, '15.00', '985.00', 6]);
});

test('fast payout: each refusal names its own reason, in the order a person should fix them', () => {
  assert.equal(judge({ status: 'RELEASED' }).reason, 'NOT_LOCKED');
  assert.equal(judge({ status: 'FROZEN' }).reason, 'NOT_LOCKED');
  assert.equal(judge({ sub_order_status: 'SHIPPED' }).reason, 'NOT_DELIVERED');
  assert.equal(judge({ payment_method: 'COD', cod_status: 'AWAITING' }).reason, 'COD_UNRECONCILED');
  assert.equal(judge({ payment_method: 'COD', cod_status: null }).reason, 'COD_UNRECONCILED');
  assert.equal(judge({ payment_method: 'COD', cod_status: 'MATCHED' }).eligible, true);
  assert.equal(judge({ payment_method: 'COD', cod_status: 'RESOLVED' }).eligible, true);
  assert.equal(judge({ has_open_return: true }).reason, 'OPEN_CLAIM');
  assert.equal(judge({ has_open_dispute: true }).reason, 'OPEN_CLAIM');
  assert.equal(judge({}, { grade: 'D' }).reason, 'GRADE_BLOCKED');
  assert.equal(judge({ amount: '99.99' }).reason, 'TOO_SMALL');
  assert.equal(judge({ amount: '50000.01' }).reason, 'TOO_LARGE');
  assert.equal(judge({ hold_until: new Date(NOW.getTime() + 1 * DAY).toISOString() }).reason, 'TOO_SOON');
  assert.equal(judge({ hold_until: new Date(NOW.getTime() - 1 * DAY).toISOString() }).reason, 'TOO_SOON');
  // Not delivered is reported before the grade, so the person is not told to fix something unfixable first.
  assert.equal(judge({ sub_order_status: 'SHIPPED' }, { grade: 'D' }).reason, 'NOT_DELIVERED');
});

test('fast payout: refused entries carry no quote', () => {
  const ev = judge({ has_open_return: true });
  assert.deepEqual([ev.eligible, ev.fee, ev.net, ev.fee_pct], [false, null, null, null]);
});

test('fast payout: the exposure cap counts what is already out, to the paisa', () => {
  const cap = fast.resolveRules({ max_outstanding: 1500 });
  assert.equal(judge({}, { outstandingPaisa: 50000, r: cap }).eligible, true);   // 500 + 1000 = 1500, at the cap
  assert.equal(judge({}, { outstandingPaisa: 50001, r: cap }).reason, 'EXPOSURE_LIMIT'); // one paisa over
});

test('fast payout: an entry whose fee would swallow it is not offered', () => {
  const greedy = fast.resolveRules({ fee_pct_by_grade: { A: 50 }, min_amount: 0.01 });
  const ev = judge({ amount: '0.01' }, { grade: 'A', r: greedy });
  assert.equal(ev.eligible, false);
});

test('fast payout: resolveRules falls back field by field and refuses nonsense', () => {
  assert.deepEqual(fast.resolveRules(undefined), { ...fast.DEFAULT_RULES, fee_pct_by_grade: { A: 1, B: 1.5, C: 2.5 }, blocked_grades: ['D'] });
  const r = fast.resolveRules({ fee_pct_by_grade: { A: 99, B: 3, C: 'x' }, min_days_saved: -1, max_outstanding: 'lots', blocked_grades: ['B', 'Q'] });
  assert.deepEqual(r.fee_pct_by_grade, { B: 3 });                     // above the 50 cap and non-numbers are dropped
  assert.equal(r.min_days_saved, fast.DEFAULT_RULES.min_days_saved);
  assert.equal(r.max_outstanding, fast.DEFAULT_RULES.max_outstanding);
  assert.deepEqual(r.blocked_grades, ['B']);
  // min above max would make every amount illegal.
  const swapped = fast.resolveRules({ min_amount: 900, max_per_request: 100 });
  assert.equal(swapped.min_amount, fast.DEFAULT_RULES.min_amount);
  assert.equal(swapped.max_per_request, fast.DEFAULT_RULES.max_per_request);
});

test('return protection: the premium is a share of the insured commission, rounded to the paisa', () => {
  assert.equal(prot.premiumPaisa('100.00', 10), 1000);
  assert.equal(prot.premiumPaisa('33.33', 10), 333);
  assert.equal(prot.premiumPaisa('100.00', 0), 0);
  assert.equal(prot.premiumPaisa('0.05', 10), 1);
});

test('return protection: a claim never pays more than insured, clawed back, or the per-order cap', () => {
  assert.equal(prot.claimPaisa({ insured: '100', clawedBack: '100', maxClaim: '5000' }), 10000);
  assert.equal(prot.claimPaisa({ insured: '100', clawedBack: '40', maxClaim: '5000' }), 4000);   // only what was taken
  assert.equal(prot.claimPaisa({ insured: '100', clawedBack: '100', maxClaim: '60' }), 6000);    // the cap
  assert.equal(prot.claimPaisa({ insured: '30', clawedBack: '100', maxClaim: '5000' }), 3000);   // only what was insured
  assert.equal(prot.claimPaisa({ insured: '100', clawedBack: '0', maxClaim: '5000' }), 0);
});

test('return protection: resolveRules falls back field by field and refuses nonsense', () => {
  assert.deepEqual(prot.resolveRules(undefined), { ...prot.DEFAULT_RULES, blocked_grades: ['D'] });
  const r = prot.resolveRules({ premium_pct: 80, max_claim_amount: -5, enabled: 'yes', max_claims_per_saler_30d: 2, blocked_grades: ['C', 'Z'] });
  assert.equal(r.premium_pct, prot.DEFAULT_RULES.premium_pct);        // above the 50 cap -> default
  assert.equal(r.max_claim_amount, prot.DEFAULT_RULES.max_claim_amount);
  assert.equal(r.enabled, true);                                        // not a boolean -> default
  assert.equal(r.max_claims_per_saler_30d, 2);
  assert.deepEqual(r.blocked_grades, ['C']);
});
