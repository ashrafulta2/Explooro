/**
 * seed.ts — Dependency-free seed runner (Prompt 2.2).
 *
 * `npm run seed` applies every server/src/db/seeds/*.sql file, in filename order, each inside its
 * own transaction. Unlike migrate.ts, seeds are NOT tracked in a table and are re-run every time —
 * they are reference/dev data, not schema history, and every seed file is written with
 * `ON CONFLICT DO NOTHING` so re-running is always safe.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config/loadEnvFile.ts';
import { loadEnv } from '../config/env.ts';
import { createDbPool, withTransaction } from '../config/db.ts';
import { repriceProducts } from '../services/product.service.ts';
import { computeGroupPrice, discountForSize, getTeamBuyingSettings } from '../services/teamPurchase.service.ts';

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
      // WHY right after the file that inserts products: the deal seeds after it (live streams, flash
      // sales) price themselves off today's retail, so it must be derived before they run.
      if (/INSERT INTO products\s*\(/.test(sql)) await priceProducts(pool);
    }

    const resynced = await resyncIdSequences(pool);
    console.log(
      resynced.length
        ? `Resynced id sequences: ${resynced.join(', ')}`
        : 'All id sequences already in sync.'
    );

    await priceTeams(pool);
  } finally {
    await pool.end();
  }
}

/**
 * WHY prices are derived here and not typed in 005_demo_catalog.sql: retail and partner profit follow
 * today's markup and split (platform_settings), so the seed's numbers would go stale on the next
 * policy change. The SQL holds only the supplier's price (base_cost + wholesale_margin); retail = that
 * + the category's markup and the partner profit come from the same service the admin's re-price
 * uses. Dev data only, so every product is rewritten, ARCHIVED ones included.
 */
async function priceProducts(pool) {
  const priced = await repriceProducts(pool, {
    reason: 'Seed: derive retail and partner profit from the supplier price',
    actorId: null,
    includeArchived: true,
    refreshPartnerProfit: true,
  });
  console.log(`Priced products from the supplier price: ${priced.repriced} of ${priced.checked} changed.`);
}

/**
 * Team purchases snapshot their price when they start, so the typed prices in
 * 010_demo_team_purchases.sql are placeholders. Every team (dev data, like the products above) gets
 * what teamPurchase.service would charge it today: the product's retail as the original price, and the
 * group price from `computeGroupPrice` with the discount for its size.
 */
async function priceTeams(pool) {
  const settings = await getTeamBuyingSettings(pool);
  const { rows } = await pool.query(
    `SELECT t.id, t.required_members, p.default_retail_price, p.base_cost, p.wholesale_margin
     FROM team_purchases t JOIN products p ON p.id = t.product_id`
  );
  for (const t of rows) {
    const { group_price: groupPrice } = computeGroupPrice({
      retailPrice: t.default_retail_price,
      baseCost: t.base_cost,
      wholesaleMargin: t.wholesale_margin,
      discountPct: discountForSize(settings, t.required_members),
    });
    await pool.query(
      `UPDATE team_purchases SET group_price = $2, original_price = $3 WHERE id = $1`,
      [t.id, groupPrice, t.default_retail_price]
    );
  }
  console.log(`Priced ${rows.length} team purchases from today's retail.`);
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
