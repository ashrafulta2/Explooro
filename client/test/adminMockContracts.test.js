/**
 * adminMockContracts.test.js — the admin mock handlers must answer in the shape the pages read
 * and the server actually returns.
 *
 * WHY this file exists: every bug it covers had the same shape and the same non-symptom. A mock
 * fixture used plausible-but-wrong field names (`order_id` for `sub_order_id`, `return_ref` for
 * `ref`, `merchant_name` for `user_full_name`), the page read them as `undefined`, and a template
 * literal rendered the string "undefined" into a table cell. No exception, no failed request, no
 * console warning — the admin surface just quietly displayed nonsense, and in the COD case threw
 * only once the aging matrix tried to read `.couriers.length` off a differently-shaped object.
 *
 * These tests assert the field names, not the values, because the names are the contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import adminHandlers from '../src/mocks/handlers/admin.js';
import { returnHandlers } from '../src/mocks/handlers/returns.js';
import { contentHandlers } from '../src/mocks/handlers/content.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Invokes the first handler registered for `method path`, mirroring handleMockRequest(). */
function call(handlers, method, path, ctx = {}) {
  const entry = handlers.find((h) => h.method === method && h.path === path);
  assert.ok(entry, `no mock handler for ${method} ${path}`);
  const res = entry.handler({ params: {}, query: {}, body: {}, ...ctx });
  return res && res.status !== undefined ? res : { status: 200, body: res };
}

describe('Admin mock handlers match the server contract', () => {
  it('users list and user detail describe the same person', () => {
    const list = call(adminHandlers, 'GET', '/admin/users').body.users;
    assert.ok(list.length > 0);

    for (const row of list) {
      const detail = call(adminHandlers, 'GET', '/admin/users/:id', {
        params: { id: String(row.id) },
      }).body.user;

      // The detail page used to synthesise a user from the numeric id, so clicking row 4 opened
      // "User 4 Demo" at a different ref, email and district than the row showed.
      for (const field of ['ref', 'full_name', 'phone', 'email', 'district', 'role_key', 'status', 'kyc_status']) {
        assert.equal(detail[field], row[field], `user ${row.id}: ${field} disagrees between list and detail`);
      }
    }
  });

  it('user detail exposes roles as an array (UserDetailPage renders one Badge per entry)', () => {
    const detail = call(adminHandlers, 'GET', '/admin/users/:id', { params: { id: '4' } }).body.user;
    assert.ok(Array.isArray(detail.roles) && detail.roles.length > 0, 'roles must be a non-empty array');
    assert.equal(detail.roles[0].key, detail.role_key);
    assert.ok(detail.roles[0].label_en && detail.roles[0].label_bn, 'each role needs both locale labels');
    // The Profile tab reads these two directly; they were absent entirely before.
    assert.ok(detail.division, 'division is rendered on the Profile tab');
    assert.ok(detail.address_line, 'address_line is rendered on the Profile tab');
  });

  it('an unknown user id 404s instead of rendering a "User NaN" ghost', () => {
    assert.equal(call(adminHandlers, 'GET', '/admin/users/:id', { params: { id: '9999' } }).status, 404);
    assert.equal(call(adminHandlers, 'GET', '/admin/users/:id', { params: { id: 'usr-dev-6' } }).status, 404);
  });

  it('COD aging report has the couriers[] / buckets shape the page destructures', () => {
    const report = call(adminHandlers, 'GET', '/admin/finance/cod/aging').body.data;

    // CodReconciliationPage reads agingData.couriers.length unguarded — a differently shaped
    // object threw "Cannot read properties of undefined (reading 'length')" mid-render.
    assert.ok(Array.isArray(report.couriers), 'couriers must be an array');
    assert.equal(typeof report.totalUnreconciledPlatform, 'string');

    for (const c of report.couriers) {
      assert.equal(typeof c.totalUnreconciledFormatted, 'string');
      for (const b of ['under3Days', 'days3To7', 'days8To14', 'days15To30', 'over30Days']) {
        assert.ok(c.buckets[b], `missing bucket ${b}`);
        assert.equal(typeof c.buckets[b].amountFormatted, 'string');
        assert.equal(typeof c.buckets[b].count, 'number');
      }
    }
  });

  it('COD reconciliation rows use the cod_reconciliation column names', () => {
    const rows = call(adminHandlers, 'GET', '/admin/finance/cod').body.data.reconciliations;
    assert.ok(rows.length > 0);

    const STATUSES = new Set([
      'PENDING', 'MATCHED', 'SHORT_COLLECTION', 'OVER_COLLECTION', 'MISSING_DEPOSIT',
      'DUPLICATE', 'UNMATCHED_CONSIGNMENT', 'TIMING_DIFFERENCE', 'RESOLVED',
    ]);

    for (const r of rows) {
      for (const field of ['consignment_id', 'courier', 'expected_amount', 'courier_reported', 'deposit_received', 'variance', 'status']) {
        assert.ok(field in r, `row ${r.id} missing ${field}`);
      }
      assert.ok(STATUSES.has(r.status), `row ${r.id}: "${r.status}" is not a cod_reconciliation status`);
    }
  });

  it('payout rows use payout_requests columns and its CHECK vocabularies', () => {
    const rows = call(adminHandlers, 'GET', '/admin/finance/payouts', { query: { status: 'ALL' } })
      .body.data.payouts;
    assert.ok(rows.length > 0);

    const METHODS = new Set(['BKASH', 'NAGAD', 'ROCKET', 'BANK']);
    const STATUSES = new Set(['REQUESTED', 'HELD', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED']);

    for (const p of rows) {
      // PayoutQueuePage renders p.ref and p.user_full_name; both were absent, so the reference
      // column read "undefined" and the recipient fell back to "User #<id>".
      for (const field of ['ref', 'user_full_name', 'user_ref', 'user_phone', 'amount', 'fee_amount', 'risk_flags_json']) {
        assert.ok(field in p, `payout ${p.id} missing ${field}`);
      }
      assert.ok(Array.isArray(p.risk_flags_json), 'risk_flags_json must be an array');
      assert.ok(METHODS.has(p.method), `payout ${p.id}: "${p.method}" is not a payout method`);
      assert.ok(STATUSES.has(p.status), `payout ${p.id}: "${p.status}" is not a payout status`);
    }
  });

  it('return claims use return_requests columns and its reason_code vocabulary', () => {
    const rows = call(returnHandlers, 'GET', '/admin/returns/queue', { query: { status: 'ALL' } })
      .body.data.returns;
    assert.ok(rows.length > 0);

    const REASONS = new Set(['DAMAGED', 'WRONG_ITEM', 'DEFECTIVE', 'SIZE_MISMATCH', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER']);

    for (const r of rows) {
      for (const field of ['ref', 'sub_order_id', 'reason_code', 'evidence_urls_json', 'refund_amount']) {
        assert.ok(field in r, `return ${r.id} missing ${field}`);
      }
      assert.ok(Array.isArray(r.evidence_urls_json), 'evidence_urls_json must be an array');
      assert.ok(REASONS.has(r.reason_code), `return ${r.ref}: "${r.reason_code}" is not a return_requests reason_code`);
    }
  });

  it('dynamic translations are nested locale -> namespace -> key', () => {
    // TranslationManagerPage.renderTable() skips any namespace whose value is not an object, so a
    // flat map renders an empty table under a header claiming hundreds of translated keys.
    const { locales } = call(contentHandlers, 'GET', '/editor/translations/completeness').body.data;

    for (const { locale } of locales) {
      const data = call(contentHandlers, 'GET', '/editor/translations/:locale', { params: { locale } }).body.data;
      const namespaces = Object.values(data);
      assert.ok(namespaces.length > 0, `locale ${locale} has no namespaces`);
      assert.ok(
        namespaces.every((ns) => ns && typeof ns === 'object' && !Array.isArray(ns)),
        `locale ${locale} must be nested by namespace, not a flat key -> string map`
      );
    }
  });
});

describe('Mock routes are not shadowed by a second declaration', () => {
  it('no method+path is declared in two handler files', () => {
    // mocks/index.js spreads the handler arrays in order and handleMockRequest() returns the
    // FIRST match, so a duplicate silently wins over — or loses to — the other and the two drift.
    // admin.js used to redeclare all four /admin/returns/* routes returns.js owns.
    const dir = join(root, 'src/mocks/handlers');
    const pattern = /method: '(\w+)',\s*\n\s*path: '([^']+)'/g;
    const seen = new Map();
    const dupes = [];

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const src = readFileSync(join(dir, file), 'utf8');
      for (const m of src.matchAll(pattern)) {
        const key = `${m[1]} ${m[2]}`;
        if (seen.has(key) && seen.get(key) !== file) {
          dupes.push(`${key} — declared in both ${seen.get(key)} and ${file}`);
        }
        seen.set(key, file);
      }
    }

    assert.deepEqual(dupes, [], `Duplicate mock routes across files:\n  ${dupes.join('\n  ')}`);
  });
});

describe('CSS custom properties referenced by the client actually exist', () => {
  /** Every `.js` / `.css` file under client/src, as [relative path, contents]. */
  function sourceFiles() {
    const out = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|css)$/.test(entry.name)) {
          out.push([full.replace(root, '').replace(/\\/g, '/'), readFileSync(full, 'utf8')]);
        }
      }
    };
    walk(join(root, 'src'));
    return out;
  }

  it('no declaration references a custom property that is never defined', () => {
    // WHY this is worth a test: `color: var(--status-success)` where --status-success does not
    // exist is not an error anywhere. CSS throws out the whole declaration and the element
    // silently inherits, so the Staff page's "active staff" (green) and "privileged roles" (red)
    // vitals rendered in identical grey, and `font-size: var(--font-size-xs)` rendered the
    // inherited 15px where 11px was meant. Nothing in the build, the console, or the network tab
    // reports it — only a person noticing the design looks slightly wrong.
    //
    // A whole parallel naming scheme had accumulated this way (--brand-primary, --color-border,
    // --surface-card, --shadow-sm, --weight-bold, --radius-2xl, --duration-fast); this asserts it
    // cannot come back. Uses that carry a fallback are allowed: `var(--tb-h, 56px)` and
    // `var(--sidebar-bg, var(--surface-1))` are the deliberate pattern for properties pinned at
    // runtime by the topbar's scroll-shrink and Theme Studio's section overrides, where the
    // fallback IS the resting value.
    const DEFINITION = /(--[A-Za-z0-9_-]+)\s*:/g;
    const SET_PROPERTY = /setProperty\(\s*['"](--[A-Za-z0-9_-]+)/g;
    const USE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g;

    const files = sourceFiles();
    const defined = new Set();
    for (const [path, src] of files) {
      if (path.endsWith('.css')) for (const m of src.matchAll(DEFINITION)) defined.add(m[1]);
      for (const m of src.matchAll(SET_PROPERTY)) defined.add(m[1]);
    }

    const offenders = [];
    for (const [path, src] of files) {
      for (const m of src.matchAll(USE)) {
        const [name, hasFallback] = [m[1], Boolean(m[2])];
        if (hasFallback || defined.has(name)) continue;
        // colorRamp.js writes `var(--brand-${step})`: the literal is a prefix, not a token name.
        if (src.startsWith('${', m.index + m[0].indexOf(name) + name.length)) continue;
        offenders.push(`${name} — ${path}`);
      }
    }

    assert.deepEqual(
      [...new Set(offenders)].sort(),
      [],
      'These reference a custom property no stylesheet defines, so the declaration is dropped ' +
        'and the value silently inherits. Map it onto a real token from styles/tokens.css or ' +
        'styles/themes.css (or give it a fallback if it is pinned at runtime):\n  ' +
        [...new Set(offenders)].sort().join('\n  ')
    );
  });

  it('font-weight is only ever set from the weight axis or a type step', () => {
    // design-system.md §3.2 gives every size step a default weight and §3.4 requires hierarchy to
    // vary weight independently of size, so tokens.css declares both --weight-<step> and the
    // named axis. Reaching past them re-hardcodes a value the master theme cannot retune.
    const offenders = [];
    for (const [path, src] of sourceFiles()) {
      for (const m of src.matchAll(/font-weight:\s*var\(\s*(--[A-Za-z0-9_-]+)/g)) {
        if (!/^--weight-(regular|medium|semibold|bold|2xs|xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)$/.test(m[1])) {
          offenders.push(`${m[1]} — ${path}`);
        }
      }
    }
    assert.deepEqual([...new Set(offenders)].sort(), [], offenders.join('\n  '));
  });
});
