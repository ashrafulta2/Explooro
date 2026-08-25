/**
 * authEmailAndPhone.test.js — Dual Mobile Number and Email Address Registration & Auth Unit Tests
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import * as authService from '../src/services/auth.service.js';
import * as otpService from '../src/services/otp.service.js';
import * as userRepo from '../src/repositories/user.repository.js';
import { getSentEmails, clearSentEmails } from '../src/integrations/email/mock.js';

// In-memory mock database implementation for testing
class MockDb {
  constructor() {
    this.users = [];
    this.profiles = [];
    this.roles = [
      { id: 1, key: 'customer', label_en: 'Customer', label_bn: 'ক্রেতা', level: 10 },
      { id: 2, key: 'saler', label_en: 'Saler', label_bn: 'সেলার', level: 20 },
      { id: 3, key: 'supplier', label_en: 'Supplier', label_bn: 'সাপ্লায়ার', level: 30 },
    ];
    this.userRoles = [];
    this.otpCodes = [];
    this.auditLogs = [];
    this.sessions = [];
    this.refreshTokens = [];
  }

  async query(sql, params = []) {
    const s = sql.trim();

    // INSERT INTO users
    if (s.startsWith('INSERT INTO users')) {
      const id = this.users.length + 1;
      const [ref, phone, email, password_hash, is_phone_verified, is_email_verified] = params;
      const row = {
        id,
        ref,
        phone: phone || null,
        email: email || null,
        password_hash: password_hash || null,
        is_phone_verified: is_phone_verified ?? false,
        is_email_verified: is_email_verified ?? false,
        status: 'ACTIVE',
        locale: 'bn',
        ui_mode: 'simple',
        created_at: new Date(),
        deleted_at: null,
      };
      this.users.push(row);
      return { rows: [row] };
    }

    // SELECT FROM users WHERE phone = $1
    if (s.includes('FROM users WHERE phone = $1')) {
      const phone = params[0];
      const match = this.users.find((u) => u.phone === phone && !u.deleted_at);
      return { rows: match ? [match] : [] };
    }

    // SELECT FROM users WHERE LOWER(email) = LOWER($1)
    if (s.includes('FROM users WHERE LOWER(email) = LOWER($1)')) {
      const email = params[0];
      const match = this.users.find(
        (u) => u.email && u.email.toLowerCase() === email.toLowerCase() && !u.deleted_at
      );
      return { rows: match ? [match] : [] };
    }

    // SELECT FROM users WHERE id = $1
    if (s.includes('FROM users WHERE id = $1')) {
      const id = params[0];
      const match = this.users.find((u) => u.id === Number(id) && !u.deleted_at);
      return { rows: match ? [match] : [] };
    }

    // INSERT INTO user_profiles
    if (s.startsWith('INSERT INTO user_profiles')) {
      const [userId, fullName] = params;
      const profile = { user_id: userId, full_name: fullName, display_name: fullName };
      this.profiles.push(profile);
      return { rows: [profile] };
    }

    // INSERT INTO user_roles
    if (s.startsWith('INSERT INTO user_roles')) {
      const [userId, roleKey] = params;
      const role = this.roles.find((r) => r.key === roleKey) || this.roles[0];
      const row = { user_id: userId, role_id: role.id };
      this.userRoles.push(row);
      return { rows: [row] };
    }

    // SELECT FROM user_roles
    if (s.includes('FROM user_roles')) {
      const userId = params[0];
      const assigned = this.userRoles.filter((ur) => ur.user_id === Number(userId));
      const result = assigned.map((ur) => this.roles.find((r) => r.id === ur.role_id));
      return { rows: result };
    }

    // UPDATE users SET is_email_verified
    if (s.includes('UPDATE users SET is_email_verified = true')) {
      const userId = params[0];
      const u = this.users.find((user) => user.id === Number(userId));
      if (u) u.is_email_verified = true;
      return { rows: [] };
    }

    // UPDATE users SET is_phone_verified
    if (s.includes('UPDATE users SET is_phone_verified = true')) {
      const userId = params[0];
      const u = this.users.find((user) => user.id === Number(userId));
      if (u) u.is_phone_verified = true;
      return { rows: [] };
    }

    // INSERT INTO otp_codes
    if (s.startsWith('INSERT INTO otp_codes')) {
      const [phone, email, codeHash, purpose, expiresAt] = params;
      const id = this.otpCodes.length + 1;
      const row = {
        id,
        phone: phone || null,
        email: email || null,
        code_hash: codeHash,
        purpose,
        attempts: 0,
        max_attempts: 5,
        consumed_at: null,
        expires_at: expiresAt,
        created_at: new Date(),
      };
      this.otpCodes.push(row);
      return { rows: [row] };
    }

    // SELECT * FROM otp_codes WHERE LOWER(email) = LOWER($1)
    if (s.includes('FROM otp_codes') && s.includes('LOWER(email) = LOWER($1)')) {
      const [email, purpose] = params;
      const match = this.otpCodes
        .slice()
        .reverse()
        .find(
          (o) =>
            o.email &&
            o.email.toLowerCase() === email.toLowerCase() &&
            o.purpose === purpose &&
            !o.consumed_at &&
            new Date(o.expires_at) > new Date()
        );
      return { rows: match ? [match] : [] };
    }

    // SELECT * FROM otp_codes WHERE phone = $1
    if (s.includes('FROM otp_codes') && s.includes('phone = $1')) {
      const [phone, purpose] = params;
      const match = this.otpCodes
        .slice()
        .reverse()
        .find(
          (o) =>
            o.phone === phone &&
            o.purpose === purpose &&
            !o.consumed_at &&
            new Date(o.expires_at) > new Date()
        );
      return { rows: match ? [match] : [] };
    }

    // UPDATE otp_codes SET consumed_at = now()
    if (s.includes('UPDATE otp_codes SET consumed_at = now()')) {
      const id = params[0];
      const o = this.otpCodes.find((item) => item.id === Number(id));
      if (o) o.consumed_at = new Date();
      return { rows: [] };
    }

    // INSERT INTO audit_logs
    if (s.startsWith('INSERT INTO audit_logs')) {
      this.auditLogs.push(params);
      return { rows: [{ id: this.auditLogs.length }] };
    }

    // INSERT INTO sessions
    if (s.startsWith('INSERT INTO sessions')) {
      const id = this.sessions.length + 1;
      const row = { id, user_id: params[0], expires_at: params[5] };
      this.sessions.push(row);
      return { rows: [row] };
    }

    // INSERT INTO refresh_tokens
    if (s.startsWith('INSERT INTO refresh_tokens')) {
      const id = this.refreshTokens.length + 1;
      const row = { id, session_id: params[0], token_hash: params[1], expires_at: params[2] };
      this.refreshTokens.push(row);
      return { rows: [row] };
    }

    // UPDATE users SET last_login_at
    if (s.includes('UPDATE users SET last_login_at')) {
      return { rows: [] };
    }

    // fallback
    return { rows: [] };
  }
}

// Mock cache
class MockCache {
  constructor() {
    this.store = new Map();
  }
  async get(k) {
    return this.store.get(k) ?? null;
  }
  async set(k, v) {
    this.store.set(k, v);
  }
  async del(k) {
    this.store.delete(k);
  }
  async incr(k) {
    const val = (Number(this.store.get(k)) || 0) + 1;
    this.store.set(k, String(val));
    return val;
  }
  async expire() {}
  async ttl() {
    return 60;
  }
}

describe('Dual Mobile Number & Email Address Registration System', () => {
  let db;
  let cache;
  const mockConfig = {
    auth: {
      jwtSecret: 'test-secret-that-is-at-least-32-chars-long-explooro',
      jwtTtlMinutes: 15,
      refreshTokenTtlDays: 30,
      piiEncryptionKey: '12345678901234567890123456789012',
      require2faForStaff: false,
    },
    isDevelopment: true,
  };

  before(() => {
    db = new MockDb();
    cache = new MockCache();
    clearSentEmails();
  });

  after(() => {
    clearSentEmails();
  });

  test('1. Registration with Email Address only creates user record and profile', async () => {
    const user = await authService.registerUser(db, {
      email: 'john.doe@example.com',
      password: 'StrongPassword123!',
      fullName: 'John Doe',
      role: 'customer',
    });

    assert.ok(user);
    assert.equal(user.email, 'john.doe@example.com');
    assert.equal(user.phone, null);
    assert.ok(user.ref.startsWith('USR'));
    assert.ok(user.password_hash);
  });

  test('2. Registration with Mobile Number only creates user record', async () => {
    const user = await authService.registerUser(db, {
      phone: '+8801712345678',
      password: 'StrongPassword123!',
      fullName: 'Karim Rahman',
      role: 'saler',
    });

    assert.ok(user);
    assert.equal(user.phone, '+8801712345678');
    assert.equal(user.email, null);
  });

  test('3. Registration without phone AND without email is rejected with VALIDATION_ERROR', async () => {
    await assert.rejects(
      async () => {
        await authService.registerUser(db, {
          password: 'StrongPassword123!',
          fullName: 'No Contact User',
        });
      },
      (err) => err.code === 'VALIDATION_ERROR'
    );
  });

  test('4. Duplicate Email registration is rejected with CONFLICT error', async () => {
    await assert.rejects(
      async () => {
        await authService.registerUser(db, {
          email: 'john.doe@example.com',
          password: 'AnotherPassword123!',
          fullName: 'Duplicate John',
        });
      },
      (err) => err.code === 'CONFLICT'
    );
  });

  test('5. Duplicate Phone registration is rejected with CONFLICT error', async () => {
    await assert.rejects(
      async () => {
        await authService.registerUser(db, {
          phone: '+8801712345678',
          password: 'AnotherPassword123!',
          fullName: 'Duplicate Karim',
        });
      },
      (err) => err.code === 'CONFLICT'
    );
  });

  test('6. Send OTP to email dispatches verification code via emailSender', async () => {
    let emailSentTo = null;
    let emailPayload = null;

    const mockEmailSender = async (to, payload) => {
      emailSentTo = to;
      emailPayload = payload;
    };

    const res = await otpService.sendOtp(db, cache, null, mockEmailSender, {
      email: 'john.doe@example.com',
      purpose: 'REGISTER',
      ip: '127.0.0.1',
      isDevelopment: true,
    });

    assert.ok(res.expiresInS > 0);
    assert.ok(res.devCode);
    assert.equal(emailSentTo, 'john.doe@example.com');
    assert.ok(emailPayload.text.includes(res.devCode));

    // Verify OTP
    const verifiedOtp = await otpService.verifyOtp(db, {
      email: 'john.doe@example.com',
      purpose: 'REGISTER',
      code: res.devCode,
    });

    assert.ok(verifiedOtp);
    assert.equal(verifiedOtp.email, 'john.doe@example.com');
  });

  test('7. Password login with Email Address succeeds', async () => {
    const result = await authService.loginWithPassword(db, cache, mockConfig, {
      email: 'john.doe@example.com',
      password: 'StrongPassword123!',
      ip: '127.0.0.1',
      userAgent: 'Test-Agent',
    });

    assert.ok(result.accessToken);
    assert.equal(result.user.email, 'john.doe@example.com');
  });

  test('8. Password login with Phone Number succeeds', async () => {
    const result = await authService.loginWithPassword(db, cache, mockConfig, {
      phone: '+8801712345678',
      password: 'StrongPassword123!',
      ip: '127.0.0.1',
      userAgent: 'Test-Agent',
    });

    assert.ok(result.accessToken);
    assert.equal(result.user.phone, '+8801712345678');
  });

  test('9. Password login with generic identifier (either email or phone) succeeds', async () => {
    const byEmail = await authService.loginWithPassword(db, cache, mockConfig, {
      identifier: 'john.doe@example.com',
      password: 'StrongPassword123!',
      ip: '127.0.0.1',
      userAgent: 'Test-Agent',
    });
    assert.ok(byEmail.accessToken);

    const byPhone = await authService.loginWithPassword(db, cache, mockConfig, {
      identifier: '+8801712345678',
      password: 'StrongPassword123!',
      ip: '127.0.0.1',
      userAgent: 'Test-Agent',
    });
    assert.ok(byPhone.accessToken);
  });
});
