/**
 * sponsoredSourcing.test.js — The invariants stated in sponsoredSourcing.service.js.
 *
 *   1. A supplier can only promote their own products in the sourcing slot.
 *   2. A blocked grade (default D) can neither buy the slot nor keep serving it; "no grade yet" is never blocked.
 *   3. The scorecard grade moves rank, not price: same bid, better grade, higher position.
 *   4. A malformed setting falls back to its default.
 *   Plus: unsellable products are not served, and the grade bonus cannot zero a campaign out.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES,
  resolveRules,
  qualityBonus,
  isBlocked,
  applyCandidatePolicy,
  assertMayAdvertise,
} from '../src/services/sponsoredSourcing.service.js';
import { calculateQualityScore, runSecondPriceAuction } from '../src/services/adAuction.service.js';

const rules = resolveRules(null);

/** A db whose queries are answered by substring match on the SQL. */
function fakeDb({ product = null, grades = {}, rulesRow = null } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes('FROM supplier_scorecards')) {
        return { rows: params[0].filter((id) => String(id) in grades).map((id) => ({ supplier_id: id, grade: grades[String(id)] })) };
      }
      if (sql.includes('FROM products')) return { rows: product ? [product] : [] };
      if (sql.includes('platform_settings')) return { rows: rulesRow ? [{ value_json: rulesRow }] : [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

const candidate = (over = {}) => ({
  id: 1,
  user_id: 10,
  bid_amount: 4,
  product: { status: 'ACTIVE', stock_qty: 5 },
  ...over,
});

describe('resolveRules', () => {
  test('defaults apply when the row is absent or not an object', () => {
    assert.deepEqual(resolveRules(null), DEFAULT_RULES);
    assert.deepEqual(resolveRules('nope'), DEFAULT_RULES);
  });

  test('a malformed field falls back on its own, leaving valid fields alone', () => {
    const r = resolveRules({ max_slots: 'many', grade_rank_bonus: { A: 0.5, B: 'x', D: -5 }, blocked_grades: ['C', 'Z'] });
    assert.equal(r.max_slots, DEFAULT_RULES.max_slots);
    assert.equal(r.grade_rank_bonus.A, 0.5);
    assert.equal(r.grade_rank_bonus.B, DEFAULT_RULES.grade_rank_bonus.B);
    assert.equal(r.grade_rank_bonus.D, DEFAULT_RULES.grade_rank_bonus.D, 'a bonus that would flip rank sign is refused');
    assert.deepEqual(r.blocked_grades, ['C'], 'unknown grades are dropped');
  });

  test('max_slots 0 is a valid way to switch the slot off', () => {
    assert.equal(resolveRules({ max_slots: 0 }).max_slots, 0);
    assert.equal(resolveRules({ max_slots: 7 }).max_slots, DEFAULT_RULES.max_slots);
  });

  test('an empty blocked_grades list is honoured, not replaced by the default', () => {
    assert.deepEqual(resolveRules({ blocked_grades: [] }).blocked_grades, []);
  });
});

describe('grade handling', () => {
  test('a supplier with no grade is neutral and never blocked', () => {
    assert.equal(qualityBonus(null, rules), rules.grade_rank_bonus.NEW);
    assert.equal(isBlocked(null, rules), false);
  });

  test('D is blocked by default, A is not', () => {
    assert.equal(isBlocked('D', rules), true);
    assert.equal(isBlocked('A', rules), false);
  });

  test('a better grade earns a larger bonus', () => {
    assert.ok(qualityBonus('A', rules) > qualityBonus('B', rules));
    assert.ok(qualityBonus('B', rules) > qualityBonus('C', rules));
    assert.ok(qualityBonus('C', rules) > qualityBonus('D', rules));
  });
});

describe('applyCandidatePolicy', () => {
  test('drops blocked-grade suppliers and stamps the bonus on the rest', async () => {
    const db = fakeDb({ grades: { 10: 'A', 11: 'D' } });
    const kept = await applyCandidatePolicy(db, [candidate({ id: 1, user_id: 10 }), candidate({ id: 2, user_id: 11 })], rules);
    assert.deepEqual(kept.map((c) => c.id), [1]);
    assert.equal(kept[0].scorecard_grade, 'A');
    assert.equal(kept[0].quality_bonus, rules.grade_rank_bonus.A);
  });

  test('an ungraded supplier is kept with the NEW bonus', async () => {
    const kept = await applyCandidatePolicy(fakeDb(), [candidate()], rules);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].scorecard_grade, null);
  });

  test('inactive or out-of-stock products are not served', async () => {
    const db = fakeDb();
    const kept = await applyCandidatePolicy(db, [
      candidate({ id: 1, product: { status: 'DRAFT', stock_qty: 5 } }),
      candidate({ id: 2, product: { status: 'ACTIVE', stock_qty: 0 } }),
      candidate({ id: 3, product: null }),
      candidate({ id: 4 }),
    ], rules);
    assert.deepEqual(kept.map((c) => c.id), [4]);
  });

  test('a failing scorecard lookup serves ungraded instead of throwing', async () => {
    const db = { async query() { throw new Error('relation "supplier_scorecards" does not exist'); } };
    const kept = await applyCandidatePolicy(db, [candidate()], rules);
    assert.equal(kept.length, 1);
  });
});

describe('assertMayAdvertise', () => {
  const owned = { supplier_id: 10, status: 'ACTIVE' };

  test('the owner of an active product may advertise it', async () => {
    await assert.doesNotReject(assertMayAdvertise(fakeDb({ product: owned }), 10, 99));
  });

  test("another supplier's product is refused", async () => {
    await assert.rejects(assertMayAdvertise(fakeDb({ product: owned }), 11, 99), { code: 'SOURCING_PRODUCT_NOT_OWNED' });
  });

  test('staff may buy on a supplier\'s behalf', async () => {
    await assert.doesNotReject(assertMayAdvertise(fakeDb({ product: owned }), 1, 99, { isPrivileged: true }));
  });

  test('a missing product id is refused', async () => {
    await assert.rejects(assertMayAdvertise(fakeDb({ product: owned }), 10, null), { code: 'PRODUCT_REQUIRED' });
  });

  test('a supplier in a blocked grade cannot buy the slot', async () => {
    await assert.rejects(assertMayAdvertise(fakeDb({ product: owned, grades: { 10: 'D' } }), 10, 99), { code: 'SUPPLIER_GRADE_BLOCKED' });
  });

  test('blocked_grades is read from settings', async () => {
    const db = fakeDb({ product: owned, grades: { 10: 'D' }, rulesRow: { blocked_grades: [] } });
    await assert.doesNotReject(assertMayAdvertise(db, 10, 99));
  });
});

describe('rank', () => {
  test('at the same bid, an A supplier outranks a D one and a new one sits between', () => {
    const base = { bid_amount: 4, impressions_count: 0, clicks_count: 0, spent_amount: 0, today_spent_amount: 0, total_budget: 500, daily_budget: 100 };
    const winners = runSecondPriceAuction([
      { ...base, id: 1, quality_bonus: qualityBonus('D', rules) },
      { ...base, id: 2, quality_bonus: qualityBonus('A', rules) },
      { ...base, id: 3, quality_bonus: qualityBonus(null, rules) },
    ], { placement: 'SOURCING_CATALOG', maxSlots: 3 });
    assert.deepEqual(winners.map((w) => w.campaignId), [2, 3, 1]);
  });

  test('no bonus leaves the quality score exactly as before', () => {
    const c = { impressions_count: 0, clicks_count: 0 };
    assert.equal(calculateQualityScore(c), calculateQualityScore({ ...c, quality_bonus: 0 }));
  });

  test('an extreme penalty cannot zero a campaign out of the auction', () => {
    assert.ok(calculateQualityScore({ quality_bonus: -5 }) > 0);
  });
});
