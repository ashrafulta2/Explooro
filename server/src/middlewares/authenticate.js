/**
 * authenticate.js — Bearer access-token verification (Prompt 2.3).
 *
 * Decorates two preHandlers:
 *   - `fastify.authenticate`         — required. Throws AUTH_REQUIRED if no Bearer token is sent.
 *   - `fastify.authenticateOptional` — best-effort. Populates req.user if a valid token is sent,
 *     otherwise leaves it undefined. Used only by /auth/2fa/setup and /auth/2fa/verify, which must
 *     work both for an already-logged-in user re-enrolling AND for the pending-challenge path a
 *     staff account's very first 2FA enrollment has to go through (it cannot hold a Bearer token
 *     yet — login never issues one to an unenrolled MEDIUM+ account).
 *
 * Either way, a session that IS revoked/logged-out stops authenticating immediately — the 15-
 * minute access token alone is not enough of a check.
 *
 * Permission checking (`requirePermission`) is Prompt 2.4's job — this only establishes *who* is
 * calling, not *what* they may do.
 */

import { verifyAccessToken } from '../lib/jwt.js';
import { getSessionWithIdentity } from '../repositories/user.repository.js';
import { AppError } from '../plugins/errorHandler.js';

async function resolveUser(app, req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice('Bearer '.length);
  let claims;
  try {
    claims = await verifyAccessToken(token, app.config.auth.jwtSecret);
  } catch (err) {
    const expired = err?.code === 'ERR_JWT_EXPIRED';
    throw new AppError(
      expired ? 'AUTH_EXPIRED' : 'AUTH_INVALID',
      expired ? 'Your session expired. Please refresh.' : 'Your session is invalid. Please log in again.',
      expired ? 'আপনার সেশনের মেয়াদ শেষ হয়ে গেছে। রিফ্রেশ করুন।' : 'আপনার সেশন অবৈধ। আবার লগইন করুন।'
    );
  }

  const session = await getSessionWithIdentity(app.db, Number(claims.sessionId));
  if (!session || session.revoked_at) {
    throw new AppError('AUTH_INVALID', 'Your session is invalid. Please log in again.', 'আপনার সেশন অবৈধ। আবার লগইন করুন।');
  }

  return {
    id: Number(claims.userId),
    roles: claims.roles,
    sessionId: session.id,
    permissionVersion: claims.permissionVersion,
    // WHY these two are here: `users` carries neither — the display name lives on `user_profiles`.
    // Chat handshake tickets, live-stream publisher/viewer tokens and in-stream orders all read
    // `req.user.full_name`, and every one of them was getting `undefined`.
    full_name: session.full_name ?? null,
    phone: session.user_phone ?? null,
  };
}

export default function authenticatePlugin(app) {
  app.decorate('authenticate', async function authenticate(req) {
    const user = await resolveUser(app, req);
    if (!user) {
      throw new AppError('AUTH_REQUIRED', 'Sign in required.', 'সাইন ইন করা প্রয়োজন।');
    }
    req.user = user;
  });

  app.decorate('authenticateOptional', async function authenticateOptional(req) {
    const user = await resolveUser(app, req);
    if (user) req.user = user;
  });
}

authenticatePlugin[Symbol.for('skip-override')] = true;
