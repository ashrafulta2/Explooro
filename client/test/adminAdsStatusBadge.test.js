/**
 * adminAdsStatusBadge.test.js — the Ads table names every campaign status, not just Active/Paused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { statusBadge } from '../src/pages/admin/AdminAdsPage.js';

test('SCHEDULED is not shown as Paused', () => {
  assert.equal(statusBadge('SCHEDULED').en, 'Scheduled');
  assert.notEqual(statusBadge('SCHEDULED').tone, statusBadge('PAUSED').tone);
});

test('each campaign status has an English and a Bangla label', () => {
  for (const s of ['ACTIVE', 'SCHEDULED', 'PAUSED', 'PENDING_REVIEW', 'COMPLETED', 'REJECTED', 'DRAFT']) {
    const b = statusBadge(s);
    assert.ok(b.en && b.bn && b.tone, s);
  }
  assert.equal(statusBadge('ACTIVE').tone, 'system-table__badge--success');
  assert.equal(statusBadge('REJECTED').tone, 'system-table__badge--danger');
});

test('an unknown status shows its own name instead of a wrong label', () => {
  assert.equal(statusBadge('EXHAUSTED').en, 'EXHAUSTED');
});
