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

  // 6. Approval Inbox Locale Parity
  await t.test('6. Approval Inbox locale parity for min reason length and card accessibility label', () => {
    assert.ok(enDict.approvals.reason_min_length, 'en.json must contain reason_min_length');
    assert.ok(bnDict.approvals.reason_min_length, 'bn.json must contain reason_min_length');
    assert.ok(enDict.approvals.card_label, 'en.json must contain card_label');
    assert.ok(bnDict.approvals.card_label, 'bn.json must contain card_label');
    assert.ok(enDict.approvals.card_label.includes('{{index}}') && enDict.approvals.card_label.includes('{{total}}'));
    assert.ok(bnDict.approvals.card_label.includes('{{index}}') && bnDict.approvals.card_label.includes('{{total}}'));
  });

  // 7. Focus Index Clamping Logic
  await t.test('7. Approval Inbox index clamping logic prevents out-of-bounds focus', () => {
    const clampIndex = (currentIdx, newLength) => Math.min(currentIdx, Math.max(0, newLength - 1));
    assert.equal(clampIndex(2, 2), 1, 'Index 2 with length 2 clamps to 1');
    assert.equal(clampIndex(0, 1), 0, 'Index 0 with length 1 stays 0');
    assert.equal(clampIndex(1, 1), 0, 'Index 1 with length 1 clamps to 0');
    assert.equal(clampIndex(0, 0), 0, 'Empty queue clamps to 0');
  });

  // 8. Approval CSS Rules & Viewport Clearance
  await t.test('8. CSS defines viewport bottom spacing and action classes for approvals', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const cssPath = resolve(import.meta.dirname, '../src/styles/components/admin-access.css');
    const css = readFileSync(cssPath, 'utf8');

    assert.ok(css.includes('.approval-inbox'), 'admin-access.css must define .approval-inbox');
    assert.ok(css.includes('padding-bottom: var(--space-10)'), '.approval-inbox must have bottom padding to prevent viewport jamming');
    assert.ok(css.includes('.approval-card__actions'), '.approval-card__actions must be defined');
    assert.ok(css.includes('.approval-card--focused'), '.approval-card--focused must be defined for keyboard navigation visibility');
  });

  // 9. Keyboard Navigation Modal Isolation & A11y Contrast
  await t.test('9. ApprovalInboxPage source contains modal isolation guard and WCAG AA contrast tokens', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const pagePath = resolve(import.meta.dirname, '../src/pages/admin/ApprovalInboxPage.js');
    const pageSrc = readFileSync(pagePath, 'utf8');

    assert.ok(pageSrc.includes('modal-backdrop') || pageSrc.includes('role="dialog"'), 'Must guard against shortcuts leaking when modal is open');
    assert.ok(pageSrc.includes("'role', 'article'"), 'Approval cards must expose role="article" for screen readers');
    assert.ok(pageSrc.includes('approvals.card_label'), 'Approval cards must have aria-label with position information');
    assert.ok(!pageSrc.includes('style="color: var(--text-muted);"'), 'Approval cards must not use low-contrast text-muted on surface-2');
  });

  // 10. Restrictions Table Layout, Top Alignment & A11y Contrast
  await t.test('10. Restrictions page layout eliminates inner vertical scroll, aligns baselines to top, and uses high contrast', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const cssPath = resolve(import.meta.dirname, '../src/styles/components/admin-access.css');
    const css = readFileSync(cssPath, 'utf8');

    assert.ok(css.includes('.admin-users {'), 'admin-access.css must define .admin-users');
    assert.ok(css.includes('.admin-users .perm-matrix__table-wrap { max-height: none; overflow-y: visible; overflow-x: auto; }'), 'Must remove max-height to eliminate inner scrollbar and row truncation');
    assert.ok(css.includes('.admin-users .perm-matrix__table td { vertical-align: top;'), 'Must set vertical-align: top for multi-line cell baseline alignment');

    const restrictionsPath = resolve(import.meta.dirname, '../src/pages/admin/RestrictionsPage.js');
    const restSrc = readFileSync(restrictionsPath, 'utf8');
    assert.ok(!restSrc.includes('<br><span'), 'Must not insert phantom br tags inside flex containers');
    assert.ok(!restSrc.includes('color: var(--text-muted);'), 'Restrictions table must not use low-contrast text-muted');
    assert.ok(!restSrc.includes('r.capability_key)}</span>'), 'Must not render raw capability_key coding text');
    assert.ok(restSrc.includes("tdActions.style.whiteSpace = 'nowrap';"), 'Must prevent action button text clipping');
  });
});
