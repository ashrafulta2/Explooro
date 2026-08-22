/**
 * ref.js — Public-facing short-code identifiers (Prompt 2.3, first caller: users.ref).
 *
 * docs/erd.md §0.2: every user-visible identifier gets a `ref` (e.g. `ORD-8F2K9QX7`) instead of
 * leaking the internal sequential `id`. Every later phase that mints a ref (orders, products,
 * disputes, …) reuses this one generator rather than rolling its own.
 */

import { randomBytes } from 'node:crypto';

// Crockford base32: excludes I, L, O, U to avoid characters that are easy to misread or confuse.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRef(prefix, length = 8) {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${prefix}-${code}`;
}
