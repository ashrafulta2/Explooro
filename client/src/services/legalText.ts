/**
 * legalText.ts — turns a legal document's text into safe HTML.
 *
 * The format is the one migration 104 writes and /admin/platform/legal accepts:
 *   "## Heading"            a section heading
 *   "- item"                a list item (consecutive items form one list)
 *   "**bold**"              bold, inside any line
 *   blank line              ends a paragraph; a single line break inside one is kept
 *
 * WHY escape first and only then add tags: the text is typed by an admin into a page every visitor
 * reads. Escaping everything means no tag in the text can ever run; the only markup is what this
 * function adds.
 */

import { escapeHtml } from './html.ts';

const bold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/** Lowercase slug for a heading's anchor. Keeps Bangla letters and their vowel signs (\p{M}). */
export function headingId(text: string, index: number): string {
  const slug = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `s${index + 1}${slug ? `-${slug}` : ''}`;
}

export interface LegalHeading { id: string; text: string }

export function renderLegalText(text: string | null | undefined): { html: string; headings: LegalHeading[] } {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const headings: LegalHeading[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map((l) => bold(escapeHtml(l))).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${bold(escapeHtml(l))}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
    } else if (line.startsWith('## ')) {
      flushPara();
      flushList();
      const text = line.slice(3).trim();
      const id = headingId(text, headings.length);
      headings.push({ id, text });
      out.push(`<h2 id="${escapeHtml(id)}">${escapeHtml(text)}</h2>`);
    } else if (line.startsWith('- ')) {
      flushPara();
      list.push(line.slice(2).trim());
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return { html: out.join('\n'), headings };
}

// ── Admin preview: where each detail goes ──────────────────────────────────

export interface CompanyFieldSpec { max: number; group: string; kind: string; required: boolean }

/**
 * Optional fields that read as another value while empty. Mirrors COMPANY_FALLBACKS in
 * server/src/services/legal.service.ts; client/test/legal.test.js fails if the keys drift.
 */
export const COMPANY_FALLBACK_FIELDS = Object.freeze({
  privacy_email: 'support_email',
  partner_support: 'support_phone',
  supplier_support: 'support_phone',
  court_city: null as string | null, // the server reads "Dhaka" / "ঢাকা"
});

export type TokenState = 'filled' | 'fallback' | 'empty' | 'auto' | 'unknown';

export interface MarkOptions {
  company: Record<string, string>;
  fields: Record<string, CompanyFieldSpec>;
  lang: 'en' | 'bn';
  /** The values the platform fills itself ({{returns.*}}), when the page knows them. */
  auto?: Record<string, string | number | null | undefined>;
  /** The admin's name for a {{company.<field>}} token, e.g. its form label. */
  labelOf: (field: string) => string;
}

/** The {{company.<field>}} token's value and how it was found, the way the server fills it. */
export function companyTokenState(field: string, { company, fields, lang }: MarkOptions): { state: TokenState; value: string } {
  if (field === 'legal_name') return company.legal_name ? { state: 'filled', value: company.legal_name } : { state: 'fallback', value: 'Explooro' };
  const paired = `${field}_en` in fields;
  if (!paired && !(field in fields)) return { state: 'unknown', value: '' };
  const v = paired ? (lang === 'bn' ? (company[`${field}_bn`] || company[`${field}_en`]) : company[`${field}_en`]) : company[field];
  if (v) return { state: 'filled', value: v };
  if (field in COMPANY_FALLBACK_FIELDS) {
    const from = COMPANY_FALLBACK_FIELDS[field as keyof typeof COMPANY_FALLBACK_FIELDS];
    const fb = from ? company[from] : (lang === 'bn' ? 'ঢাকা' : 'Dhaka');
    if (fb) return { state: 'fallback', value: fb };
  }
  return { state: 'empty', value: '' };
}

/**
 * Wraps every {{token}} in rendered legal HTML in a <mark> that shows the value it will read as,
 * so an admin sees which words come from the details form and which are still empty.
 * WHY on the HTML and not the text: renderLegalText escapes everything first; braces survive
 * escaping, and the values put in here are escaped again.
 */
export function markLegalTokens(html: string, opts: MarkOptions): string {
  return html.replace(/\{\{\s*([a-z_]+)\.([a-z_]+)\s*\}\}/g, (whole, group, field) => {
    if (group === 'returns') {
      const v = opts.auto?.[`${group}.${field}`];
      return `<mark class="legal-token legal-token--auto" title="${escapeHtml(whole)}">${escapeHtml(v != null ? String(v) : whole)}</mark>`;
    }
    if (group !== 'company') return `<mark class="legal-token legal-token--unknown">${escapeHtml(whole)}</mark>`;
    const { state, value } = companyTokenState(field, opts);
    const label = state === 'unknown' ? whole : opts.labelOf(field);
    const text = state === 'filled' || state === 'fallback' ? value : `[${label}]`;
    return `<mark class="legal-token legal-token--${state}" data-field="${escapeHtml(field)}" title="${escapeHtml(label)}">${escapeHtml(text)}</mark>`;
  });
}
