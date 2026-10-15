/**
 * ledgerWalletNotFound.test.js — WALLET_NOT_FOUND names only the missing wallets.
 *
 * Regression for a bug `// @ts-check` caught: pg returns BIGINT ids as strings, while
 * recordTransactionGroup compares them against parsed numbers. The Set lookup never matched, so
 * the error listed every wallet in the group instead of the one that does not exist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as ledgerService from '../src/services/ledger.service.js';

test('WALLET_NOT_FOUND lists only the missing wallet when pg returns string ids', async () => {
  // Shaped like pg: the one wallet that exists comes back with a string BIGINT id.
  const client = {
    async query(sql) {
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ id: '7', available_balance: '1000.00', pending_escrow_balance: '0.00', held_balance: '0.00' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  await assert.rejects(
    ledgerService.recordTransactionGroup(client, {
      entries: [
        { walletId: '7', entryType: 'DEBIT', amount: '10.00', balanceBucket: 'AVAILABLE' },
        { walletId: '8', entryType: 'CREDIT', amount: '10.00', balanceBucket: 'AVAILABLE' },
      ],
    }),
    (err) => {
      assert.match(err.message, /^WALLET_NOT_FOUND: The following wallet IDs were not found: 8$/);
      return true;
    }
  );
});
