/**
 * theme.js — Mock API handlers for Theme Studio (Prompt 3.5).
 *
 * WHY this file had to exist: core/api.js resolves every call against these mock handlers unless
 * VITE_API_MODE=live, and no theme handler was ever registered — every theme.* request (active
 * theme lookup, draft save, publish, rename, delete) silently 404'd. The Studio's live colour
 * preview still worked (it calls applyTheme() directly, not through the API), which made a saved
 * theme LOOK like it persisted. It never did: reopening Theme Studio re-fetched `/theme/active`,
 * got a 404, and fell back to the shipped default — the exact bug this file fixes.
 */
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../../config/master-themes.js';

const STORAGE_KEY = 'explooro:mock:theme:palettes';

function loadStoredPalettes() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch {
    // fallback
  }
  return [
    {
      id: 1,
      name: 'Midnight Slate (Shipped Default)',
      preset_key: DEFAULT_MASTER_PRESET,
      is_active: true,
      is_published: true,
      tokens_json: { master: { ...MASTER_PRESETS[DEFAULT_MASTER_PRESET].master } },
      created_by: 1,
      published_by: 1,
      created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    },
  ];
}

let mockPalettes = loadStoredPalettes();
let nextId = Math.max(1, ...mockPalettes.map((p) => p.id || 1)) + 1;

function saveStoredPalettes() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mockPalettes));
    }
  } catch {
    // fallback
  }
}

function notFound(id) {
  return {
    status: 404,
    body: {
      error: {
        code: 'NOT_FOUND',
        message_en: `Theme palette #${id} not found.`,
        message_bn: `থিম প্যালেট #${id} পাওয়া যায়নি।`,
      },
    },
  };
}

function sortedPalettes() {
  return [...mockPalettes].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });
}

export const themeHandlers = [
  {
    method: 'GET',
    path: '/theme/active',
    handler() {
      const active = mockPalettes.find((p) => p.is_active) ?? null;
      return { status: 200, body: { theme: active, tokens: active?.tokens_json ?? null } };
    },
  },
  {
    method: 'GET',
    path: '/admin/theme/palettes',
    handler() {
      return { status: 200, body: { palettes: sortedPalettes() } };
    },
  },
  {
    method: 'POST',
    path: '/admin/theme/draft',
    handler({ body }) {
      const { name, preset_key = null, tokens } = body || {};
      const now = new Date().toISOString();
      const draft = {
        id: nextId++,
        name: (name && name.trim()) || 'Custom Theme Draft',
        preset_key,
        is_active: false,
        is_published: false,
        tokens_json: tokens || {},
        created_by: 1,
        published_by: null,
        created_at: now,
        updated_at: now,
      };
      mockPalettes.push(draft);
      saveStoredPalettes();
      return { status: 201, body: { draft } };
    },
  },
  {
    method: 'PATCH',
    path: '/admin/theme/:id',
    handler({ params, body }) {
      const id = Number(params.id);
      const target = mockPalettes.find((p) => p.id === id);
      if (!target) return notFound(id);

      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: 'A theme name is required.',
              message_bn: 'থিমের নাম আবশ্যক।',
            },
          },
        };
      }

      target.name = name;
      target.updated_at = new Date().toISOString();
      saveStoredPalettes();
      return { status: 200, body: { palette: target } };
    },
  },
  {
    method: 'DELETE',
    path: '/admin/theme/:id',
    handler({ params }) {
      const id = Number(params.id);
      const target = mockPalettes.find((p) => p.id === id);
      if (!target) return notFound(id);

      if (target.is_active) {
        return {
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message_en: 'The theme currently live on the site cannot be deleted. Publish a different theme first.',
              message_bn: 'সাইটে বর্তমানে লাইভ থাকা থিম মুছে ফেলা যাবে না। প্রথমে অন্য একটি থিম পাবলিশ করুন।',
            },
          },
        };
      }

      mockPalettes = mockPalettes.filter((p) => p.id !== id);
      saveStoredPalettes();
      return { status: 200, body: { deleted: { id } } };
    },
  },
  {
    method: 'POST',
    path: '/admin/theme/:id/publish',
    handler({ params }) {
      const id = Number(params.id);
      const target = mockPalettes.find((p) => p.id === id);
      if (!target) return notFound(id);

      const now = new Date().toISOString();
      mockPalettes.forEach((p) => { p.is_active = false; });
      target.is_active = true;
      target.is_published = true;
      target.published_by = 1;
      target.updated_at = now;
      saveStoredPalettes();

      return { status: 200, body: { published: target } };
    },
  },
  {
    method: 'POST',
    path: '/admin/theme/validate-contrast',
    handler({ body }) {
      const tokens = body?.tokens || {};
      return {
        status: 200,
        body: {
          valid: true,
          master_applied: Boolean(tokens.master),
          master: tokens.master ?? null,
          effective_tokens: null,
        },
      };
    },
  },
];

export default themeHandlers;
