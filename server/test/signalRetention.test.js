/**
 * signalRetention.test.js — Invariants for enforcing personalization_signals.retention_days.
 *
 *   1. Setting   — retention_days is sanitised: clamped to 7..730, default 180, and null/'' are
 *                  "not set", never 0. It is read off the module row (JSON string too).
 *   2. Cutoff    — now minus N days; a row exactly at the cutoff and anything newer is kept.
 *   3. Batches   — deletes are bounded (LIMIT per statement, a cap per run), never one big DELETE.
 *   4. Tables    — BOTH product_interaction_events and search_events are pruned; one failing does
 *                  not stop the other.
 *   5. Job       — reports to job_runs, is skipped by the scheduler when the module is off, and says
 *                  when retention is shorter than the co-visitation window.
 *   6. Migration — what 061 adds: indexes only.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as svc from '../src/services/signalRetention.service.js';
import * as repo from '../src/repositories/signalRetention.repository.js';
import { runSignalRetention } from '../src/jobs/signalRetention.job.js';
import { runJobNow } from '../src/jobs/scheduler.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-08T12:00:00.000Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * DAY);

/**
 * An in-memory stand-in for the two event tables that understands the one DELETE the repository
 * issues: delete up to $2 rows whose created_at is strictly before $1.
 */
function makeDb({ settings, enabled = true, covisitWindow, tables = {}, failOn } = {}) {
  const data = {
    product_interaction_events: [...(tables.product_interaction_events || [])],
    search_events: [...(tables.search_events || [])],
  };
  const deletes = [];
  const db = {
    data,
    deletes,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.includes('FROM platform_modules')) {
        return settings === 'missing-row'
          ? { rows: [] }
          : { rows: [{ is_enabled: enabled, settings_json: settings }] };
      }
      if (q.includes('FROM platform_settings')) {
        return covisitWindow === undefined
          ? { rows: [] }
          : { rows: [{ key: 'recommendation.covisit', value_json: { window_days: covisitWindow } }] };
      }
      const del = q.match(/^DELETE FROM (\w+) WHERE id IN/);
      if (del) {
        const table = del[1];
        if (failOn === table) throw new Error(`boom ${table}`);
        const [cutoff, limit] = params;
        deletes.push({ table, cutoff, limit, sql: q });
        const doomed = new Set(
          data[table].filter((r) => r.created_at < cutoff).slice(0, limit).map((r) => r.id)
        );
        data[table] = data[table].filter((r) => !doomed.has(r.id));
        return { rows: [], rowCount: doomed.size };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return db;
}

const rows = (n, createdAt, startId = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: startId + i, created_at: createdAt }));

// ── 1. Setting ──────────────────────────────────────────────────────────────────────────────────
describe('Signal retention — the retention_days setting', () => {
  test('shipped defaults and limits are exactly what migration 055 seeds', () => {
    const m055 = fs.readFileSync(path.resolve(import.meta.dirname, '../src/db/migrations/055_personalization_signals.sql'), 'utf8');
    assert.match(m055, /"retention_days": 180/);
    assert.match(m055, /"retention_days": \{ "type": "integer", "minimum": 7, "maximum": 730, "default": 180 \}/);
    assert.equal(svc.DEFAULT_RETENTION_DAYS, 180);
    assert.equal(svc.MIN_RETENTION_DAYS, 7);
    assert.equal(svc.MAX_RETENTION_DAYS, 730);
  });

  test('values inside the range are used as they are', () => {
    for (const v of [7, 30, 180, 365, 730]) assert.equal(svc.sanitizeRetentionDays(v), v);
    assert.equal(svc.sanitizeRetentionDays('90'), 90, 'a numeric string is read as a number');
  });

  test('values outside the range are clamped, not discarded', () => {
    assert.equal(svc.sanitizeRetentionDays(1), 7);
    assert.equal(svc.sanitizeRetentionDays(0), 7);
    assert.equal(svc.sanitizeRetentionDays(-50), 7);
    assert.equal(svc.sanitizeRetentionDays(731), 730);
    assert.equal(svc.sanitizeRetentionDays(1e9), 730);
  });

  test('null, empty and absent are "not set" and give the default - never 0', () => {
    for (const v of [null, undefined, '', '   ']) {
      assert.equal(svc.sanitizeRetentionDays(v), 180, `${JSON.stringify(v)}`);
    }
  });

  test('values that are not numbers give the default', () => {
    for (const v of ['soon', NaN, Infinity, -Infinity, true, false, [], [30], {}, () => 30]) {
      assert.equal(svc.sanitizeRetentionDays(v), 180, String(v));
    }
  });

  test('a fractional value rounds UP: deletion is irreversible, so err on keeping data', () => {
    assert.equal(svc.sanitizeRetentionDays(30.2), 31);
    assert.equal(svc.sanitizeRetentionDays(6.1), 7);
  });

  test('it is read off the module row, JSON string included', async () => {
    assert.equal(await svc.resolveRetentionDays(makeDb({ settings: { retention_days: 45 } })), 45);
    assert.equal(await svc.resolveRetentionDays(makeDb({ settings: JSON.stringify({ retention_days: 60 }) })), 60);
  });

  test('a missing row, missing key, bad JSON or non-object settings give the default', async () => {
    assert.equal(await svc.resolveRetentionDays(makeDb({ settings: 'missing-row' })), 180);
    assert.equal(await svc.resolveRetentionDays(makeDb({ settings: { track_guests: true } })), 180);
    assert.equal(await svc.resolveRetentionDays(makeDb({ settings: '{not json' })), 180);
    assert.equal(await svc.resolveRetentionDays(makeDb({ settings: [30] })), 180);
    assert.equal(await svc.resolveRetentionDays(makeDb({ settings: { retention_days: null } })), 180);
  });

  test('an unreadable table gives the default instead of an error', async () => {
    const broken = { query: async () => { throw new Error('relation "platform_modules" does not exist'); } };
    assert.equal(await svc.resolveRetentionDays(broken), 180);
  });
});

// ── 2. Cutoff ───────────────────────────────────────────────────────────────────────────────────
describe('Signal retention — cutoff', () => {
  test('the cutoff is exactly N whole days before now', () => {
    assert.equal(svc.retentionCutoff(180, NOW).toISOString(), daysAgo(180).toISOString());
    assert.equal(svc.retentionCutoff(7, NOW).toISOString(), '2026-10-01T12:00:00.000Z');
  });

  test('the cutoff handed to SQL is that instant, and the SQL compares strictly', async () => {
    const db = makeDb({ settings: { retention_days: 30 } });
    await svc.purgeExpiredSignals(db, { now: NOW });
    for (const d of db.deletes) {
      assert.equal(d.cutoff.toISOString(), daysAgo(30).toISOString());
      assert.match(d.sql, /created_at < \$1/);
      assert.doesNotMatch(d.sql, /<=/);
    }
  });

  test('only rows older than the cutoff go: a row at the cutoff and newer rows survive', async () => {
    const cutoff = daysAgo(30);
    const mixed = [
      { id: 1, created_at: daysAgo(31) },
      { id: 2, created_at: new Date(cutoff.getTime() - 1) },
      { id: 3, created_at: cutoff }, // exactly at the cutoff: kept
      { id: 4, created_at: new Date(cutoff.getTime() + 1) },
      { id: 5, created_at: daysAgo(1) },
      { id: 6, created_at: NOW },
    ];
    const db = makeDb({
      settings: { retention_days: 30 },
      tables: { product_interaction_events: mixed, search_events: mixed },
    });
    const out = await svc.purgeExpiredSignals(db, { now: NOW });
    for (const t of ['product_interaction_events', 'search_events']) {
      assert.deepEqual(db.data[t].map((r) => r.id), [3, 4, 5, 6], t);
      assert.equal(out.tables[t].deleted, 2, t);
    }
    assert.equal(out.deleted, 4);
  });

  test('a shorter setting deletes more, a longer one less, from the same data', async () => {
    const tables = { product_interaction_events: [{ id: 1, created_at: daysAgo(100) }], search_events: [] };
    const short = await svc.purgeExpiredSignals(makeDb({ settings: { retention_days: 90 }, tables }), { now: NOW });
    const long = await svc.purgeExpiredSignals(makeDb({ settings: { retention_days: 365 }, tables }), { now: NOW });
    assert.equal(short.deleted, 1);
    assert.equal(long.deleted, 0);
  });

  test('a null setting purges at 180 days, not at the 7-day floor', async () => {
    const tables = { product_interaction_events: [{ id: 1, created_at: daysAgo(100) }], search_events: [] };
    const db = makeDb({ settings: { retention_days: null }, tables });
    const out = await svc.purgeExpiredSignals(db, { now: NOW });
    assert.equal(out.retentionDays, 180);
    assert.equal(out.deleted, 0, 'a 100-day-old row is inside 180 days');
  });
});

// ── 3. Bounded batches ──────────────────────────────────────────────────────────────────────────
describe('Signal retention — bounded batches', () => {
  test('the SQL deletes a LIMITed id set, never the whole predicate at once', async () => {
    for (const table of repo.RETENTION_TABLES) {
      const db = makeDb();
      await repo.deleteOlderThanBatch(db, table, NOW, 10);
      assert.match(
        db.deletes[0].sql,
        new RegExp(`^DELETE FROM ${table} WHERE id IN \\( SELECT id FROM ${table} WHERE created_at < \\$1 LIMIT \\$2 \\)$`)
      );
      assert.equal(db.deletes[0].limit, 10);
    }
  });

  test('the shipped batch is 5000 rows, with a finite cap per table', () => {
    assert.equal(svc.BATCH_SIZE, 5000);
    assert.ok(Number.isInteger(svc.MAX_BATCHES_PER_TABLE) && svc.MAX_BATCHES_PER_TABLE > 0);
  });

  test('a backlog is deleted in several statements, none larger than the batch size', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      tables: { product_interaction_events: rows(25, daysAgo(60)), search_events: [] },
    });
    const out = await svc.purgeExpiredSignals(db, { now: NOW, batchSize: 10, maxBatches: 10 });
    const pie = db.deletes.filter((d) => d.table === 'product_interaction_events');
    assert.equal(pie.length, 3, '10 + 10 + 5, and the short batch ends the loop');
    assert.ok(pie.every((d) => d.limit === 10));
    assert.equal(out.tables.product_interaction_events.deleted, 25);
    assert.equal(out.tables.product_interaction_events.batches, 3);
    assert.equal(out.tables.product_interaction_events.capped, false);
    assert.equal(db.data.product_interaction_events.length, 0);
  });

  test('an exact multiple of the batch size costs one extra, empty, lookup - and no more', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      tables: { product_interaction_events: rows(20, daysAgo(60)), search_events: [] },
    });
    const out = await svc.purgeExpiredSignals(db, { now: NOW, batchSize: 10, maxBatches: 10 });
    assert.equal(out.tables.product_interaction_events.batches, 3);
    assert.equal(out.tables.product_interaction_events.capped, false);
  });

  test('the per-run cap stops the loop, leaves the rest for tomorrow and says so', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      tables: { product_interaction_events: rows(100, daysAgo(60)), search_events: [] },
    });
    const out = await svc.purgeExpiredSignals(db, { now: NOW, batchSize: 10, maxBatches: 4 });
    const t = out.tables.product_interaction_events;
    assert.equal(t.batches, 4);
    assert.equal(t.deleted, 40);
    assert.equal(t.capped, true);
    assert.equal(db.data.product_interaction_events.length, 60);
  });

  test('the cap is per table: one big table does not starve the other', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      tables: { product_interaction_events: rows(100, daysAgo(60)), search_events: rows(15, daysAgo(60)) },
    });
    const out = await svc.purgeExpiredSignals(db, { now: NOW, batchSize: 10, maxBatches: 3 });
    assert.equal(out.tables.product_interaction_events.deleted, 30);
    assert.equal(out.tables.search_events.deleted, 15);
    assert.equal(out.tables.search_events.capped, false);
  });

  test('nothing expired: one lookup per table, zero deleted, not capped', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      tables: { product_interaction_events: rows(3, daysAgo(2)), search_events: rows(3, daysAgo(2)) },
    });
    const out = await svc.purgeExpiredSignals(db, { now: NOW });
    assert.equal(db.deletes.length, 2);
    assert.equal(out.deleted, 0);
    assert.equal(out.tables.search_events.capped, false);
  });

  test('the default run uses the shipped batch size', async () => {
    const db = makeDb({ settings: { retention_days: 30 } });
    await svc.purgeExpiredSignals(db, { now: NOW });
    assert.ok(db.deletes.every((d) => d.limit === 5000));
  });

  test('the retention work runs on the pool, not inside a transaction', async () => {
    const db = makeDb({ settings: { retention_days: 30 } });
    await svc.purgeExpiredSignals(db, { now: NOW });
    assert.equal(db.deletes.some((d) => /BEGIN|FOR UPDATE/i.test(d.sql)), false);
  });

  test('only the two known tables can be named', async () => {
    await assert.rejects(() => repo.deleteOlderThanBatch(makeDb(), 'users; DROP TABLE users', NOW, 5), /UNKNOWN_RETENTION_TABLE/);
    assert.deepEqual([...repo.RETENTION_TABLES].sort(), ['product_interaction_events', 'search_events']);
  });
});

// ── 4. Both tables ──────────────────────────────────────────────────────────────────────────────
describe('Signal retention — both tables', () => {
  test('product_interaction_events and search_events are both pruned', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      tables: {
        product_interaction_events: [...rows(4, daysAgo(90)), ...rows(2, daysAgo(1), 100)],
        search_events: [...rows(7, daysAgo(90)), ...rows(3, daysAgo(1), 100)],
      },
    });
    const out = await svc.purgeExpiredSignals(db, { now: NOW });
    assert.equal(out.tables.product_interaction_events.deleted, 4);
    assert.equal(out.tables.search_events.deleted, 7);
    assert.equal(out.deleted, 11);
    assert.equal(db.data.product_interaction_events.length, 2);
    assert.equal(db.data.search_events.length, 3);
  });

  test('a failure in one table is recorded and the other is still pruned', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      failOn: 'product_interaction_events',
      tables: { product_interaction_events: rows(5, daysAgo(90)), search_events: rows(5, daysAgo(90)) },
    });
    const out = await svc.purgeExpiredSignals(db, { now: NOW });
    assert.equal(out.errors.length, 1);
    assert.equal(out.errors[0].table, 'product_interaction_events');
    assert.match(out.errors[0].message, /boom/);
    assert.equal(out.tables.search_events.deleted, 5);
  });

  test('rows deleted before a mid-table failure are still counted', async () => {
    let calls = 0;
    const inner = makeDb({
      settings: { retention_days: 30 },
      tables: { product_interaction_events: rows(30, daysAgo(90)), search_events: [] },
    });
    const db = {
      query: async (sql, params) => {
        if (/^\s*DELETE FROM product_interaction_events/.test(sql) && ++calls === 3) throw new Error('lock timeout');
        return inner.query(sql, params);
      },
    };
    const out = await svc.purgeExpiredSignals(db, { now: NOW, batchSize: 10, maxBatches: 10 });
    assert.equal(out.tables.product_interaction_events.deleted, 20);
    assert.equal(out.errors.length, 1);
  });

  test('it does not touch any table other than the two event logs', async () => {
    const db = makeDb({ settings: { retention_days: 30 } });
    const seen = [];
    const spy = { query: async (sql, p) => { seen.push(sql); return db.query(sql, p); } };
    await svc.purgeExpiredSignals(spy, { now: NOW });
    const writes = seen.filter((s) => /^\s*(DELETE|UPDATE|INSERT|TRUNCATE)/i.test(s));
    assert.equal(writes.length, 2);
    assert.ok(writes.every((s) => /DELETE FROM (product_interaction_events|search_events)\b/.test(s)));
  });
});

// ── 5. Job ──────────────────────────────────────────────────────────────────────────────────────
describe('Signal retention — job', () => {
  const logger = () => {
    const out = { info: [], warn: [], error: [] };
    return { out, info: (m) => out.info.push(m), warn: (m) => out.warn.push(m), error: (m) => out.error.push(m) };
  };

  test('it reports processedCount and metadata for job_runs', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      tables: { product_interaction_events: rows(4, daysAgo(90)), search_events: rows(2, daysAgo(90)) },
    });
    const log = logger();
    const res = await runSignalRetention(db, null, log);
    assert.equal(res.processedCount, 6);
    assert.equal(res.successCount, 6);
    assert.equal(res.errorCount, 0);
    assert.deepEqual(res.errors, []);
    assert.equal(res.metadata.retentionDays, 30);
    assert.equal(res.metadata.tables.search_events.deleted, 2);
    assert.match(log.out.info[0], /deleted 6 events older than 30 days/);
    // metadata is stored as JSON by the scheduler
    assert.doesNotThrow(() => JSON.stringify(res.metadata));
  });

  test('a partial failure is reported as errors without failing the run', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      failOn: 'search_events',
      tables: { product_interaction_events: rows(3, daysAgo(90)), search_events: [] },
    });
    const log = logger();
    const res = await runSignalRetention(db, null, log);
    assert.equal(res.errorCount, 1);
    assert.equal(res.errors[0].table, 'search_events');
    assert.equal(res.processedCount, 3);
    assert.match(log.out.error[0], /search_events failed/);
  });

  test('every table failing throws, so job_runs records FAILED', async () => {
    const db = {
      query: async (sql) => {
        if (/^\s*DELETE/.test(sql)) throw new Error('disk full');
        return { rows: [], rowCount: 0 };
      },
    };
    await assert.rejects(() => runSignalRetention(db, null, logger()), /SIGNAL_RETENTION_FAILED.*disk full/);
  });

  test('hitting the per-run cap is logged as a warning', async () => {
    const db = makeDb({
      settings: { retention_days: 30 },
      tables: { product_interaction_events: rows(svc.BATCH_SIZE * svc.MAX_BATCHES_PER_TABLE + 1, daysAgo(90)), search_events: [] },
    });
    const log = logger();
    const res = await runSignalRetention(db, null, log);
    assert.equal(res.metadata.tables.product_interaction_events.capped, true);
    assert.equal(res.processedCount, svc.BATCH_SIZE * svc.MAX_BATCHES_PER_TABLE);
    assert.ok(log.out.warn.some((m) => /batch cap/.test(m)));
  });

  test('retention shorter than the co-visitation window is flagged', async () => {
    const short = await svc.purgeExpiredSignals(makeDb({ settings: { retention_days: 30 }, covisitWindow: 60 }), { now: NOW });
    assert.equal(short.covisitWindowDays, 60);
    assert.equal(short.shortensCovisitWindow, true);

    const log = logger();
    await runSignalRetention(makeDb({ settings: { retention_days: 30 }, covisitWindow: 60 }), null, log);
    assert.ok(log.out.warn.some((m) => /shorter than the co-visitation window/.test(m)));
  });

  test('the shipped defaults (180 retention, 60 window) do not warn', async () => {
    const log = logger();
    const res = await runSignalRetention(makeDb({ settings: { retention_days: 180 } }), null, log);
    assert.equal(res.metadata.covisitWindowDays, 60);
    assert.equal(res.metadata.shortensCovisitWindow, false);
    assert.equal(log.out.warn.length, 0);
  });

  test('retention equal to the window does not shorten it', async () => {
    const out = await svc.purgeExpiredSignals(makeDb({ settings: { retention_days: 60 }, covisitWindow: 60 }), { now: NOW });
    assert.equal(out.shortensCovisitWindow, false);
  });

  // The scheduler owns the module gate; these go through runJobNow so the registration is what is tested.
  function makePool({ enabled, settings = { retention_days: 30 }, tables }) {
    const inner = makeDb({ settings, enabled, tables });
    const client = {
      queries: [],
      async query(sql) {
        this.queries.push(sql);
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        if (sql.includes('INSERT INTO job_runs')) return { rows: [{ id: 77 }] };
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const pool = { query: inner.query.bind(inner), connect: async () => client, inner, client };
    return pool;
  }
  const quiet = { info() {}, warn() {}, error() {}, log() {} };

  test('registered daily on the personalization_signals module: off means skipped, nothing deleted', async () => {
    const pool = makePool({
      enabled: false,
      tables: { product_interaction_events: rows(5, daysAgo(90)), search_events: rows(5, daysAgo(90)) },
    });
    const res = await runJobNow('signal_retention', pool, null, quiet);
    assert.deepEqual(res, { status: 'SKIPPED', reason: 'MODULE_DISABLED' });
    assert.equal(pool.inner.deletes.length, 0);
    assert.equal(pool.inner.data.product_interaction_events.length, 5);
    assert.equal(pool.inner.data.search_events.length, 5);
    assert.equal(pool.client.queries.length, 0, 'no lock taken, no job_runs row written');
  });

  test('module on: the scheduler runs it, and the result lands in job_runs', async () => {
    const pool = makePool({
      enabled: true,
      tables: { product_interaction_events: rows(5, daysAgo(400)), search_events: rows(2, daysAgo(400)) },
    });
    const res = await runJobNow('signal_retention', pool, null, quiet);
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.processedCount, 7);
    const update = pool.client.queries.find((q) => q.includes('UPDATE job_runs'));
    assert.ok(update);
    assert.equal(pool.inner.data.product_interaction_events.length, 0);
    assert.equal(pool.inner.data.search_events.length, 0);
  });

  test('the job source declares the daily interval and the module key', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../src/jobs/signalRetention.job.js'), 'utf8');
    assert.match(src, /name: 'signal_retention'/);
    assert.match(src, /intervalMs: 24 \* 3600000/);
    assert.match(src, /moduleKey: 'personalization_signals'/);
    const app = fs.readFileSync(path.resolve(import.meta.dirname, '../src/app.js'), 'utf8');
    assert.match(app, /import '\.\/jobs\/signalRetention\.job\.js'/);
  });
});

// ── 6. Migration ────────────────────────────────────────────────────────────────────────────────
describe('Signal retention — migration 061', () => {
  const dir = path.resolve(import.meta.dirname, '../src/db/migrations');
  const sql = fs.readFileSync(path.join(dir, '061_signal_retention_indexes.sql'), 'utf8');

  test('it adds a BRIN index on created_at for both tables, idempotently', () => {
    assert.match(sql, /CREATE INDEX IF NOT EXISTS \w+ ON product_interaction_events USING BRIN \(created_at\)/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS \w+ ON search_events USING BRIN \(created_at\)/);
  });

  test('it only adds indexes: no table, column, data or constraint change', () => {
    const statements = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
    assert.equal(statements.length, 2);
    assert.ok(statements.every((s) => /^CREATE INDEX IF NOT EXISTS/.test(s)));
  });
});
