/**
 * permissionSync.ts — brings the roles, permissions and role grants in the database up to the
 * permission catalog, as the last step of `npm run migrate`.
 *
 * WHY migrate does this and not only `npm run seed`: a new permission lands in
 * seeds/001_roles_permissions.sql (generated from docs/permission-catalog.json), never in a
 * migration. A database that is migrated but not re-seeded keeps working, yet every page guarded
 * by the new key shows as locked, even to the super admin (it happened with platform.legal.view).
 * Running the full seed is not the answer: it also re-prices the demo catalog.
 *
 * Safe to run on every migrate because the seed file only ever adds: each INSERT is
 * ON CONFLICT DO NOTHING, and nothing at runtime edits role_permissions (delegation is a grant, not
 * a role change). server/test/permissionSync.test.js fails if the file ever stops being add-only.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PERMISSION_SEED_FILE = path.join(__dirname, 'seeds', '001_roles_permissions.sql');

/**
 * Applies the permission seed inside one transaction and reports how many rows it added.
 * `pool` is a pg Pool (or anything with connect() returning a client with query/release).
 */
export async function syncPermissions(pool, sql?: string) {
  const text = sql ?? (await readFile(PERMISSION_SEED_FILE, 'utf8'));
  const client = await pool.connect();
  try {
    const count = async () => {
      const { rows } = await client.query(
        `SELECT (SELECT count(*) FROM roles)::int AS roles,
                (SELECT count(*) FROM permissions)::int AS permissions,
                (SELECT count(*) FROM role_permissions)::int AS grants`
      );
      return rows[0];
    };
    await client.query('BEGIN');
    const before = await count();
    await client.query(text);
    const after = await count();
    await client.query('COMMIT');
    return {
      roles: after.roles - before.roles,
      permissions: after.permissions - before.permissions,
      grants: after.grants - before.grants,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Permission sync failed: ${err.message}`);
  } finally {
    client.release();
  }
}
