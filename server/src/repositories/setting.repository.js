/**
 * setting.repository.js — Data access for the platform_settings table (004_platform_config.sql).
 *
 * platform_settings is the project's home for every business number and policy value that must be
 * changeable without a deploy (CLAUDE.md: "Configuration, not code"). Rows are addressed by their
 * dotted `key` and grouped by `group_key`, so a feature reads and writes its whole policy as one
 * group rather than one round trip per value.
 */

/** Every row in one settings group, ordered by key so a policy object is built deterministically. */
export async function listSettingsByGroup(db, groupKey) {
  const { rows } = await db.query(
    `SELECT key, value_json, value_type, label_en, label_bn, group_key, is_sensitive,
            updated_by, created_at, updated_at
     FROM platform_settings
     WHERE group_key = $1
     ORDER BY key`,
    [groupKey]
  );
  return rows;
}

export async function getSettingByKey(db, key) {
  const { rows } = await db.query(
    `SELECT key, value_json, value_type, label_en, label_bn, group_key, is_sensitive,
            updated_by, created_at, updated_at
     FROM platform_settings
     WHERE key = $1`,
    [key]
  );
  return rows[0] ?? null;
}

/**
 * Locks a settings group for the remainder of the caller's transaction.
 *
 * WHY: a policy write is read-modify-write (read the current values to audit them as `before`,
 * then write the new ones). Two admins saving at once would otherwise interleave and the second
 * commit would record a `before` that never existed — an audit trail that lies. Taking the row
 * locks up front serialises the two saves instead. Must be called inside a transaction; outside
 * one the lock is released immediately and buys nothing.
 */
export async function lockSettingsGroup(db, groupKey) {
  const { rows } = await db.query(
    `SELECT key, value_json
     FROM platform_settings
     WHERE group_key = $1
     ORDER BY key
     FOR UPDATE`,
    [groupKey]
  );
  return rows;
}

/**
 * Inserts or updates one setting. `valueJson` is the JS value itself (string/boolean/array/object)
 * and is serialised here, so callers never hand-build JSON text.
 *
 * On conflict only the value, the author and the timestamp move: labels and grouping belong to the
 * migration that declared the key, not to whoever happens to change its value.
 */
export async function upsertSetting(
  db,
  { key, valueJson, valueType, labelEn = null, labelBn = null, groupKey, isSensitive = false, updatedBy = null }
) {
  const { rows } = await db.query(
    `INSERT INTO platform_settings
       (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (key) DO UPDATE
       SET value_json = EXCLUDED.value_json,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
     RETURNING key, value_json, value_type, label_en, label_bn, group_key, is_sensitive,
               updated_by, created_at, updated_at`,
    [key, JSON.stringify(valueJson), valueType, labelEn, labelBn, groupKey, isSensitive, updatedBy]
  );
  return rows[0];
}

/**
 * Who is currently able to run `permissionKey`: the roles that hold it by default plus every
 * live standing grant (Mode A). This is the "assigned by Super Admin" roster — it answers
 * "who can change this?" from the same tables requirePermission reads, rather than from a
 * second list that would drift.
 */
export async function listPermissionHolders(db, permissionKey) {
  const { rows: roleRows } = await db.query(
    `SELECT r.key, r.label_en, r.label_bn
     FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
     WHERE rp.permission_key = $1
     ORDER BY r.level DESC`,
    [permissionKey]
  );

  const { rows: grantRows } = await db.query(
    `SELECT o.id, o.user_id, o.effect, o.reason, o.expires_at, o.created_at,
            u.ref AS user_ref, p.full_name, p.display_name
     FROM user_permission_overrides o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN user_profiles p ON p.user_id = o.user_id
     WHERE o.permission_key = $1
       AND o.revoked_at IS NULL
       AND o.expires_at > now()
     ORDER BY o.created_at DESC`,
    [permissionKey]
  );

  return { roles: roleRows, grants: grantRows };
}
