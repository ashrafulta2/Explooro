/**
 * volumeIncentive.test.js — the rules that decide who is paid what, and when.
 *
 *   1. Tiers must rise in BOTH volume and rebate, and stay inside the platform's bounds.
 *   2. The platform's share and the saler's share always add back to the rebate, to the paisa.
 *   3. A month is only due once the settle lag has passed, and only recent months are visited.
 *   4. A programme change waits for next month (except a supplier's first), and a blocked grade
 *      cannot switch one on.
 *   5. A payout that cannot be funded stays open, then lapses, and never overdraws the supplier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULES, resolveRules, validateTiers, pickTier, nextTier, computeRebate,
  addMonths, monthEnd, duePeriods, saveProgram, payOne,
} from '../src/services/volumeIncentive.service.js';

const rules = resolveRules(null);
const tiers = [{ min_volume: 10000, rebate_pct: 1 }, { min_volume: 50000, rebate_pct: 2 }];

test('resolveRules falls back field by field and refuses nonsense', () => {
  assert.deepEqual(resolveRules(undefined), { ...DEFAULT_RULES, blocked_grades: ['D'] });
  const r = resolveRules({ platform_fee_pct: 90, max_tiers: 'lots', settle_lag_days: 3, blocked_grades: ['A', 'Z'] });
  assert.equal(r.platform_fee_pct, DEFAULT_RULES.platform_fee_pct); // above the 50 cap -> default
  assert.equal(r.max_tiers, DEFAULT_RULES.max_tiers);
  assert.equal(r.settle_lag_days, 3);
  assert.deepEqual(r.blocked_grades, ['A']);
});

test('validateTiers sorts a valid set and keeps the numbers', () => {
  const out = validateTiers([{ min_volume: '50000', rebate_pct: '2' }, { min_volume: 10000, rebate_pct: 1 }], rules);
  assert.deepEqual(out, tiers);
});

test('validateTiers refuses every way a tier set can be unfair or out of bounds', () => {
  const bad = (input) => assert.throws(() => validateTiers(input, rules), (e) => e.code === 'VALIDATION_FAILED' || /tier|rebate|volume/i.test(e.message));
  bad([]);
  bad('nope');
  bad([{ min_volume: 100, rebate_pct: 1 }]);                                    // below min_threshold
  bad([{ min_volume: 10000, rebate_pct: 0 }]);                                  // no rebate
  bad([{ min_volume: 10000, rebate_pct: rules.max_rebate_pct + 0.01 }]);        // above the platform cap
  bad([{ min_volume: 10000, rebate_pct: 1 }, { min_volume: 20000, rebate_pct: 1 }]); // rebate does not rise
  bad([{ min_volume: 10000, rebate_pct: 1 }, { min_volume: 10000, rebate_pct: 2 }]); // volume does not rise
  bad([{ min_volume: 10000, rebate_pct: 1.234 }]);                              // finer than a paisa
  bad(Array.from({ length: rules.max_tiers + 1 }, (_, i) => ({ min_volume: 10000 * (i + 1), rebate_pct: i + 1 }))); // too many
});

test('pickTier takes the highest tier reached; nextTier is the goal after it', () => {
  assert.equal(pickTier(9999.99, tiers), null);
  assert.equal(pickTier(10000, tiers).rebate_pct, 1);
  assert.equal(pickTier(49999.99, tiers).rebate_pct, 1);
  assert.equal(pickTier(50000, tiers).rebate_pct, 2);
  assert.equal(pickTier(1e9, [...tiers].reverse()).rebate_pct, 2); // order in storage does not matter
  assert.equal(nextTier(0, tiers).min_volume, 10000);
  assert.equal(nextTier(10000, tiers).min_volume, 50000);
  assert.equal(nextTier(50000, tiers), null);
});

test('computeRebate: saler + platform always equal the gross, to the paisa', () => {
  for (const [volume, pct, fee] of [[12345.67, 1.5, 10], [99999.99, 3.33, 7.5], [10000, 2, 0], [0.01, 5, 33.33], [250000, 4.75, 50]]) {
    const m = computeRebate({ volume, rebatePct: pct, platformFeePct: fee });
    assert.equal(m.netPaisa + m.feePaisa, m.grossPaisa, `${volume} @ ${pct}% fee ${fee}%`);
    assert.ok(m.netPaisa >= 0 && m.feePaisa >= 0);
  }
  assert.deepEqual(
    (({ gross, fee, net }) => ({ gross, fee, net }))(computeRebate({ volume: 50000, rebatePct: 2, platformFeePct: 10 })),
    { gross: '1000.00', fee: '100.00', net: '900.00' }
  );
});

test('calendar helpers cross year ends and leap months', () => {
  assert.equal(addMonths('2026-01-01', -1), '2025-12-01');
  assert.equal(addMonths('2026-11-01', 3), '2027-02-01');
  assert.equal(monthEnd('2028-02-01'), '2028-02-29');
  assert.equal(monthEnd('2026-02-01'), '2026-02-28');
  assert.equal(monthEnd('2026-12-01'), '2026-12-31');
});

test('duePeriods waits for the settle lag and only looks back a few months', () => {
  const r = { ...rules, settle_lag_days: 7 };
  // 3rd of the month: last month ended 3 days ago, lag not over -> nothing from last month
  let due = duePeriods({ today: '2026-10-03', monthStart: '2026-10-01' }, r).map((p) => p.start);
  assert.deepEqual(due, ['2026-07-01', '2026-08-01']);
  // 8th: Sept 30 + 1 + 7 = Oct 8 -> September is due
  due = duePeriods({ today: '2026-10-08', monthStart: '2026-10-01' }, r).map((p) => p.start);
  assert.deepEqual(due, ['2026-07-01', '2026-08-01', '2026-09-01']);
  assert.equal(duePeriods({ today: '2026-10-08', monthStart: '2026-10-01' }, r).at(-1).end, '2026-09-30');
  // a 60-day lag: July (ended Jul 31 + 61 = Sep 30) is due, August (Oct 31) is not yet
  assert.deepEqual(
    duePeriods({ today: '2026-10-08', monthStart: '2026-10-01' }, { ...r, settle_lag_days: 60 }).map((p) => p.start),
    ['2026-07-01']
  );
});

// --- saveProgram: which month a change starts, and who may switch one on --------------------------------

function fakeProgramDb({ versions = [], grade = null } = {}) {
  const written = [];
  return {
    written,
    async query(sql, params = []) {
      if (sql.includes("key = 'supplier.volume_incentive'")) return { rows: [] };
      if (sql.includes('AT TIME ZONE') && sql.includes('month_start')) return { rows: [{ today: '2026-10-15', month_start: '2026-10-01' }] };
      if (sql.includes('FROM volume_incentive_programs') && sql.includes('ORDER BY valid_from DESC')) return { rows: versions };
      if (sql.includes('INSERT INTO volume_incentive_programs')) {
        written.push({ validFrom: params[1], isActive: params[2], tiers: JSON.parse(params[3]) });
        return { rows: [{ id: 1, supplier_id: params[0], valid_from: params[1], is_active: params[2], tiers_json: JSON.parse(params[3]) }] };
      }
      if (sql.includes('FROM supplier_scorecards')) return { rows: grade ? [{ grade }] : [] };
      return { rows: [] }; // audit insert and anything else
    },
  };
}

test('a supplier\'s first programme starts this month; every later change waits for next month', async () => {
  const first = fakeProgramDb();
  await saveProgram(first, { supplierId: 5, isActive: true, tiers });
  assert.equal(first.written[0].validFrom, '2026-10-01');

  const later = fakeProgramDb({ versions: [{ valid_from: '2026-09-01', is_active: true, tiers_json: tiers }] });
  await saveProgram(later, { supplierId: 5, isActive: true, tiers });
  assert.equal(later.written[0].validFrom, '2026-11-01');
});

test('a blocked grade cannot switch a programme on, but can still pause one', async () => {
  const blocked = fakeProgramDb({ grade: 'D' });
  await assert.rejects(() => saveProgram(blocked, { supplierId: 5, isActive: true, tiers }), (e) => e.code === 'SUPPLIER_GRADE_BLOCKED');
  assert.equal(blocked.written.length, 0);

  const pausing = fakeProgramDb({ grade: 'D', versions: [{ valid_from: '2026-09-01', is_active: true, tiers_json: tiers }] });
  await saveProgram(pausing, { supplierId: 5, isActive: false, tiers: [] });
  assert.equal(pausing.written[0].isActive, false);
  assert.equal(pausing.written[0].validFrom, '2026-11-01');
});

test('an ungraded supplier is never blocked', async () => {
  const fresh = fakeProgramDb({ grade: null });
  await saveProgram(fresh, { supplierId: 5, isActive: true, tiers });
  assert.equal(fresh.written.length, 1);
});

// --- payOne: funding decisions ---------------------------------------------------------------------------

function fakePayoutPool({ status = 'UNFUNDED', balance = '5000.00', periodEnd = '2026-09-30' } = {}) {
  const log = [];
  const client = {
    log,
    async query(sql, params = []) {
      log.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
      if (sql.includes('FROM volume_incentive_payouts') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 9, supplier_id: 1, saler_id: 2, status, period_start: '2026-09-01', period_end: periodEnd, volume: '50000.00', rebate_pct: '2.00', gross_amount: '1000.00', platform_fee: '100.00', net_amount: '900.00' }] };
      }
      if (sql.includes('FROM wallets') && sql.includes('WHERE user_id')) return { rows: [{ id: params[0] * 10, user_id: params[0], available_balance: balance }] };
      if (sql.includes('FROM wallets') && sql.includes('FOR UPDATE')) return { rows: [{ id: 10, available_balance: balance }] };
      if (sql.includes('FROM users u')) return { rows: [{ id: 99 }] };
      return { rows: [] };
    },
    release() {},
  };
  return { client, async connect() { return client; } };
}

const payRules = { ...rules, settle_lag_days: 7, funding_retry_days: 7 };

test('payOne leaves a payout open when the supplier cannot cover it, and never touches the ledger', async () => {
  const pool = fakePayoutPool({ balance: '999.99' });
  assert.equal(await payOne(pool, 9, payRules, '2026-10-10'), 'UNFUNDED');
  assert.ok(!pool.client.log.some((l) => /INSERT INTO ledger/i.test(l) || /UPDATE wallets/i.test(l)));
});

test('payOne lapses an unfunded payout once the retry window is over, and not a day sooner', async () => {
  // lapses after period_end + 1 + 7 + 7 = 2026-10-15
  assert.equal(await payOne(fakePayoutPool({ balance: '0' }), 9, payRules, '2026-10-15'), 'UNFUNDED');
  assert.equal(await payOne(fakePayoutPool({ balance: '0' }), 9, payRules, '2026-10-16'), 'LAPSED');
});

test('payOne does nothing for a payout that is already paid', async () => {
  assert.equal(await payOne(fakePayoutPool({ status: 'PAID' }), 9, payRules, '2026-10-10'), 'ALREADY_SETTLED');
});
