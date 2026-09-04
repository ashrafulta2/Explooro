/**
 * adminSecurityPages.test.js — Unit Tests for Super Admin 2FA, IP Allowlist, and Backups Pages.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };
import { adminApi } from '../src/services/admin.api.js';
import adminHandlers from '../src/mocks/handlers/admin.js';
import { navItems } from '../src/config/navigation.js';

describe('Super Admin Security & Disaster Recovery — Client Invariants', () => {
  it('1. Locale integrity — 100% parity for admin_2fa, admin_ip_allowlist, admin_backups', () => {
    const namespaces = ['admin_2fa', 'admin_ip_allowlist', 'admin_backups'];

    for (const ns of namespaces) {
      assert.ok(enDict[ns], `Namespace "${ns}" must exist in en.json`);
      assert.ok(bnDict[ns], `Namespace "${ns}" must exist in bn.json`);

      const enKeys = Object.keys(enDict[ns]).sort();
      const bnKeys = Object.keys(bnDict[ns]).sort();

      assert.deepEqual(enKeys, bnKeys, `Namespace "${ns}" keys must match exactly between en and bn`);

      for (const k of enKeys) {
        assert.ok(typeof enDict[ns][k] === 'string' && enDict[ns][k].length > 0, `en.${ns}.${k} must not be empty`);
        assert.ok(typeof bnDict[ns][k] === 'string' && bnDict[ns][k].length > 0, `bn.${ns}.${k} must not be empty`);
      }
    }
  });

  it('2. Navigation definitions for 2FA, IP Allowlist, and Backups', () => {
    const expected = [
      { key: 'admin.security.2fa', path: '/admin/security/2fa', permission: 'security.2fa.manage' },
      { key: 'admin.security.ip_allowlist', path: '/admin/security/ip-allowlist', permission: 'security.ip.manage' },
      { key: 'admin.security.backups', path: '/admin/security/backups', permission: 'system.backup.manage' },
    ];

    for (const item of expected) {
      const found = navItems.find((n) => n.key === item.key);
      assert.ok(found, `Expected nav item ${item.key} to exist`);
      assert.equal(found.path, item.path);
      assert.equal(found.permission, item.permission);
      assert.ok(found.roles?.includes('super_admin'), `${item.key} must be accessible by super_admin`);
    }
  });

  it('3. adminApi exposes full method suites for 2FA, IP Allowlist, and Backups', () => {
    const methods = [
      'get2faStatus',
      'update2faPolicy',
      'resetStaff2fa',
      'remindStaff2fa',
      'getIpAllowlist',
      'addIpAllowlistEntry',
      'updateIpAllowlistEntry',
      'deleteIpAllowlistEntry',
      'setIpAllowlistMode',
      'getBackups',
      'triggerBackup',
      'restoreBackup',
    ];

    for (const m of methods) {
      assert.equal(typeof adminApi[m], 'function', `adminApi must export function ${m}`);
    }
  });

  it('4. Mock handlers respond with expected structures for 2FA endpoints', () => {
    const twoFaHandler = adminHandlers.find((h) => h.method === 'GET' && h.path === '/admin/security/2fa');
    assert.ok(twoFaHandler, 'Mock GET /admin/security/2fa must exist');
    const res = twoFaHandler.handler();
    assert.equal(res.status, 200);
    assert.ok(res.body?.data?.policy?.enforcement_tier);
    assert.ok(Array.isArray(res.body?.data?.staff));
    assert.ok(res.body?.data?.stats);
  });

  it('5. Mock handlers respond with expected structures for IP Allowlist endpoints', () => {
    const allowlistHandler = adminHandlers.find((h) => h.method === 'GET' && h.path === '/admin/security/ip-allowlist');
    assert.ok(allowlistHandler, 'Mock GET /admin/security/ip-allowlist must exist');
    const allowlistRes = allowlistHandler.handler({ query: {} });
    assert.equal(allowlistRes.status, 200);
    assert.ok(Array.isArray(allowlistRes.body?.data?.entries));
    assert.ok(allowlistRes.body?.data?.mode);
  });

  it('6. Mock handlers respond with expected structures for Backups endpoints', () => {
    const backupsHandler = adminHandlers.find((h) => h.method === 'GET' && h.path === '/admin/system/backups');
    assert.ok(backupsHandler, 'Mock GET /admin/system/backups must exist');
    const backupsRes = backupsHandler.handler({ query: {} });
    assert.equal(backupsRes.status, 200);
    assert.ok(Array.isArray(backupsRes.body?.data?.backups));
  });

  it('7. Page modules export default mount function', async () => {
    const staff2faMod = await import('../src/pages/admin/Staff2faPage.js');
    assert.equal(typeof staff2faMod.default, 'function', 'Staff2faPage must export default function');

    const ipAllowlistMod = await import('../src/pages/admin/IpAllowlistPage.js');
    assert.equal(typeof ipAllowlistMod.default, 'function', 'IpAllowlistPage must export default function');

    const backupMod = await import('../src/pages/admin/BackupPage.js');
    assert.equal(typeof backupMod.default, 'function', 'BackupPage must export default function');
  });
});
