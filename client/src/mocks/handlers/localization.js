/**
 * localization.js — Mock API handlers for the Language & Localization policy.
 *
 * Mirrors server/src/routes/localization.routes.js so the whole feature is demonstrable with
 * VITE_API_MODE=mock and no database, per the Master Instruction that every integration ships a
 * mock driver and defaults to it in development.
 *
 * The policy persists to localStorage rather than living in a module-scope variable, because the
 * thing being tested is "does the default survive a reload?" — a mock that forgets on refresh
 * would make a broken implementation look like a working one, which is the failure the theme mock
 * handler was written to fix.
 */

const STORAGE_KEY = 'explooro:mock:localization:policy';

const SUPPORTED_LOCALES = ['en', 'bn'];

const DEFAULT_POLICY = {
  default_locale: 'en',
  enabled_locales: ['bn', 'en'],
  allow_user_override: true,
  updated_at: null,
  updated_by: null,
};

function loadPolicy() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && SUPPORTED_LOCALES.includes(parsed.default_locale)) {
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
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mockPolicy));
    }
  } catch {
    // Non-fatal: the change still applies for this session.
  }
}

/** The same four rules as localization.service.js validatePolicy(), same order, same messages. */
function validate(body) {
  const { default_locale: defaultLocale, enabled_locales: enabledLocales, allow_user_override: allowOverride, reason } = body;

  if (typeof defaultLocale !== 'string' || !SUPPORTED_LOCALES.includes(defaultLocale)) {
    return {
      code: 'VALIDATION_ERROR',
      message_en: `Default language must be one of: ${SUPPORTED_LOCALES.join(', ')}.`,
      message_bn: `ডিফল্ট ভাষা এগুলোর একটি হতে হবে: ${SUPPORTED_LOCALES.join(', ')}।`,
    };
  }
  if (!Array.isArray(enabledLocales) || enabledLocales.length === 0) {
    return {
      code: 'VALIDATION_ERROR',
      message_en: 'At least one language must stay enabled.',
      message_bn: 'অন্তত একটি ভাষা সক্রিয় রাখতে হবে।',
    };
  }
  if (!enabledLocales.includes(defaultLocale)) {
    return {
      code: 'VALIDATION_ERROR',
      message_en: 'The default language must also be enabled.',
      message_bn: 'ডিফল্ট ভাষাটিও সক্রিয় থাকতে হবে।',
    };
  }
  if (typeof allowOverride !== 'boolean') {
    return {
      code: 'VALIDATION_ERROR',
      message_en: 'Visitor language choice must be true or false.',
      message_bn: 'দর্শনার্থীর ভাষা নির্বাচন true অথবা false হতে হবে।',
    };
  }
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    return {
      code: 'VALIDATION_ERROR',
      message_en: 'Give a reason of at least 10 characters for this change.',
      message_bn: 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।',
    };
  }
  return null;
}

export const localizationHandlers = [
  // Public: what the client boots from.
  {
    method: 'GET',
    path: '/localization/policy',
    handler() {
      return {
        status: 200,
        body: {
          policy: {
            default_locale: mockPolicy.default_locale,
            enabled_locales: mockPolicy.enabled_locales,
            allow_user_override: mockPolicy.allow_user_override,
          },
          supported_locales: SUPPORTED_LOCALES,
        },
      };
    },
  },

  // Admin read: policy + who may change it + recent history.
  {
    method: 'GET',
    path: '/admin/platform/localization',
    handler() {
      return {
        status: 200,
        body: {
          policy: { ...mockPolicy },
          supported_locales: SUPPORTED_LOCALES,
          authority: {
            roles: [{ key: 'super_admin', label_en: 'Super Admin', label_bn: 'সুপার অ্যাডমিন' }],
            grants: [
              {
                id: 1,
                user_id: 42,
                user_ref: 'USR-4F2A91',
                full_name: 'Nusrat Jahan',
                display_name: 'Nusrat (Content Lead)',
                effect: 'GRANT',
                reason: 'Owns the Bangla rollout for the Eid campaign window.',
                expires_at: new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString(),
                created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
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
    path: '/admin/platform/localization',
    handler({ body = {} } = {}) {
      const error = validate(body);
      if (error) {
        return { status: 400, body: { error } };
      }

      const before = {
        default_locale: mockPolicy.default_locale,
        enabled_locales: [...mockPolicy.enabled_locales],
        allow_user_override: mockPolicy.allow_user_override,
      };

      mockPolicy = {
        default_locale: body.default_locale,
        enabled_locales: [...new Set(body.enabled_locales)].sort(),
        allow_user_override: body.allow_user_override,
        updated_at: new Date().toISOString(),
        updated_by: 1,
      };
      savePolicy();

      mockHistory.unshift({
        id: mockHistory.length + 1,
        action: 'platform.localization.update',
        actor_ref: 'USR-SUPERADMIN',
        risk_tier: 'MEDIUM',
        created_at: mockPolicy.updated_at,
        before_json: before,
        after_json: {
          default_locale: mockPolicy.default_locale,
          enabled_locales: mockPolicy.enabled_locales,
          allow_user_override: mockPolicy.allow_user_override,
        },
        after: { meta: { reason: body.reason.trim() } },
      });
      mockHistory = mockHistory.slice(0, 10);

      return {
        status: 200,
        body: {
          policy: { ...mockPolicy },
          message_en: 'Default language updated. New visitors will see it immediately.',
          message_bn: 'ডিফল্ট ভাষা হালনাগাদ হয়েছে। নতুন দর্শনার্থীরা সঙ্গে সঙ্গে এটি দেখবেন।',
        },
      };
    },
  },
];

export default localizationHandlers;
