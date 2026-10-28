/**
 * mocks/releaseNotes.ts — the one release-note store the mock API serves the What's New feature from.
 *
 * WHY this file exists: the popup (GET /notifications/whats-new, handlers/notifications.ts) answered
 * from a hard-coded constant, and the editor (GET /content/whats-new, POST/DELETE /editor/whats-new,
 * handlers/content.js) wrote a separate array the popup never read. So in mock mode — the dev
 * default — every user saw the same v2.4 note no matter what an editor published, and since the
 * "seen" flag was a module variable it came back on every reload. Both handlers now use this store,
 * the same way the live server uses one `release_notes` table (migration 075).
 *
 * Notes and per-user acks persist to localStorage: the thing being tested is "publish, reload, see
 * it once", and a mock that forgets on refresh would hide a broken implementation.
 *
 * Mirrors server/src/services/content.service.ts (upsertReleaseNote) and
 * notification.service.ts (getLatestReleaseNotes). Mock-only: nothing outside src/mocks imports it.
 */

export type ReleaseCategory = 'FEATURE' | 'IMPROVEMENT' | 'SECURITY' | 'FIX';
export type ReleaseAudience = 'ALL' | 'SALERS' | 'SUPPLIERS';

export const RELEASE_CATEGORIES: string[] = ['FEATURE', 'IMPROVEMENT', 'SECURITY', 'FIX'] satisfies ReleaseCategory[];
export const RELEASE_AUDIENCES: string[] = ['ALL', 'SALERS', 'SUPPLIERS'] satisfies ReleaseAudience[];
const VERSION_TAG_MAX = 32;
// Same numbers as HIGHLIGHT_LIMITS in server/src/services/content.service.ts; the server test fails
// if they drift.
export const HIGHLIGHT_LIMITS = { maxItems: 6, iconMax: 8, titleMax: 80, descMax: 240 };
const AUDIENCE_BY_ROLE: Record<string, ReleaseAudience> = { saler: 'SALERS', supplier: 'SUPPLIERS' };

const NOTES_KEY = 'explooro:mock:release-notes';
const VIEWS_KEY = 'explooro:mock:release-views';

export interface HighlightCard {
  icon: string;
  title_en: string;
  title_bn: string;
  desc_en: string;
  desc_bn: string;
}

/** A stored note, the shape of one `release_notes` row. */
export interface ReleaseNote {
  id: number;
  version_tag: string;
  title_en: string;
  title_bn: string;
  category: ReleaseCategory | string;
  target_audience: ReleaseAudience | string;
  summary_en: string;
  summary_bn: string;
  highlights_json: HighlightCard[];
  published_at: string;
  updated_at?: string;
}

/** What the API returns: the row plus `version`, the name the editor pages read. */
export type ReleaseNoteDto = ReleaseNote & { version: string };

/** A handler-style reply, so validation errors look like the live API's. */
export interface MockReply<T = unknown> {
  status: number;
  body: T;
}

type ErrorBody = { error: { code: string; message_en: string; message_bn: string } };

const daysAgo = (d: number): string => new Date(Date.now() - 86400000 * d).toISOString();

const SEED_NOTES: ReleaseNote[] = [
  {
    id: 1,
    version_tag: 'v2.4.0',
    title_en: '1-Click Physical Factory Showroom Status & Weekly Schedule',
    title_bn: '১-ক্লিক ফিজিক্যাল ফ্যাক্টরি শোরুম স্ট্যাটাস ও সাপ্তাহিক সময়সূচি',
    category: 'FEATURE',
    target_audience: 'ALL',
    summary_en: 'Suppliers can now manage real-time walk-in availability, customized 7-day operating hours, and warehouse pickup desks.',
    summary_bn: 'সরবরাহকারীরা এখন রিয়েল-টাইম শোরুম ভিজিট, ৭ দিনের সাপ্তাহিক সময়সূচি এবং কাস্টমার সেলফ-পিকআপ ডেস্ক সেটআপ করতে পারেন।',
    highlights_json: [],
    published_at: daysAgo(2),
  },
  {
    id: 2,
    version_tag: 'v2.3.5',
    title_en: 'Steadfast & Pathao Courier Consignment 1-Click Handover',
    title_bn: 'স্টেডফাস্ট ও পাঠাও কুরিয়ার পার্সেল ১-ক্লিক হ্যান্ডওভার',
    category: 'IMPROVEMENT',
    target_audience: 'SUPPLIERS',
    summary_en: 'Instant airway bill barcode printing, thermal shipping labels, and real-time live tracking webhooks.',
    summary_bn: 'তাৎক্ষণিক এয়ারওয়ে বিল বারকোড ও থার্মাল লেবেল প্রিন্ট এবং সরাসরি লাইভ ট্র্যাকিং সমন্বয়।',
    highlights_json: [],
    published_at: daysAgo(6),
  },
  {
    id: 3,
    version_tag: 'v2.3.0',
    title_en: 'B2B Milestone Escrow Contracts & Immutable Hash Verification',
    title_bn: 'বিটুবি মাইলস্টোন এসক্রো চুক্তি ও হ্যাশ ভেরিফিকেশন',
    category: 'SECURITY',
    target_audience: 'SALERS',
    summary_en: 'Deterministic SHA-256 digital signature hashes for bulk garment and textile manufacturing agreements.',
    summary_bn: 'পোশাক ও টেক্সটাইল বাল্ক চুক্তির জন্য ক্রিপ্টোগ্রাফিক ডিজিটাল সাইন ও নিরাপদ পেমেন্ট এসক্রো।',
    highlights_json: [],
    published_at: daysAgo(12),
  },
];

function read<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    // Private browsing, cleared storage, or corrupt JSON — the seed is the right answer.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal: the change still applies for this session.
  }
}

const persistedNotes = read<ReleaseNote[] | null>(NOTES_KEY, null);
let notes: ReleaseNote[] = Array.isArray(persistedNotes) ? persistedNotes : SEED_NOTES.map((n) => ({ ...n }));
/** `{ [userId]: string[] }` — version tags each user has closed. */
let views = read<Record<string, string[]>>(VIEWS_KEY, {});
if (!views || typeof views !== 'object' || Array.isArray(views)) views = {};

const saveNotes = () => write(NOTES_KEY, notes);
const saveViews = () => write(VIEWS_KEY, views);

// WHY `version` alongside `version_tag`: same as the server's toReleaseDto — the editor pages read
// `version`, the popup and the ack endpoint read `version_tag`.
const toDto = (n: ReleaseNote): ReleaseNoteDto => ({ ...n, version: n.version_tag, highlights_json: n.highlights_json || [] });

const newestFirst = (a: ReleaseNote, b: ReleaseNote): number =>
  Date.parse(b.published_at) - Date.parse(a.published_at) || b.id - a.id;

const fail = (status: number, code: string, message_en: string, message_bn: string): MockReply<ErrorBody> => ({
  status,
  body: { error: { code, message_en, message_bn } },
});

/** Mirrors the server's sanitizeHighlights: `{ cards }` or `{ error }` (a handler response). */
function sanitizeHighlights(input: unknown): { cards: HighlightCard[]; error?: undefined } | { error: MockReply<ErrorBody> } {
  const invalid = (en: string, bn: string) => ({ error: fail(400, 'VALIDATION_FAILED', en, bn) });
  if (input == null) return { cards: [] };
  if (!Array.isArray(input)) return invalid('Highlights must be a list.', 'হাইলাইট একটি তালিকা হতে হবে।');
  const { maxItems, iconMax, titleMax, descMax } = HIGHLIGHT_LIMITS;
  if (input.length > maxItems) return invalid(`At most ${maxItems} highlights.`, `সর্বোচ্চ ${maxItems}টি হাইলাইট দেওয়া যায়।`);
  const cards: HighlightCard[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const h = input[i];
    const str = (v: unknown): string => String(v ?? '').trim();
    const icon = str(h?.icon);
    const titleEn = str(h?.title_en);
    const descEn = str(h?.desc_en);
    const titleBn = str(h?.title_bn) || titleEn;
    const descBn = str(h?.desc_bn) || descEn;
    const n = i + 1;
    if (!titleEn || !descEn) return invalid(`Highlight ${n} needs a title and a description.`, `হাইলাইট ${n} এ শিরোনাম ও বিবরণ দিতে হবে।`);
    if (icon.length > iconMax) return invalid(`Highlight ${n}: the icon must be one emoji.`, `হাইলাইট ${n}: আইকন একটি ইমোজি হতে হবে।`);
    if (titleEn.length > titleMax || titleBn.length > titleMax) {
      return invalid(`Highlight ${n}: title is longer than ${titleMax} characters.`, `হাইলাইট ${n}: শিরোনাম ${titleMax} অক্ষরের বেশি।`);
    }
    if (descEn.length > descMax || descBn.length > descMax) {
      return invalid(`Highlight ${n}: description is longer than ${descMax} characters.`, `হাইলাইট ${n}: বিবরণ ${descMax} অক্ষরের বেশি।`);
    }
    cards.push({ icon, title_en: titleEn, title_bn: titleBn, desc_en: descEn, desc_bn: descBn });
  }
  return { cards };
}

export function listReleaseNotes({ limit = 50, offset = 0 }: { limit?: number | string; offset?: number | string } = {}): {
  items: ReleaseNoteDto[];
  total: number;
  limit: number;
  offset: number;
} {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const sorted = [...notes].sort(newestFirst);
  return { items: sorted.slice(off, off + lim).map(toDto), total: notes.length, limit: lim, offset: off };
}

/** Returns `{ status, body }` like a handler, so validation errors match the live API. */
export function upsertReleaseNote(
  body: Partial<Omit<ReleaseNote, 'highlights_json'>> & { version?: string; highlights_json?: unknown } = {},
): MockReply<ErrorBody | { data: ReleaseNoteDto }> {
  const id = body.id ? Number(body.id) : null;
  const tag = String(body.version_tag ?? body.version ?? '').trim();
  const category = body.category || 'FEATURE';
  const audience = body.target_audience || 'ALL';
  const titleEn = String(body.title_en || '').trim();
  const summaryEn = String(body.summary_en || '').trim();
  const titleBn = String(body.title_bn || '').trim() || titleEn;
  const summaryBn = String(body.summary_bn || '').trim() || summaryEn;

  if (!tag || !titleEn || !summaryEn) {
    return fail(400, 'VALIDATION_FAILED', 'Version, title and summary are required.', 'ভার্সন, শিরোনাম ও বিবরণ দিতে হবে।');
  }
  if (tag.length > VERSION_TAG_MAX) {
    return fail(400, 'VALIDATION_FAILED', `Version tag must be at most ${VERSION_TAG_MAX} characters.`, `ভার্সন ট্যাগ সর্বোচ্চ ${VERSION_TAG_MAX} অক্ষর হতে পারে।`);
  }
  if (!RELEASE_CATEGORIES.includes(category)) {
    return fail(400, 'VALIDATION_FAILED', 'Unknown release category.', 'অজানা রিলিজ ক্যাটাগরি।');
  }
  if (!RELEASE_AUDIENCES.includes(audience)) {
    return fail(400, 'VALIDATION_FAILED', 'Unknown target audience.', 'অজানা লক্ষ্য দর্শক।');
  }
  // undefined means "keep the stored cards", as on the server.
  let cards: HighlightCard[] | null = null;
  if (body.highlights_json !== undefined) {
    const res = sanitizeHighlights(body.highlights_json);
    if (res.error) return res.error;
    cards = (res as { cards: HighlightCard[] }).cards;
  }
  if (notes.some((n) => n.version_tag === tag && n.id !== id)) {
    return fail(409, 'CONFLICT', `Version ${tag} is already published. Use a new version tag.`, `${tag} ভার্সন আগেই প্রকাশিত। নতুন ভার্সন ট্যাগ দিন।`);
  }

  const fields = {
    version_tag: tag, category, target_audience: audience,
    title_en: titleEn, title_bn: titleBn, summary_en: summaryEn, summary_bn: summaryBn,
  };

  let note: ReleaseNote | undefined;
  if (id) {
    note = notes.find((n) => n.id === id);
    if (!note) return fail(404, 'NOT_FOUND', `Release note #${id} not found.`, `রিলিজ নোট #${id} পাওয়া যায়নি।`);
    // published_at stays put on edit, as on the server.
    Object.assign(note, fields, { updated_at: new Date().toISOString() });
    if (cards !== null) note.highlights_json = cards;
  } else {
    note = {
      id: notes.reduce((max, n) => Math.max(max, n.id), 0) + 1,
      ...fields,
      highlights_json: cards || [],
      published_at: new Date().toISOString(),
    };
    notes.push(note);
  }
  saveNotes();
  return { status: 200, body: { data: toDto(note) } };
}

export function deleteReleaseNote(id: number | string): MockReply<ErrorBody | { data: { id: number; deleted: true } }> {
  const before = notes.length;
  notes = notes.filter((n) => n.id !== Number(id));
  if (notes.length === before) {
    return fail(404, 'NOT_FOUND', `Release note #${id} not found.`, `রিলিজ নোট #${id} পাওয়া যায়নি।`);
  }
  saveNotes();
  return { status: 200, body: { data: { id: Number(id), deleted: true } } };
}

/** The popup's answer: newest note for this viewer's audience, or null once they closed it. */
export function latestReleaseFor({
  userId = 'guest',
  role = null,
}: { userId?: string | number; role?: string | null } = {}): ReleaseNoteDto | null {
  const audiences = AUDIENCE_BY_ROLE[role] ? ['ALL', AUDIENCE_BY_ROLE[role]] : ['ALL'];
  const latest = notes
    .filter((n) => audiences.includes(n.target_audience) && Date.parse(n.published_at) <= Date.now())
    .sort(newestFirst)[0];
  if (!latest) return null;
  if ((views[userId] || []).includes(latest.version_tag)) return null;
  return toDto(latest);
}

export function markReleaseViewed({ userId = 'guest', versionTag }: { userId?: string | number; versionTag?: string }): void {
  if (!versionTag) return;
  const seen = views[userId] || [];
  if (!seen.includes(versionTag)) {
    views = { ...views, [userId]: [...seen, versionTag] };
    saveViews();
  }
}

/** Tests only: back to the seed with no acks. */
export function resetReleaseNotesForTests(): void {
  notes = SEED_NOTES.map((n) => ({ ...n }));
  views = {};
}
