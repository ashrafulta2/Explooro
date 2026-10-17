/**
 * attribution.js — Mock API handlers for the sale attribution window (/admin/growth/attribution).
 *
 * Mirrors server/src/routes/attributionAdmin.routes.ts. Persisted to localStorage, as
 * handlers/delivery.js is, so "does the save survive a reload?" can be checked in mock mode.
 */

const STORAGE_KEY = 'explooro:mock:attribution:policy';
// Mirrors attribution.service.ts WINDOW_LIMITS and the migration 076 seed.
const LIMITS = { min: 1, max: 90 };
const DEFAULT_POLICY = { window_days: 7, updated_at: null, updated_by: null };
const MIN_REASON_LENGTH = 10;

function loadPolicy() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Number.isInteger(parsed?.window_days)) return { ...DEFAULT_POLICY, ...parsed };
  } catch {
    // Private browsing — the shipped default.
  }
  return { ...DEFAULT_POLICY };
}

let mockPolicy = loadPolicy();
const mockHistory = [];

const MOCK_STATS = {
  storefront: { parcels: 42, commission: '3360.00' },
  short_link: { parcels: 17, commission: '1530.00' },
  other: { parcels: 0, commission: '0' },
  unattributed: { parcels: 88, commission: '0' },
};

const bad = (message_en, message_bn) => ({ status: 400, body: { error: { code: 'VALIDATION_FAILED', message_en, message_bn } } });

export const attributionHandlers = [
  {
    method: 'GET',
    path: '/admin/growth/attribution',
    handler() {
      return {
        status: 200,
        body: { policy: { ...mockPolicy }, limits: { ...LIMITS }, stats: MOCK_STATS, history: mockHistory, can_update: true },
      };
    },
  },
  {
    method: 'PUT',
    path: '/admin/growth/attribution',
    handler({ body = {} } = {}) {
      const days = body.window_days;
      if (!Number.isInteger(days) || days < LIMITS.min || days > LIMITS.max) {
        return bad(
          `The attribution window must be a whole number of days from ${LIMITS.min} to ${LIMITS.max}.`,
          `অ্যাট্রিবিউশন উইন্ডো ${LIMITS.min} থেকে ${LIMITS.max} দিনের মধ্যে পূর্ণ সংখ্যা হতে হবে।`
        );
      }
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason.length < MIN_REASON_LENGTH) {
        return bad(
          `Give a reason of at least ${MIN_REASON_LENGTH} characters for this change.`,
          `এই পরিবর্তনের জন্য অন্তত ${MIN_REASON_LENGTH} অক্ষরের একটি কারণ লিখুন।`
        );
      }
      const before = mockPolicy.window_days;
      mockPolicy = { window_days: days, updated_at: new Date().toISOString(), updated_by: 1 };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mockPolicy));
      } catch {
        // Not persisted; still applies for this session.
      }
      mockHistory.unshift({
        created_at: mockPolicy.updated_at,
        actor_ref: 'USR-SUPERADMIN',
        before_json: { window_days: before },
        after_json: { window_days: days },
        meta_json: { reason },
      });
      return {
        status: 200,
        body: {
          policy: { ...mockPolicy },
          message_en: 'Attribution window updated. Items added to a cart from now on use it.',
          message_bn: 'অ্যাট্রিবিউশন উইন্ডো হালনাগাদ হয়েছে। এখন থেকে কার্টে যোগ হওয়া পণ্যে এটি প্রযোজ্য।',
        },
      };
    },
  },
];
