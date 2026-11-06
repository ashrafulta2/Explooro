/**
 * legal.ts — the legal documents and where each lives (migration 104).
 *
 * Mirrors server/src/config/legal.ts (keys and paths). server/test/legal.test.js fails if they drift.
 * The text itself always comes from the API (GET /legal/documents/:key), never from here.
 */

export interface LegalDocLink {
  key: 'terms' | 'privacy' | 'refund' | 'partner_agreement';
  /** The URL segment under /legal/. */
  slug: string;
  path: string;
  /** i18n key of the short name used in links (footer, sign-up box). */
  labelKey: string;
}

export const LEGAL_DOCS: readonly LegalDocLink[] = Object.freeze([
  { key: 'terms', slug: 'terms', path: '/legal/terms', labelKey: 'legal.link.terms' },
  { key: 'privacy', slug: 'privacy', path: '/legal/privacy', labelKey: 'legal.link.privacy' },
  { key: 'refund', slug: 'refund', path: '/legal/refund', labelKey: 'legal.link.refund' },
  { key: 'partner_agreement', slug: 'partner-agreement', path: '/legal/partner-agreement', labelKey: 'legal.link.partner_agreement' },
]);

export function legalDocBySlug(slug: string | null | undefined): LegalDocLink | null {
  return LEGAL_DOCS.find((d) => d.slug === slug) ?? null;
}
