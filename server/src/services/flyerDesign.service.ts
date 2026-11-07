/**
 * flyerDesign.service.ts — the Flyer Studio designs a person saved, kept on the server so they
 * follow the person across devices (migration 110).
 *
 * Every call answers with the person's whole list, newest first, so the client never has to work
 * out what the server ended up keeping (a save past the limit drops the oldest).
 */

import { withTransaction } from '../config/db.ts';
import { AppError } from '../plugins/errorHandler.ts';
import * as repo from '../repositories/flyerDesign.repository.ts';

/**
 * WHY a fixed cap and not a setting: this is a storage bound for one person's bookmarks, not a
 * business number anyone tunes; the studio shows them as one gallery page. The client reads it from
 * every answer (`limit`) instead of keeping its own copy.
 */
export const SAVED_LIMIT = 60;

/**
 * occasion.layout.palette.pattern.headline — the same shape the table's CHECK enforces.
 * Only the shape: the ids belong to the client's design library (see the migration's comment).
 */
export const DESIGN_KEY_RE = /^[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}\.[0-9]{1,2}$/;

export function assertDesignKey(key: unknown): string {
  const value = String(key ?? '');
  if (!DESIGN_KEY_RE.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'That is not a flyer design.', 'এটি কোনো ফ্লায়ার ডিজাইন নয়।', { field: 'key' });
  }
  return value;
}

export interface SavedDesigns { keys: string[]; limit: number }

const answer = (keys: string[]): SavedDesigns => ({ keys, limit: SAVED_LIMIT });

export async function list(db, userId: number): Promise<SavedDesigns> {
  return answer(await repo.listKeys(db, userId, SAVED_LIMIT));
}

/** Saves one design at the top of the list; past the limit the oldest one goes. */
export async function save(db, userId: number, key: unknown): Promise<SavedDesigns> {
  const designKey = assertDesignKey(key);
  return withTransaction(db, async (client) => {
    await repo.upsertKeys(client, userId, [designKey], [new Date()]);
    await repo.trimToLimit(client, userId, SAVED_LIMIT);
    return answer(await repo.listKeys(client, userId, SAVED_LIMIT));
  });
}

export async function remove(db, userId: number, key: unknown): Promise<SavedDesigns> {
  const designKey = assertDesignKey(key);
  await repo.deleteKey(db, userId, designKey);
  return list(db, userId);
}

/**
 * Brings in designs saved on a device before sync existed (they live in that browser's storage).
 * `keys` is newest first. Keys already on the server keep their place; new ones go on top in the
 * order given; the list is then cut to the limit. Malformed keys are skipped, not refused, because
 * old browser storage is not something the person can fix.
 */
export async function merge(db, userId: number, keys: unknown): Promise<SavedDesigns> {
  const incoming = Array.isArray(keys) ? keys : [];
  const valid = [...new Set(incoming.map((k) => String(k ?? '')).filter((k) => DESIGN_KEY_RE.test(k)))].slice(0, SAVED_LIMIT);
  return withTransaction(db, async (client) => {
    if (valid.length) {
      // One millisecond apart, newest first, so the list keeps the order the device had.
      const now = Date.now();
      await repo.insertMissingKeys(client, userId, valid, valid.map((_, i) => new Date(now - i)));
      await repo.trimToLimit(client, userId, SAVED_LIMIT);
    }
    return answer(await repo.listKeys(client, userId, SAVED_LIMIT));
  });
}
