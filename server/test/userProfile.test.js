/**
 * userProfile.test.js — Self-service profile (GET/PUT /api/v1/me/profile).
 *
 * Locks the four rules that make this endpoint safe to expose to every signed-in user, since it is
 * the only write surface in the app whose subject is the caller themselves:
 *   1. The payload cannot widen its own scope — phone, status, id and roles are dropped, not honoured.
 *   2. Changing the email clears `is_email_verified`; leaving it alone does not touch the column.
 *   3. Birth dates are validated against the real calendar and the platform's minimum age, and
 *      stored encrypted rather than in plain text.
 *   4. The write runs in one transaction and leaves an audit row.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import meRoutes from '../src/routes/me.routes.js';
import * as profileService from '../src/services/profile.service.js';
import * as userRepo from '../src/repositories/user.repository.js';
import { decryptField } from '../src/lib/encryption.js';

// 32 zero bytes, base64 — a valid AES-256 key shape for lib/encryption.js.
const TEST_CONFIG = { auth: { piiEncryptionKey: Buffer.alloc(32).toString('base64') } };

const USER_ID = 42;

const PROFILE_ROW = (over = {}) => ({
  id: USER_ID,
  ref: 'USR-7K2M9QX4',
  phone: '+8801711223344',
  email: 'fatema@example.com',
  is_phone_verified: true,
  is_email_verified: true,
  status: 'ACTIVE',
  locale: 'bn',
  ui_mode: 'simple',
  last_login_at: '2026-09-09T10:00:00.000Z',
  created_at: '2026-02-01T09:00:00.000Z',
  profile_updated_at: null,
  full_name: 'Fatema Begum',
  display_name: 'Fatema',
  avatar_media_id: null,
  avatar_storage_key: null,
  date_of_birth: null,
  gender: 'FEMALE',
  division: 'dhaka',
  district: 'dhaka_city',
  upazila: 'Dhanmondi',
  address_line: 'House 42, Road 7/A',
  postal_code: '1205',
  bio: '',
  timezone: 'Asia/Dhaka',
  use_bengali_numerals: true,
  ...over,
});

const VALID_PAYLOAD = (over = {}) => ({
  full_name: 'Fatema Begum',
  display_name: 'Fatema',
  gender: 'FEMALE',
  email: 'fatema@example.com',
  division: 'dhaka',
  district: 'dhaka_city',
  upazila: 'Dhanmondi',
  address_line: 'House 42, Road 7/A',
  postal_code: '1205',
  bio: '',
  timezone: 'Asia/Dhaka',
  locale: 'bn',
  ui_mode: 'simple',
  use_bengali_numerals: true,
  ...over,
});

/**
 * Mock pool whose `.connect()` shares the queryHandler, so `withTransaction()` runs its real
 * BEGIN/COMMIT path. `calls` records `{ sql, params }` in order.
 */
function createMockDb({ profileRow = PROFILE_ROW(), emailTaken = false, avatarAsset = null } = {}) {
  const calls = [];

  async function query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql: normalized, params });

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
    if (/FROM users u LEFT JOIN user_profiles/i.test(normalized)) return { rows: [profileRow] };
    if (/FROM user_roles|JOIN roles/i.test(normalized)) return { rows: [{ key: 'customer' }] };
    if (/SELECT 1 FROM users WHERE LOWER\(email\)/i.test(normalized)) {
      return { rows: emailTaken ? [{ '?column?': 1 }] : [] };
    }
    if (/FROM media_assets/i.test(normalized)) return { rows: avatarAsset ? [avatarAsset] : [] };
    return { rows: [] };
  }

  const db = { query, calls };
  db.connect = async () => ({ query, release: () => {} });
  return db;
}

const findCall = (db, re) => db.calls.find((c) => re.test(c.sql));

describe('Profile payload validation (buildProfileUpdate)', () => {
  test('splits the payload into user_profiles and users column sets', () => {
    const { profile, account } = profileService.buildProfileUpdate(VALID_PAYLOAD());
    assert.equal(profile.full_name, 'Fatema Begum');
    assert.equal(profile.division, 'dhaka');
    assert.equal(account.locale, 'bn');
    assert.equal(account.ui_mode, 'simple');
    assert.equal(account.email, 'fatema@example.com');
  });

  test('Rule 1: privilege-shaped fields in the payload are dropped, not written', () => {
    const { profile, account } = profileService.buildProfileUpdate(
      VALID_PAYLOAD({
        phone: '+8801999999999',
        status: 'BANNED',
        id: 1,
        roles: ['super_admin'],
        is_email_verified: true,
        password_hash: 'x',
      })
    );
    const written = { ...profile, ...account };
    for (const forbidden of ['phone', 'status', 'id', 'roles', 'password_hash']) {
      assert.ok(!(forbidden in written), `${forbidden} must never reach the repository`);
    }
    // is_email_verified is a users column, but only updateMyProfile may set it — never the caller.
    assert.ok(!('is_email_verified' in account));
  });

  test('the repository whitelists match what the validator can produce', () => {
    const { profile, account } = profileService.buildProfileUpdate(
      VALID_PAYLOAD({ date_of_birth: '1995-06-15', avatar_media_id: 7 })
    );
    for (const key of Object.keys(profile)) {
      assert.ok(userRepo.SELF_PROFILE_COLUMNS.includes(key), `${key} is not a writable profile column`);
    }
    for (const key of Object.keys(account)) {
      assert.ok(userRepo.SELF_ACCOUNT_COLUMNS.includes(key), `${key} is not a writable account column`);
    }
  });

  test('full name is required', () => {
    assert.throws(
      () => profileService.buildProfileUpdate(VALID_PAYLOAD({ full_name: '   ' })),
      (err) => err.code === 'VALIDATION_FAILED' && err.details?.field === 'full_name'
    );
  });

  test('an empty display name falls back to the full name', () => {
    const { profile } = profileService.buildProfileUpdate(VALID_PAYLOAD({ display_name: '' }));
    assert.equal(profile.display_name, 'Fatema Begum');
  });

  test('whitespace is collapsed rather than stored verbatim', () => {
    const { profile } = profileService.buildProfileUpdate(
      VALID_PAYLOAD({ full_name: '  Fatema   Begum  ' })
    );
    assert.equal(profile.full_name, 'Fatema Begum');
  });

  test('gender is restricted to the column CHECK constraint', () => {
    assert.equal(profileService.buildProfileUpdate(VALID_PAYLOAD({ gender: 'female' })).profile.gender, 'FEMALE');
    assert.throws(
      () => profileService.buildProfileUpdate(VALID_PAYLOAD({ gender: 'ROBOT' })),
      (err) => err.details?.field === 'gender'
    );
  });

  test('locale and ui_mode are restricted to their CHECK constraints', () => {
    assert.throws(() => profileService.buildProfileUpdate(VALID_PAYLOAD({ locale: 'fr' })), /Unsupported language/);
    assert.throws(
      () => profileService.buildProfileUpdate(VALID_PAYLOAD({ ui_mode: 'expert' })),
      /Unsupported interface mode/
    );
  });

  test('a Bangladeshi postal code is exactly 4 digits', () => {
    assert.throws(
      () => profileService.buildProfileUpdate(VALID_PAYLOAD({ postal_code: '12' })),
      (err) => err.details?.field === 'postal_code'
    );
    assert.equal(profileService.buildProfileUpdate(VALID_PAYLOAD({ postal_code: '' })).profile.postal_code, null);
  });

  test('a malformed email is rejected and a valid one is lower-cased', () => {
    assert.throws(
      () => profileService.buildProfileUpdate(VALID_PAYLOAD({ email: 'not-an-email' })),
      (err) => err.details?.field === 'email'
    );
    assert.equal(
      profileService.buildProfileUpdate(VALID_PAYLOAD({ email: 'Fatema@Example.COM' })).account.email,
      'fatema@example.com'
    );
  });

  test('an over-length bio is refused rather than silently truncated by Postgres', () => {
    assert.throws(
      () => profileService.buildProfileUpdate(VALID_PAYLOAD({ bio: 'x'.repeat(501) })),
      (err) => err.details?.field === 'bio'
    );
  });

  test('avatar_media_id must be numeric or explicitly cleared', () => {
    assert.equal(profileService.buildProfileUpdate(VALID_PAYLOAD({ avatar_media_id: '7' })).profile.avatar_media_id, 7);
    assert.equal(profileService.buildProfileUpdate(VALID_PAYLOAD({ avatar_media_id: null })).profile.avatar_media_id, null);
    assert.throws(
      () => profileService.buildProfileUpdate(VALID_PAYLOAD({ avatar_media_id: 'DROP TABLE users' })),
      (err) => err.details?.field === 'avatar_media_id'
    );
  });
});

describe('Rule 3: date of birth', () => {
  test('accepts a real past date', () => {
    assert.equal(profileService.normalizeDateOfBirth('1995-06-15'), '1995-06-15');
  });

  test('rejects a date that does not exist on the calendar', () => {
    // `new Date('2025-02-30')` rolls over to 2 March instead of failing, which would silently
    // store a different day than the user typed.
    assert.throws(() => profileService.normalizeDateOfBirth('2025-02-30'), /does not exist/);
  });

  test('rejects a non-ISO format', () => {
    assert.throws(() => profileService.normalizeDateOfBirth('15/06/1995'), /YYYY-MM-DD/);
  });

  test('enforces the platform minimum age', () => {
    const lastYear = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    assert.throws(
      () => profileService.normalizeDateOfBirth(lastYear),
      (err) => err.details?.field === 'date_of_birth'
    );
  });

  test('an empty value clears the field instead of failing', () => {
    assert.equal(profileService.normalizeDateOfBirth(''), null);
    assert.equal(profileService.normalizeDateOfBirth(null), null);
  });
});

describe('updateMyProfile', () => {
  test('Rule 4: writes both tables inside one transaction and records an audit row', async () => {
    const db = createMockDb();
    await profileService.updateMyProfile(db, TEST_CONFIG, USER_ID, VALID_PAYLOAD());

    const order = db.calls.map((c) => c.sql);
    const begin = order.findIndex((s) => /^BEGIN$/i.test(s));
    const commit = order.findIndex((s) => /^COMMIT$/i.test(s));
    const upsert = order.findIndex((s) => /INSERT INTO user_profiles/i.test(s));

    assert.ok(begin >= 0 && commit > begin, 'the write is transactional');
    assert.ok(upsert > begin && upsert < commit, 'the profile upsert runs inside the transaction');
    assert.ok(findCall(db, /INSERT INTO audit_logs/i), 'a state-changing action must be audited');
  });

  test('Rule 2: changing the email clears is_email_verified', async () => {
    const db = createMockDb();
    await profileService.updateMyProfile(
      db,
      TEST_CONFIG,
      USER_ID,
      VALID_PAYLOAD({ email: 'new-address@example.com' })
    );

    const update = findCall(db, /UPDATE users SET/i);
    assert.ok(update, 'the users row is updated');
    assert.match(update.sql, /is_email_verified = /, 'verification is reset alongside the address');
    assert.ok(update.params.includes(false), 'and reset to false, not carried over');
  });

  test('Rule 2: leaving the email unchanged does not touch the verified flag', async () => {
    const db = createMockDb();
    await profileService.updateMyProfile(db, TEST_CONFIG, USER_ID, VALID_PAYLOAD());

    const update = findCall(db, /UPDATE users SET/i);
    assert.ok(update, 'locale/ui_mode still write');
    assert.ok(!/is_email_verified/.test(update.sql), 'an unchanged email must not re-verify or un-verify');
    assert.ok(!/email = /.test(update.sql), 'and must not be rewritten at all');
  });

  test('an email already registered elsewhere is a CONFLICT, not a 500 from the unique index', async () => {
    const db = createMockDb({ emailTaken: true });
    await assert.rejects(
      profileService.updateMyProfile(db, TEST_CONFIG, USER_ID, VALID_PAYLOAD({ email: 'taken@example.com' })),
      (err) => err.code === 'CONFLICT' && err.statusCode === 409
    );
    assert.ok(!findCall(db, /UPDATE users SET/i), 'nothing is written when the check fails');
  });

  test('an avatar the caller does not own is refused', async () => {
    const db = createMockDb({ avatarAsset: null });
    await assert.rejects(
      profileService.updateMyProfile(db, TEST_CONFIG, USER_ID, VALID_PAYLOAD({ avatar_media_id: 999 })),
      (err) => err.code === 'VALIDATION_FAILED' && err.details?.field === 'avatar_media_id'
    );
  });

  test('Rule 3: the birth date is stored encrypted and reads back decrypted', async () => {
    const db = createMockDb();
    await profileService.updateMyProfile(
      db,
      TEST_CONFIG,
      USER_ID,
      VALID_PAYLOAD({ date_of_birth: '1995-06-15' })
    );

    const upsert = findCall(db, /INSERT INTO user_profiles/i);
    const stored = upsert.params.find((p) => typeof p === 'string' && p !== '1995-06-15' && p.length > 40);
    assert.ok(stored, 'a ciphertext parameter is written');
    assert.ok(!upsert.params.includes('1995-06-15'), 'the plain date never reaches the column');
    assert.equal(decryptField(stored, TEST_CONFIG.auth.piiEncryptionKey), '1995-06-15');
  });

  test('a profile with a ciphertext from a rotated key still loads', async () => {
    // A 500 on the whole page is a worse outcome than one field reading as "not set".
    const db = createMockDb({ profileRow: PROFILE_ROW({ date_of_birth: 'not-valid-ciphertext' }) });
    const profile = await profileService.getMyProfile(db, TEST_CONFIG, USER_ID);
    assert.equal(profile.date_of_birth, null);
    assert.equal(profile.full_name, 'Fatema Begum');
  });

  test('a missing account is a 404, not an empty profile', async () => {
    const db = createMockDb();
    db.query = async () => ({ rows: [] });
    await assert.rejects(
      profileService.getMyProfile(db, TEST_CONFIG, USER_ID),
      (err) => err.code === 'NOT_FOUND'
    );
  });
});

describe('HTTP surface', () => {
  async function buildApp(db) {
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    app.decorate('db', db);
    app.decorate('config', TEST_CONFIG);
    app.decorate('authenticate', async (req) => {
      req.user = { id: USER_ID, roles: ['customer'] };
    });
    await app.register(meRoutes, { prefix: '/api/v1/me' });
    await app.ready();
    return app;
  }

  test('GET /api/v1/me/profile returns the caller own record', async () => {
    const app = await buildApp(createMockDb());
    const res = await app.inject({ method: 'GET', url: '/api/v1/me/profile' });
    assert.equal(res.statusCode, 200);
    const { data } = res.json();
    assert.equal(data.ref, 'USR-7K2M9QX4');
    assert.equal(data.full_name, 'Fatema Begum');
    assert.deepEqual(data.roles, [{ key: 'customer' }]);
    await app.close();
  });

  test('PUT /api/v1/me/profile saves and echoes the updated record', async () => {
    const app = await buildApp(createMockDb());
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/profile',
      payload: VALID_PAYLOAD({ full_name: 'Fatema Akter Begum' }),
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().data);
    await app.close();
  });

  test('a validation failure comes back as a bilingual 400', async () => {
    const app = await buildApp(createMockDb());
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/profile',
      payload: VALID_PAYLOAD({ full_name: '' }),
    });
    assert.equal(res.statusCode, 400);
    const { error } = res.json();
    assert.equal(error.code, 'VALIDATION_FAILED');
    assert.ok(error.message_en, 'English message');
    assert.ok(error.message_bn, 'Bengali message');
    await app.close();
  });
});
