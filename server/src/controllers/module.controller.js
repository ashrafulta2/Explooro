/**
 * module.controller.js — Fastify request handlers for module control endpoints (Prompt 3.1).
 */

import * as moduleService from '../services/module.service.js';

export async function getPublicModules(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;

  const context = {
    userId: req.user?.id,
    userRef: req.user?.ref,
    role: req.user?.role || req.user?.roles?.[0],
    roles: req.user?.roles,
    tier: req.user?.tier,
    district: req.user?.district,
    percentageSeed: req.user?.id || req.ip,
  };

  const modules = await moduleService.getPublicModulesMap(db, cache, context);
  return reply.send({ modules });
}

export async function listAdminModules(req, reply) {
  const db = req.db || req.server?.db;
  const modules = await moduleService.listAdminModules(db);
  return reply.send({ modules });
}

export async function toggleModule(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { key } = req.params;
  const { enabled, reason, cascade = false, scheduled_on_at, scheduled_off_at } = req.body || {};

  if (enabled === undefined) {
    return reply.status(400).send({
      error: {
        code: 'MISSING_FIELD',
        message_en: 'Field "enabled" (boolean) is required.',
        message_bn: '"enabled" (বুলিয়ান) ফিল্ডটি বাধ্যতামূলক।',
      },
    });
  }

  try {
    const result = await moduleService.toggleModule(db, cache, req.user, key, {
      enabled: Boolean(enabled),
      reason,
      cascade: Boolean(cascade),
      scheduledOnAt: scheduled_on_at,
      scheduledOffAt: scheduled_off_at,
    });

    return reply.send({ data: result });
  } catch (err) {
    if (err.statusCode === 409) {
      return reply.status(409).send({
        error: {
          code: err.code || 'MODULE_DEPENDENCY_CONFLICT',
          message_en: err.message_en || err.message,
          message_bn: err.message_bn || err.message,
          dependents: err.dependents || [],
        },
      });
    }
    if (err.statusCode === 400) {
      return reply.status(400).send({
        error: {
          code: err.code || 'BAD_REQUEST',
          message_en: err.message_en || err.message,
          message_bn: err.message_bn || err.message,
        },
      });
    }
    if (err.statusCode === 404) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message_en: err.message,
          message_bn: 'মডিউলটি খুঁজে পাওয়া যায়নি।',
        },
      });
    }
    throw err;
  }
}

export async function updateModuleSettings(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { key } = req.params;
  const { settings, reason } = req.body || {};

  try {
    const updated = await moduleService.updateModuleSettings(db, cache, req.user, key, {
      settings,
      reason,
    });

    return reply.send({ data: updated });
  } catch (err) {
    if (err.statusCode) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code || 'BAD_REQUEST',
          message_en: err.message_en || err.message,
          message_bn: err.message_bn || err.message,
        },
      });
    }
    throw err;
  }
}

export async function createTargetingRule(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { key } = req.params;
  const { target_type, target_value, is_enabled = true, priority } = req.body || {};

  try {
    const rule = await moduleService.createTargetingRule(db, cache, req.user, key, {
      targetType: target_type,
      targetValue: target_value,
      isEnabled: is_enabled,
      priority,
    });

    return reply.status(201).send({ data: rule });
  } catch (err) {
    if (err.statusCode) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code || 'BAD_REQUEST',
          message_en: err.message,
        },
      });
    }
    throw err;
  }
}

export async function deleteTargetingRule(req, reply) {
  const db = req.db || req.server?.db;
  const cache = req.cache || req.server?.cache;
  const { id } = req.params;

  try {
    const deleted = await moduleService.deleteTargetingRule(db, cache, req.user, id);
    return reply.send({ data: deleted });
  } catch (err) {
    if (err.statusCode) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code || 'BAD_REQUEST',
          message_en: err.message,
        },
      });
    }
    throw err;
  }
}

export async function getModuleHistory(req, reply) {
  const db = req.db || req.server?.db;
  const { key } = req.params;

  try {
    const history = await moduleService.getModuleHistory(db, key);
    return reply.send({ data: history });
  } catch (err) {
    if (err.statusCode) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code || 'BAD_REQUEST',
          message_en: err.message,
        },
      });
    }
    throw err;
  }
}
