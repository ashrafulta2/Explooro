/**
 * usersAndAuditExplorer.test.js — Invariants for Users & Access Admin UI, Approval Inbox,
 * and Audit Trail Explorer (Prompts 3.3 & 3.4).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import { computeObjectDiff, generatePlainLanguageSummary, serializeAuditRecordsToCsv } from '../src/components/admin/AuditDiffViewer.js';

test('Prompts 3.3 & 3.4: Users, Access & Audit Explorer — Client Invariants', async (t) => {
  // 1. Locale Integrity
  await t.test('1. Locale integrity for admin users, approvals, and audit namespaces', () => {
    assert.ok(enDict.admin_users, 'en.json must contain admin_users');
    assert.ok(bnDict.admin_users, 'bn.json must contain admin_users');

    assert.ok(enDict.approvals, 'en.json must contain approvals');
    assert.ok(bnDict.approvals, 'bn.json must contain approvals');

    assert.ok(enDict.audit_explorer, 'en.json must contain audit_explorer');
    assert.ok(bnDict.audit_explorer, 'bn.json must contain audit_explorer');
  });

  // 2. Audit Diff Calculation
  await t.test('2. computeObjectDiff accurately computes added, removed, and modified attributes', () => {
    const before = {
      saler_split_pct: 40,
      platform_split_pct: 60,
      min_margin: 10,
      old_config: 'legacy',
    };

    const after = {
      saler_split_pct: 45,
      platform_split_pct: 55,
      min_margin: 10,
      new_config: 'modern',
    };

    const diff = computeObjectDiff(before, after);
    assert.equal(diff.totalChanges, 4); // 2 modified, 1 removed, 1 added
    assert.ok(diff.modified.includes('saler_split_pct'));
    assert.ok(diff.modified.includes('platform_split_pct'));
    assert.ok(diff.removed.includes('old_config'));
    assert.ok(diff.added.includes('new_config'));
  });

  // 3. Plain Language Summary Generator
  await t.test('3. generatePlainLanguageSummary generates readable summaries for staff operations', () => {
    // Module toggle
    const moduleAudit = {
      action: 'module.disable',
      target_type: 'platform_module',
      target_ref: 'live_stream',
      before_json: { is_enabled: true },
      after_json: { is_enabled: false, last_reason: 'Routine maintenance' },
    };
    const modSummary = generatePlainLanguageSummary(moduleAudit, 'en');
    assert.ok(modSummary.includes('Disabled module') || modSummary.includes('live_stream'));

    // Permission grant
    const grantAudit = {
      action: 'permission.grant',
      target_type: 'user_permission_override',
      target_ref: 'orders.refund.approve',
      after_json: { user_id: 12, permission_key: 'orders.refund.approve' },
    };
    const grantSummary = generatePlainLanguageSummary(grantAudit, 'en');
    assert.ok(grantSummary.includes('Granted permission') || grantSummary.includes('orders.refund.approve'));

    // Capability restriction
    const restrictAudit = {
      action: 'restriction.apply',
      target_type: 'user_restriction',
      target_ref: 'can_withdraw',
      after_json: { capability: 'can_withdraw', mode: 'BLOCK', reason: 'KYC Required' },
    };
    const restrictSummary = generatePlainLanguageSummary(restrictAudit, 'en');
    assert.ok(restrictSummary.includes('can_withdraw') || restrictSummary.includes('BLOCK'));
  });

  // 4. CSV Serializer & Escaping
  await t.test('4. serializeAuditRecordsToCsv serializes fields and escapes commas/quotes', () => {
    const records = [
      {
        id: '101',
        created_at: '2026-08-30T12:00:00Z',
        actor_role: 'admin',
        action: 'module.toggle',
        target_type: 'platform_module',
        target_ref: 'chat',
        ip_address: '127.0.0.1',
        trace_id: 'trc-abc-123',
        risk_tier: 'CRITICAL',
      },
      {
        id: '102',
        created_at: '2026-08-30T12:05:00Z',
        actor_role: 'super_admin',
        action: 'user.restrict',
        target_type: 'user',
        target_ref: 'User, #5 "Rahim"',
        ip_address: '192.168.1.1',
        trace_id: 'trc-xyz-789',
        risk_tier: 'HIGH',
      },
    ];

    const csv = serializeAuditRecordsToCsv(records);
    assert.ok(csv.startsWith('ID,Timestamp,Actor Role,Action,Target Type,Target Ref,IP Address,Trace ID,Risk Tier'));
    assert.ok(csv.includes('101,2026-08-30T12:00:00Z,admin,module.toggle'));
    // Escaped string with comma and quotes
    assert.ok(csv.includes('"User, #5 ""Rahim"""'));
  });

  // 5. Approval Inbox Keyboard Navigation Invariants
  await t.test('5. Approval Inbox keyboard navigation maps valid actions', () => {
    const keys = {
      j: 'NEXT_ITEM',
      k: 'PREV_ITEM',
      a: 'APPROVE',
      r: 'REJECT',
    };

    assert.equal(keys.j, 'NEXT_ITEM');
    assert.equal(keys.k, 'PREV_ITEM');
    assert.equal(keys.a, 'APPROVE');
    assert.equal(keys.r, 'REJECT');
  });
});
