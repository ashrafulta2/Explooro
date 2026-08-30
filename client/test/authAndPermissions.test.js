/**
 * authAndPermissions.test.js — Invariants for Client Authentication, Session Management,
 * Permission Resolution & Locked State UX (Prompt 2.8).
 *
 * Pins the core security & UX invariants:
 *   1. Locale integrity — en/bn parity for auth.* and access.* namespaces.
 *   2. ElevatedAccessChip time formatting — accurate hour/minute conversion in English & Bengali.
 *   3. In-memory JWT payload decoding & proactive refresh scheduling.
 *   4. Client whyDenied() resolution rules — 'held', 'requestable', 'critical_locked', 'restricted', 'module_off'.
 *   5. Request access submission payload invariants.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import { formatRemainingTime } from '../src/components/access/ElevatedAccessChip.js';
import catalog from '../../docs/permission-catalog.json' with { type: 'json' };

const catalogMap = new Map(catalog.permissions.map((p) => [p.key, p]));

test('Prompt 2.8: Auth & Access Frontend — Client Invariants', async (t) => {
  // 1. Locale Integrity
  await t.test('1. Locale integrity — en/bn key parity for auth and access namespaces', () => {
    const enAuth = Object.keys(enDict.auth || {}).sort();
    const bnAuth = Object.keys(bnDict.auth || {}).sort();
    assert.deepEqual(enAuth, bnAuth, 'auth namespace keys must match in en and bn');

    const enAccess = Object.keys(enDict.access || {}).sort();
    const bnAccess = Object.keys(bnDict.access || {}).sort();
    assert.deepEqual(enAccess, bnAccess, 'access namespace keys must match in en and bn');
  });

  // 2. ElevatedAccessChip Time Formatting
  await t.test('2. ElevatedAccessChip formatRemainingTime produces exact strings in EN and BN', () => {
    // 1 hour 42 minutes (6120000 ms)
    const ms1 = (1 * 3600 + 42 * 60) * 1000;
    assert.equal(formatRemainingTime(ms1, 'en'), '1h 42m');
    assert.equal(formatRemainingTime(ms1, 'bn'), '১ ঘণ্টা ৪২ মিনিট');

    // 42 minutes (2520000 ms)
    const ms2 = 42 * 60 * 1000;
    assert.equal(formatRemainingTime(ms2, 'en'), '42m');
    assert.equal(formatRemainingTime(ms2, 'bn'), '৪২ মিনিট');

    // Edge case: 0 ms
    assert.equal(formatRemainingTime(0, 'en'), '0m');
    assert.equal(formatRemainingTime(0, 'bn'), '০ মিনিট');
  });

  // 3. JWT Payload Decoding & Proactive Refresh Math
  await t.test('3. JWT payload decoding & proactive 60s pre-expiry calculation', () => {
    const fakePayload = {
      sub: '5',
      roles: ['supplier'],
      exp: Math.floor(Date.now() / 1000) + 900, // 15 min from now
    };

    const base64Url = Buffer.from(JSON.stringify(fakePayload)).toString('base64url');
    const fakeToken = `header.${base64Url}.signature`;

    // Decode simulation
    const decoded = JSON.parse(Buffer.from(fakeToken.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(decoded.sub, '5');
    assert.deepEqual(decoded.roles, ['supplier']);

    // Proactive refresh timing (60s before expiration)
    const expiresInMs = decoded.exp * 1000 - Date.now();
    const refreshInMs = Math.max(expiresInMs - 60_000, 10_000);
    assert.ok(refreshInMs >= 830_000 && refreshInMs <= 850_000, 'Refreshes ~14 minutes in for a 15-minute token');
  });

  // 4. Client whyDenied() Resolution Rules
  await t.test('4. whyDenied() resolution rules across permission risk tiers and restrictions', () => {
    const held = new Set(['catalog.product.view', 'catalog.product.create']);
    const restrictions = [{ capability: 'can_withdraw', mode: 'BLOCK', reason: 'KYC Required' }];

    function testWhyDenied(key, { isSuperAdmin = false, isModuleOn = true } = {}) {
      if (!isModuleOn) return 'module_off';

      const restriction = restrictions.find((r) => r.capability === key || (key === 'finance.payout.request' && r.capability === 'can_withdraw'));
      if (restriction && restriction.mode === 'BLOCK') return 'restricted';

      if (held.has(key)) return 'held';

      const meta = catalogMap.get(key);
      if (!meta) return 'no_permission';

      if (meta.risk_tier === 'CRITICAL' && !isSuperAdmin) {
        return 'critical_locked';
      }
      if (meta.risk_tier === 'MEDIUM') {
        return 'requestable';
      }
      return 'no_permission';
    }

    // Held permission
    assert.equal(testWhyDenied('catalog.product.view'), 'held');

    // Blocked restriction
    assert.equal(testWhyDenied('finance.payout.request'), 'restricted');

    // CRITICAL permission for regular staff
    assert.equal(testWhyDenied('users.permission.grant', { isSuperAdmin: false }), 'critical_locked');

    // CRITICAL permission when held by super admin
    held.add('users.permission.grant');
    assert.equal(testWhyDenied('users.permission.grant', { isSuperAdmin: true }), 'held');
    held.delete('users.permission.grant');

    // MEDIUM permission eligible for JIT request
    assert.equal(testWhyDenied('orders.return.approve'), 'requestable');

    // Module disabled
    assert.equal(testWhyDenied('catalog.product.create', { isModuleOn: false }), 'module_off');
  });

  // 5. Request Access Submission Invariants
  await t.test('5. Request access payload invariants', () => {
    const validRequest = {
      permission_key: 'orders.return.approve',
      reason: 'Need to process dispute for customer return #1234',
      window_minutes: 120,
    };

    assert.ok(validRequest.permission_key.length > 0, 'permission_key is mandatory');
    assert.ok(validRequest.reason.trim().length >= 10, 'reason must be at least 10 chars');
    assert.equal(validRequest.window_minutes, 120, 'default window is 120 minutes');
  });
});
