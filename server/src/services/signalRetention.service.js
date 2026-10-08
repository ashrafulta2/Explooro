/**
 * signalRetention.service.js — Enforces `retention_days` on the behavioural event log.
 *
 * Migration 055 seeds personalization_signals.settings_json.retention_days (7..730, default 180) but
 * nothing read it, so product_interaction_events and search_events grew forever. This is the reader:
 * it deletes rows older than the cutoff from BOTH tables, in bounded batches so one run cannot lock
 * either table, and reports what it did for job_runs.
 *
 * Interaction with co-visitation: covisit.service.js reads `window_days` (default 60, max 365) of
 * events. Retention deletes the events it would read, so a retention SHORTER than window_days quietly
 * shortens the effective window to retention_days. The run reports that (`shortensCovisitWindow`)
 * rather than overriding either number - they are two owners' settings, and the right fix is theirs.
 */

import * as signalRepo from '../repositories/signalRetention.repository.js';
import { resolveCovisitConfig } from './covisit.service.js';

export const MODULE_KEY = 'personalization_signals';

/** Same numbers migration 055 seeds and its settings_schema enforces. */
export const DEFAULT_RETENTION_DAYS = 180;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 730;

// WHY these are constants and not settings: they are an operating limit on the job (how much a single
// statement may lock), not a business number. 5,000 rows per statement is a short lock; 40 batches per
// table caps a run at 200,000 rows per table. The job is daily, so a large backlog drains over days
// instead of holding the database for one long run - and `capped` in the result says when that happened.
export const BATCH_SIZE = 5000;
export const MAX_BATCHES_PER_TABLE = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `pg` hands back JSONB parsed; a mock db or a text column may return a string. */
function readJson(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The retention in whole days, always inside 7..730.
 *
 * - absent, null, '', non-numeric, boolean, array, NaN or infinite → the default. `null` and '' are
 *   rejected explicitly because Number(null) and Number('') are 0, which would read "not set" as a
 *   real value and then clamp to 7 - deleting 173 days more than anyone configured.
 * - a number (or numeric string) outside the range → clamped to the nearest end.
 * - a fractional number → rounded UP, because deletion is irreversible: keeping a day too long is the
 *   safe error.
 */
export function sanitizeRetentionDays(raw) {
  if (typeof raw !== 'number' && typeof raw !== 'string') return DEFAULT_RETENTION_DAYS;
  if (typeof raw === 'string' && raw.trim() === '') return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.ceil(n)));
}

/** retention_days off the module row. An unreadable row or table yields the default, never an error. */
export async function resolveRetentionDays(db) {
  try {
    const row = await signalRepo.getModuleSettings(db, MODULE_KEY);
    const settings = readJson(row?.settings_json);
    const isObject = settings && typeof settings === 'object' && !Array.isArray(settings);
    return sanitizeRetentionDays(isObject ? settings.retention_days : undefined);
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}

/** Rows strictly older than this are deleted; anything at or after it is kept. */
export function retentionCutoff(retentionDays, now = new Date()) {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/**
 * Deletes one table's expired rows in bounded batches, recording into `progress` as it goes so a
 * failure part-way still reports the rows already gone.
 * Stops at the first short batch (nothing left) or at `maxBatches` (`capped`: more may remain).
 */
async function purgeTable(db, table, cutoff, { batchSize, maxBatches }, progress) {
  while (true) {
    if (progress.batches >= maxBatches) {
      progress.capped = true;
      return;
    }
    const n = await signalRepo.deleteOlderThanBatch(db, table, cutoff, batchSize);
    progress.batches += 1;
    progress.deleted += n;
    if (n < batchSize) return;
  }
}

/**
 * One retention pass. Pass the Pool: each batch is its own statement and commits on its own, which is
 * what keeps the locks short. A failure in one table is recorded and does not stop the other.
 *
 * @returns {Promise<{retentionDays: number, cutoff: string, covisitWindowDays: number,
 *   shortensCovisitWindow: boolean, deleted: number, tables: object, errors: object[]}>}
 */
export async function purgeExpiredSignals(
  db,
  { now = new Date(), batchSize = BATCH_SIZE, maxBatches = MAX_BATCHES_PER_TABLE } = {}
) {
  const retentionDays = await resolveRetentionDays(db);
  const cutoff = retentionCutoff(retentionDays, now);
  const covisitWindowDays = (await resolveCovisitConfig(db)).window_days;

  const tables = {};
  const errors = [];
  let deleted = 0;
  for (const table of signalRepo.RETENTION_TABLES) {
    const progress = { deleted: 0, batches: 0, capped: false };
    try {
      await purgeTable(db, table, cutoff, { batchSize, maxBatches }, progress);
    } catch (err) {
      errors.push({ table, message: err.message });
    }
    tables[table] = progress;
    deleted += progress.deleted;
  }

  return {
    retentionDays,
    cutoff: cutoff.toISOString(),
    covisitWindowDays,
    shortensCovisitWindow: retentionDays < covisitWindowDays,
    deleted,
    tables,
    errors,
  };
}
