/**
 * legal.ts — the legal documents and where each lives (migration 104).
 *
 * Mirrors server/src/config/legal.ts (keys and paths). server/test/legal.test.js fails if they drift.
 * The text itself always comes from the API (GET /legal/documents/:key), never from here.
 */

export interface LegalDocLink {
  key: 'terms' | 'privacy' | 'refund' | 'partner_agreement' | 'supplier_agreement';
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
  { key: 'supplier_agreement', slug: 'supplier-agreement', path: '/legal/supplier-agreement', labelKey: 'legal.link.supplier_agreement' },
]);

/**
 * How many points each document asks a lawyer to check before launch, drawn on /admin/platform/legal
 * from admin.legal.review.<key>.<n> (1-based). They were the [[LAWYER]] notes in
 * docs/legal-templates, kept out of the published text by migration 113.
 * WHY a count and not an array in the locales: the i18n engine reads strings.
 */
export const LEGAL_REVIEW_POINTS: Readonly<Record<LegalDocLink['key'], number>> = Object.freeze({
  terms: 4, privacy: 3, refund: 1, partner_agreement: 1, supplier_agreement: 2,
});

export function legalDocBySlug(slug: string | null | undefined): LegalDocLink | null {
  return LEGAL_DOCS.find((d) => d.slug === slug) ?? null;
}
