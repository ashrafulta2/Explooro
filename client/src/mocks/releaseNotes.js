/**
 * mocks/releaseNotes.js — the one release-note store the mock API serves the What's New feature from.
 *
 * WHY this file exists: the popup (GET /notifications/whats-new, handlers/notifications.js) answered
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

export const RELEASE_CATEGORIES = ['FEATURE', 'IMPROVEMENT', 'SECURITY', 'FIX'];
export const RELEASE_AUDIENCES = ['ALL', 'SALERS', 'SUPPLIERS'];
const VERSION_TAG_MAX = 32;
const AUDIENCE_BY_ROLE = { saler: 'SALERS', supplier: 'SUPPLIERS' };

const NOTES_KEY = 'explooro:mock:release-notes';
const VIEWS_KEY = 'explooro:mock:release-views';

const daysAgo = (d) => new Date(Date.now() - 86400000 * d).toISOString();

const SEED_NOTES = [
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

function read(key, fallback) {
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

function write(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal: the change still applies for this session.
  }
}

const persistedNotes = read(NOTES_KEY, null);
let notes = Array.isArray(persistedNotes) ? persistedNotes : SEED_NOTES.map((n) => ({ ...n }));
/** `{ [userId]: string[] }` — version tags each user has closed. */
let views = read(VIEWS_KEY, {});
if (!views || typeof views !== 'object' || Array.isArray(views)) views = {};

const saveNotes = () => write(NOTES_KEY, notes);
const saveViews = () => write(VIEWS_KEY, views);

// WHY `version` alongside `version_tag`: same as the server's toReleaseDto — the editor pages read
// `version`, the popup and the ack endpoint read `version_tag`.
const toDto = (n) => ({ ...n, version: n.version_tag, highlights_json: n.highlights_json || [] });

const newestFirst = (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || b.id - a.id;

const fail = (status, code, message_en, message_bn) => ({ status, body: { error: { code, message_en, message_bn } } });

export function listReleaseNotes({ limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const sorted = [...notes].sort(newestFirst);
  return { items: sorted.slice(off, off + lim).map(toDto), total: notes.length, limit: lim, offset: off };
}

/** Returns `{ status, body }` like a handler, so validation errors match the live API. */
export function upsertReleaseNote(body = {}) {
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
  if (notes.some((n) => n.version_tag === tag && n.id !== id)) {
    return fail(409, 'CONFLICT', `Version ${tag} is already published. Use a new version tag.`, `${tag} ভার্সন আগেই প্রকাশিত। নতুন ভার্সন ট্যাগ দিন।`);
  }

  const fields = {
    version_tag: tag, category, target_audience: audience,
    title_en: titleEn, title_bn: titleBn, summary_en: summaryEn, summary_bn: summaryBn,
  };

  let note;
  if (id) {
    note = notes.find((n) => n.id === id);
    if (!note) return fail(404, 'NOT_FOUND', `Release note #${id} not found.`, `রিলিজ নোট #${id} পাওয়া যায়নি।`);
    // published_at stays put on edit, as on the server.
    Object.assign(note, fields, { updated_at: new Date().toISOString() });
  } else {
    note = {
      id: notes.reduce((max, n) => Math.max(max, n.id), 0) + 1,
      ...fields,
      highlights_json: [],
      published_at: new Date().toISOString(),
    };
    notes.push(note);
  }
  saveNotes();
  return { status: 200, body: { data: toDto(note) } };
}

export function deleteReleaseNote(id) {
  const before = notes.length;
  notes = notes.filter((n) => n.id !== Number(id));
  if (notes.length === before) {
    return fail(404, 'NOT_FOUND', `Release note #${id} not found.`, `রিলিজ নোট #${id} পাওয়া যায়নি।`);
  }
  saveNotes();
  return { status: 200, body: { data: { id: Number(id), deleted: true } } };
}

/** The popup's answer: newest note for this viewer's audience, or null once they closed it. */
export function latestReleaseFor({ userId = 'guest', role = null } = {}) {
  const audiences = AUDIENCE_BY_ROLE[role] ? ['ALL', AUDIENCE_BY_ROLE[role]] : ['ALL'];
  const latest = notes
    .filter((n) => audiences.includes(n.target_audience) && Date.parse(n.published_at) <= Date.now())
    .sort(newestFirst)[0];
  if (!latest) return null;
  if ((views[userId] || []).includes(latest.version_tag)) return null;
  return toDto(latest);
}

export function markReleaseViewed({ userId = 'guest', versionTag }) {
  if (!versionTag) return;
  const seen = views[userId] || [];
  if (!seen.includes(versionTag)) {
    views = { ...views, [userId]: [...seen, versionTag] };
    saveViews();
  }
}

/** Tests only: back to the seed with no acks. */
export function resetReleaseNotesForTests() {
  notes = SEED_NOTES.map((n) => ({ ...n }));
  views = {};
}
