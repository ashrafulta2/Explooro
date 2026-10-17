/**
 * attributionAdmin.controller.ts — the sale attribution window (/admin/growth/attribution).
 */

import * as attributionService from '../services/attribution.service.ts';
import * as auditService from '../services/audit.service.ts';
import * as auditRepo from '../repositories/audit.repository.ts';

const dbOf = (req) => req.db || req.server?.db;

export async function getAdminPolicy(req, reply) {
  const db = dbOf(req);
  const policy = await attributionService.getPolicy(db);
  const stats = await attributionService.getStats(db, policy.window_days);

  let history = [];
  try {
    const result = await auditRepo.listAuditLogs(db, { action: 'growth.attribution.update', limit: 10 });
    history = result?.items ?? [];
  } catch {
    // The page still works without history.
  }

  return reply.send({
    policy,
    limits: { ...attributionService.WINDOW_LIMITS },
    stats,
    history,
    can_update: Boolean(req.userPermissions?.has?.('growth.attribution.update')),
  });
}

export async function updateAdminPolicy(req, reply) {
  const body = req.body || {};
  const policy = await attributionService.updatePolicy(dbOf(req), auditService, {
    policy: { window_days: body.window_days },
    reason: body.reason,
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: { traceId: req.traceId, ip: req.ip, userAgent: req.headers?.['user-agent'] },
  });

  return reply.send({
    policy,
    message_en: 'Attribution window updated. Items added to a cart from now on use it.',
    message_bn: 'অ্যাট্রিবিউশন উইন্ডো হালনাগাদ হয়েছে। এখন থেকে কার্টে যোগ হওয়া পণ্যে এটি প্রযোজ্য।',
  });
}
