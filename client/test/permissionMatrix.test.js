/**
 * permissionMatrix.test.js — invariants behind the Roles & Permissions matrix (Prompt 3.3).
 *
 * The bug this pins: the page drew a tick for Super Admin on every row, but the catalog gives
 * Super Admin 151 of 187 permissions (it deliberately lacks the saler.* / supplier.* workspace
 * ones). A cell must be decided by the data, never by the role's name.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import catalog from '../../docs/permission-catalog.json' with { type: 'json' };
import en from '../src/locales/en.json' with { type: 'json' };
import bn from '../src/locales/bn.json' with { type: 'json' };
import adminHandlers from '../src/mocks/handlers/admin.js';
import {
  buildHeldIndex,
  cellState,
  countHeldByRole,
  filterPermissions,
  groupByDomain,
  listDomains,
  sortRoles,
} from '../src/services/permissionMatrix.js';

const roles = [
  { id: 1, key: 'super_admin', level: 100 },
  { id: 2, key: 'editor', level: 60 },
  { id: 3, key: 'customer', level: 10 },
  { id: 4, key: 'moderator', level: 60 },
];
const perms = [
  { key: 'catalog.product.view', domain: 'catalog', risk_tier: 'LOW', label_en: 'View products', plain_en: 'browse the catalog' },
  { key: 'catalog.product.delete', domain: 'catalog', risk_tier: 'CRITICAL', label_en: 'Delete products' },
  { key: 'saler.store.manage', domain: 'saler', risk_tier: 'LOW', label_en: 'Manage own store' },
  { key: 'finance.payout.approve', domain: 'finance', risk_tier: 'HIGH', label_en: 'Approve payouts' },
];

describe('cellState', () => {
  const held = buildHeldIndex([
    { role_id: 1, permission_key: 'catalog.product.view' },
    { role_id: 1, permission_key: 'catalog.product.delete' },
    { role_id: 3, permission_key: 'catalog.product.view' },
  ]);
  const [superAdmin, , customer, moderator] = roles;

  it('is granted only when the data says the role holds it', () => {
    assert.equal(cellState(customer, perms[0], held), 'granted');
    assert.equal(cellState(moderator, perms[0], held), 'none');
  });

  it('does not assume Super Admin holds everything', () => {
    assert.equal(cellState(superAdmin, perms[0], held), 'granted');
    assert.equal(cellState(superAdmin, perms[2], held), 'none', 'saler.* is not a Super Admin default');
  });

  it('locks CRITICAL permissions a non-Super-Admin role does not hold', () => {
    assert.equal(cellState(customer, perms[1], held), 'locked');
    assert.equal(cellState(moderator, perms[1], held), 'locked');
    assert.equal(cellState(superAdmin, perms[1], held), 'granted');
  });

  it('never shows a lock on a non-CRITICAL permission', () => {
    assert.equal(cellState(customer, perms[3], held), 'none');
  });
});

describe('sortRoles', () => {
  it('orders lowest privilege first with a stable tie-break', () => {
    assert.deepEqual(sortRoles(roles).map((r) => r.key), ['customer', 'editor', 'moderator', 'super_admin']);
  });

  it('does not mutate its input', () => {
    const copy = [...roles];
    sortRoles(roles);
    assert.deepEqual(roles, copy);
  });
});

describe('filterPermissions', () => {
  it('ANDs domain, risk and search', () => {
    assert.equal(filterPermissions(perms).length, 4);
    assert.deepEqual(filterPermissions(perms, { domain: 'catalog' }).map((p) => p.key), ['catalog.product.view', 'catalog.product.delete']);
    assert.deepEqual(filterPermissions(perms, { domain: 'catalog', risk: 'CRITICAL' }).map((p) => p.key), ['catalog.product.delete']);
    assert.deepEqual(filterPermissions(perms, { risk: 'HIGH', query: 'payout' }).map((p) => p.key), ['finance.payout.approve']);
    assert.equal(filterPermissions(perms, { domain: 'finance', query: 'catalog' }).length, 0);
  });

  it('searches label, key and plain description, ignoring case and padding', () => {
    assert.equal(filterPermissions(perms, { query: '  DELETE ' }).length, 1);
    assert.equal(filterPermissions(perms, { query: 'saler.store' }).length, 1);
    assert.equal(filterPermissions(perms, { query: 'BROWSE' }).length, 1);
  });
});

describe('domains', () => {
  it('lists domains present in the data, known ones in catalog order and unknown ones last', () => {
    const list = listDomains([...perms, { key: 'zz.new', domain: 'zeta' }, { key: 'aa.new', domain: 'alpha' }]);
    assert.deepEqual(list.map((d) => d.key), ['catalog', 'finance', 'saler', 'alpha', 'zeta']);
    assert.equal(list[0].count, 2);
  });

  it('groups permissions in the same order', () => {
    assert.deepEqual(groupByDomain(perms).map(([d]) => d), ['catalog', 'finance', 'saler']);
  });
});

describe('countHeldByRole', () => {
  it('counts against the whole catalog and ignores keys that no longer exist', () => {
    const held = buildHeldIndex([
      { role_id: 3, permission_key: 'catalog.product.view' },
      { role_id: 3, permission_key: 'retired.permission' },
    ]);
    assert.equal(countHeldByRole(roles, perms, held).get(3), 1);
    assert.equal(countHeldByRole(roles, perms, held).get(1), 0);
  });
});

describe('real catalog', () => {
  const body = adminHandlers.find((h) => h.method === 'GET' && h.path === '/admin/roles-permissions').handler({}).body;
  const held = buildHeldIndex(body.rolePermissions);

  it('the dev mock serves the whole catalog, not a hand-typed sample', () => {
    assert.equal(body.permissions.length, catalog.permissions.length);
    assert.equal(body.roles.length, catalog.roles.length);
    assert.ok(body.rolePermissions.every((rp) => rp.role_id !== undefined), 'every default_roles entry resolves to a role id');
  });

  it('Super Admin holds its default set, which is a strict subset of the catalog', () => {
    const superAdmin = body.roles.find((r) => r.key === 'super_admin');
    const total = countHeldByRole(body.roles, body.permissions, held).get(superAdmin.id);
    assert.equal(total, catalog.permissions.filter((p) => p.default_roles.includes('super_admin')).length);
    assert.ok(total < catalog.permissions.length);
  });

  it('every CRITICAL permission renders as a lock for every role but Super Admin', () => {
    for (const perm of body.permissions.filter((p) => p.risk_tier === 'CRITICAL')) {
      for (const role of body.roles.filter((r) => r.key !== 'super_admin')) {
        assert.equal(cellState(role, perm, held), 'locked', `${role.key} / ${perm.key}`);
      }
    }
  });

  it('every domain in the catalog has a label in both languages', () => {
    for (const { key } of listDomains(catalog.permissions)) {
      assert.ok(en.perm_matrix[`domain_${key}`], `en.json perm_matrix.domain_${key}`);
      assert.ok(bn.perm_matrix[`domain_${key}`], `bn.json perm_matrix.domain_${key}`);
    }
  });

  it('perm_matrix strings exist in both languages', () => {
    assert.deepEqual(Object.keys(en.perm_matrix).sort(), Object.keys(bn.perm_matrix).sort());
  });
});
