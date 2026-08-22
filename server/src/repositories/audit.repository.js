/**
 * audit.repository.js — Data access layer for Audit Logs (Prompt 2.7).
 *
 * Repositories own raw SQL only. Follows strict 3-tier architecture:
 * Routes → Controllers → Services → Repositories.
 */

export async function insertAuditLog(
  db,
  {
    actorId = null,
    actorRole = null,
    action,
    targetType = null,
    targetRef = null,
    beforeJson = null,
    afterJson = null,
    undoPayload = null,
    riskTier = null,
    isBreakglass = false,
    ipAddress = null,
    userAgent = null,
    traceId = null,
  }
) {
  const { rows } = await db.query(
    `INSERT INTO audit_logs
       (actor_id, actor_role, action, target_type, target_ref,
        before_json, after_json, undo_payload, risk_tier, is_breakglass,
        ip_address, user_agent, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      actorId,
      actorRole,
      action,
      targetType,
      targetRef,
      beforeJson ? JSON.stringify(beforeJson) : null,
      afterJson ? JSON.stringify(afterJson) : null,
      undoPayload ? JSON.stringify(undoPayload) : null,
      riskTier,
      isBreakglass,
      ipAddress,
      userAgent,
      traceId,
    ]
  );
  return rows[0];
}

export async function listAuditLogs(
  db,
  {
    actorId = null,
    action = null,
    targetType = null,
    targetRef = null,
    riskTier = null,
    traceId = null,
    startDate = null,
    endDate = null,
    cursor = null,
    limit = 50,
  } = {}
) {
  let where = 'WHERE 1=1';
  const params = [];

  if (actorId) {
    params.push(actorId);
    where += ` AND al.actor_id = $${params.length}`;
  }
  if (action) {
    params.push(action);
    where += ` AND al.action = $${params.length}`;
  }
  if (targetType) {
    params.push(targetType);
    where += ` AND al.target_type = $${params.length}`;
  }
  if (targetRef) {
    params.push(targetRef);
    where += ` AND al.target_ref = $${params.length}`;
  }
  if (riskTier) {
    params.push(riskTier);
    where += ` AND al.risk_tier = $${params.length}`;
  }
  if (traceId) {
    params.push(traceId);
    where += ` AND al.trace_id = $${params.length}`;
  }
  if (startDate) {
    params.push(new Date(startDate));
    where += ` AND al.created_at >= $${params.length}`;
  }
  if (endDate) {
    params.push(new Date(endDate));
    where += ` AND al.created_at <= $${params.length}`;
  }
  if (cursor) {
    params.push(Number(cursor));
    where += ` AND al.id < $${params.length}`;
  }

  params.push(limit + 1);
  const { rows } = await db.query(
    `SELECT al.*, u.ref AS actor_ref, u.phone AS actor_phone
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id
     ${where}
     ORDER BY al.id DESC
     LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

  return {
    items,
    next_cursor: nextCursor,
    has_more: hasMore,
  };
}

export async function getAuditChainForVerification(db, { limit = 5000, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT id, actor_id, actor_role, action, target_type, target_ref,
            before_json, after_json, undo_payload, risk_tier, is_breakglass,
            ip_address, user_agent, trace_id, prev_hash, row_hash, created_at
     FROM audit_logs
     ORDER BY id ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

export async function getUserTimelineAuditLogs(db, userId, userRef = null, { limit = 50, offset = 0 } = {}) {
  const params = [userId, userRef, limit, offset];
  const { rows } = await db.query(
    `SELECT al.*, u.ref AS actor_ref, u.phone AS actor_phone
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id
     WHERE al.actor_id = $1
        OR (al.target_type = 'user' AND (al.target_ref = $1::text OR ($2::text IS NOT NULL AND al.target_ref = $2::text)))
        OR (al.target_type = 'user_restriction' AND (al.before_json->>'subject_ref' = $1::text OR al.after_json->>'subject_ref' = $1::text))
        OR (al.target_type = 'user_permission_override' AND (al.before_json->>'user_id' = $1::text OR al.after_json->>'user_id' = $1::text))
     ORDER BY al.created_at DESC
     LIMIT $3 OFFSET $4`,
    params
  );
  return rows;
}

export async function getAuditLogById(db, id) {
  const { rows } = await db.query(
    `SELECT al.*, u.ref AS actor_ref, u.phone AS actor_phone
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_id
     WHERE al.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}
