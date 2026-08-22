/**
 * auditUi.test.js — Test suite for Prompt 3.4 (Audit Explorer, Diff Computation, Human Summaries & Timeline).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeObjectDiff, generatePlainLanguageSummary } from '../../client/src/components/admin/AuditDiffViewer.js';

describe('Audit Explorer UI Logic & Diff Viewer (Prompt 3.4)', () => {
  test('computeObjectDiff: accurately identifies added, removed, and modified keys', () => {
    const before = {
      is_enabled: true,
      rate_limit: 100,
      old_feature: 'legacy',
    };

    const after = {
      is_enabled: false,
      rate_limit: 150,
      new_feature: 'active',
    };

    const diff = computeObjectDiff(before, after);

    assert.deepEqual(diff.modified, ['is_enabled', 'rate_limit']);
    assert.deepEqual(diff.added, ['new_feature']);
    assert.deepEqual(diff.removed, ['old_feature']);
    assert.equal(diff.totalChanges, 4);
  });

  test('computeObjectDiff: returns 0 totalChanges when objects are identical', () => {
    const obj = { name: 'Explooro', status: 'ACTIVE', flags: [1, 2] };
    const diff = computeObjectDiff(obj, { ...obj });
    assert.equal(diff.totalChanges, 0);
  });

  test('generatePlainLanguageSummary: produces human-friendly description for module toggle', () => {
    const record = {
      action: 'platform.module.toggle',
      target_type: 'platform_module',
      target_ref: 'chat',
      before: { key: 'chat', is_enabled: true },
      after: { key: 'chat', is_enabled: false, disabled_reason: 'Maintenance window' },
      meta: { reason: 'Maintenance window' },
    };

    const summary = generatePlainLanguageSummary(record);
    assert.ok(summary.includes('chat'));
    assert.ok(summary.includes('Maintenance window'));
  });

  test('generatePlainLanguageSummary: produces human-friendly description for permission grant', () => {
    const record = {
      action: 'users.grant.create',
      target_type: 'user',
      target_ref: 'USR-8F2K9QX7',
      after: { permission_key: 'orders.order.view_all' },
      meta: { permission_key: 'orders.order.view_all', user_ref: 'USR-8F2K9QX7' },
    };

    const summary = generatePlainLanguageSummary(record);
    assert.ok(summary.includes('orders.order.view_all'));
    assert.ok(summary.includes('USR-8F2K9QX7'));
  });

  test('generatePlainLanguageSummary: produces human-friendly description for capability restriction', () => {
    const record = {
      action: 'users.restriction.create',
      target_type: 'user_restriction',
      target_ref: 'USR-3M7V2WQ1',
      after: { capability_key: 'can_withdraw', mode: 'BLOCK' },
      meta: { capability_key: 'can_withdraw' },
    };

    const summary = generatePlainLanguageSummary(record);
    assert.ok(summary.includes('can_withdraw=BLOCK'));
    assert.ok(summary.includes('USR-3M7V2WQ1'));
  });

  test('CSV Serializer escapes commas and quotes properly', () => {
    const serializeCsvRow = (row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',');

    const row = [101, '2026-08-22T09:00:00Z', 'USR-ADMIN', '01711000000', 'module.disable', 'CRITICAL', 'platform_module', 'chat, with comma', '127.0.0.1', 'tr_123"quote'];
    const serialized = serializeCsvRow(row);

    assert.equal(
      serialized,
      '"101","2026-08-22T09:00:00Z","USR-ADMIN","01711000000","module.disable","CRITICAL","platform_module","chat, with comma","127.0.0.1","tr_123""quote"'
    );
  });
});
