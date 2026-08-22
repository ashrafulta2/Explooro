/**
 * migrate.js — Dependency-free, forward-only migration runner (Prompt 2.1, checksums added 2.2).
 *
 * `npm run migrate`        applies every pending .sql file in server/src/db/migrations, in
 *                          filename order, each inside its own transaction, and records it in
 *                          `_migrations` along with a sha256 checksum of its contents.
 * `npm run migrate:status` lists applied vs. pending without changing anything.
 *
 * Applied migrations are immutable (docs/erd.md §13 rule 3): if a file that already ran has
 * changed on disk, the runner refuses to proceed rather than silently re-applying or ignoring the
 * edit — the fix is always a new forward migration, never editing history.
 *
 * No knex, no node-pg-migrate — migrations are plain numbered .sql files, which is all this
 * project ever needs (see docs/dependency-ledger.md §4).
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config/loadEnvFile.js';
import { loadEnv } from '../config/env.js';
import { createDbPool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function checksumOf(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function listMigrationFiles() {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedByName(pool) {
  const { rows } = await pool.query('SELECT name, checksum FROM _migrations ORDER BY name');
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

async function applyMigration(pool, name, sql) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO _migrations (name, checksum) VALUES ($1, $2)', [
      name,
      checksumOf(sql),
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${name} failed: ${err.message}`);
  } finally {
    client.release();
  }
}

async function run() {
  const config = loadEnv();
  const pool = createDbPool(config);
  const command = process.argv[2] ?? 'up';

  try {
    await ensureMigrationsTable(pool);
    const files = await listMigrationFiles();
    const contents = new Map();
    for (const name of files) {
      contents.set(name, await readFile(path.join(MIGRATIONS_DIR, name), 'utf8'));
    }

    const applied = await getAppliedByName(pool);
    const changed = files.filter(
      (f) => applied.has(f) && applied.get(f) !== checksumOf(contents.get(f))
    );
    if (changed.length > 0) {
      throw new Error(
        `Refusing to proceed — already-applied migration(s) changed on disk: ${changed.join(', ')}. ` +
          'Applied migrations are immutable; fix forward with a new migration file instead.'
      );
    }

    const pending = files.filter((f) => !applied.has(f));

    if (command === 'status') {
      console.log(`Applied (${applied.size}):`);
      for (const name of files.filter((f) => applied.has(f))) console.log(`  [x] ${name}`);
      console.log(`Pending (${pending.length}):`);
      for (const name of pending) console.log(`  [ ] ${name}`);
      return;
    }

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    for (const name of pending) {
      await applyMigration(pool, name, contents.get(name));
      console.log(`Applied ${name}`);
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
