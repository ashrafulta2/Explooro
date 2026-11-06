/**
 * legal.ts — the legal documents the platform publishes (migration 104, Prompt 12.6 req 7).
 *
 * `acceptedBy` is who must agree to the current version before they carry on:
 *   'all'      every signed-in account, whatever its role
 *   string[]   only accounts holding one of these roles
 *   null       read-only: published and linked, but nobody signs it (the refund policy is part of
 *              the terms, which everyone accepts)
 *
 * Kept in step with client/src/config/legal.ts (keys and paths); server/test/legal.test.js fails if
 * the two drift, or if a key here is not in the legal_documents CHECK.
 */

export interface LegalDocDef {
  key: 'terms' | 'privacy' | 'refund' | 'partner_agreement';
  path: string;
  acceptedBy: 'all' | string[] | null;
}

export const LEGAL_DOCS: readonly LegalDocDef[] = Object.freeze([
  { key: 'terms', path: '/legal/terms', acceptedBy: 'all' },
  { key: 'privacy', path: '/legal/privacy', acceptedBy: 'all' },
  { key: 'refund', path: '/legal/refund', acceptedBy: null },
  { key: 'partner_agreement', path: '/legal/partner-agreement', acceptedBy: ['saler'] },
]);

export const LEGAL_DOC_KEYS = Object.freeze(LEGAL_DOCS.map((d) => d.key));

/** The documents an account with these roles must have agreed to. */
export function docsToAccept(roles: string[] = []): LegalDocDef[] {
  return LEGAL_DOCS.filter((d) => d.acceptedBy === 'all'
    || (Array.isArray(d.acceptedBy) && d.acceptedBy.some((r) => roles.includes(r))));
}
