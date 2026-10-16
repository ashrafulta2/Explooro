/**
 * deficitRecovery.test.js — deficit records close once the wallet has earned the money back.
 *
 * A clawback debits the full amount, so a deficit already shows as a negative available balance.
 * settleDeficitRecoveries only brings negative_balance_recoveries in line with that balance:
 * what is still owed is max(0, -available_balance), applied oldest record first.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { settleDeficitRecoveries } from '../src/services/clawback.service.ts';
import { runDeficitRecovery } from '../src/jobs/deficitRecovery.job.ts';

function createDb({ available, records }) {
  const wallet = { id: 101, user_id: 7, available_balance: available };
  const rows = records.map((r, i) => ({
    id: i + 1,
    wallet_id: 101,
    recovered_from_available: r.recovered ?? '0.00',
    unrecovered_deficit: r.deficit,
    recovery_status: 'PENDING',
    recovered_at: null,
  }));

  const handle = async (sql, params = []) => {
    if (sql.includes('SELECT DISTINCT wallet_id')) {
      const open = rows.some((r) => ['PENDING', 'PARTIALLY_RECOVERED'].includes(r.recovery_status));
      return { rows: open ? [{ wallet_id: 101 }] : [] };
    }
    if (sql.includes('FROM wallets') && sql.includes('FOR UPDATE')) {
      return { rows: [wallet] };
    }
    if (sql.includes('FROM negative_balance_recoveries') && sql.includes('FOR UPDATE')) {
      return { rows: rows.filter((r) => ['PENDING', 'PARTIALLY_RECOVERED'].includes(r.recovery_status)).map((r) => ({ ...r })) };
    }
    if (sql.includes('UPDATE negative_balance_recoveries')) {
      const row = rows.find((r) => r.id === params[0]);
      row.recovered_from_available = params[1];
      row.unrecovered_deficit = params[2];
      row.recovery_status = params[3];
      if (params[3] === 'RECOVERED') row.recovered_at = 'now';
      return { rows: [] };
    }
    return { rows: [] };
  };

  const db = { query: handle, async connect() { return { query: handle, release() {} }; } };
  return { db, rows, wallet };
}

describe('settleDeficitRecoveries', () => {
  test('a wallet back at zero or above closes its deficits', async () => {
    const { db, rows } = createDb({ available: '25.00', records: [{ deficit: '150.00', recovered: '50.00' }] });

    const result = await settleDeficitRecoveries(db);

    assert.equal(result.recordsRecovered, 1);
    assert.equal(result.recoveredAmount, '150.00');
    assert.deepEqual(
      { status: rows[0].recovery_status, recovered: rows[0].recovered_from_available, deficit: rows[0].unrecovered_deficit },
      { status: 'RECOVERED', recovered: '200.00', deficit: '0.00' }
    );
    assert.equal(rows[0].recovered_at, 'now');
  });

  test('a wallet still below zero keeps what it owes, oldest record recovered first', async () => {
    // outstanding 230, still owed 100 -> 130 recovered, all of it on the older record
    const { db, rows } = createDb({ available: '-100.00', records: [{ deficit: '150.00' }, { deficit: '80.00' }] });

    const result = await settleDeficitRecoveries(db);

    assert.equal(result.recoveredAmount, '130.00');
    assert.equal(rows[0].recovery_status, 'PARTIALLY_RECOVERED');
    assert.equal(rows[0].unrecovered_deficit, '20.00');
    assert.equal(rows[0].recovered_from_available, '130.00');
    assert.equal(rows[1].recovery_status, 'PENDING', 'the newer record is untouched');
  });

  test('nothing is recovered while the wallet owes at least the whole deficit', async () => {
    const { db, rows } = createDb({ available: '-300.00', records: [{ deficit: '150.00' }, { deficit: '80.00' }] });

    const result = await settleDeficitRecoveries(db);

    assert.equal(result.walletsSettled, 0);
    assert.ok(rows.every((r) => r.recovery_status === 'PENDING'));
  });

  test('the remaining part of a partly recovered record closes on a later run', async () => {
    const { db, rows, wallet } = createDb({ available: '-100.00', records: [{ deficit: '150.00' }] });
    await settleDeficitRecoveries(db);
    assert.equal(rows[0].unrecovered_deficit, '100.00');

    wallet.available_balance = '0.00'; // the wallet earns the rest back

    await settleDeficitRecoveries(db);
    assert.equal(rows[0].recovery_status, 'RECOVERED');
    assert.equal(rows[0].recovered_from_available, '150.00');
  });

  test('the job reports what it settled', async () => {
    const { db } = createDb({ available: '0.00', records: [{ deficit: '40.00' }] });
    const logger = { info() {}, warn() {}, error() {} };

    const result = await runDeficitRecovery(db, null, logger);

    assert.equal(result.processedCount, 1);
    assert.equal(result.successCount, 1);
    assert.equal(result.errorCount, 0);
  });
});
