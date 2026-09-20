/**
 * html.js — escaping for the pages that still assemble markup as one `innerHTML` string.
 *
 * WHY a shared helper: the access-governance pages (grants, restrictions, approvals, KYC) interpolate
 * operator- and applicant-typed text — a grant's justification, a sanction reason, a submitted
 * business name — straight into template literals. Those are exactly the screens a privileged
 * reviewer keeps open, so a `<img onerror>` in a reason field would run with their session. Each of
 * those pages used to carry no escaping at all; StaffPage and friends each grew a private copy.
 */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes `value` for use in HTML text or a quoted attribute. `null`/`undefined` become ''. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}
