/**
 * permission.repository.js — Data access for RBAC, delegation, and restrictions (Prompt 2.4 / 2.5).
 *
 * Repositories own raw SQL only. No business rules, no caching.
 * Follows the 3-tier architecture: Routes → Controllers → Services → Repositories.
 */

export async function getRolesForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT r.id, r.key, r.label_en, r.label_bn, r.level
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
     ORDER BY r.level DESC`,
    [userId]
  );
  return rows;
}

export async function getPermissionsForRoleKeys(db, roleKeys) {
  if (!roleKeys || roleKeys.length === 0) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT p.key, p.domain, p.label_en, p.label_bn, p.plain_en, p.plain_bn,
            p.risk_tier, p.delegable, p.approval_mode, r.key AS role_key
     FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
     JOIN permissions p ON p.key = rp.permission_key
     WHERE r.key = ANY($1::text[])`,
    [roleKeys]
  );
  return rows;
}

export async function getActiveUserOverrides(db, userId) {
  const { rows } = await db.query(
    `SELECT id, permission_key, effect, scope_json, reason, granted_by, expires_at, created_at
     FROM user_permission_overrides
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > now()
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
}

export async function getActiveJitGrants(db, userId) {
  const { rows } = await db.query(
    `SELECT id, ref, permission_key, target_scope_json, reason, approver_id,
            window_minutes, window_expires_at, decided_at
     FROM permission_grant_requests
     WHERE requester_id = $1
       AND status = 'APPROVED'
       AND window_expires_at > now()
     ORDER BY decided_at ASC`,
    [userId]
  );
  return rows;
}

export async function getPermissionByKey(db, key) {
  const { rows } = await db.query(
    `SELECT key, domain, label_en, label_bn, plain_en, plain_bn, risk_tier, delegable, approval_mode
     FROM permissions
     WHERE key = $1`,
    [key]
  );
  return rows[0] ?? null;
}

export async function getAllPermissions(db) {
  const { rows } = await db.query(
    `SELECT key, domain, label_en, label_bn, plain_en, plain_bn, risk_tier, delegable, approval_mode
     FROM permissions
     ORDER BY key ASC`
  );
  return rows;
}

export async function getDirectUserRestrictions(db, userId, userRef, capabilityKey = null) {
  const { rows } = await db.query(
    `SELECT id, subject_type, subject_ref, capability_key, mode, limit_value,
            reason, reason_bn, evidence_json, applied_by, expires_at, created_at
     FROM user_restrictions
     WHERE subject_type = 'USER'
       AND (subject_ref = $1::text OR subject_ref = $2::text)
       AND lifted_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
       AND ($3::text IS NULL OR capability_key = $3::text)
     ORDER BY created_at DESC`,
    [String(userId), userRef, capabilityKey]
  );
  return rows;
}

export async function getActiveSegmentRestrictions(db, capabilityKey = null) {
  const { rows } = await db.query(
    `SELECT id, subject_type, subject_ref, segment_predicate, capability_key, mode, limit_value,
            reason, reason_bn, evidence_json, applied_by, expires_at, created_at
     FROM user_restrictions
     WHERE subject_type = 'SEGMENT'
       AND lifted_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
       AND ($1::text IS NULL OR capability_key = $1::text)
     ORDER BY created_at DESC`,
    [capabilityKey]
  );
  return rows;
}

export async function getUserProfileAndTrust(db, userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.ref, u.status, up.district, up.division, ts.tier, ts.score AS trust_score
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN trust_scores ts ON ts.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

/* ========================================================================= */
/* MODE A: Standing Grants (user_permission_overrides)                      */
/* ========================================================================= */

export async function createGrantOverride(
  db,
  { userId, permissionKey, effect = 'GRANT', scopeJson = null, reason, grantedBy, expiresAt }
) {
  const { rows } = await db.query(
    `INSERT INTO user_permission_overrides
       (user_id, permission_key, effect, scope_json, reason, granted_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, permissionKey, effect, scopeJson ? JSON.stringify(scopeJson) : null, reason, grantedBy, expiresAt]
  );
  return rows[0];
}

export async function getGrantOverrideById(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM user_permission_overrides WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function revokeGrantOverride(db, id, { revokedBy, reason = null }) {
  const { rows } = await db.query(
    `UPDATE user_permission_overrides
     SET revoked_at = now(),
         revoked_by = $2
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [id, revokedBy]
  );
  return rows[0] ?? null;
}

export async function listGrantOverrides(
  db,
  { userId = null, permissionKey = null, status = 'ACTIVE', limit = 50, offset = 0 } = {}
) {
  let where = 'WHERE 1=1';
  const params = [];

  if (userId) {
    params.push(userId);
    where += ` AND upo.user_id = $${params.length}`;
  }
  if (permissionKey) {
    params.push(permissionKey);
    where += ` AND upo.permission_key = $${params.length}`;
  }
  if (status === 'ACTIVE') {
    where += ' AND upo.revoked_at IS NULL AND upo.expires_at > now()';
  } else if (status === 'REVOKED') {
    where += ' AND upo.revoked_at IS NOT NULL';
  } else if (status === 'EXPIRED') {
    where += ' AND upo.revoked_at IS NULL AND upo.expires_at <= now()';
  }

  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT upo.*, u.ref AS user_ref, u.phone AS user_phone,
            g.ref AS granted_by_ref, r.ref AS revoked_by_ref,
            p.label_en AS permission_label_en, p.label_bn AS permission_label_bn, p.risk_tier
     FROM user_permission_overrides upo
     JOIN users u ON u.id = upo.user_id
     JOIN users g ON g.id = upo.granted_by
     LEFT JOIN users r ON r.id = upo.revoked_by
     JOIN permissions p ON p.key = upo.permission_key
     ${where}
     ORDER BY upo.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/* ========================================================================= */
/* MODE B: Just-In-Time Requests (permission_grant_requests)                */
/* ========================================================================= */

export async function createAccessRequest(
  db,
  { ref, requesterId, permissionKey, targetScopeJson = null, reason }
) {
  const { rows } = await db.query(
    `INSERT INTO permission_grant_requests
       (ref, requester_id, permission_key, target_scope_json, reason, status)
     VALUES ($1, $2, $3, $4, $5, 'PENDING')
     RETURNING *`,
    [ref, requesterId, permissionKey, targetScopeJson ? JSON.stringify(targetScopeJson) : null, reason]
  );
  return rows[0];
}

export async function getAccessRequestById(db, id) {
  const { rows } = await db.query(
    `SELECT pgr.*, u.ref AS requester_ref, u.phone AS requester_phone,
            a.ref AS approver_ref, p.label_en, p.label_bn, p.risk_tier, p.plain_en, p.plain_bn
     FROM permission_grant_requests pgr
     JOIN users u ON u.id = pgr.requester_id
     LEFT JOIN users a ON a.id = pgr.approver_id
     JOIN permissions p ON p.key = pgr.permission_key
     WHERE pgr.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getAccessRequestByRef(db, ref) {
  const { rows } = await db.query(
    `SELECT pgr.*, u.ref AS requester_ref, u.phone AS requester_phone,
            a.ref AS approver_ref, p.label_en, p.label_bn, p.risk_tier, p.plain_en, p.plain_bn
     FROM permission_grant_requests pgr
     JOIN users u ON u.id = pgr.requester_id
     LEFT JOIN users a ON a.id = pgr.approver_id
     JOIN permissions p ON p.key = pgr.permission_key
     WHERE pgr.ref = $1`,
    [ref]
  );
  return rows[0] ?? null;
}

export async function decideAccessRequest(
  db,
  id,
  { status, approverId, approverNote = null, windowMinutes = null, windowExpiresAt = null, decidedAt = new Date() }
) {
  const { rows } = await db.query(
    `UPDATE permission_grant_requests
     SET status = $2,
         approver_id = $3,
         approver_note = $4,
         window_minutes = $5,
         window_expires_at = $6,
         decided_at = $7
     WHERE id = $1
     RETURNING *`,
    [id, status, approverId, approverNote, windowMinutes, windowExpiresAt, decidedAt]
  );
  return rows[0] ?? null;
}

export async function listAccessRequests(
  db,
  { requesterId = null, permissionKey = null, status = null, limit = 50, offset = 0 } = {}
) {
  let where = 'WHERE 1=1';
  const params = [];

  if (requesterId) {
    params.push(requesterId);
    where += ` AND pgr.requester_id = $${params.length}`;
  }
  if (permissionKey) {
    params.push(permissionKey);
    where += ` AND pgr.permission_key = $${params.length}`;
  }
  if (status) {
    params.push(status);
    where += ` AND pgr.status = $${params.length}`;
  }

  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT pgr.*, u.ref AS requester_ref, u.phone AS requester_phone,
            a.ref AS approver_ref,
            p.label_en AS permission_label_en, p.label_bn AS permission_label_bn,
            p.plain_en, p.plain_bn, p.risk_tier
     FROM permission_grant_requests pgr
     JOIN users u ON u.id = pgr.requester_id
     LEFT JOIN users a ON a.id = pgr.approver_id
     JOIN permissions p ON p.key = pgr.permission_key
     ${where}
     ORDER BY pgr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/* ========================================================================= */
/* MODE C: Maker-Checker (pending_admin_actions)                            */
/* ========================================================================= */

export async function createPendingAdminAction(
  db,
  { ref, actorId, actionKey, payloadJson, targetType, targetRef, actorNote = null, expiresAt }
) {
  const { rows } = await db.query(
    `INSERT INTO pending_admin_actions
       (ref, actor_id, action_key, payload_json, target_type, target_ref, actor_note, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [ref, actorId, actionKey, JSON.stringify(payloadJson), targetType, targetRef, actorNote, expiresAt]
  );
  return rows[0];
}

export async function getPendingAdminActionById(db, id, forUpdate = false) {
  // `FOR UPDATE OF paa` (not a bare `FOR UPDATE`) — Postgres refuses to lock rows on the nullable
  // side of an outer join (approver_id is NULL until decided), so a plain `FOR UPDATE` here throws
  // "FOR UPDATE cannot be applied to the nullable side of an outer join" on every call. Naming the
  // target table restricts the lock to paa (the non-nullable side) and leaves the join intact.
  const lock = forUpdate ? ' FOR UPDATE OF paa' : '';
  const { rows } = await db.query(
    `SELECT paa.*, u.ref AS actor_ref, u.phone AS actor_phone,
            a.ref AS approver_ref, p.label_en, p.label_bn, p.risk_tier, p.approval_mode
     FROM pending_admin_actions paa
     JOIN users u ON u.id = paa.actor_id
     LEFT JOIN users a ON a.id = paa.approver_id
     JOIN permissions p ON p.key = paa.action_key
     WHERE paa.id = $1${lock}`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getPendingAdminActionByRef(db, ref) {
  const { rows } = await db.query(
    `SELECT paa.*, u.ref AS actor_ref, u.phone AS actor_phone,
            a.ref AS approver_ref, p.label_en, p.label_bn, p.risk_tier, p.approval_mode
     FROM pending_admin_actions paa
     JOIN users u ON u.id = paa.actor_id
     LEFT JOIN users a ON a.id = paa.approver_id
     JOIN permissions p ON p.key = paa.action_key
     WHERE paa.ref = $1`,
    [ref]
  );
  return rows[0] ?? null;
}

export async function updatePendingActionDecision(
  db,
  id,
  { status, approverId = null, approverNote = null, decidedAt = new Date(), appliedAt = null, failureReason = null }
) {
  const { rows } = await db.query(
    `UPDATE pending_admin_actions
     SET status = $2,
         approver_id = $3,
         approver_note = $4,
         decided_at = $5,
         applied_at = $6,
         failure_reason = $7
     WHERE id = $1
     RETURNING *`,
    [id, status, approverId, approverNote, decidedAt, appliedAt, failureReason]
  );
  return rows[0] ?? null;
}

export async function listPendingAdminActions(
  db,
  { actorId = null, actionKey = null, status = null, limit = 50, offset = 0 } = {}
) {
  let where = 'WHERE 1=1';
  const params = [];

  if (actorId) {
    params.push(actorId);
    where += ` AND paa.actor_id = $${params.length}`;
  }
  if (actionKey) {
    params.push(actionKey);
    where += ` AND paa.action_key = $${params.length}`;
  }
  if (status) {
    params.push(status);
    where += ` AND paa.status = $${params.length}`;
  }

  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT paa.*, u.ref AS actor_ref, u.phone AS actor_phone,
            a.ref AS approver_ref,
            p.label_en AS permission_label_en, p.label_bn AS permission_label_bn,
            p.plain_en, p.plain_bn, p.risk_tier
     FROM pending_admin_actions paa
     JOIN users u ON u.id = paa.actor_id
     LEFT JOIN users a ON a.id = paa.approver_id
     JOIN permissions p ON p.key = paa.action_key
     ${where}
     ORDER BY paa.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/* ========================================================================= */
/* Expiry & Periodic Sweep Queries                                          */
/* ========================================================================= */

export async function expireOverdueJitRequests(db) {
  const { rows } = await db.query(
    `UPDATE permission_grant_requests
     SET status = 'EXPIRED'
     WHERE status = 'APPROVED' AND window_expires_at <= now()
     RETURNING id, ref, requester_id, permission_key`
  );
  return rows;
}

export async function expireOverduePendingActions(db) {
  const { rows } = await db.query(
    `UPDATE pending_admin_actions
     SET status = 'EXPIRED'
     WHERE status = 'PENDING' AND expires_at <= now()
     RETURNING id, ref, actor_id, action_key`
  );
  return rows;
}

export async function findOverdueGrantOverrides(db) {
  const { rows } = await db.query(
    `SELECT id, user_id, permission_key
     FROM user_permission_overrides
     WHERE revoked_at IS NULL AND expires_at <= now()`
  );
  return rows;
}

/* ========================================================================= */
/* Restriction Management (Prompt 2.6)                                      */
/* ========================================================================= */

export async function createUserRestriction(
  db,
  {
    subjectType,
    subjectRef,
    segmentPredicate = null,
    capabilityKey,
    mode,
    limitValue = null,
    reason,
    reasonBn = null,
    evidenceJson = null,
    appliedBy,
    expiresAt = null,
  }
) {
  const { rows } = await db.query(
    `INSERT INTO user_restrictions
       (subject_type, subject_ref, segment_predicate, capability_key, mode, limit_value,
        reason, reason_bn, evidence_json, applied_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      subjectType,
      subjectRef,
      segmentPredicate ? JSON.stringify(segmentPredicate) : null,
      capabilityKey,
      mode,
      limitValue,
      reason,
      reasonBn,
      evidenceJson ? JSON.stringify(evidenceJson) : null,
      appliedBy,
      expiresAt,
    ]
  );
  return rows[0];
}

export async function getUserRestrictionById(db, id) {
  const { rows } = await db.query(
    `SELECT ur.*,
            a.ref AS applied_by_ref, a.phone AS applied_by_phone,
            l.ref AS lifted_by_ref
     FROM user_restrictions ur
     LEFT JOIN users a ON a.id = ur.applied_by
     LEFT JOIN users l ON l.id = ur.lifted_by
     WHERE ur.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function updateUserRestriction(
  db,
  id,
  { mode = null, limitValue = null, reason = null, reasonBn = null, evidenceJson = null, expiresAt = null }
) {
  const { rows } = await db.query(
    `UPDATE user_restrictions
     SET mode = COALESCE($2, mode),
         limit_value = COALESCE($3, limit_value),
         reason = COALESCE($4, reason),
         reason_bn = COALESCE($5, reason_bn),
         evidence_json = COALESCE($6, evidence_json),
         expires_at = COALESCE($7, expires_at)
     WHERE id = $1 AND lifted_at IS NULL
     RETURNING *`,
    [
      id,
      mode,
      limitValue,
      reason,
      reasonBn,
      evidenceJson ? JSON.stringify(evidenceJson) : null,
      expiresAt,
    ]
  );
  return rows[0] ?? null;
}

export async function liftUserRestriction(db, id, { liftedBy, liftReason = null }) {
  const { rows } = await db.query(
    `UPDATE user_restrictions
     SET lifted_at = now(),
         lifted_by = $2,
         evidence_json = CASE
           WHEN evidence_json IS NULL THEN jsonb_build_object('lift_reason', $3::text)
           ELSE evidence_json || jsonb_build_object('lift_reason', $3::text)
         END
     WHERE id = $1 AND lifted_at IS NULL
     RETURNING *`,
    [id, liftedBy, liftReason]
  );
  return rows[0] ?? null;
}

export async function listRestrictionsForUser(db, userId, userRef = null) {
  const { rows } = await db.query(
    `SELECT ur.*,
            a.ref AS applied_by_ref,
            l.ref AS lifted_by_ref
     FROM user_restrictions ur
     LEFT JOIN users a ON a.id = ur.applied_by
     LEFT JOIN users l ON l.id = ur.lifted_by
     WHERE ur.subject_type = 'USER'
       AND (ur.subject_ref = $1::text OR ($2::text IS NOT NULL AND ur.subject_ref = $2::text))
     ORDER BY ur.created_at DESC`,
    [String(userId), userRef]
  );
  return rows;
}

export async function listAllRestrictions(
  db,
  { subjectType = null, capabilityKey = null, mode = null, status = 'ACTIVE', limit = 50, offset = 0 } = {}
) {
  let where = 'WHERE 1=1';
  const params = [];

  if (subjectType) {
    params.push(subjectType);
    where += ` AND ur.subject_type = $${params.length}`;
  }
  if (capabilityKey) {
    params.push(capabilityKey);
    where += ` AND ur.capability_key = $${params.length}`;
  }
  if (mode) {
    params.push(mode);
    where += ` AND ur.mode = $${params.length}`;
  }
  if (status === 'ACTIVE') {
    where += ' AND ur.lifted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > now())';
  } else if (status === 'LIFTED') {
    where += ' AND ur.lifted_at IS NOT NULL';
  } else if (status === 'EXPIRED') {
    where += ' AND ur.lifted_at IS NULL AND ur.expires_at IS NOT NULL AND ur.expires_at <= now()';
  }

  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT ur.*,
            a.ref AS applied_by_ref,
            l.ref AS lifted_by_ref
     FROM user_restrictions ur
     LEFT JOIN users a ON a.id = ur.applied_by
     LEFT JOIN users l ON l.id = ur.lifted_by
     ${where}
     ORDER BY ur.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

