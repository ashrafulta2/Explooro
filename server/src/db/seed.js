/**
 * seed.js — Dependency-free seed runner (Prompt 2.2).
 *
 * `npm run seed` applies every server/src/db/seeds/*.sql file, in filename order, each inside its
 * own transaction. Unlike migrate.js, seeds are NOT tracked in a table and are re-run every time —
 * they are reference/dev data, not schema history, and every seed file is written with
 * `ON CONFLICT DO NOTHING` so re-running is always safe.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config/loadEnvFile.js';
import { loadEnv } from '../config/env.js';
import { createDbPool, withTransaction } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = path.join(__dirname, 'seeds');

async function run() {
  const config = loadEnv();
  const pool = createDbPool(config);

  try {
    const entries = await readdir(SEEDS_DIR);
    const files = entries.filter((f) => f.endsWith('.sql')).sort();

    if (files.length === 0) {
      console.log('No seed files found.');
      return;
    }

    for (const name of files) {
      const sql = await readFile(path.join(SEEDS_DIR, name), 'utf8');
      await withTransaction(pool, (client) => client.query(sql));
      console.log(`Seeded ${name}`);
    }

    const resynced = await resyncIdSequences(pool);
    console.log(
      resynced.length
        ? `Resynced id sequences: ${resynced.join(', ')}`
        : 'All id sequences already in sync.'
    );
  } finally {
    await pool.end();
  }
}

/**
 * Fast-forwards every `id` sequence past the highest id actually present.
 *
 * WHY this is required: the seed files insert rows with explicit ids so they can reference each
 * other by stable number. Postgres only advances a BIGSERIAL sequence when it supplies the value,
 * so after seeding, every one of those sequences still points at 1. The next INSERT that lets the
 * database assign an id — a real signup, a new product, a new store — collides with a seeded row
 * and fails on the primary key. Re-running is harmless; setval is idempotent for a given max.
 */
async function resyncIdSequences(pool) {
  const { rows } = await pool.query(`
    SELECT c.table_name, pg_get_serial_sequence('public.' || c.table_name, 'id') AS seq
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name = 'id'
      AND t.table_type = 'BASE TABLE'
  `);

  const fixed = [];
  for (const { table_name: table, seq } of rows) {
    if (!seq) continue; // not a serial/identity column
    const { rows: [row] } = await pool.query(
      `SELECT COALESCE(MAX(id), 0) AS max_id, (SELECT last_value FROM ${seq}) AS seq_value FROM ${table}`
    );
    if (Number(row.max_id) > Number(row.seq_value)) {
      await pool.query(`SELECT setval($1, $2)`, [seq, Number(row.max_id)]);
      fixed.push(table);
    }
  }
  return fixed;
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
