/**
 * totp.service.js — RFC 6238 TOTP, hand-written (Prompt 2.3).
 *
 * No otplib/speakeasy: TOTP is ~40 lines of HMAC-SHA1 over Node's built-in crypto plus base32,
 * and docs/dependency-ledger.md §4 already hand-writes things of comparable size rather than
 * pulling in a package for them.
 */

import { createHmac, randomBytes } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const WINDOW_STEPS = 1; // tolerate ±1 step (±30s) of clock drift

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');

  let output = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(encoded) {
  const clean = encoded.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function generateSecret() {
  return base32Encode(randomBytes(20)); // 160-bit secret, the RFC 4226 recommendation
}

export function buildOtpauthUri(secretBase32, { accountName, issuer = 'Explooro' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
    algorithm: 'SHA1',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Verifies `code` against the secret, tolerating ±1 time step of clock drift. */
export function verifyTotp(secretBase32, code, at = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;

  const secretBuffer = base32Decode(secretBase32);
  const currentStep = Math.floor(at / 1000 / PERIOD_SECONDS);

  for (let delta = -WINDOW_STEPS; delta <= WINDOW_STEPS; delta += 1) {
    if (hotp(secretBuffer, currentStep + delta) === code) return true;
  }
  return false;
}

export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}
