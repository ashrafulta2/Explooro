/**
 * attribution.js — remembers which shop partner sent this shopper here, so their sale credits them.
 *
 * A "touch" is the last storefront the shopper visited (`STORE`, by slug) or the last tracked
 * short link they opened (`LINK`, by code, arriving as `?ref=<code>`). The latest touch wins. It is
 * sent with every add-to-cart; the server (attribution.service.ts) alone decides whether it still
 * counts — its age against the admin's window, whether that partner sells the product, and that the
 * shopper is not the partner. So nothing here expires or validates anything; it only remembers.
 *
 * WHY localStorage, not a cookie: it must survive the shopper closing the tab and coming back days
 * later, and only this client ever reads it. Every access is guarded: private windows and blocked
 * storage simply mean no touch, never a broken page.
 */

const STORAGE_KEY = 'explooro.attribution';
// Mirrors the server's bound (attribution.service.ts MAX_REF_LENGTH); a longer ref is not ours.
const MAX_REF_LENGTH = 120;

function save(touch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(touch));
  } catch {
    // Storage unavailable: the touch is simply not remembered.
  }
}

/** Records a touch now. Ignores anything that is not a plausible slug or code. */
export function recordTouch(type, ref) {
  if (type !== 'STORE' && type !== 'LINK') return;
  const clean = String(ref || '').trim().toLowerCase();
  if (!clean || clean.length > MAX_REF_LENGTH) return;
  save({ type, ref: clean, at: new Date().toISOString() });
}

/** The latest touch, or null. */
export function currentTouch() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || (raw.type !== 'STORE' && raw.type !== 'LINK') || typeof raw.ref !== 'string') return null;
    return { type: raw.type, ref: raw.ref, at: String(raw.at || '') };
  } catch {
    return null;
  }
}

/** Called on every navigation: a page opened through a short link carries `?ref=<code>`. */
export function captureTouchFromQuery(query) {
  const code = query?.ref;
  if (typeof code === 'string' && code) recordTouch('LINK', code);
}
