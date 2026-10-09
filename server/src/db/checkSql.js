/**
 * checkSql.js — prepares every static SQL statement in server/src against the migrated schema.
 *
 * `npm run check:sql` (needs DATABASE_URL pointing at a database that `npm run migrate` has brought
 * up to date) scans every .js file under server/src for template literals that start with SELECT,
 * INSERT, UPDATE, DELETE or WITH and asks Postgres to PREPARE each one. PREPARE parses and plans
 * the statement without running it, so a statement naming a table or column that does not exist
 * fails here instead of in production.
 *
 * WHY this exists: the test suite mocks the database, so a query against a column that was never
 * created passes every test. On 2026-10-08 this check found ~50 such statements (orders.status,
 * order_items.quantity, products.stock_quantity, user_restrictions.user_id, ...), several of them
 * on the payment, return and payout paths.
 *
 * Skipped, because they are not complete statements on their own:
 *   - literals containing `${...}` (built at runtime);
 *   - literals inside a comment;
 *   - fragments: `let x = `...`` later extended with `x +=`, or `const X = `...`` used as `${X}`.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config/loadEnvFile.js';
import { loadEnv } from '../config/env.js';
import { createDbPool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set([path.join(SRC_DIR, 'db', 'migrations'), path.join(SRC_DIR, 'db', 'seeds')]);

const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
const TEMPLATE_LITERAL = /`((?:[^`\\]|\\.)*)`/gs;

// PREPARE cannot infer a type for some untyped parameters ($1 compared with $1, used only in a
// CASE, and so on). Those are planning limits, not schema errors, so they are not reported.
const IGNORED_ERRORS =
  /could not determine data type|inconsistent types deduced|there is no parameter|cannot insert multiple commands|could not determine polymorphic|is not unique/;

// Statements known to be wrong and deliberately left for a product decision. Each entry is matched
// by file and by the error message, so the same file breaking in a new way still fails the check.
// Remove an entry in the same change that fixes it.
const KNOWN_FAILURES = [];

function isKnownFailure(file, message) {
  return KNOWN_FAILURES.some((k) => k.file === file && message.includes(k.error));
}

async function listSourceFiles(dir) {
  if (SKIP_DIRS.has(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return listSourceFiles(full);
      return e.name.endsWith('.js') ? [full] : [];
    })
  );
  return nested.flat();
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function isInComment(src, index) {
  const lineStart = src.lastIndexOf('\n', index) + 1;
  const prefix = src.slice(lineStart, index).trim();
  return prefix.startsWith('*') || prefix.startsWith('//') || prefix.startsWith('/*');
}

function isFragment(src, index) {
  const lineStart = src.lastIndexOf('\n', index) + 1;
  const assigned = src.slice(lineStart, index).match(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
  if (!assigned) return false;
  const name = assigned[1];
  return src.includes(`${name} +=`) || src.includes(`\${${name}}`);
}

export function extractStatements(src) {
  const statements = [];
  for (const match of src.matchAll(TEMPLATE_LITERAL)) {
    const sql = match[1];
    if (!SQL_START.test(sql) || sql.includes('${')) continue;
    if (isInComment(src, match.index) || isFragment(src, match.index)) continue;
    statements.push({ sql, line: lineOf(src, match.index) });
  }
  return statements;
}

async function run() {
  const config = loadEnv();
  const pool = createDbPool(config);
  const client = await pool.connect();
  const failures = [];
  const known = [];
  let checked = 0;

  try {
    for (const file of (await listSourceFiles(SRC_DIR)).sort()) {
      const src = await readFile(file, 'utf8');
      for (const { sql, line } of extractStatements(src)) {
        checked += 1;
        try {
          await client.query('DEALLOCATE ALL');
          await client.query(`PREPARE explooro_check_sql AS ${sql}`);
        } catch (err) {
          const rel = path.relative(SRC_DIR, file);
          if (isKnownFailure(rel, err.message)) {
            known.push(`${rel}:${line} -> ${err.message}`);
          } else if (!IGNORED_ERRORS.test(err.message)) {
            failures.push(`${rel}:${line} -> ${err.message}`);
          }
        }
      }
    }
    await client.query('DEALLOCATE ALL');
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`Prepared ${checked} SQL statements against the migrated schema.`);
  if (known.length > 0) {
    console.log(`${known.length} known failure(s), listed in KNOWN_FAILURES:`);
    for (const k of known) console.log(`  ${k}`);
  }
  if (failures.length > 0) {
    console.error(`${failures.length} statement(s) do not match the schema:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
