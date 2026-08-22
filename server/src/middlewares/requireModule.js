/**
 * requireModule.js — Route gating middleware based on platform module state & targeting (Prompt 3.1).
 *
 * Returns 403 MODULE_DISABLED with bilingual messages if the target module is turned off
 * globally, outside its scheduled window, or disabled by targeted rules.
 */

import fp from 'fastify-plugin';
import { isEnabled } from '../services/module.service.js';
import * as repo from '../repositories/module.repository.js';
import { getRequestContext } from '../plugins/requestContext.js';

export function createRequireModuleMiddleware(app) {
  return function requireModule(moduleKey) {
    return async function requireModulePreHandler(req, reply) {
      const db = req.db || app.db;
      const cache = req.cache || app.cache;

      const context = {
        userId: req.user?.id,
        userRef: req.user?.ref,
        role: req.user?.role || req.user?.roles?.[0],
        roles: req.user?.roles,
        tier: req.user?.tier,
        district: req.user?.district,
        percentageSeed: req.user?.id || req.ip,
      };

      const enabled = await isEnabled(db, cache, moduleKey, context);

      if (!enabled) {
        const traceId = getRequestContext()?.trace_id || req.headers?.['x-trace-id'] || 'TRACE-MODULE';
        const moduleRow = await repo.getModuleByKey(db, moduleKey).catch(() => null);

        const labelEn = moduleRow?.label_en || moduleKey;
        const labelBn = moduleRow?.label_bn || moduleKey;

        return reply.status(403).send({
          error: {
            code: 'MODULE_DISABLED',
            module_key: moduleKey,
            message_en: `The "${labelEn}" module is currently disabled on this platform.`,
            message_bn: `এই প্ল্যাটফর্মে "${labelBn}" মডিউলটি বর্তমানে বন্ধ রয়েছে।`,
            trace_id: traceId,
          },
        });
      }
    };
  };
}

async function requireModulePlugin(app) {
  const requireModule = createRequireModuleMiddleware(app);
  app.decorate('requireModule', requireModule);
}

export default fp(requireModulePlugin, {
  name: 'requireModule',
});
