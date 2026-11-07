/**
 * flyerDesigns.ts — Mock API handlers for saved Flyer Studio designs.
 *
 * Mirrors server/src/routes/flyerDesign.routes.ts and services/flyerDesign.service.ts: the same
 * answers ({ data: { keys, limit } }), the same 60-design limit with the oldest dropped, the same
 * key shape refused with 400, and a merge that keeps what was already saved.
 *
 * WHY localStorage, one list per mock user: the thing being demonstrated is "my saved designs
 * follow me" — a list that forgot on reload, or that a second dev account could see, would make a
 * broken implementation look like a working one.
 */

import { getMockSessionUser } from './auth.ts';
import type { MockRoute } from '../types.ts';

const LIMIT = 60;
// Same pattern as DESIGN_KEY_RE in server/src/services/flyerDesign.service.ts.
const KEY_RE = /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[0-9]{1,2}$/;

function storageKey() {
  const user = getMockSessionUser() as { id?: string | number } | null;
  return `explooro:mock:flyer-designs:${user?.id ?? 'anon'}`;
}

function read(): string[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(storageKey()) || '[]');
    return Array.isArray(raw) ? raw.filter((k) => KEY_RE.test(k)) : [];
  } catch {
    return [];
  }
}

function write(keys: string[]) {
  const kept = keys.slice(0, LIMIT);
  try { globalThis.localStorage?.setItem(storageKey(), JSON.stringify(kept)); } catch { /* storage blocked: answer anyway */ }
  return { data: { keys: kept, limit: LIMIT } };
}

const badKey = { status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'That is not a flyer design.', message_bn: 'এটি কোনো ফ্লায়ার ডিজাইন নয়।' } } };

const flyerDesignHandlers: MockRoute[] = [
  { method: 'GET', path: '/me/flyer-designs', handler: () => ({ data: { keys: read().slice(0, LIMIT), limit: LIMIT } }) },
  {
    method: 'PUT',
    path: '/me/flyer-designs/:key',
    handler: ({ params }) => {
      const key = decodeURIComponent(params?.key || '');
      if (!KEY_RE.test(key)) return badKey;
      return write([key, ...read().filter((k) => k !== key)]);
    },
  },
  {
    method: 'DELETE',
    path: '/me/flyer-designs/:key',
    handler: ({ params }) => {
      const key = decodeURIComponent(params?.key || '');
      if (!KEY_RE.test(key)) return badKey;
      return write(read().filter((k) => k !== key));
    },
  },
  {
    method: 'POST',
    path: '/me/flyer-designs/merge',
    handler: ({ body }) => {
      const current = read();
      const incoming = [...new Set<string>((Array.isArray(body?.keys) ? body.keys : []).map(String).filter((k) => KEY_RE.test(k)))]
        .slice(0, LIMIT)
        .filter((k) => !current.includes(k));
      return write([...incoming, ...current]);
    },
  },
];

export default flyerDesignHandlers;
