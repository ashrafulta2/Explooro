/**
 * auth.service.js — Registration, login, refresh rotation, 2FA (Prompt 2.3).
 *
 * Permission resolution here is the pre-2.4 simplified form: the union of role_permissions for
 * the user's roles, no overrides/JIT/deny yet (that engine is docs/rbac-spec.md §4, Prompt 2.4).
 * It is enough to answer this prompt's one real question — "does this account hold a MEDIUM+
 * permission, and therefore require 2FA at login" — without building the resolver early.
 */

import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signAccessToken } from '../lib/jwt.js';
import { encryptField, decryptField } from '../lib/encryption.js';
import { generateRef } from '../lib/ref.js';
import { writeAudit } from '../lib/audit.js';
import { AppError } from '../plugins/errorHandler.js';
import { checkBucket } from '../lib/rateBucket.js';
import * as userRepo from '../repositories/user.repository.js';
import * as rbacService from './rbac.service.js';
import {
  generateSecret,
  buildOtpauthUri,
  verifyTotp,
  generateRecoveryCodes,
} from './totp.service.js';

const TWO_FACTOR_CHALLENGE_TTL_S = 5 * 60;
const STAFF_RISK_TIERS = ['MEDIUM', 'HIGH', 'CRITICAL'];

function hashOpaqueToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function generateOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

function publicUser(user) {
  return {
    ref: user.ref,
    phone: user.phone,
    email: user.email,
    status: user.status,
    locale: user.locale,
    ui_mode: user.ui_mode,
  };
}

async function resolveRoleKeysAndRisk(db, cache, userId, config) {
  const resolved = await rbacService.resolvePermissions(db, cache, userId);
  const roleKeys = resolved.roles;
  let requires2fa = false;
  if (config.auth.require2faForStaff) {
    for (const [, meta] of resolved.metadata) {
      if (STAFF_RISK_TIERS.includes(meta.risk_tier)) {
        requires2fa = true;
        break;
      }
    }
  }
  return { roleKeys, requires2fa };
}

/** Issues a session + refresh token + access token. Only call once every gate has passed. */
async function issueTokensForUser(db, config, user, roleKeys, { ip, userAgent }) {
  const familyId = randomUUID();
  const expiresAt = new Date(Date.now() + config.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  const session = await userRepo.createSession(db, { userId: user.id, familyId, ip, userAgent, expiresAt });

  const refreshPlain = generateOpaqueToken();
  await userRepo.createRefreshToken(db, {
    sessionId: session.id,
    tokenHash: hashOpaqueToken(refreshPlain),
    expiresAt,
  });

  const { token: accessToken, expiresIn } = await signAccessToken(
    { userId: user.id, roles: roleKeys, sessionId: session.id },
    config.auth.jwtSecret
  );

  return { accessToken, expiresIn, refreshPlain, refreshExpiresAt: expiresAt, session };
}

/**
 * Shared by password login, OTP-completed login, and the post-2FA-verify completion path.
 * Either returns tokens, or throws TWO_FACTOR_REQUIRED with a challenge_token in `details`.
 */
async function completeLogin(db, cache, config, user, { ip, userAgent }) {
  const { roleKeys, requires2fa } = await resolveRoleKeysAndRisk(db, cache, user.id, config);

  if (requires2fa) {
    const staff2fa = await userRepo.getStaff2fa(db, user.id);
    const challengeToken = generateOpaqueToken();
    await cache.set(`2fa_challenge:${challengeToken}`, JSON.stringify({ userId: user.id }), TWO_FACTOR_CHALLENGE_TTL_S);

    await writeAudit(db, {
      actorId: user.id,
      action: 'auth.login.2fa_challenge',
      targetType: 'user',
      targetRef: user.ref,
      ip,
      userAgent,
    });

    throw new AppError(
      'TWO_FACTOR_REQUIRED',
      'Two-factor verification is required for this account.',
      'এই অ্যাকাউন্টের জন্য দুই-স্তর যাচাই প্রয়োজন।',
      { challenge_token: challengeToken, enrolled: Boolean(staff2fa?.enrolled_at) }
    );
  }

  const tokens = await issueTokensForUser(db, config, user, roleKeys, { ip, userAgent });
  await userRepo.updateLastLogin(db, user.id);
  await writeAudit(db, {
    actorId: user.id,
    action: 'auth.login.success',
    targetType: 'user',
    targetRef: user.ref,
    ip,
    userAgent,
  });

  return { ...tokens, user, roles: roleKeys };
}

// Mirrors auth.routes.js's SELF_SERVICE_ROLE enum — kept in sync there, not re-validated here.
const SELF_SERVICE_ROLES = new Set(['customer', 'saler', 'supplier']);

export async function registerUser(db, { phone, email, password, fullName, role }) {
  if (!phone && !email) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Either a mobile number or email address is required to register.',
      'রেজিস্টার করতে মোবাইল নম্বর বা ইমেইল ঠিকানা আবশ্যক।'
    );
  }

  if (phone) {
    const existingPhone = await userRepo.findUserByPhone(db, phone);
    if (existingPhone) {
      throw new AppError(
        'CONFLICT',
        'An account with this phone number already exists.',
        'এই ফোন নম্বর দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট আছে।'
      );
    }
  }

  if (email) {
    const existingEmail = await userRepo.findUserByEmail(db, email);
    if (existingEmail) {
      throw new AppError(
        'CONFLICT',
        'An account with this email address already exists.',
        'এই ইমেইল ঠিকানা দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট আছে।'
      );
    }
  }

  const passwordHash = password ? await hashPassword(password) : null;
  const ref = generateRef('USR');
  const user = await userRepo.createUser(db, {
    ref,
    phone: phone || null,
    email: email ? email.toLowerCase().trim() : null,
    passwordHash,
  });
  await userRepo.createUserProfile(db, { userId: user.id, fullName });
  const roleKey = SELF_SERVICE_ROLES.has(role) ? role : 'customer';
  await userRepo.assignRole(db, { userId: user.id, roleKey });

  await writeAudit(db, {
    actorId: user.id,
    action: 'auth.register',
    targetType: 'user',
    targetRef: ref,
    afterJson: {
      phone: phone || null,
      email: email ? email.toLowerCase().trim() : null,
      has_password: Boolean(password),
      role: roleKey,
    },
  });

  return user;
}

export async function loginWithPassword(db, cache, config, { phone, email, identifier, password, ip, userAgent }) {
  await checkBucket(cache, `login:ip:${ip}`, 10, 60);

  const targetIdentifier = identifier || email || phone;
  let user = null;
  if (targetIdentifier) {
    user = await userRepo.findUserByIdentifier(db, targetIdentifier);
  }

  const genericFailure = () =>
    new AppError('AUTH_INVALID', 'Incorrect credentials or password.', 'ভুল তথ্য বা পাসওয়ার্ড।');

  if (!user || !user.password_hash) {
    throw genericFailure();
  }

  await checkBucket(cache, `login:account:${user.id}`, 5, 60);

  const passwordOk = await verifyPassword(user.password_hash, password);
  if (!passwordOk) {
    await writeAudit(db, {
      actorId: user.id,
      action: 'auth.login.failed',
      targetType: 'user',
      targetRef: user.ref,
      ip,
      userAgent,
    });
    throw genericFailure();
  }

  if (user.status !== 'ACTIVE') {
    throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.', 'এই অ্যাকাউন্টটি স্থগিত করা হয়েছে।');
  }

  const result = await completeLogin(db, cache, config, user, { ip, userAgent });
  return { ...result, user: publicUser(result.user) };
}

/** Called by the controller after otp.service.verifyOtp succeeds for purpose LOGIN. */
export async function completeOtpLogin(db, cache, config, identifierOrObj, meta) {
  const { ip, userAgent } = meta || {};
  let user = null;

  if (typeof identifierOrObj === 'string') {
    user = await userRepo.findUserByIdentifier(db, identifierOrObj);
  } else if (identifierOrObj && typeof identifierOrObj === 'object') {
    const { phone, email, identifier } = identifierOrObj;
    const target = identifier || email || phone;
    if (target) {
      user = await userRepo.findUserByIdentifier(db, target);
    }
  }

  if (!user) {
    throw new AppError('NOT_FOUND', 'No account found for this user.', 'এই তথ্যের জন্য কোনো অ্যাকাউন্ট পাওয়া যায়নি।');
  }
  if (user.status !== 'ACTIVE') {
    throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended.', 'এই অ্যাকাউন্টটি স্থগিত করা হয়েছে।');
  }
  const result = await completeLogin(db, cache, config, user, { ip, userAgent });
  return { ...result, user: publicUser(result.user) };
}

export async function refreshSession(db, config, { refreshPlain, ip, userAgent }) {
  const invalid = () =>
    new AppError('AUTH_INVALID', 'Please log in again.', 'অনুগ্রহ করে আবার লগইন করুন।');

  const tokenHash = hashOpaqueToken(refreshPlain);
  const existing = await userRepo.getRefreshTokenByHash(db, tokenHash);
  if (!existing) throw invalid();

  const session = await userRepo.getSessionById(db, existing.session_id);
  if (!session || session.revoked_at) throw invalid();

  if (existing.used_at) {
    await userRepo.revokeSession(db, session.id, 'refresh_reuse_detected');
    await writeAudit(db, {
      actorId: session.user_id,
      action: 'auth.refresh.reuse_detected',
      targetType: 'session',
      targetRef: String(session.id),
      riskTier: 'HIGH',
      ip,
      userAgent,
    });
    throw invalid();
  }

  if (new Date(existing.expires_at) < new Date()) throw invalid();

  const user = await userRepo.findUserById(db, session.user_id);
  if (!user || user.status !== 'ACTIVE') throw invalid();

  const expiresAt = new Date(Date.now() + config.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  const newRefreshPlain = generateOpaqueToken();
  const newRow = await userRepo.createRefreshToken(db, {
    sessionId: session.id,
    tokenHash: hashOpaqueToken(newRefreshPlain),
    expiresAt,
  });
  await userRepo.markRefreshTokenUsed(db, existing.id, newRow.id);
  await userRepo.touchSessionLastSeen(db, session.id);

  const roles = await userRepo.getRolesForUser(db, user.id);
  const roleKeys = roles.map((r) => r.key);
  const { token: accessToken, expiresIn } = await signAccessToken(
    { userId: user.id, roles: roleKeys, sessionId: session.id },
    config.auth.jwtSecret
  );

  return {
    accessToken,
    expiresIn,
    refreshPlain: newRefreshPlain,
    refreshExpiresAt: expiresAt,
    user: publicUser(user),
    roles: roleKeys,
  };
}

export async function logout(db, { sessionId, ip, userAgent }) {
  await userRepo.revokeSession(db, sessionId, 'logout');
  await writeAudit(db, { action: 'auth.logout', targetType: 'session', targetRef: String(sessionId), ip, userAgent });
}

export async function getMe(db, cache, { userId }) {
  const user = await userRepo.findUserById(db, userId);
  if (!user) throw new AppError('NOT_FOUND', 'Account not found.', 'অ্যাকাউন্ট পাওয়া যায়নি।');

  const resolved = await rbacService.resolvePermissions(db, cache, userId);
  const restrictions = await userRepo.getActiveRestrictionsForUser(db, user.ref);

  return {
    user: publicUser(user),
    roles: resolved.roles,
    permissions: Array.from(resolved.permissions),
    restrictions,
  };
}

/**
 * `userId` comes from an authenticated Bearer token (a user proactively enrolling or re-enrolling).
 * `challengeToken` comes from a login that hit TWO_FACTOR_REQUIRED with `enrolled: false` — the
 * only way a staff account can ever complete its FIRST enrollment, since login never issues a
 * token to an unenrolled MEDIUM+ account in the first place.
 */
export async function setup2fa(db, cache, config, { userId, challengeToken }) {
  let resolvedUserId = userId;
  if (challengeToken) {
    const raw = await cache.get(`2fa_challenge:${challengeToken}`);
    if (!raw) {
      throw new AppError('AUTH_INVALID', 'This challenge has expired. Please log in again.', 'এই যাচাই সময় শেষ হয়ে গেছে। আবার লগইন করুন।');
    }
    resolvedUserId = JSON.parse(raw).userId;
  }
  if (!resolvedUserId) {
    throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
  }

  const user = await userRepo.findUserById(db, resolvedUserId);
  if (!user) throw new AppError('NOT_FOUND', 'Account not found.', 'অ্যাকাউন্ট পাওয়া যায়নি।');

  const secret = generateSecret();
  const otpauthUri = buildOtpauthUri(secret, { accountName: user.phone });
  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodesHash = recoveryCodes.map((c) => createHash('sha256').update(c, 'utf8').digest('hex'));
  const secretEncrypted = encryptField(secret, config.auth.piiEncryptionKey);

  await userRepo.upsertStaff2fa(db, { userId: resolvedUserId, secretEncrypted, recoveryCodesHash });
  await writeAudit(db, { actorId: resolvedUserId, action: 'auth.2fa.enroll_start', targetType: 'user', targetRef: user.ref });

  return { otpauthUri, secret, recoveryCodes };
}

export async function verify2fa(db, cache, config, { userId, challengeToken, code, ip, userAgent }) {
  let resolvedUserId = userId;

  if (challengeToken) {
    const raw = await cache.get(`2fa_challenge:${challengeToken}`);
    if (!raw) {
      throw new AppError('AUTH_INVALID', 'This challenge has expired. Please log in again.', 'এই যাচাই সময় শেষ হয়ে গেছে। আবার লগইন করুন।');
    }
    resolvedUserId = JSON.parse(raw).userId;
  }

  if (!resolvedUserId) {
    throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
  }

  const staff2fa = await userRepo.getStaff2fa(db, resolvedUserId);
  const secret = staff2fa ? decryptField(staff2fa.secret_encrypted, config.auth.piiEncryptionKey) : null;
  const ok = Boolean(secret) && verifyTotp(secret, code);

  if (!ok) {
    await writeAudit(db, {
      actorId: resolvedUserId,
      action: 'auth.2fa.verify_failed',
      targetType: 'user',
      targetRef: String(resolvedUserId),
      ip,
      userAgent,
    });
    throw new AppError('TWO_FACTOR_INVALID', 'That code is not correct.', 'কোডটি সঠিক নয়।');
  }

  await userRepo.markStaff2faVerifiedNow(db, resolvedUserId);
  await writeAudit(db, {
    actorId: resolvedUserId,
    action: 'auth.2fa.verify_success',
    targetType: 'user',
    targetRef: String(resolvedUserId),
    ip,
    userAgent,
  });

  if (challengeToken) {
    await cache.del(`2fa_challenge:${challengeToken}`);
    const user = await userRepo.findUserById(db, resolvedUserId);
    const roles = await userRepo.getRolesForUser(db, resolvedUserId);
    const roleKeys = roles.map((r) => r.key);
    const tokens = await issueTokensForUser(db, config, user, roleKeys, { ip, userAgent });
    await userRepo.updateLastLogin(db, resolvedUserId);
    return { completedLogin: true, ...tokens, user: publicUser(user), roles: roleKeys };
  }

  return { completedLogin: false, enrolled: true };
}
