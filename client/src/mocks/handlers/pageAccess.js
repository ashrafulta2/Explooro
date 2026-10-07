/**
 * mocks/handlers/pageAccess.js — per-page availability in mock mode.
 *
 *   GET /page-access   the viewer-facing map, read on every cold boot
 *   GET /admin/pages   every stored row, for /admin/platform/pages
 *   PUT /admin/pages   write one page's state
 *
 * Persisted to localStorage, not just to a module-level Map: the whole point of the feature is
 * that a page the super admin parks STAYS parked, and a mock that forgets on reload is the exact
 * failure that made the module switchboard look broken for nine phases (see mocks/moduleState.js).
 *
 * Validation is duplicated here in miniature — the lock list and the four states — so the mock
 * refuses what the real API refuses. client/test/pageAvailability.test.js asserts the lists match
 * services/pageAccess.js rather than letting them drift.
 */

import { PAGE_STATES, LOCKED_PATHS, normalizePath } from '../../services/pageAccess.js';

const STORAGE_KEY = 'explooro:mock:pageToggles';

function readPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** `{ [route_path]: { state, allowed_roles, allowed_user_ids, reason, updated_at } }` */
const toggles = new Map(Object.entries(readPersisted()));

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(toggles)));
  } catch {
    // Storage unavailable or full — persistence is a convenience, not a guarantee.
  }
}

/** The viewer-facing shape: parked rows only, because absence means LIVE. */
function publicMap() {
  const map = {};
  for (const [path, row] of toggles) {
    if (row.state === 'LIVE') continue;
    map[path] = {
      state: row.state,
      allowed_roles: row.allowed_roles ?? [],
      allowed_user_ids: row.allowed_user_ids ?? [],
    };
  }
  return map;
}

function validationError(messageEn, messageBn, details = {}) {
  return {
    status: 400,
    body: {
      error: {
        code: 'VALIDATION_FAILED',
        message_en: messageEn,
        message_bn: messageBn,
        details,
        trace_id: `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      },
    },
  };
}

export const pageAccessHandlers = [
  {
    method: 'GET',
    path: '/page-access',
    handler() {
      const pages = publicMap();
      return {
        status: 200,
        body: { pages, data: pages, states: PAGE_STATES, locked_paths: LOCKED_PATHS },
      };
    },
  },

  {
    method: 'GET',
    path: '/admin/pages',
    handler() {
      const pages = [...toggles.entries()]
        .map(([route_path, row]) => ({ route_path, ...row }))
        .sort((a, b) => a.route_path.localeCompare(b.route_path));
      return {
        status: 200,
        body: {
          pages,
          data: pages,
          states: PAGE_STATES,
          locked_paths: LOCKED_PATHS,
          history: [],
          can_toggle: true,
        },
      };
    },
  },

  {
    method: 'PUT',
    path: '/admin/pages',
    handler({ body }) {
      const path = normalizePath(body?.route_path);
      const state = body?.state;
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
      const allowedRoles = Array.isArray(body?.allowed_roles) ? body.allowed_roles : [];
      const allowedUserIds = Array.isArray(body?.allowed_user_ids) ? body.allowed_user_ids.map(String) : [];

      if (!path || !path.startsWith('/')) {
        return validationError(
          'route_path must be an absolute path beginning with "/".',
          'route_path অবশ্যই "/" দিয়ে শুরু হওয়া একটি পূর্ণ পাথ হতে হবে।',
          { field: 'route_path' }
        );
      }

      if (!PAGE_STATES.includes(state)) {
        return validationError(
          `state must be one of: ${PAGE_STATES.join(', ')}.`,
          `state এগুলোর একটি হতে হবে: ${PAGE_STATES.join(', ')}।`,
          { field: 'state', supported: PAGE_STATES }
        );
      }

      if (LOCKED_PATHS.includes(path) && state !== 'LIVE') {
        return {
          status: 400,
          body: {
            error: {
              code: 'PAGE_LOCKED',
              message_en: `"${path}" cannot be switched off — it is one of the pages that would lock you out.`,
              message_bn: `"${path}" বন্ধ করা যাবে না — এটি বন্ধ করলে আপনি নিজেই ঢুকতে পারবেন না।`,
              details: { field: 'route_path', locked_paths: LOCKED_PATHS },
            },
          },
        };
      }

      if (state === 'LIMITED' && allowedRoles.length === 0 && allowedUserIds.length === 0) {
        return validationError(
          'A limited page needs at least one allowed role or user — otherwise it is hidden from everyone, which is what HIDDEN is for.',
          'সীমিত পেজের জন্য অন্তত একটি রোল বা ইউজার দিতে হবে — নাহলে এটি সবার কাছেই লুকানো থাকবে, যার জন্য HIDDEN আছে।',
          { field: 'allowed_roles' }
        );
      }

      if (reason.length < 10) {
        return validationError(
          'Give a reason of at least 10 characters for this change.',
          'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।',
          { field: 'reason' }
        );
      }

      const before = toggles.get(path) ?? { state: 'LIVE', allowed_roles: [], allowed_user_ids: [] };
      const after = {
        state,
        // Only LIMITED reads them — clearing otherwise stops a stale rollout list from coming back.
        allowed_roles: state === 'LIMITED' ? allowedRoles : [],
        allowed_user_ids: state === 'LIMITED' ? allowedUserIds : [],
        reason,
        updated_at: new Date().toISOString(),
      };

      if (state === 'LIVE') toggles.delete(path);
      else toggles.set(path, after);
      persist();

      return {
        status: 200,
        body: {
          data: { page: { route_path: path, ...after }, before: { route_path: path, ...before } },
          message_en: `"${path}" is now ${state}.`,
          message_bn: `"${path}" এখন ${state}।`,
        },
      };
    },
  },
];

export default pageAccessHandlers;
