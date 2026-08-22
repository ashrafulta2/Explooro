/**
 * jwt.js — Access-token signing/verification (Prompt 2.3).
 *
 * The single file that imports `jose` (docs/dependency-ledger.md). docs/api-contract.md §8 fixes
 * the claim shape exactly: sub, roles, pv (permission-cache version), sid (session id), exp.
 *
 * `pv` is hardcoded to 1 for every token until Prompt 2.4's resolution engine adds the real
 * per-user version column and the bump-on-change mechanism (rbac-spec.md §4.2) — the claim exists
 * now so the token shape never has to change later, but nothing invalidates it early yet.
 */

import { SignJWT, jwtVerify } from 'jose';

const ALGORITHM = 'HS256';
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

function secretKey(jwtSecret) {
  return new TextEncoder().encode(jwtSecret);
}

export async function signAccessToken({ userId, roles, sessionId, permissionVersion = 1 }, jwtSecret) {
  const token = await new SignJWT({ roles, pv: permissionVersion, sid: String(sessionId) })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey(jwtSecret));

  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** Returns { userId, roles, sessionId, permissionVersion } or throws on invalid/expired token. */
export async function verifyAccessToken(token, jwtSecret) {
  const { payload } = await jwtVerify(token, secretKey(jwtSecret), { algorithms: [ALGORITHM] });
  return {
    userId: payload.sub,
    roles: payload.roles,
    sessionId: payload.sid,
    permissionVersion: payload.pv,
  };
}

export { ACCESS_TOKEN_TTL_SECONDS };
