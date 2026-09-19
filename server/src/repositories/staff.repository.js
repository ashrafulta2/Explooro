/**
 * staff.repository.js — SQL for the Staff Management admin surface (Prompt 3.3).
 *
 * "Staff" is not a table. It is a users row that holds a role at or above STAFF_MIN_ROLE_LEVEL
 * (config/staffRoles.js), so every read here goes through one CTE — ROSTER_CTE — and every caller
 * sees the same derived columns. Money never appears; nothing here is a balance mutation.
 *
 * Derived status (the API's vocabulary is ACTIVE | INVITED | SUSPENDED, the table's is not):
 *   SUSPENDED  users.status is SUSPENDED or BANNED
 *   INVITED    users.status is ACTIVE (or PENDING_VERIFICATION) and the person has never signed in
 *   ACTIVE     users.status is ACTIVE and last_login_at is set
 * WHY "invited" is derived instead of a stored status: auth.service.js only lets status = 'ACTIVE'
 * sign in, so a PENDING_VERIFICATION invitee could never reach the OTP flow that activates them. An
 * ACTIVE account with no last_login_at is exactly "created, has not accepted yet" and signs in
 * through the existing OTP + staff-2FA path with no auth change.
 *
 * Every function takes `db` — the pool for reads, a transaction client for writes — so the service
 * decides the transaction boundary.
 */

/** $1 = STAFF_MIN_ROLE_LEVEL. Appended to by each query; never interpolate user input into it. */
const ROSTER_CTE = `
  WITH staff_role AS (
    SELECT DISTINCT ON (ur.user_id) ur.user_id, r.id AS role_id, r.key AS role_key,
           r.label_en, r.label_bn, r.level
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
     WHERE r.level >= $1
     ORDER BY ur.user_id, r.level DESC, r.id
  ),
  roster AS (
    SELECT u.id, u.ref, u.email, u.phone, u.status AS account_status, u.last_login_at, u.created_at,
           up.full_name, up.department,
           sr.role_id, sr.role_key, sr.label_en AS role_label_en, sr.label_bn AS role_label_bn,
           (s2.enrolled_at IS NOT NULL) AS two_factor_enabled,
           CASE
             WHEN u.status IN ('SUSPENDED', 'BANNED') THEN 'SUSPENDED'
             WHEN u.last_login_at IS NULL THEN 'INVITED'
             ELSE 'ACTIVE'
           END AS status,
           -- super_admin holds every permission by rule (rbac.service.js), not by role_permissions rows.
           CASE WHEN sr.role_key = 'super_admin'
                THEN (SELECT COUNT(*) FROM permissions)
                ELSE (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = sr.role_id)
           END::int AS permissions_count
      FROM users u
      JOIN staff_role sr ON sr.user_id = u.id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      LEFT JOIN staff_2fa s2 ON s2.user_id = u.id
     WHERE u.deleted_at IS NULL
  )`;

/** Escapes LIKE metacharacters so a search for "50%" or "a_b" matches literally. */
function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The digits of a phone, without country code or leading zero: "+8801711000001" -> "1711000001". */
function nationalDigits(text) {
  const digits = String(text).replace(/\D/g, '');
  if (digits.startsWith('880')) return digits.slice(3);
  return digits.replace(/^0/, '');
}

export async function listStaffRoles(db, minLevel) {
  const { rows } = await db.query(
    `SELECT r.key, r.label_en, r.label_bn, r.level,
            CASE WHEN r.key = 'super_admin'
                 THEN (SELECT COUNT(*) FROM permissions)
                 ELSE (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id)
            END::int AS permissions_count
       FROM roles r
      WHERE r.level >= $1
      ORDER BY r.level DESC, r.key`,
    [minLevel]
  );
  return rows;
}

export async function findStaffRoleByKey(db, key, minLevel) {
  const { rows } = await db.query(
    'SELECT id, key, label_en, label_bn, level FROM roles WHERE key = $1 AND level >= $2',
    [key, minLevel]
  );
  return rows[0] ?? null;
}

/**
 * Filtered, paginated roster. Filters run against the CTE's derived columns (status, 2FA), which is
 * why they sit in an outer query rather than in the CTE. `total` is the filtered count for the
 * pager; the vitals (below) deliberately ignore filters.
 */
export async function listStaff(db, { minLevel, query, role, status, twoFactor, limit, offset }) {
  const params = [minLevel];
  const where = [];

  if (query) {
    params.push(likePattern(query));
    const text = `$${params.length}`;
    const clauses = [
      `full_name ILIKE ${text} ESCAPE '\\'`,
      `email ILIKE ${text} ESCAPE '\\'`,
      `ref ILIKE ${text} ESCAPE '\\'`,
      `department ILIKE ${text} ESCAPE '\\'`,
    ];
    const digits = nationalDigits(query);
    if (digits.length >= 3) {
      params.push(`%${digits}%`);
      clauses.push(`phone LIKE $${params.length}`);
    }
    where.push(`(${clauses.join(' OR ')})`);
  }
  if (role) {
    params.push(role);
    where.push(`role_key = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (twoFactor === 'ENABLED') where.push('two_factor_enabled');
  if (twoFactor === 'PENDING') where.push('NOT two_factor_enabled');

  params.push(limit, offset);
  const { rows } = await db.query(
    `${ROSTER_CTE}
     SELECT roster.*, COUNT(*) OVER()::int AS total_rows
       FROM roster
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows, total: rows[0]?.total_rows ?? 0 };
}

export async function getStaffById(db, id, minLevel) {
  const { rows } = await db.query(`${ROSTER_CTE} SELECT * FROM roster WHERE id = $2`, [minLevel, id]);
  return rows[0] ?? null;
}

/**
 * Security posture of the WHOLE roster. A search must never make 2FA coverage look different, so
 * this takes no filters. "Usable" excludes suspended members: a suspended account cannot sign in,
 * so its missing 2FA is not a live exposure.
 */
export async function getVitals(db, minLevel) {
  const { rows } = await db.query(
    `${ROSTER_CTE}
     SELECT COUNT(*)::int AS total_staff,
            COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_staff,
            COUNT(*) FILTER (WHERE status = 'INVITED')::int AS invited_staff,
            COUNT(*) FILTER (WHERE status <> 'SUSPENDED')::int AS usable_staff,
            COUNT(*) FILTER (WHERE status <> 'SUSPENDED' AND two_factor_enabled)::int AS usable_with_2fa,
            COUNT(*) FILTER (WHERE status = 'ACTIVE' AND role_key = 'super_admin')::int AS active_super_admins
       FROM roster`,
    [minLevel]
  );
  return rows[0];
}

/**
 * Serialises every operation that could remove a Super Admin, for the length of the caller's
 * transaction. Call this FIRST, then read the count with listActiveSuperAdmins() in a separate
 * statement.
 *
 * WHY an advisory lock and not row locks: "the last active Super Admin cannot be demoted or
 * suspended" is a count-then-write rule, and two concurrent requests (demote A while suspending B)
 * would each see two admins and both proceed, leaving none. Locking the super-admin `users` rows
 * looks like the fix and is not — a demotion rewrites `user_roles`, not `users`, and under READ
 * COMMITTED a waiter re-checks only the row it was blocked on; the joined `user_roles` is still read
 * from the statement's original snapshot, so it keeps counting the admin who was just demoted.
 * (Found by the concurrency test in test/staffManagement.test.js, which passed by luck when run alone.)
 * A single advisory lock has no such gap: the second transaction waits here, and its NEXT statement
 * — the count — takes a fresh snapshot that sees the first one's commit. These are rare admin
 * actions, so one global lock costs nothing.
 */
export async function lockSuperAdminGuard(db) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('staff:super-admin-guard', 0))");
}

/** Ids of the ACTIVE (signed-in, not suspended) Super Admins. Read it only after lockSuperAdminGuard. */
export async function listActiveSuperAdmins(db) {
  const { rows } = await db.query(
    `SELECT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.key = 'super_admin'
      WHERE u.status = 'ACTIVE' AND u.last_login_at IS NOT NULL AND u.deleted_at IS NULL
      ORDER BY u.id`
  );
  return rows.map((r) => Number(r.id));
}

/** Row-locks one user for the duration of the caller's transaction. */
export async function lockUser(db, id) {
  const { rows } = await db.query(
    'SELECT id, status FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
    [id]
  );
  return rows[0] ?? null;
}

export async function findConflictingContact(db, { email, phone }) {
  const { rows } = await db.query(
    `SELECT CASE WHEN lower(email) = $1 THEN 'email' ELSE 'phone' END AS field
       FROM users
      WHERE lower(email) = $1 OR phone = $2
      ORDER BY (lower(email) = $1) DESC
      LIMIT 1`,
    [email, phone]
  );
  return rows[0]?.field ?? null;
}

export async function insertStaffUser(db, { ref, phone, email }) {
  const { rows } = await db.query(
    `INSERT INTO users (ref, phone, email, status, locale)
     VALUES ($1, $2, $3, 'ACTIVE', 'en')
     RETURNING id`,
    [ref, phone, email]
  );
  return Number(rows[0].id);
}

export async function insertStaffProfile(db, { userId, fullName, department }) {
  await db.query(
    `INSERT INTO user_profiles (user_id, full_name, department) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, department = EXCLUDED.department`,
    [userId, fullName, department]
  );
}

export async function insertUserRole(db, { userId, roleId, assignedBy }) {
  await db.query(
    'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [userId, roleId, assignedBy]
  );
}

/**
 * Swaps the member's staff role. Non-staff roles they also hold (a supplier who was made a
 * moderator keeps being a supplier) are left alone — only roles at or above the staff line move.
 */
export async function replaceStaffRole(db, { userId, roleId, assignedBy, minLevel }) {
  await db.query(
    `DELETE FROM user_roles ur USING roles r
      WHERE ur.role_id = r.id AND ur.user_id = $1 AND r.level >= $2`,
    [userId, minLevel]
  );
  await insertUserRole(db, { userId, roleId, assignedBy });
}

export async function setUserStatus(db, userId, status) {
  await db.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);
}

/** Signs the person out everywhere; authenticate.js rejects a revoked session on the next request. */
export async function revokeAllSessions(db, userId, reason) {
  const { rowCount } = await db.query(
    'UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL',
    [userId, reason]
  );
  return rowCount;
}

/**
 * Deleting the row is the reset: with no staff_2fa row, the next login reports `enrolled: false`
 * and walks the person through a fresh enrolment (auth.service.js completeLogin). Returns whether
 * an enrolled authenticator was actually removed, so "nothing to reset" is distinguishable.
 */
export async function deleteEnrolledStaff2fa(db, userId) {
  const { rowCount } = await db.query(
    'DELETE FROM staff_2fa WHERE user_id = $1 AND enrolled_at IS NOT NULL',
    [userId]
  );
  return rowCount > 0;
}

/**
 * The change history for one member: audit rows whose target is this staff ref, newest first.
 * Read-only against the append-only audit_logs; the reason a write carried is stored under
 * after_json.meta.reason (audit.service.js `meta`) and lifted out here so the client gets it flat.
 */
export async function listStaffActivity(db, ref, limit) {
  const { rows } = await db.query(
    `SELECT a.id, a.action, a.before_json, a.after_json, a.created_at,
            COALESCE(up.full_name, actor.email, 'System') AS actor_name
       FROM audit_logs a
       LEFT JOIN users actor ON actor.id = a.actor_id
       LEFT JOIN user_profiles up ON up.user_id = a.actor_id
      WHERE a.target_type = 'staff' AND a.target_ref = $1
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $2`,
    [ref, limit]
  );
  return rows.map((row) => {
    const { meta, ...after } = row.after_json ?? {};
    return {
      id: Number(row.id),
      action: row.action,
      actor_name: row.actor_name,
      before: row.before_json ?? {},
      after,
      reason: meta?.reason ?? null,
      created_at: row.created_at,
    };
  });
}
