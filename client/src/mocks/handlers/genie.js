/**
 * genie.js — Mock API handlers for the popup genie-effect policy.
 *
 * Mirrors server/src/routes/genie.routes.js so the whole feature is demonstrable with
 * VITE_API_MODE=mock and no database (Master Instruction: every integration ships a mock driver).
 *
 * The policy persists to localStorage rather than a module-scope variable: the thing being tested is
 * "does the setting survive a reload?", and a mock that forgets on refresh would make a broken
 * implementation look like a working one (the same reason handlers/localization.js does this).
 */

import { GENIE_DEFAULTS, GENIE_LIMITS, GENIE_QUALITIES } from '../../lib/genie.js';

const STORAGE_KEY = 'explooro:mock:genie:policy';

const DEFAULT_POLICY = { ...GENIE_DEFAULTS, updated_at: null, updated_by: null };

const isDuration = (n) =>
  Number.isInteger(n) && n >= GENIE_LIMITS.minDurationMs && n <= GENIE_LIMITS.maxDurationMs;

function loadPolicy() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && isDuration(parsed.duration_ms) && GENIE_QUALITIES.includes(parsed.quality)) {
          return { ...DEFAULT_POLICY, ...parsed };
        }
      }
    }
  } catch {
    // Private browsing or cleared storage — the shipped default is the right answer.
  }
  return { ...DEFAULT_POLICY };
}

let mockPolicy = loadPolicy();
let mockHistory = [];

function savePolicy() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(mockPolicy));
  } catch {
    // Non-fatal: the change still applies for this session.
  }
}

const bad = (message_en, message_bn) => ({ code: 'VALIDATION_FAILED', message_en, message_bn });

/** The same rules as genie.service.js validatePolicy(), in the same order, with the same messages. */
function validate(body) {
  const { enabled, duration_ms: durationMs, quality, reason } = body;
  if (typeof enabled !== 'boolean') {
    return bad('The popup effect switch must be true or false.', 'পপআপ ইফেক্টের সুইচ true অথবা false হতে হবে।');
  }
  if (!isDuration(durationMs)) {
    return bad(
      `Duration must be a whole number of milliseconds between ${GENIE_LIMITS.minDurationMs} and ${GENIE_LIMITS.maxDurationMs}.`,
      `সময় ${GENIE_LIMITS.minDurationMs} থেকে ${GENIE_LIMITS.maxDurationMs} মিলিসেকেন্ডের মধ্যে একটি পূর্ণসংখ্যা হতে হবে।`
    );
  }
  if (typeof quality !== 'string' || !GENIE_QUALITIES.includes(quality)) {
    return bad(
      `Smoothness must be one of: ${GENIE_QUALITIES.join(', ')}.`,
      `মসৃণতা এগুলোর একটি হতে হবে: ${GENIE_QUALITIES.join(', ')}।`
    );
  }
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    return bad('Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।');
  }
  return null;
}

const pick = (p) => ({ enabled: p.enabled, duration_ms: p.duration_ms, quality: p.quality });
const limits = () => ({ min_duration_ms: GENIE_LIMITS.minDurationMs, max_duration_ms: GENIE_LIMITS.maxDurationMs });

export const genieHandlers = [
  // Public: what the client applies at boot.
  {
    method: 'GET',
    path: '/genie/policy',
    handler() {
      return { status: 200, body: { policy: pick(mockPolicy), limits: limits(), qualities: [...GENIE_QUALITIES] } };
    },
  },

  // Admin read: policy + who may change it + recent history.
  {
    method: 'GET',
    path: '/admin/platform/genie',
    handler() {
      return {
        status: 200,
        body: {
          policy: { ...mockPolicy },
          limits: limits(),
          qualities: [...GENIE_QUALITIES],
          authority: {
            roles: [{ key: 'super_admin', label_en: 'Super Admin', label_bn: 'সুপার অ্যাডমিন' }],
            grants: [
              {
                id: 1,
                user_id: 42,
                user_ref: 'USR-4F2A91',
                full_name: 'Tanvir Ahmed',
                display_name: 'Tanvir (Design Lead)',
                effect: 'GRANT',
                reason: 'Tunes storefront motion for the campaign builds.',
                expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
                created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
              },
            ],
          },
          history: mockHistory,
          can_update: true,
        },
      };
    },
  },

  {
    method: 'PUT',
    path: '/admin/platform/genie',
    handler({ body = {} } = {}) {
      const error = validate(body);
      if (error) return { status: 400, body: { error } };

      const before = pick(mockPolicy);
      mockPolicy = {
        enabled: body.enabled,
        duration_ms: body.duration_ms,
        quality: body.quality,
        updated_at: new Date().toISOString(),
        updated_by: 1,
      };
      savePolicy();

      mockHistory.unshift({
        id: mockHistory.length + 1,
        action: 'platform.genie.update',
        actor_ref: 'USR-SUPERADMIN',
        risk_tier: 'MEDIUM',
        created_at: mockPolicy.updated_at,
        before_json: before,
        after_json: { ...pick(mockPolicy), meta: { reason: body.reason.trim() } },
      });
      mockHistory = mockHistory.slice(0, 10);

      return {
        status: 200,
        body: {
          policy: { ...mockPolicy },
          message_en: 'Popup effect updated. Visitors get it on their next page load.',
          message_bn: 'পপআপ ইফেক্ট হালনাগাদ হয়েছে। দর্শনার্থীরা পরবর্তী পেজ লোডেই এটি পাবেন।',
        },
      };
    },
  },
];

export default genieHandlers;
