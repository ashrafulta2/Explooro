/**
 * adminNavigation.test.js — Automated Unit Tests for Admin & Super Admin Navigation and Role Invariants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { navGroups, navItems, NAV_ROLES, MOBILE_TABS } from '../src/config/navigation.js';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };

describe('Admin Navigation & Sidebar Structure Invariants', () => {
  it('1. NAV_ROLES includes both super_admin and admin roles', () => {
    assert.ok(NAV_ROLES.includes('super_admin'), 'NAV_ROLES must include super_admin');
    assert.ok(NAV_ROLES.includes('admin'), 'NAV_ROLES must include admin');
  });

  it('2. All 9 admin navigation groups are configured for both super_admin and admin', () => {
    const adminGroups = navGroups.filter(
      (g) => g.role === 'super_admin' || (Array.isArray(g.roles) && (g.roles.includes('super_admin') || g.roles.includes('admin')))
    );

    assert.equal(adminGroups.length, 9, 'Admin navigation must have exactly 9 groups');

    const expectedGroupKeys = [
      'admin.overview',
      'admin.users',
      'admin.catalog',
      'admin.orders',
      'admin.finance',
      'admin.growth',
      'admin.content',
      'admin.platform',
      'admin.security',
    ];

    expectedGroupKeys.forEach((key) => {
      const group = adminGroups.find((g) => g.key === key);
      assert.ok(group, `Expected group ${key} to exist`);
      assert.ok(
        group.roles?.includes('admin') || group.role === 'admin' || (group.roles?.includes('super_admin') && group.roles?.includes('admin')),
        `Group ${key} must include admin role`
      );
    });
  });

  it('3. All 49 admin nav items support both super_admin and admin roles', () => {
    const adminItems = navItems.filter((item) => item.group?.startsWith('admin.'));
    assert.equal(adminItems.length, 49, 'Expected exactly 49 admin nav items');

    adminItems.forEach((item) => {
      assert.ok(item.roles?.includes('super_admin'), `Nav item ${item.key} must include super_admin`);
      assert.ok(item.roles?.includes('admin'), `Nav item ${item.key} must include admin`);
      assert.ok(item.path.startsWith('/admin'), `Nav item ${item.key} path must start with /admin`);
      assert.ok(item.permission, `Nav item ${item.key} must define a permission key`);
    });
  });

  it('4. MOBILE_TABS defines tabs for both super_admin and admin', () => {
    assert.ok(Array.isArray(MOBILE_TABS.admin), 'MOBILE_TABS must define admin tabs');
    assert.ok(Array.isArray(MOBILE_TABS.super_admin), 'MOBILE_TABS must define super_admin tabs');
    assert.equal(MOBILE_TABS.admin.length, 5, 'Admin mobile tabs must have 5 tabs including more');
    assert.ok(MOBILE_TABS.admin.some((t) => t.path === '/admin'), 'Admin mobile tabs must link to /admin');
  });

  it('5. All nav group and item i18n keys resolve in English and Bengali dictionaries', () => {
    const adminGroups = navGroups.filter((g) => g.key.startsWith('admin.'));
    adminGroups.forEach((g) => {
      const parts = g.label_i18n_key.split('.');
      let enVal = enDict;
      let bnVal = bnDict;
      for (const p of parts) {
        enVal = enVal?.[p];
        bnVal = bnVal?.[p];
      }
      assert.ok(typeof enVal === 'string', `Missing EN label for key ${g.label_i18n_key}`);
      assert.ok(typeof bnVal === 'string', `Missing BN label for key ${g.label_i18n_key}`);
    });
  });
});
