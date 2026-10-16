/**
 * webhookSecurity.ts — shared helpers for verifying inbound gateway / courier webhooks.
 *
 * WHY this file exists: every driver used to fall back to a hardcoded secret (or to "no signature
 * means accept") so the app ran with zero config. Fine on a laptop, but on a live deployment that
 * forgot one variable it turns the public webhook into a button anyone can press: forge a signed
 * "payment succeeded" or "parcel delivered" event, and escrow releases. In live mode the fallback is
 * now `null`, and a null secret verifies nothing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Live = running in production, or the named driver variable has been switched off `mock`. */
export function isLive(driverEnvKey) {
  if (process.env.NODE_ENV === 'production') return true;
  if (!driverEnvKey) return false;
  return String(process.env[driverEnvKey] || 'mock').trim().toLowerCase() !== 'mock';
}

/** The configured secret, or the dev default outside live mode, or null in live mode. */
export function secretOrDevDefault(configured, devDefault, driverEnvKey) {
  if (configured) return configured;
  return isLive(driverEnvKey) ? null : devDefault;
}

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True when `signature` is the hex HMAC-SHA256 of the exact bytes received. */
export function hmacHexMatches(secret, body, signature) {
  if (!secret || !signature) return false;
  const bodyStr = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body ?? {});
  return safeEqual(createHmac('sha256', secret).update(bodyStr).digest('hex'), String(signature).trim());
}
