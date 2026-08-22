/**
 * db.js — PostgreSQL connection pool (Prompt 2.1).
 *
 * One `pg` Pool per process, built from the validated env config. Works identically against a
 * Neon managed database (SSL, pgbouncer in front) and a local PostgreSQL install — the only
 * difference is whatever `sslmode` the connection string itself carries.
 */

import pg from 'pg';

const { Pool } = pg;

/**
 * Neon's connection string ships `sslmode=require`. Its certificate chain is valid, but the
 * pooled endpoint sits behind infrastructure that some Node TLS configurations reject without
 * this relaxation — the same accommodation Neon's own docs recommend for `pg`.
 */
function resolveSsl(databaseUrl) {
  return /sslmode=require/i.test(databaseUrl) ? { rejectUnauthorized: false } : false;
}

export function createDbPool(config) {
  const pool = new Pool({
    connectionString: config.database.url,
    max: config.database.poolMax,
    statement_timeout: config.database.statementTimeoutMs,
    ssl: resolveSsl(config.database.url),
  });

  pool.on('error', (err) => {
    // Idle clients emit here on a dropped connection; it must never crash the process.
    // eslint-disable-next-line no-console
    console.error('[db] idle client error', err);
  });

  return pool;
}

/**
 * Runs `fn` inside BEGIN/COMMIT, ROLLBACK on throw, and always releases the client back to the
 * pool. `fn` receives the checked-out client — use it, not the pool, for every query in scope.
 */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
