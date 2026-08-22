/**
 * password.js — argon2id password hashing (Prompt 2.2, reused unchanged by Prompt 2.3's login).
 *
 * The single file that imports `argon2` (docs/dependency-ledger.md) — introduced a phase early, in
 * 2.2, because the dev-user seed needs real hashes rather than placeholders. Prompt 2.3's
 * auth.service.js imports from here, not from `argon2` directly, so the dependency still has
 * exactly one point of contact.
 */

import argon2 from 'argon2';

export async function hashPassword(plain) {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash, plain) {
  return argon2.verify(hash, plain);
}
