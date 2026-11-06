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
