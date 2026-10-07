/**
 * pageToggle.repository.js — Data access for the page_toggles table (054_page_availability.sql).
 *
 * The table holds only the OVERRIDES: a route absent from it is LIVE. That is why there is no
 * "list every page" query here — the client's route table is the registry (see
 * client/src/config/pageRegistry.js), and the server never needs to know the full set.
 */

/** Every parked page. LIVE rows carry no information, so they are not worth sending. */
export async function listParkedPages(db) {
  const { rows } = await db.query(
    `SELECT route_path, state, allowed_roles, allowed_user_ids, reason, updated_by, updated_at
     FROM page_toggles
     WHERE state <> 'LIVE'
     ORDER BY route_path`
  );
  return rows;
}

/** Every row, parked or not, for the admin screen's history column. */
export async function listAllPageToggles(db) {
  const { rows } = await db.query(
    `SELECT route_path, state, allowed_roles, allowed_user_ids, reason, updated_by, updated_at
     FROM page_toggles
     ORDER BY route_path`
  );
  return rows;
}

export async function getPageToggle(db, routePath) {
  const { rows } = await db.query(
    `SELECT route_path, state, allowed_roles, allowed_user_ids, reason, updated_by, updated_at
     FROM page_toggles
     WHERE route_path = $1`,
    [routePath]
  );
  return rows[0] ?? null;
}

/**
 * Locks one route's row for the rest of the caller's transaction and returns it.
 *
 * WHY: a write is read-modify-write (read the current state to audit it as `before`, then write
 * the new one). Two admins saving the same page at once would otherwise both record a `before`
 * from the same read and the second audit row would describe a transition that never happened.
 * Returns null when the row does not exist yet — there is nothing to lock, and the INSERT's
 * primary key then serialises the two writers instead.
 */
export async function lockPageToggle(db, routePath) {
  const { rows } = await db.query(
    `SELECT route_path, state, allowed_roles, allowed_user_ids, reason, updated_by, updated_at
     FROM page_toggles
     WHERE route_path = $1
     FOR UPDATE`,
    [routePath]
  );
  return rows[0] ?? null;
}

/**
 * Inserts or replaces one route's availability. `allowedRoles` / `allowedUserIds` are JS arrays
 * and are serialised here, so callers never hand-build JSON text.
 */
export async function upsertPageToggle(
  db,
  { routePath, state, allowedRoles = [], allowedUserIds = [], reason = null, updatedBy = null }
) {
  const { rows } = await db.query(
    `INSERT INTO page_toggles
       (route_path, state, allowed_roles, allowed_user_ids, reason, updated_by, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, now())
     ON CONFLICT (route_path) DO UPDATE
       SET state = EXCLUDED.state,
           allowed_roles = EXCLUDED.allowed_roles,
           allowed_user_ids = EXCLUDED.allowed_user_ids,
           reason = EXCLUDED.reason,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
     RETURNING route_path, state, allowed_roles, allowed_user_ids, reason, updated_by, updated_at`,
    [
      routePath,
      state,
      JSON.stringify(allowedRoles),
      JSON.stringify(allowedUserIds.map(String)),
      reason,
      updatedBy,
    ]
  );
  return rows[0];
}
