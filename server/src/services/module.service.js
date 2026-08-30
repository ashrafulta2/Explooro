/**
 * module.service.js — Module Control Backend, Hierarchical Targeting & Dependency Engine (Prompt 3.1).
 */

import { createHash } from 'node:crypto';
import * as repo from '../repositories/module.repository.js';
import * as auditService from './audit.service.js';

const TARGET_TYPE_PRIORITIES = {
  USER: 40,
  DISTRICT: 30,
  TIER: 20,
  ROLE: 10,
  PERCENTAGE: 0,
};

let memoryCacheVersion = 1;

export async function getCacheVersion(cache) {
  if (!cache) return memoryCacheVersion;
  try {
    const v = await cache.get('modules:version');
    return v ? parseInt(v, 10) : memoryCacheVersion;
  } catch {
    return memoryCacheVersion;
  }
}

export async function bumpCacheVersion(cache) {
  memoryCacheVersion += 1;
  if (!cache) return memoryCacheVersion;
  try {
    await cache.set('modules:version', String(memoryCacheVersion));
  } catch {
    // Ignore cache error
  }
  return memoryCacheVersion;
}

/**
 * Computes deterministic bucket 0..99 for percentage rollout.
 */
export function computePercentageBucket(moduleKey, seed) {
  const input = `${moduleKey}:${seed || '0'}`;
  const hash = createHash('sha256').update(input, 'utf8').digest('hex');
  return parseInt(hash.slice(0, 8), 16) % 100;
}

/**
 * Evaluate if a module is enabled for a given user/request context.
 *
 * Evaluation order:
 * 1. Global switch: is_enabled === false -> false
 * 2. Scheduled window: now outside [scheduled_on_at, scheduled_off_at] -> false
 * 3. Targeting rules: USER (40) > DISTRICT (30) > TIER (20) > ROLE (10) > PERCENTAGE (0)
 * 4. Default: default_enabled / is_enabled
 */
export async function isEnabled(db, cache, moduleKey, context = {}) {
  if (!moduleKey) return true;

  const version = await getCacheVersion(cache);
  const contextKey = JSON.stringify({
    u: context.userId ?? context.userRef ?? null,
    r: context.role ?? context.roles ?? null,
    t: context.tier ?? null,
    d: context.district ?? null,
    s: context.percentageSeed ?? null,
  });
  const cacheKey = `module:eval:${version}:${moduleKey}:${contextKey}`;

  if (cache) {
    try {
      const cached = await cache.get(cacheKey);
      if (cached !== null && cached !== undefined) {
        return cached === 'true' || cached === true;
      }
    } catch {
      // Proceed to DB on cache error
    }
  }

  const moduleRow = await repo.getModuleByKey(db, moduleKey);
  if (!moduleRow) {
    // Unknown module defaults to false
    return false;
  }

  // 1. Global Off
  if (!moduleRow.is_enabled) {
    if (cache) await cache.set(cacheKey, 'false', 60).catch(() => {});
    return false;
  }

  // 2. Scheduled window
  const now = Date.now();
  if (moduleRow.scheduled_on_at && now < new Date(moduleRow.scheduled_on_at).getTime()) {
    if (cache) await cache.set(cacheKey, 'false', 60).catch(() => {});
    return false;
  }
  if (moduleRow.scheduled_off_at && now > new Date(moduleRow.scheduled_off_at).getTime()) {
    if (cache) await cache.set(cacheKey, 'false', 60).catch(() => {});
    return false;
  }

  // 3. Targeting rules
  const rules = await repo.getTargetingRules(db, moduleKey);
  if (rules && rules.length > 0) {
    for (const rule of rules) {
      const type = (rule.target_type || '').toUpperCase();
      const val = rule.target_value;

      if (type === 'USER') {
        const uId = context.userId !== undefined ? String(context.userId) : null;
        const uRef = context.userRef !== undefined ? String(context.userRef) : null;
        if ((uId && uId === val) || (uRef && uRef === val)) {
          const res = Boolean(rule.is_enabled);
          if (cache) await cache.set(cacheKey, String(res), 60).catch(() => {});
          return res;
        }
      } else if (type === 'DISTRICT') {
        if (context.district && context.district.trim().toLowerCase() === val.trim().toLowerCase()) {
          const res = Boolean(rule.is_enabled);
          if (cache) await cache.set(cacheKey, String(res), 60).catch(() => {});
          return res;
        }
      } else if (type === 'TIER') {
        if (context.tier && context.tier.trim().toUpperCase() === val.trim().toUpperCase()) {
          const res = Boolean(rule.is_enabled);
          if (cache) await cache.set(cacheKey, String(res), 60).catch(() => {});
          return res;
        }
      } else if (type === 'ROLE') {
        const activeRole = context.role;
        const activeRoles = Array.isArray(context.roles) ? context.roles : (activeRole ? [activeRole] : []);
        if (activeRoles.includes(val)) {
          const res = Boolean(rule.is_enabled);
          if (cache) await cache.set(cacheKey, String(res), 60).catch(() => {});
          return res;
        }
      } else if (type === 'PERCENTAGE') {
        const targetPct = parseInt(val, 10);
        if (!isNaN(targetPct)) {
          const seed = context.percentageSeed || context.userId || context.userRef || '0';
          const bucket = computePercentageBucket(moduleKey, seed);
          if (bucket < targetPct) {
            const res = Boolean(rule.is_enabled);
            if (cache) await cache.set(cacheKey, String(res), 60).catch(() => {});
            return res;
          }
        }
      }
    }
  }

  // 4. Default
  const finalResult = Boolean(moduleRow.is_enabled);
  if (cache) await cache.set(cacheKey, String(finalResult), 60).catch(() => {});
  return finalResult;
}

/**
 * Returns map of moduleKey -> boolean for public flag consumption.
 */
export async function getPublicModulesMap(db, cache, context = {}) {
  const all = await repo.getAllModules(db);
  const result = {};

  await Promise.all(
    all.map(async (m) => {
      result[m.key] = await isEnabled(db, cache, m.key, context);
    })
  );

  return result;
}

/**
 * Lists all modules with active targeting rules, settings, and dependents for Admin.
 */
export async function listAdminModules(db) {
  const modules = await repo.getAllModules(db);
  const rules = await repo.getAllTargetingRules(db);

  const rulesByModule = new Map();
  for (const r of rules) {
    if (!rulesByModule.has(r.module_key)) {
      rulesByModule.set(r.module_key, []);
    }
    rulesByModule.get(r.module_key).push(r);
  }

  return modules.map((m) => ({
    ...m,
    targeting_rules: rulesByModule.get(m.key) || [],
  }));
}

/**
 * Toggle a module on/off with mandatory reason and dependency check.
 */
export async function toggleModule(db, cache, actor, moduleKey, { enabled, reason, cascade = false, scheduledOnAt = null, scheduledOffAt = null }) {
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    const err = new Error('A reason of at least 10 characters is mandatory for module state changes.');
    err.statusCode = 400;
    err.code = 'INVALID_REASON';
    err.message_en = 'A reason of at least 10 characters is mandatory for module state changes.';
    err.message_bn = 'মডিউলের অবস্থা পরিবর্তনের জন্য কমপক্ষে ১০ অক্ষরের কারণ উল্লেখ করা বাধ্যতামূলক।';
    throw err;
  }

  const existing = await repo.getModuleByKey(db, moduleKey);
  if (!existing) {
    const err = new Error(`Module "${moduleKey}" not found.`);
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const isDisabling = enabled === false;
  const disabledModules = [];

  // Check parent dependencies if enabling
  if (!isDisabling && Array.isArray(existing.depends_on) && existing.depends_on.length > 0) {
    for (const parentKey of existing.depends_on) {
      const parent = await repo.getModuleByKey(db, parentKey);
      if (parent && !parent.is_enabled) {
        const err = new Error(`Cannot enable "${existing.label_en}" because required parent module "${parent.label_en}" (${parentKey}) is disabled.`);
        err.statusCode = 409;
        err.code = 'PARENT_MODULE_DISABLED';
        err.message_en = `Cannot enable "${existing.label_en}" because required module "${parent.label_en}" (${parentKey}) is disabled.`;
        err.message_bn = `"${existing.label_bn}" চালু করা যাচ্ছে না কারণ প্রয়োজনীয় মডিউল "${parent.label_bn}" (${parentKey}) বন্ধ রয়েছে।`;
        throw err;
      }
    }
  }

  // Check dependencies if turning off
  if (isDisabling) {
    const activeDependents = await repo.getActiveDependentModules(db, moduleKey);
    if (activeDependents.length > 0) {
      if (!cascade) {
        const dependentNamesEn = activeDependents.map((d) => `"${d.label_en}" (${d.key})`).join(', ');
        const dependentNamesBn = activeDependents.map((d) => `"${d.label_bn}" (${d.key})`).join(', ');
        const err = new Error(`Cannot disable "${existing.label_en}" because ${dependentNamesEn} depend(s) on it.`);
        err.statusCode = 409;
        err.code = 'MODULE_DEPENDENCY_CONFLICT';
        err.dependents = activeDependents.map((d) => ({
          key: d.key,
          label_en: d.label_en,
          label_bn: d.label_bn,
        }));
        err.message_en = `Cannot disable "${existing.label_en}" because the following modules depend on it: ${dependentNamesEn}. Pass cascade=true to disable them simultaneously.`;
        err.message_bn = `"${existing.label_bn}" বন্ধ করা যাচ্ছে না কারণ এর উপর নিম্নলিখিত মডিউলগুলো নির্ভরশীল: ${dependentNamesBn}। একসাথে বন্ধ করতে cascade=true দিন।`;
        throw err;
      }

      // Cascade is true: disable all active dependents first
      for (const dep of activeDependents) {
        const updatedDep = await repo.updateModuleState(db, dep.key, {
          enabled: false,
          reason: `Cascaded disable because parent "${moduleKey}" was disabled: ${reason}`,
          updatedBy: actor?.id ?? null,
        });

        await auditService.record(db, {
          actor: actor?.id ?? null,
          actor_role: actor?.role ?? 'super_admin',
          action: 'module.disable',
          target_type: 'platform_module',
          target_ref: dep.key,
          before: dep,
          after: updatedDep,
          undo_payload: { enabled: dep.is_enabled, reason: `Revert cascaded disable of ${dep.key}` },
          risk_tier: 'CRITICAL',
        });
        disabledModules.push(updatedDep);
      }
    }
  }

  // Update target module
  const updated = await repo.updateModuleState(db, moduleKey, {
    enabled,
    reason: reason.trim(),
    updatedBy: actor?.id ?? null,
    scheduledOnAt,
    scheduledOffAt,
  });

  await auditService.record(db, {
    actor: actor?.id ?? null,
    actor_role: actor?.role ?? 'super_admin',
    action: enabled ? 'module.enable' : 'module.disable',
    target_type: 'platform_module',
    target_ref: moduleKey,
    before: existing,
    after: updated,
    undo_payload: { enabled: existing.is_enabled, reason: `Revert module toggle for ${moduleKey}` },
    risk_tier: 'CRITICAL',
  });

  await bumpCacheVersion(cache);

  return {
    module: updated,
    cascaded: disabledModules,
  };
}

/**
 * Validates and updates sub-settings of a module.
 */
export async function updateModuleSettings(db, cache, actor, moduleKey, { settings, reason }) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    const err = new Error('Settings payload must be a JSON object.');
    err.statusCode = 400;
    err.code = 'INVALID_SETTINGS';
    throw err;
  }

  const existing = await repo.getModuleByKey(db, moduleKey);
  if (!existing) {
    const err = new Error(`Module "${moduleKey}" not found.`);
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  // If settings_schema is present, validate properties
  if (existing.settings_schema && existing.settings_schema.properties) {
    const props = existing.settings_schema.properties;
    for (const [key, val] of Object.entries(settings)) {
      if (props[key]) {
        const schemaProp = props[key];
        if (schemaProp.type === 'integer' && !Number.isInteger(val)) {
          const err = new Error(`Field "${key}" must be an integer.`);
          err.statusCode = 400;
          err.code = 'SCHEMA_VALIDATION_ERROR';
          throw err;
        }
        if (schemaProp.type === 'number' && typeof val !== 'number') {
          const err = new Error(`Field "${key}" must be a number.`);
          err.statusCode = 400;
          err.code = 'SCHEMA_VALIDATION_ERROR';
          throw err;
        }
        if (schemaProp.type === 'boolean' && typeof val !== 'boolean') {
          const err = new Error(`Field "${key}" must be a boolean.`);
          err.statusCode = 400;
          err.code = 'SCHEMA_VALIDATION_ERROR';
          throw err;
        }
        if (schemaProp.type === 'array' && !Array.isArray(val)) {
          const err = new Error(`Field "${key}" must be an array.`);
          err.statusCode = 400;
          err.code = 'SCHEMA_VALIDATION_ERROR';
          throw err;
        }
        if (schemaProp.enum && !schemaProp.enum.includes(val)) {
          const err = new Error(`Field "${key}" must be one of: ${schemaProp.enum.join(', ')}.`);
          err.statusCode = 400;
          err.code = 'SCHEMA_VALIDATION_ERROR';
          throw err;
        }
      }
    }
  }

  const mergedSettings = {
    ...(existing.settings_json || {}),
    ...settings,
  };

  const updated = await repo.updateModuleSettings(db, moduleKey, {
    settingsJson: mergedSettings,
    updatedBy: actor?.id ?? null,
  });

  await auditService.record(db, {
    actor: actor?.id ?? null,
    actor_role: actor?.role ?? 'super_admin',
    action: 'module.settings_update',
    target_type: 'platform_module',
    target_ref: moduleKey,
    before: existing.settings_json,
    after: mergedSettings,
    undo_payload: { settings: existing.settings_json, reason: `Revert settings for ${moduleKey}` },
    risk_tier: 'CRITICAL',
  });

  await bumpCacheVersion(cache);

  return updated;
}

/**
 * Creates a targeting rule for a module.
 */
export async function createTargetingRule(db, cache, actor, moduleKey, { targetType, targetValue, isEnabled = true, priority }) {
  const existing = await repo.getModuleByKey(db, moduleKey);
  if (!existing) {
    const err = new Error(`Module "${moduleKey}" not found.`);
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const upperType = (targetType || '').toUpperCase();
  if (!['ROLE', 'TIER', 'DISTRICT', 'USER', 'PERCENTAGE'].includes(upperType)) {
    const err = new Error(`Invalid target_type: ${targetType}. Supported: ROLE, TIER, DISTRICT, USER, PERCENTAGE.`);
    err.statusCode = 400;
    err.code = 'INVALID_TARGET_TYPE';
    throw err;
  }

  if (targetValue === undefined || targetValue === null || String(targetValue).trim() === '') {
    const err = new Error('target_value is required.');
    err.statusCode = 400;
    err.code = 'MISSING_TARGET_VALUE';
    throw err;
  }

  const assignedPriority = priority !== undefined ? parseInt(priority, 10) : (TARGET_TYPE_PRIORITIES[upperType] ?? 0);

  const rule = await repo.createTargetingRule(db, {
    moduleKey,
    targetType: upperType,
    targetValue: String(targetValue).trim(),
    isEnabled: Boolean(isEnabled),
    priority: assignedPriority,
    createdBy: actor?.id ?? null,
  });

  await auditService.record(db, {
    actor: actor?.id ?? null,
    actor_role: actor?.role ?? 'super_admin',
    action: 'module.targeting_create',
    target_type: 'platform_module',
    target_ref: moduleKey,
    before: null,
    after: rule,
    risk_tier: 'CRITICAL',
  });

  await bumpCacheVersion(cache);

  return rule;
}

/**
 * Deletes a targeting rule.
 */
export async function deleteTargetingRule(db, cache, actor, id) {
  const deleted = await repo.deleteTargetingRule(db, id);
  if (!deleted) {
    const err = new Error(`Targeting rule ${id} not found.`);
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  await auditService.record(db, {
    actor: actor?.id ?? null,
    actor_role: actor?.role ?? 'super_admin',
    action: 'module.targeting_delete',
    target_type: 'platform_module',
    target_ref: deleted.module_key,
    before: deleted,
    after: null,
    risk_tier: 'CRITICAL',
  });

  await bumpCacheVersion(cache);

  return deleted;
}

/**
 * Fetches audit log history for a module.
 */
export async function getModuleHistory(db, moduleKey) {
  const existing = await repo.getModuleByKey(db, moduleKey);
  if (!existing) {
    const err = new Error(`Module "${moduleKey}" not found.`);
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  return repo.getModuleAuditHistory(db, moduleKey);
}
