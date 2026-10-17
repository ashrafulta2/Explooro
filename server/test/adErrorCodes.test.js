/**
 * adErrorCodes.test.js — every error code the ad services throw has an HTTP status.
 *
 * WHY: a code missing from ERROR_STATUS (plugins/errorHandler.ts) answers 500 INTERNAL_ERROR. Before
 * 2026-10-17, 24 ad codes did — a bid below the floor or a sold-out slot read as a server crash.
 * Two are deliberately left at 500 because they are system faults, not the caller's mistake.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const AD_SERVICES = [
  'ads.service.ts',
  'adProducts.service.ts',
  'adPricing.ts',
  'adPushBlast.service.ts',
  'adRefund.ts',
  'adDestination.service.ts',
  'sponsoredSourcing.service.ts',
];

const SYSTEM_FAULTS = new Set(['INVALID_PRICING_MODEL', 'WALLET_NOT_FOUND']);

test('every code the ad services throw is mapped to a status', () => {
  const handler = readFileSync(path.join(SRC, 'plugins', 'errorHandler.ts'), 'utf8');
  const mapped = new Set([...handler.matchAll(/^ {2}([A-Z_]+):\s*\d{3},/gm)].map((m) => m[1]));

  const unmapped = [];
  for (const file of AD_SERVICES) {
    const source = readFileSync(path.join(SRC, 'services', file), 'utf8');
    for (const [, code] of source.matchAll(/AppError\(\s*'([A-Z_]+)'/g)) {
      if (!mapped.has(code) && !SYSTEM_FAULTS.has(code)) unmapped.push(`${file}: ${code}`);
    }
  }
  assert.deepEqual([...new Set(unmapped)], []);
});
