/**
 * media.js — Mock media upload, so avatar/photo pickers work with VITE_API_MODE=mock.
 *
 * The real POST /media/direct pushes bytes through sharp and the storage driver and hands back a
 * `media_assets` row. Here the browser already holds the bytes as a data URL, so the "asset" is
 * just that string under a synthetic numeric id — ids stay numeric because the server validates
 * `avatar_media_id` as digits, and a mock that handed back `med-abc` would let a payload through
 * in dev that the live API rejects.
 *
 * Persisted to sessionStorage for the tab's lifetime, matching handlers/auth.js's mock session:
 * a page reload must not blank out the avatar the developer just picked.
 */

const STORE_KEY = 'explooro.mock.media';
// 6-digit floor keeps mock ids clear of the fixture ids other handlers hardcode.
const ID_FLOOR = 900_000;

function loadStore() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* sessionStorage unavailable (private mode, quota) — in-memory only for this page view */
  }
}

let assets = loadStore();

/** Resolves a mock media id to its data URL. Used by handlers/me.js to render an avatar. */
export function resolveMockMediaUrl(id) {
  if (id === null || id === undefined) return null;
  return assets[String(id)]?.url ?? null;
}

export default [
  {
    method: 'POST',
    path: '/media/direct',
    handler({ body }) {
      const dataUrl = body?.data_base64 || '';
      if (!dataUrl) {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message_en: 'No image data was received.',
              message_bn: 'কোনো ছবির ডেটা পাওয়া যায়নি।',
            },
          },
        };
      }

      const id = ID_FLOOR + Object.keys(assets).length + 1;
      const asset = {
        id,
        ref: `MED-MOCK-${id}`,
        purpose: (body?.purpose || 'PRODUCT').toUpperCase(),
        mime_type: /^data:([^;]+);/.exec(dataUrl)?.[1] || 'image/webp',
        url: dataUrl,
        created_at: new Date().toISOString(),
      };

      assets = { ...assets, [String(id)]: asset };
      saveStore(assets);

      return { status: 201, body: { asset } };
    },
  },
];
