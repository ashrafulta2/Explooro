/**
 * deliveryCharge.controller.ts — the per-parcel delivery charge for normal checkout, by delivery zone.
 */

import * as deliveryChargeService from '../services/deliveryCharge.service.ts';
import * as auditService from '../services/audit.service.ts';
import * as auditRepo from '../repositories/audit.repository.ts';
import { BD_DISTRICTS_BY_DIVISION } from '../config/bdDistricts.ts';

const dbOf = (req) => req.db || req.server?.db;
const cacheOf = (req) => req.cache || req.server?.cache;

// WHY the bounds come from here: the page must never offer a value the server would refuse.
const limits = () => ({
  ...deliveryChargeService.CHARGE_LIMITS,
  ...deliveryChargeService.ZONE_LIMITS,
  days: { ...deliveryChargeService.DAYS_LIMITS },
  cutoff: { ...deliveryChargeService.CUTOFF_LIMITS },
});

/** Public: the cart, Quick Buy and checkout show the charge before sign-in. Never fails (default on error). */
export async function getPublicPolicy(req, reply) {
  const policy = await deliveryChargeService.getPolicy(dbOf(req), cacheOf(req));
  return reply.send({ policy: deliveryChargeService.publicView(policy) });
}

export async function getAdminPolicy(req, reply) {
  const db = dbOf(req);
  const policy = await deliveryChargeService.getPolicy(db, cacheOf(req), { fresh: true });

  let history = [];
  try {
    const result = await auditRepo.listAuditLogs(db, { action: 'platform.delivery.update', limit: 10 });
    history = result?.items ?? [];
  } catch {
    // The page still works without history.
  }

  return reply.send({
    policy,
    limits: limits(),
    // The district ids a zone may list, so the page offers exactly what validatePolicy accepts.
    districts_by_division: BD_DISTRICTS_BY_DIVISION,
    history,
    can_update: Boolean(req.userPermissions?.has?.('platform.delivery.update')),
  });
}

export async function updateAdminPolicy(req, reply) {
  const body = req.body || {};
  const policy = await deliveryChargeService.updatePolicy(dbOf(req), cacheOf(req), auditService, {
    policy: { zones: body.zones, default_zone: body.default_zone, cutoff_hour: body.cutoff_hour ?? null },
    reason: body.reason,
    expectedUpdatedAt: body.expected_updated_at ?? null,
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: { traceId: req.traceId, ip: req.ip, userAgent: req.headers?.['user-agent'] },
  });

  return reply.send({
    policy,
    message_en: 'Delivery charges updated. New carts and orders use them now.',
    message_bn: 'ডেলিভারি চার্জ হালনাগাদ হয়েছে। নতুন কার্ট ও অর্ডারে এখন থেকেই এটি প্রযোজ্য।',
  });
}
