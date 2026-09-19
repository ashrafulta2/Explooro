/**
 * adminStaffPage.test.js — Staff Management page: mock-API invariants + locale coverage.
 *
 * The mock roster is stateful and enforces the rules the real endpoint must, so the invariants
 * are asserted against it: the last Super Admin cannot be demoted or suspended, every write
 * needs a reason for the audit log, and contact details are unique.
 *
 * The mock is also held to the REAL API's contract (server/src/services/staff.service.js, asserted
 * against PostgreSQL in server/test/staffManagement.test.js): validation is HTTP 400, refusals use
 * the closed code enum with the reason in `details.reason`, phones are E.164. A mock that answers
 * differently from the live endpoint lets a page pass in development and break in production.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleMockRequest } from '../src/mocks/index.js';
import { describeWriteOutcome } from '../src/services/writeOutcome.js';
import { normaliseBdPhone } from '../src/services/format.js';
import enDict from '../src/locales/en.json' with { type: 'json' };
import bnDict from '../src/locales/bn.json' with { type: 'json' };

const call = (method, path, body, query) => handleMockRequest({ method, path, body, query });
const list = (query = {}) => call('GET', '/admin/staff', undefined, { limit: 50, ...query }).body;
const find = (ref) => list().staff.find((s) => s.ref === ref);

const valid = (over = {}) => ({
  full_name: 'Mahfuzur Rahman',
  email: 'mahfuz@explooro.com',
  phone: '01799000111',
  role_key: 'moderator',
  department: 'Compliance',
  ...over,
});

describe('Staff Management — mock API invariants', () => {
  it('1. list is paginated and vitals describe the whole roster, not the filtered slice', () => {
    const page = call('GET', '/admin/staff', undefined, { limit: 2, page: 1 }).body;
    assert.equal(page.staff.length, 2);
    assert.ok(page.total_pages >= 2);

    const filtered = call('GET', '/admin/staff', undefined, { q: 'nusrat' }).body;
    assert.equal(filtered.staff.length, 1);
    assert.equal(filtered.vitals.total_staff, list().vitals.total_staff, 'vitals ignore filters');
    assert.ok(filtered.roles.some((r) => r.key === 'super_admin'));
  });

  it('2. provisioning validates every field and reports which one failed', () => {
    const cases = [
      [{ full_name: ' ' }, 'full_name'],
      [{ email: 'not-an-email' }, 'email'],
      [{ phone: '12345' }, 'phone'],
      [{ phone: '01099999999' }, 'phone'], // 010 is not a Bangladeshi mobile prefix
      [{ role_key: 'root' }, 'role_key'],
    ];
    for (const [over, field] of cases) {
      const res = call('POST', '/admin/staff', valid(over));
      assert.equal(res.status, 400, field);
      assert.equal(res.body.error.code, 'VALIDATION_FAILED');
      assert.equal(res.body.error.details.field, field);
      assert.ok(res.body.error.message_en && res.body.error.message_bn, 'both languages');
    }
  });

  it('3. a provisioned member is INVITED with no 2FA, gets the next ref, and can be found', () => {
    const before = list().vitals.total_staff;
    const res = call('POST', '/admin/staff', valid());
    assert.equal(res.status, 201);
    const created = res.body.staff;
    assert.equal(created.status, 'INVITED');
    assert.equal(created.two_factor_enabled, false);
    assert.equal(created.last_active_at, null);
    assert.match(created.ref, /^STF-\d{3}$/);
    assert.equal(list().vitals.total_staff, before + 1);
    assert.equal(call('GET', '/admin/staff', undefined, { q: '01799000111' }).body.staff.length, 1);
  });

  it('4. email and phone are unique (409 on the offending field)', () => {
    const dupEmail = call('POST', '/admin/staff', valid({ email: 'RAHIM.KHAN@explooro.com', phone: '01799000222' }));
    assert.equal(dupEmail.status, 409);
    assert.equal(dupEmail.body.error.details.field, 'email');

    const dupPhone = call('POST', '/admin/staff', valid({ email: 'other@explooro.com', phone: '01711000001' }));
    assert.equal(dupPhone.status, 409);
    assert.equal(dupPhone.body.error.details.field, 'phone');
  });

  it('5. the last active Super Admin can be neither demoted nor suspended', () => {
    const owner = find('STF-001');
    const demote = call('PATCH', `/admin/staff/${owner.id}/role`, { role_key: 'admin', reason: 'test' });
    assert.equal(demote.status, 409);
    assert.equal(demote.body.error.code, 'CONFLICT');
    assert.equal(demote.body.error.details.reason, 'LAST_SUPER_ADMIN');

    const suspend = call('PATCH', `/admin/staff/${owner.id}/status`, { status: 'SUSPENDED', reason: 'test' });
    assert.equal(suspend.status, 409);
    assert.equal(suspend.body.error.code, 'CONFLICT');
    assert.equal(suspend.body.error.details.reason, 'LAST_SUPER_ADMIN');
    assert.equal(find('STF-001').role_key, 'super_admin', 'nothing changed');
  });

  it('6. an INVITED Super Admin cannot stand in for the active owner (only ACTIVE ones count)', () => {
    const second = call('POST', '/admin/staff', valid({ full_name: 'Backup Owner', email: 'backup@explooro.com', phone: '01799000333', role_key: 'super_admin' })).body.staff;
    assert.equal(list().vitals.privileged_roles_count, 1, 'an INVITED super admin is not yet active');

    // The invited backup has never signed in, so the owner is still the only ACTIVE Super Admin.
    const owner = find('STF-001');
    const stillBlocked = call('PATCH', `/admin/staff/${owner.id}/role`, { role_key: 'admin', reason: 'test' });
    assert.equal(stillBlocked.status, 409, 'an invited backup cannot stand in for an active owner');
    assert.ok(second.id);
  });

  it('7. every write needs a reason of at least 3 characters', () => {
    const tariq = find('STF-002');
    for (const [method, path, body] of [
      ['PATCH', `/admin/staff/${tariq.id}/role`, { role_key: 'editor' }],
      ['PATCH', `/admin/staff/${tariq.id}/role`, { role_key: 'editor', reason: 'x' }],
      ['PATCH', `/admin/staff/${tariq.id}/status`, { status: 'SUSPENDED' }],
      ['POST', `/admin/staff/${tariq.id}/reset-2fa`, {}],
    ]) {
      const res = call(method, path, body);
      assert.equal(res.status, 400, `${method} ${path}`);
      assert.equal(res.body.error.details.field, 'reason');
    }
    assert.equal(find('STF-002').role_key, 'moderator');
  });

  it('8. role change: rejects no-ops, applies otherwise, and records before/after in the timeline', () => {
    const nusrat = find('STF-003');
    assert.equal(call('PATCH', `/admin/staff/${nusrat.id}/role`, { role_key: 'editor', reason: 'same' }).status, 400);

    const ok = call('PATCH', `/admin/staff/${nusrat.id}/role`, { role_key: 'moderator', reason: 'Moved to trust & safety' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.staff.role_key, 'moderator');
    assert.equal(ok.body.staff.permissions_count, 24);

    const entry = call('GET', `/admin/staff/${nusrat.id}`).body.activity[0];
    assert.equal(entry.action, 'staff.role.assign');
    assert.deepEqual(entry.before, { role_key: 'editor' });
    assert.deepEqual(entry.after, { role_key: 'moderator' });
    assert.equal(entry.reason, 'Moved to trust & safety');
  });

  it('9. reset 2FA works once; a second attempt has nothing to reset and moves the 2FA vital', () => {
    const kamal = find('STF-004');
    const before = list().vitals.two_factor_rate_pct;
    assert.equal(call('POST', `/admin/staff/${kamal.id}/reset-2fa`, { reason: 'Lost phone' }).status, 200);
    assert.ok(list().vitals.two_factor_rate_pct < before);
    const again = call('POST', `/admin/staff/${kamal.id}/reset-2fa`, { reason: 'Again' });
    assert.deepEqual([again.status, again.body.error.code, again.body.error.details.reason], [409, 'CONFLICT', 'NOTHING_TO_RESET']);
    assert.equal(list({ two_factor: 'PENDING' }).staff.some((s) => s.ref === 'STF-004'), true);
  });

  it('10. suspend / reactivate, and a never-signed-in member returns to INVITED, not ACTIVE', () => {
    const invited = call('POST', '/admin/staff', valid({ email: 'fresh@explooro.com', phone: '01799000444' })).body.staff;
    assert.equal(call('PATCH', `/admin/staff/${invited.id}/status`, { status: 'ACTIVE', reason: 'nope' }).status, 409, 'only suspended can be reactivated');
    assert.equal(call('PATCH', `/admin/staff/${invited.id}/status`, { status: 'SUSPENDED', reason: 'Offer withdrawn' }).body.staff.status, 'SUSPENDED');
    assert.equal(call('PATCH', `/admin/staff/${invited.id}/status`, { status: 'SUSPENDED', reason: 'again' }).status, 409);
    assert.equal(call('PATCH', `/admin/staff/${invited.id}/status`, { status: 'ACTIVE', reason: 'Reinstated' }).body.staff.status, 'INVITED');

    const tariq = find('STF-002');
    call('PATCH', `/admin/staff/${tariq.id}/status`, { status: 'SUSPENDED', reason: 'Investigation' });
    assert.equal(call('PATCH', `/admin/staff/${tariq.id}/status`, { status: 'ACTIVE', reason: 'Cleared' }).body.staff.status, 'ACTIVE');
  });

  it('11. resend-invite only applies to members who have not signed in', () => {
    const invited = list({ status: 'INVITED' }).staff[0];
    assert.equal(call('POST', `/admin/staff/${invited.id}/resend-invite`, {}).status, 200);
    const notInvited = call('POST', `/admin/staff/${find('STF-001').id}/resend-invite`, {});
    assert.deepEqual([notInvited.status, notInvited.body.error.details.reason], [409, 'NOT_INVITED']);
  });

  it('12. unknown ids answer 404 with both languages', () => {
    for (const [method, path, body] of [
      ['GET', '/admin/staff/99999'],
      ['PATCH', '/admin/staff/99999/role', { role_key: 'editor', reason: 'abc' }],
      ['POST', '/admin/staff/99999/reset-2fa', { reason: 'abc' }],
    ]) {
      const res = call(method, path, body);
      assert.equal(res.status, 404);
      assert.ok(res.body.error.message_bn);
    }
  });
});

describe('Staff Management — mock matches the live API contract', () => {
  // The same lists the server integration test asserts.
  const STAFF_KEYS = ['created_at', 'department', 'email', 'full_name', 'id', 'last_active_at', 'permissions_count', 'phone', 'ref', 'role_key', 'role_label_bn', 'role_label_en', 'status', 'two_factor_enabled'];
  const VITAL_KEYS = ['active_staff', 'invited_staff', 'privileged_roles_count', 'total_staff', 'two_factor_pending', 'two_factor_rate_pct'];
  const ROLE_KEYS = ['description_bn', 'description_en', 'key', 'label_bn', 'label_en', 'permissions_count', 'privileged'];

  const provision = (over = {}) =>
    call('POST', '/admin/staff', valid({ email: `p${Math.random().toString(36).slice(2, 8)}@explooro.com`, phone: `018${Math.floor(1e7 + Math.random() * 9e7)}`, ...over }));

  it('17. rows, roles and vitals carry exactly the fields the server sends', () => {
    const body = list();
    assert.deepEqual(Object.keys(body.staff[0]).sort(), STAFF_KEYS);
    assert.deepEqual(Object.keys(body.vitals).sort(), VITAL_KEYS);
    assert.deepEqual(Object.keys(body.roles[0]).sort(), ROLE_KEYS);
    assert.deepEqual(Object.keys(body).sort(), ['limit', 'page', 'roles', 'staff', 'total', 'total_pages', 'vitals']);
  });

  it('18. phones are E.164 like the server stores them, and every spelling finds — and collides with — the same person', () => {
    const created = provision({ phone: '01799765432' }).body.staff;
    assert.equal(created.phone, '+8801799765432');
    for (const q of ['01799765432', '+8801799765432', '8801799765432', '1799765432', '9976543']) {
      assert.ok(call('GET', '/admin/staff', undefined, { q }).body.staff.some((s) => s.id === created.id), q);
    }
    for (const phone of ['01799765432', '+8801799765432', '8801799765432']) {
      const dup = provision({ phone });
      assert.deepEqual([dup.status, dup.body.error.code, dup.body.error.details.field], [409, 'CONFLICT', 'phone'], phone);
    }
  });

  it('19. a blank department is null (the page shows a dash), not an invented "Operations"', () => {
    assert.equal(provision({ department: '   ' }).body.staff.department, null);
  });

  it('20. the invitation copy tells the truth: an email, then an OTP to the mobile — no sign-in link', () => {
    const out = provision().body;
    assert.equal(out.invite_sent, true);
    assert.match(out.message_en, /invitation was emailed/i);
    assert.match(out.message_en, /one-time code/i);
    assert.doesNotMatch(`${out.message_en} ${out.message_bn}`, /link|লিংক/i);
    const invited = list({ status: 'INVITED' }).staff[0];
    const resent = call('POST', `/admin/staff/${invited.id}/resend-invite`, {}).body;
    assert.doesNotMatch(`${resent.message_en} ${resent.message_bn}`, /link|লিংক/i);
    for (const dictionary of [enDict, bnDict]) {
      assert.doesNotMatch(dictionary.admin.staff.modal_desc, /link|লিংক/i, 'the modal must not promise a link either');
    }
  });

  it('21. every refusal uses a code from the closed enum, with the business reason in details.reason', () => {
    const CLOSED = new Set(['VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN']);
    const member = provision().body.staff;
    call('PATCH', `/admin/staff/${member.id}/status`, { status: 'SUSPENDED', reason: 'testing' });
    const refusals = [
      [call('PATCH', `/admin/staff/${member.id}/status`, { status: 'SUSPENDED', reason: 'again' }), 'ALREADY_SUSPENDED'],
      [call('PATCH', `/admin/staff/${find('STF-003').id}/status`, { status: 'ACTIVE', reason: 'not suspended' }), 'NOT_SUSPENDED'],
    ];
    for (const [res, reason] of refusals) {
      assert.equal(res.status, 409);
      assert.ok(CLOSED.has(res.body.error.code), res.body.error.code);
      assert.equal(res.body.error.details.reason, reason);
      assert.ok(res.body.error.message_en && res.body.error.message_bn);
    }
  });
});

describe('describeWriteOutcome — a 202 deferral is not a success', () => {
  const deferred = { deferred: { code: 'PERMISSION_PENDING_APPROVAL', message_en: 'Sent for approval.', message_bn: 'অনুমোদনের জন্য পাঠানো হয়েছে।' } };

  it('22. a deferred reply is flagged so the page does not toast success or reload', () => {
    assert.deepEqual(describeWriteOutcome(deferred, { fallback: 'done' }), { deferred: true, message: 'Sent for approval.' });
    assert.equal(describeWriteOutcome(deferred, { bn: true }).message, 'অনুমোদনের জন্য পাঠানো হয়েছে।');
    assert.equal(describeWriteOutcome({ deferred: {} }, { deferredFallback: 'Waiting.' }).message, 'Waiting.', 'falls back when the server sent no text');
  });

  it('23. a completed write reads the server message in the active language, else the fallback', () => {
    const res = { message_en: 'Role updated.', message_bn: 'রোল আপডেট হয়েছে।' };
    assert.deepEqual(describeWriteOutcome(res, { fallback: 'x' }), { deferred: false, message: 'Role updated.' });
    assert.equal(describeWriteOutcome(res, { bn: true }).message, 'রোল আপডেট হয়েছে।');
    assert.equal(describeWriteOutcome({}, { fallback: 'Saved.' }).message, 'Saved.');
    assert.equal(describeWriteOutcome(undefined, { fallback: 'Saved.' }).deferred, false);
  });

  it('24. the page reads every write through it and warns when the invitation email failed', () => {
    const page = readFileSync(new URL('../src/pages/admin/StaffPage.js', import.meta.url), 'utf8');
    assert.match(page, /describeWriteOutcome\(res/);
    assert.match(page, /outcome\.deferred/);
    assert.match(page, /invite_sent === false\) toast\.warning/);
    assert.ok(enDict.admin.staff.toast_deferred && bnDict.admin.staff.toast_deferred);
  });
});

describe('normaliseBdPhone — the form accepts what the API accepts', () => {
  it('25. every common spelling of one mobile becomes the same E.164 number; non-mobiles are refused', () => {
    for (const ok of ['01811000003', '8801811000003', '+8801811000003', '+880 1811-000003', '(0181) 1000003', ' 01811000003 ']) {
      assert.equal(normaliseBdPhone(ok), '+8801811000003', ok);
    }
    for (const bad of ['', null, undefined, '0181100000', '018110000033', '01211000003', '+911811000003', 'abcdefghijk']) {
      assert.equal(normaliseBdPhone(bad), null, String(bad));
    }
  });
});

describe('Staff Management — page source & locales', () => {
  const source = readFileSync(new URL('../src/pages/admin/StaffPage.js', import.meta.url), 'utf8');

  it('13. every admin.staff key the page uses exists in both languages', () => {
    const used = new Set();
    for (const m of source.matchAll(/\bt\(\s*['`]admin\.staff\.([^'`$]+)['`]/g)) used.add(m[1]);
    for (const m of source.matchAll(/\['(admin\.staff\.[a-z_0-9]+)'/g)) used.add(m[1].replace('admin.staff.', ''));
    for (const k of ['status_active', 'status_invited', 'status_suspended']) used.add(k);
    assert.ok(used.size > 60, 'sanity: the scan found the page keys');

    for (const key of used) {
      assert.ok(typeof enDict.admin.staff[key] === 'string' && enDict.admin.staff[key], `en.admin.staff.${key}`);
      assert.ok(typeof bnDict.admin.staff[key] === 'string' && bnDict.admin.staff[key], `bn.admin.staff.${key}`);
    }
    assert.deepEqual(Object.keys(enDict.admin.staff).sort(), Object.keys(bnDict.admin.staff).sort(), 'en/bn parity');
  });

  it('14. placeholders match between en and bn', () => {
    for (const [key, en] of Object.entries(enDict.admin.staff)) {
      const tokens = (s) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(tokens(bnDict.admin.staff[key]), tokens(en), `placeholders in ${key}`);
    }
  });

  it('15. no native confirm()/prompt() dialogs and no fabricated fallback roster', () => {
    assert.doesNotMatch(source, /\b(?:window\.)?(?:confirm|prompt|alert)\(/);
    assert.doesNotMatch(source, /Rahim Khan|STF-00\d/);
  });

  it('16. user-supplied text is escaped before it reaches innerHTML', () => {
    for (const field of ['s.full_name', 's.email', 's.ref', 's.department']) {
      const raw = new RegExp(`\\$\\{${field.replace('.', '\\.')}\\}`);
      assert.doesNotMatch(source, raw, `${field} must go through escapeHtml`);
    }
  });
});
