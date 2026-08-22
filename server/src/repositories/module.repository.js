/**
 * module.repository.js — Database queries for platform modules, targeting rules, and settings (Prompt 3.1).
 */

export async function getAllModules(db) {
  const res = await db.query(
    `SELECT key, group_key, label_en, label_bn, description_en, description_bn,
            is_enabled, default_enabled, settings_json, settings_schema, depends_on,
            scheduled_on_at, scheduled_off_at, last_reason, updated_by, created_at, updated_at
     FROM platform_modules
     ORDER BY group_key ASC, key ASC`
  );
  return res.rows;
}

export async function getModuleByKey(db, key) {
  const res = await db.query(
    `SELECT key, group_key, label_en, label_bn, description_en, description_bn,
            is_enabled, default_enabled, settings_json, settings_schema, depends_on,
            scheduled_on_at, scheduled_off_at, last_reason, updated_by, created_at, updated_at
     FROM platform_modules
     WHERE key = $1`,
    [key]
  );
  return res.rows[0] || null;
}

export async function getActiveDependentModules(db, key) {
  const res = await db.query(
    `SELECT key, label_en, label_bn, is_enabled, depends_on
     FROM platform_modules
     WHERE $1 = ANY(depends_on) AND is_enabled = true`,
    [key]
  );
  return res.rows;
}

export async function updateModuleState(db, key, { enabled, reason, updatedBy, scheduledOnAt = null, scheduledOffAt = null }) {
  const res = await db.query(
    `UPDATE platform_modules
     SET is_enabled = $2,
         last_reason = $3,
         updated_by = $4,
         scheduled_on_at = $5,
         scheduled_off_at = $6,
         updated_at = now()
     WHERE key = $1
     RETURNING *`,
    [key, enabled, reason, updatedBy, scheduledOnAt, scheduledOffAt]
  );
  return res.rows[0] || null;
}

export async function updateModuleSettings(db, key, { settingsJson, updatedBy }) {
  const res = await db.query(
    `UPDATE platform_modules
     SET settings_json = $2,
         updated_by = $3,
         updated_at = now()
     WHERE key = $1
     RETURNING *`,
    [key, JSON.stringify(settingsJson), updatedBy]
  );
  return res.rows[0] || null;
}

export async function getTargetingRules(db, moduleKey) {
  const res = await db.query(
    `SELECT id, module_key, target_type, target_value, is_enabled, priority, created_by, created_at
     FROM module_targeting_rules
     WHERE module_key = $1
     ORDER BY priority DESC, id ASC`,
    [moduleKey]
  );
  return res.rows;
}

export async function getAllTargetingRules(db) {
  const res = await db.query(
    `SELECT id, module_key, target_type, target_value, is_enabled, priority, created_by, created_at
     FROM module_targeting_rules
     ORDER BY priority DESC, id ASC`
  );
  return res.rows;
}

export async function createTargetingRule(db, { moduleKey, targetType, targetValue, isEnabled = true, priority = 0, createdBy = null }) {
  const res = await db.query(
    `INSERT INTO module_targeting_rules (module_key, target_type, target_value, is_enabled, priority, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [moduleKey, targetType, targetValue, isEnabled, priority, createdBy]
  );
  return res.rows[0];
}

export async function deleteTargetingRule(db, id) {
  const res = await db.query(
    `DELETE FROM module_targeting_rules
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return res.rows[0] || null;
}

export async function getModuleAuditHistory(db, moduleKey) {
  const res = await db.query(
    `SELECT id, actor_id, actor_role, action, target_type, target_ref,
            before_json, after_json, risk_tier, ip_address, trace_id, created_at
     FROM audit_logs
     WHERE target_type = 'platform_module' AND target_ref = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [moduleKey]
  );
  return res.rows;
}
