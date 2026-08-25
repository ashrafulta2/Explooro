/**
 * user.repository.js — Data access for identity/RBAC/session tables (Prompt 2.3).
 *
 * Every function takes `db` (a pg Pool or a checked-out transaction client — both expose the same
 * `.query`) as its first argument, per the project's 3-tier architecture: services own business
 * rules, repositories own SQL, nothing above this layer writes a query.
 */

export async function findUserByPhone(db, phone) {
  if (!phone) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL', [phone]);
  return rows[0] ?? null;
}

export async function findUserByEmail(db, email) {
  if (!email) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL', [email]);
  return rows[0] ?? null;
}

export async function findUserByIdentifier(db, identifier) {
  if (!identifier) return null;
  const trimmed = identifier.trim();
  const isEmail = trimmed.includes('@');
  if (isEmail) {
    return findUserByEmail(db, trimmed);
  }
  return findUserByPhone(db, trimmed);
}

export async function findUserById(db, id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
  return rows[0] ?? null;
}

export async function createUser(db, { ref, phone = null, email = null, passwordHash = null, isPhoneVerified = false, isEmailVerified = false }) {
  const { rows } = await db.query(
    `INSERT INTO users (ref, phone, email, password_hash, is_phone_verified, is_email_verified)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [ref, phone, email, passwordHash, isPhoneVerified, isEmailVerified]
  );
  return rows[0];
}

export async function createUserProfile(db, { userId, fullName = null }) {
  await db.query(
    `INSERT INTO user_profiles (user_id, full_name, display_name) VALUES ($1, $2, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, fullName]
  );
}

export async function markPhoneVerified(db, userId) {
  await db.query('UPDATE users SET is_phone_verified = true WHERE id = $1', [userId]);
}

export async function markEmailVerified(db, userId) {
  await db.query('UPDATE users SET is_email_verified = true WHERE id = $1', [userId]);
}

export async function updateLastLogin(db, userId) {
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
}

export async function assignRole(db, { userId, roleKey, assignedBy = null }) {
  await db.query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by)
     SELECT $1, r.id, $3 FROM roles r WHERE r.key = $2
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleKey, assignedBy]
  );
}

export async function getRolesForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT r.id, r.key, r.label_en, r.label_bn, r.level
     FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId]
  );
  return rows;
}

/** Pre-2.4 simplified resolution: union of role_permissions only — no overrides/JIT/deny yet. */
export async function getPermissionsForRoleKeys(db, roleKeys) {
  if (roleKeys.length === 0) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT p.key, p.risk_tier
     FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
     JOIN permissions p ON p.key = rp.permission_key
     WHERE r.key = ANY($1::text[])`,
    [roleKeys]
  );
  return rows;
}

export async function createSession(db, { userId, familyId, ip, userAgent, deviceLabel = null, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO sessions (user_id, family_id, ip_address, user_agent, device_label, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, familyId, ip, userAgent, deviceLabel, expiresAt]
  );
  return rows[0];
}

export async function getSessionById(db, id) {
  const { rows } = await db.query('SELECT * FROM sessions WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/**
 * Session lookup that also carries the identity fields every authenticated request needs.
 *
 * WHY this exists alongside `getSessionById`: `authenticate.js` already pays for one session query
 * per request, and callers downstream (chat tickets, live-stream tokens, in-stream orders) need the
 * user's display name and phone. Folding them into the existing round trip keeps `req.user` useful
 * without adding a second query. `getSessionById` keeps its narrower contract for auth.service.js.
 */
export async function getSessionWithIdentity(db, id) {
  const { rows } = await db.query(
    `SELECT s.*,
            COALESCE(up.display_name, up.full_name) AS full_name,
            u.phone AS user_phone
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE s.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function revokeSession(db, id, reason) {
  await db.query('UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1', [id, reason]);
}

export async function touchSessionLastSeen(db, id) {
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]);
}

export async function createRefreshToken(db, { sessionId, tokenHash, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING *`,
    [sessionId, tokenHash, expiresAt]
  );
  return rows[0];
}

export async function getRefreshTokenByHash(db, tokenHash) {
  const { rows } = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  return rows[0] ?? null;
}

export async function markRefreshTokenUsed(db, id, replacedById) {
  await db.query('UPDATE refresh_tokens SET used_at = now(), replaced_by = $2 WHERE id = $1', [id, replacedById]);
}

export async function createOtp(db, { phone = null, email = null, codeHash, purpose, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO otp_codes (phone, email, code_hash, purpose, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [phone, email ? email.toLowerCase().trim() : null, codeHash, purpose, expiresAt]
  );
  return rows[0];
}

export async function getLatestActiveOtp(db, { phone = null, email = null, purpose }) {
  if (email) {
    const { rows } = await db.query(
      `SELECT * FROM otp_codes
       WHERE LOWER(email) = LOWER($1) AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [email.trim(), purpose]
    );
    return rows[0] ?? null;
  }
  const { rows } = await db.query(
    `SELECT * FROM otp_codes
     WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, purpose]
  );
  return rows[0] ?? null;
}

export async function incrementOtpAttempts(db, id) {
  const { rows } = await db.query(
    'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts, max_attempts',
    [id]
  );
  return rows[0];
}

export async function consumeOtp(db, id) {
  await db.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [id]);
}

export async function getStaff2fa(db, userId) {
  const { rows } = await db.query('SELECT * FROM staff_2fa WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}

export async function upsertStaff2fa(db, { userId, secretEncrypted, recoveryCodesHash }) {
  const { rows } = await db.query(
    `INSERT INTO staff_2fa (user_id, secret_encrypted, recovery_codes_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET secret_encrypted = EXCLUDED.secret_encrypted,
           recovery_codes_hash = EXCLUDED.recovery_codes_hash,
           enrolled_at = NULL,
           last_used_at = NULL
     RETURNING *`,
    [userId, secretEncrypted, JSON.stringify(recoveryCodesHash)]
  );
  return rows[0];
}

export async function markStaff2faVerifiedNow(db, userId) {
  await db.query(
    `UPDATE staff_2fa SET enrolled_at = COALESCE(enrolled_at, now()), last_used_at = now() WHERE user_id = $1`,
    [userId]
  );
}

export async function getActiveRestrictionsForUser(db, userRef) {
  const { rows } = await db.query(
    `SELECT id, capability_key, mode, limit_value, reason, expires_at
     FROM user_restrictions
     WHERE subject_type = 'USER' AND subject_ref = $1
       AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [userRef]
  );
  return rows;
}

export async function listUsersForAdmin(
  db,
  { query = null, role = null, tier = null, verification = null, restriction = null, district = null, limit = 50, offset = 0 } = {}
) {
  let where = 'WHERE u.deleted_at IS NULL';
  const params = [];

  if (query) {
    params.push(`%${query}%`);
    const pIdx = params.length;
    where += ` AND (u.phone ILIKE $${pIdx} OR u.email ILIKE $${pIdx} OR u.ref ILIKE $${pIdx} OR up.full_name ILIKE $${pIdx} OR up.display_name ILIKE $${pIdx})`;
  }

  if (role && role !== 'ALL') {
    params.push(role);
    where += ` AND r.key = $${params.length}`;
  }

  if (tier && tier !== 'ALL') {
    params.push(tier);
    where += ` AND u.status = $${params.length}`;
  }

  if (district && district !== 'ALL') {
    params.push(district);
    where += ` AND up.district = $${params.length}`;
  }

  params.push(limit, offset);

  const { rows } = await db.query(
    `SELECT u.id, u.ref, u.phone, u.email, u.status, u.is_phone_verified, u.is_email_verified, u.last_login_at, u.created_at,
            up.full_name, up.display_name, up.district, up.division,
            r.key AS role_key, r.label_en AS role_label_en, r.label_bn AS role_label_bn,
            (SELECT COUNT(*) FROM user_restrictions ur WHERE ur.subject_type = 'USER' AND ur.subject_ref = u.ref AND ur.lifted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > now()))::int AS active_restrictions_count
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     ${where}
     ORDER BY u.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return rows;
}

export async function getUserDetailForAdmin(db, userIdOrRef) {
  const isNumeric = /^\d+$/.test(String(userIdOrRef));
  const querySql = isNumeric
    ? 'SELECT u.*, up.full_name, up.display_name, up.district, up.division, up.address_line, up.postal_code, up.bio FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1 AND u.deleted_at IS NULL'
    : 'SELECT u.*, up.full_name, up.display_name, up.district, up.division, up.address_line, up.postal_code, up.bio FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.ref = $1 AND u.deleted_at IS NULL';

  const { rows } = await db.query(querySql, [userIdOrRef]);
  if (!rows[0]) return null;

  const user = rows[0];

  // Fetch roles
  const roles = await getRolesForUser(db, user.id);

  // Fetch active restrictions
  const restrictions = await getActiveRestrictionsForUser(db, user.ref);

  return {
    ...user,
    roles,
    restrictions,
  };
}

export async function getRolesAndPermissionMatrix(db) {
  const rolesRes = await db.query('SELECT id, key, label_en, label_bn, level, is_system FROM roles ORDER BY level DESC');
  const permsRes = await db.query(
    'SELECT key, domain, label_en, label_bn, plain_en, plain_bn, risk_tier, delegable, approval_mode FROM permissions ORDER BY domain, key'
  );
  const mapRes = await db.query('SELECT role_id, permission_key FROM role_permissions');

  return {
    roles: rolesRes.rows,
    permissions: permsRes.rows,
    rolePermissions: mapRes.rows,
  };
}
