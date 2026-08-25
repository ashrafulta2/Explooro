/**
 * auth.controller.js — HTTP shaping for auth endpoints (Prompt 2.3).
 *
 * Cookies and CSRF live here, not in auth.service.js: services return plain data, controllers own
 * everything that touches the request/reply. docs/api-contract.md §8: refresh token is an opaque
 * HttpOnly cookie scoped to /api/v1/auth; a separate, JS-readable `csrf` cookie implements the
 * double-submit pattern required for cookie-authenticated POSTs (`SameSite=Lax` alone is not
 * sufficient).
 */

import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import * as authService from '../services/auth.service.js';
import * as otpService from '../services/otp.service.js';
import {
  markPhoneVerified,
  markEmailVerified,
  findUserByPhone,
  findUserByEmail,
  findUserByIdentifier,
  getRefreshTokenByHash,
} from '../repositories/user.repository.js';
import { AppError } from '../plugins/errorHandler.js';

const REFRESH_COOKIE = 'rt';
const CSRF_COOKIE = 'csrf';

function requestMeta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] ?? null };
}

function setAuthCookies(reply, config, { refreshPlain, refreshExpiresAt }) {
  const secure = config.isProduction;

  reply.setCookie(REFRESH_COOKIE, refreshPlain, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/v1/auth',
    expires: refreshExpiresAt,
  });

  reply.setCookie(CSRF_COOKIE, randomBytes(24).toString('hex'), {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: refreshExpiresAt,
  });
}

function clearAuthCookies(reply, config) {
  const secure = config.isProduction;
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth', secure, sameSite: 'lax' });
  reply.clearCookie(CSRF_COOKIE, { path: '/', secure, sameSite: 'lax' });
}

/** Double-submit check for the two cookie-authenticated routes (refresh, logout). */
function assertCsrf(req) {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers['x-csrf-token'];
  const invalid = () =>
    new AppError('AUTH_INVALID', 'Your session could not be verified. Please log in again.', 'আপনার সেশন যাচাই করা যায়নি। আবার লগইন করুন।');

  if (!cookieToken || !headerToken) throw invalid();
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw invalid();
}

function loginResponseBody(result) {
  return {
    access_token: result.accessToken,
    expires_in: result.expiresIn,
    user: { ...result.user, roles: result.roles },
  };
}

export async function register(req, reply) {
  const { db } = req.server;
  const { phone, email, password, full_name: fullName, role } = req.body;
  const user = await authService.registerUser(db, { phone, email, password, fullName, role });
  reply.code(201).send({
    data: { user: { ref: user.ref, phone: user.phone, email: user.email, status: user.status } },
  });
}

export async function login(req, reply) {
  const { db, cache, config } = req.server;
  const result = await authService.loginWithPassword(db, cache, config, {
    ...req.body,
    ...requestMeta(req),
  });
  setAuthCookies(reply, config, result);
  reply.send({ data: loginResponseBody(result) });
}

export async function sendOtp(req, reply) {
  const { db, cache, config, smsSender, emailSender } = req.server;
  const { phone, email, purpose } = req.body;
  const { devCode, expiresInS } = await otpService.sendOtp(db, cache, smsSender, emailSender, {
    phone,
    email,
    purpose,
    ip: req.ip,
    isDevelopment: config.isDevelopment,
  });

  reply.send({
    data: { sent: true, expires_in_s: expiresInS },
    ...(devCode ? { meta: { otp_debug: devCode } } : {}),
  });
}

export async function verifyOtp(req, reply) {
  const { db, cache, config } = req.server;
  const { phone, email, purpose, code } = req.body;

  await otpService.verifyOtp(db, { phone, email, purpose, code });

  if (purpose === 'REGISTER') {
    const user = email ? await findUserByEmail(db, email) : await findUserByPhone(db, phone);
    if (user) {
      if (email) await markEmailVerified(db, user.id);
      if (phone) await markPhoneVerified(db, user.id);
    }
    reply.send({ data: { verified: true } });
    return;
  }

  if (purpose === 'LOGIN') {
    const result = await authService.completeOtpLogin(db, cache, config, { phone, email }, requestMeta(req));
    setAuthCookies(reply, config, result);
    reply.send({ data: loginResponseBody(result) });
    return;
  }

  // COD_CONFIRM / PAYOUT_CONFIRM / RESET: consumption is generic here; the owning feature
  // (checkout, vault, password reset) reads the consumed otp_codes row itself in its own phase.
  reply.send({ data: { verified: true } });
}

export async function refresh(req, reply) {
  const { db, config } = req.server;
  assertCsrf(req);

  const refreshPlain = req.cookies?.[REFRESH_COOKIE];
  if (!refreshPlain) {
    throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
  }

  const result = await authService.refreshSession(db, config, { refreshPlain, ...requestMeta(req) });
  setAuthCookies(reply, config, result);
  reply.send({ data: loginResponseBody(result) });
}

export async function logout(req, reply) {
  const { db, config } = req.server;
  assertCsrf(req);

  const refreshPlain = req.cookies?.[REFRESH_COOKIE];
  if (refreshPlain) {
    const tokenHash = createHash('sha256').update(refreshPlain, 'utf8').digest('hex');
    const row = await getRefreshTokenByHash(db, tokenHash);
    if (row) {
      await authService.logout(db, { sessionId: row.session_id, ...requestMeta(req) });
    }
  }

  clearAuthCookies(reply, config);
  reply.send({ data: { logged_out: true } });
}

export async function me(req, reply) {
  const { db, cache } = req.server;
  const result = await authService.getMe(db, cache, { userId: req.user.id });
  reply.send({ data: result });
}

export async function setup2fa(req, reply) {
  const { db, cache, config } = req.server;
  const result = await authService.setup2fa(db, cache, config, {
    userId: req.user?.id ?? null,
    challengeToken: req.body?.challenge_token ?? null,
  });
  reply.send({
    data: { otpauth_uri: result.otpauthUri, secret: result.secret, recovery_codes: result.recoveryCodes },
  });
}

export async function verify2fa(req, reply) {
  const { db, cache, config } = req.server;
  const { code, challenge_token: challengeToken } = req.body;

  const result = await authService.verify2fa(db, cache, config, {
    userId: req.user?.id ?? null,
    challengeToken,
    code,
    ...requestMeta(req),
  });

  if (result.completedLogin) {
    setAuthCookies(reply, config, result);
    reply.send({ data: loginResponseBody(result) });
    return;
  }

  reply.send({ data: { enrolled: true } });
}
