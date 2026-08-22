/**
 * segment.service.js — Dynamic Segment Evaluation & Preview Engine (Prompt 2.6).
 *
 * Implements dynamic predicate matching per docs/rbac-spec.md §5:
 * - Dynamic segment predicate rules: role, district, division, status, tier, trust_score thresholds.
 * - Evaluated live at request time so newly matching users are covered automatically without backfill jobs.
 * - Dry-run preview query returning matching count and sample users for admin interface.
 */

/**
 * Evaluates a segment predicate in-memory against a user's context.
 *
 * @param {object} predicate - e.g. { role: 'saler', district: 'Dhaka', tier: 'STARTER', trust_score_lt: 40 }
 * @param {object} userContext - { roles: string[], district, division, status, tier, trust_score, created_at }
 * @returns {boolean}
 */
export function evaluatePredicate(predicate, userContext) {
  if (!predicate || typeof predicate !== 'object') return false;
  if (!userContext) return false;

  const roles = (userContext.roles || []).map((r) => String(r).toLowerCase());

  if (predicate.role && !roles.includes(String(predicate.role).toLowerCase())) {
    return false;
  }

  if (predicate.roles_include && Array.isArray(predicate.roles_include)) {
    const targetRoles = predicate.roles_include.map((r) => String(r).toLowerCase());
    const hasAny = targetRoles.some((r) => roles.includes(r));
    if (!hasAny) return false;
  }

  if (predicate.roles && Array.isArray(predicate.roles)) {
    const targetRoles = predicate.roles.map((r) => String(r).toLowerCase());
    const hasAny = targetRoles.some((r) => roles.includes(r));
    if (!hasAny) return false;
  }

  if (predicate.district && String(userContext.district || '').toLowerCase() !== String(predicate.district).toLowerCase()) {
    return false;
  }

  if (predicate.division && String(userContext.division || '').toLowerCase() !== String(predicate.division).toLowerCase()) {
    return false;
  }

  if (predicate.status && userContext.status !== predicate.status) {
    return false;
  }

  if (predicate.tier && String(userContext.tier || 'STARTER').toLowerCase() !== String(predicate.tier).toLowerCase()) {
    return false;
  }

  const score = typeof userContext.trust_score === 'number' ? userContext.trust_score : 50;

  if (typeof predicate.trust_score_lt === 'number' && score >= predicate.trust_score_lt) {
    return false;
  }

  if (typeof predicate.trust_score_lte === 'number' && score > predicate.trust_score_lte) {
    return false;
  }

  if (typeof predicate.trust_score_gt === 'number' && score <= predicate.trust_score_gt) {
    return false;
  }

  if (typeof predicate.trust_score_gte === 'number' && score < predicate.trust_score_gte) {
    return false;
  }

  if (predicate.created_before && userContext.created_at) {
    if (new Date(userContext.created_at) >= new Date(predicate.created_before)) {
      return false;
    }
  }

  if (predicate.created_after && userContext.created_at) {
    if (new Date(userContext.created_at) <= new Date(predicate.created_after)) {
      return false;
    }
  }

  // Generic attribute comparison for additional custom criteria
  const knownKeys = new Set([
    'role',
    'roles',
    'roles_include',
    'district',
    'division',
    'status',
    'tier',
    'trust_score_lt',
    'trust_score_lte',
    'trust_score_gt',
    'trust_score_gte',
    'created_before',
    'created_after',
  ]);

  for (const [k, v] of Object.entries(predicate)) {
    if (!knownKeys.has(k)) {
      if (userContext[k] !== v) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Executes a dry-run preview query against the database to determine
 * how many users match the specified predicate criteria.
 *
 * @param {object} db - Database client/pool
 * @param {object} predicate - Predicate criteria
 * @returns {Promise<{ matching_count: number, sample_users: Array }>}
 */
export async function previewSegmentMatch(db, predicate = {}) {
  let where = 'WHERE 1=1';
  const params = [];

  if (predicate.role) {
    params.push(String(predicate.role).toLowerCase());
    where += ` AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id AND LOWER(r.key) = $${params.length}
    )`;
  }

  if (predicate.roles_include && Array.isArray(predicate.roles_include) && predicate.roles_include.length > 0) {
    params.push(predicate.roles_include.map((r) => String(r).toLowerCase()));
    where += ` AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id AND LOWER(r.key) = ANY($${params.length}::text[])
    )`;
  }

  if (predicate.district) {
    params.push(String(predicate.district).toLowerCase());
    where += ` AND LOWER(up.district) = $${params.length}`;
  }

  if (predicate.division) {
    params.push(String(predicate.division).toLowerCase());
    where += ` AND LOWER(up.division) = $${params.length}`;
  }

  if (predicate.status) {
    params.push(predicate.status);
    where += ` AND u.status = $${params.length}`;
  }

  if (predicate.tier) {
    params.push(String(predicate.tier).toLowerCase());
    where += ` AND LOWER(COALESCE(ts.tier, 'STARTER')) = $${params.length}`;
  }

  if (typeof predicate.trust_score_lt === 'number') {
    params.push(predicate.trust_score_lt);
    where += ` AND COALESCE(ts.score, 50) < $${params.length}`;
  }

  if (typeof predicate.trust_score_lte === 'number') {
    params.push(predicate.trust_score_lte);
    where += ` AND COALESCE(ts.score, 50) <= $${params.length}`;
  }

  if (typeof predicate.trust_score_gt === 'number') {
    params.push(predicate.trust_score_gt);
    where += ` AND COALESCE(ts.score, 50) > $${params.length}`;
  }

  if (typeof predicate.trust_score_gte === 'number') {
    params.push(predicate.trust_score_gte);
    where += ` AND COALESCE(ts.score, 50) >= $${params.length}`;
  }

  if (predicate.created_before) {
    params.push(new Date(predicate.created_before));
    where += ` AND u.created_at < $${params.length}`;
  }

  if (predicate.created_after) {
    params.push(new Date(predicate.created_after));
    where += ` AND u.created_at > $${params.length}`;
  }

  // Execute count query
  const countSql = `
    SELECT count(DISTINCT u.id)::int AS count
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN trust_scores ts ON ts.user_id = u.id
    ${where}
  `;
  const countRes = await db.query(countSql, params);
  const matchingCount = countRes.rows[0]?.count ?? 0;

  // Execute sample rows query (up to 10)
  const sampleSql = `
    SELECT u.id, u.ref, u.phone, u.status,
           up.district, up.division,
           COALESCE(ts.tier, 'STARTER') AS tier,
           COALESCE(ts.score, 50) AS trust_score
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN trust_scores ts ON ts.user_id = u.id
    ${where}
    ORDER BY u.created_at DESC
    LIMIT 10
  `;
  const sampleRes = await db.query(sampleSql, params);

  return {
    matching_count: matchingCount,
    sample_users: sampleRes.rows,
  };
}
