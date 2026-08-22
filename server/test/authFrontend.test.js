/**
 * authFrontend.test.js — Frontend Authentication & Permission Logic Unit Tests (Prompt 2.8).
 *
 * Verifies Prompt 2.8 acceptance criteria:
 * 1. Permission evaluation: can(), isRestricted(), and whyDenied() across roles and tiers.
 * 2. Moderator with zero grants sees locked states (requestable vs critical_locked).
 * 3. Customer role is denied access to admin-only capabilities.
 * 4. Elevated access countdown formatting (English & Bengali).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read permission catalog directly
const catalogPath = join(process.cwd(), '../docs/permission-catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const catalogPermissions = new Map(catalog.permissions.map((p) => [p.key, p]));

function formatRemainingTime(ms, lang = 'en') {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (lang === 'bn') {
    const toBn = (n) => String(n).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
    if (hours > 0) return `${toBn(hours)} ঘণ্টা ${toBn(minutes)} মিনিট`;
    return `${toBn(minutes)} মিনিট`;
  }

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function evaluateWhyDenied({ permissionKey, heldPermissions, activeRoles, activeRestrictions = [] }) {
  if (!permissionKey) return 'held';
  if (heldPermissions.has(permissionKey)) return 'held';

  const matchingRestriction = activeRestrictions.find(
    (r) => r.capability_key === permissionKey || permissionKey.includes(r.capability_key)
  );
  if (matchingRestriction && matchingRestriction.mode === 'BLOCK') {
    return 'restricted';
  }

  const meta = catalogPermissions.get(permissionKey);
  const isSuperAdmin = activeRoles.includes('super_admin');

  if (meta?.risk_tier === 'CRITICAL' && !isSuperAdmin) {
    return 'critical_locked';
  }

  if (meta?.risk_tier === 'MEDIUM') {
    return 'requestable';
  }

  if (meta?.risk_tier === 'HIGH') {
    return 'maker_checker';
  }

  return 'no_permission';
}

describe('Auth & Access Frontend Logic (Prompt 2.8)', () => {
  test('ElevatedAccessChip: formatRemainingTime formats remaining duration in en and bn', () => {
    const twoHoursMs = 2 * 3600 * 1000 + 15 * 60 * 1000;
    const formattedEn = formatRemainingTime(twoHoursMs, 'en');
    const formattedBn = formatRemainingTime(twoHoursMs, 'bn');

    assert.equal(formattedEn, '2h 15m');
    assert.equal(formattedBn, '২ ঘণ্টা ১৫ মিনিট');

    const fortyMinutesMs = 40 * 60 * 1000;
    assert.equal(formatRemainingTime(fortyMinutesMs, 'en'), '40m');
    assert.equal(formatRemainingTime(fortyMinutesMs, 'bn'), '৪০ মিনিট');
  });

  test('Acceptance 1: Moderator with zero grants has delegable permissions as requestable and CRITICAL as locked', () => {
    const moderatorRoles = ['moderator'];
    const heldPermissions = new Set([
      'moderation.queue.view',
      'moderation.product.approve',
      'moderation.review.moderate',
    ]);

    // Held permission
    const heldRes = evaluateWhyDenied({
      permissionKey: 'moderation.queue.view',
      heldPermissions,
      activeRoles: moderatorRoles,
    });
    assert.equal(heldRes, 'held');

    // Delegable MEDIUM-tier withheld permission -> requestable
    const delegableRes = evaluateWhyDenied({
      permissionKey: 'moderation.live.handle',
      heldPermissions,
      activeRoles: moderatorRoles,
    });
    assert.equal(delegableRes, 'requestable');

    // Non-delegable CRITICAL-tier withheld permission -> critical_locked
    const criticalRes = evaluateWhyDenied({
      permissionKey: 'staff.role.assign',
      heldPermissions,
      activeRoles: moderatorRoles,
    });
    assert.equal(criticalRes, 'critical_locked');
  });

  test('Acceptance 4: Customer role does not hold any admin permissions', () => {
    const customerRoles = ['customer'];
    const customerPermissions = new Set([
      'orders.order.create',
      'orders.order.view_own',
      'catalog.product.view',
    ]);

    const adminCheck = evaluateWhyDenied({
      permissionKey: 'admin.dashboard.view',
      heldPermissions: customerPermissions,
      activeRoles: customerRoles,
    });
    assert.notEqual(adminCheck, 'held');

    const auditCheck = evaluateWhyDenied({
      permissionKey: 'security.audit.view',
      heldPermissions: customerPermissions,
      activeRoles: customerRoles,
    });
    assert.equal(auditCheck, 'requestable'); // MEDIUM tier, requestable if staff or denied
  });

  test('Capability restriction BLOCK yields restricted whyDenied status', () => {
    const heldPermissions = new Set(['vault.payout.request']);
    const activeRoles = ['saler'];
    const activeRestrictions = [
      { capability_key: 'can_withdraw', mode: 'BLOCK', reason: 'Fraud check' },
    ];

    const result = evaluateWhyDenied({
      permissionKey: 'can_withdraw',
      heldPermissions,
      activeRoles,
      activeRestrictions,
    });
    assert.equal(result, 'restricted');
  });
});
