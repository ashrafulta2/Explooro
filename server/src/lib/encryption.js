/**
 * encryption.js — AES-256-GCM envelope encryption for 🔐 columns (Prompt 2.3).
 *
 * docs/erd.md §0.6: PII/secret columns are TEXT ciphertext, never stored plain. First real user of
 * this is staff_2fa.secret_encrypted; later phases (KYC documents, payout account numbers) reuse
 * it unchanged.
 *
 * PII_ENCRYPTION_KEY is a 32-byte key, base64-encoded in .env. Output is a single TEXT field:
 * base64(iv [12 bytes] || authTag [16 bytes] || ciphertext).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function resolveKey(base64Key) {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error(`PII_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

export function encryptField(plainText, base64Key) {
  const key = resolveKey(base64Key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptField(encoded, base64Key) {
  const key = resolveKey(base64Key);
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
