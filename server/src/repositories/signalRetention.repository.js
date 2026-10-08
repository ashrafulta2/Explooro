/**
 * signalRetention.repository.js — Raw SQL for pruning the behavioural event log (personalized feed).
 *
 * Two jobs: read the personalization_signals module's settings, and delete ONE bounded batch of rows
 * older than a cutoff. Looping, the cap per run and the policy live in the service. No ORM.
 */

/**
 * The tables retention prunes, each with its fixed statement. WHY a lookup of whole statements and
 * not `DELETE FROM ${table}`: a table name cannot be a bound parameter, and building SQL from a
 * string argument is how an identifier ends up attacker-controlled. Only these two statements exist.
 *
 * The inner SELECT picks a batch and the outer DELETE removes exactly those ids, so a run holds row
 * locks on at most `LIMIT` rows at a time instead of one lock sweep over the whole backlog.
 */
const DELETE_BATCH_SQL = Object.freeze({
  product_interaction_events: `DELETE FROM product_interaction_events
     WHERE id IN (
       SELECT id FROM product_interaction_events WHERE created_at < $1 LIMIT $2
     )`,
  search_events: `DELETE FROM search_events
     WHERE id IN (
       SELECT id FROM search_events WHERE created_at < $1 LIMIT $2
     )`,
});

export const RETENTION_TABLES = Object.freeze(Object.keys(DELETE_BATCH_SQL));

/** The module row's settings, or null when the row (or the table) is not there. */
export async function getModuleSettings(db, moduleKey) {
  const { rows } = await db.query('SELECT settings_json FROM platform_modules WHERE key = $1', [moduleKey]);
  return rows[0] ? { settings_json: rows[0].settings_json } : null;
}

/**
 * Deletes at most `limit` rows of `table` created strictly before `cutoff`.
 * Strictly: a row stamped exactly at the cutoff is kept.
 *
 * Run it on the Pool (not inside a transaction) so each batch commits and releases its locks before
 * the next one starts.
 *
 * @param {{query: Function}} db
 * @param {'product_interaction_events'|'search_events'} table
 * @param {Date} cutoff
 * @param {number} limit
 * @returns {Promise<number>} rows deleted
 */
export async function deleteOlderThanBatch(db, table, cutoff, limit) {
  const sql = DELETE_BATCH_SQL[table];
  if (!sql) throw new Error(`UNKNOWN_RETENTION_TABLE: ${table}`);
  const { rowCount } = await db.query(sql, [cutoff, limit]);
  return rowCount || 0;
}
