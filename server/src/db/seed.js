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
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
