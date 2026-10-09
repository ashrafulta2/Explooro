/**
 * deliveryCharge.controller.js — the per-parcel delivery charge for normal checkout.
 */

import * as deliveryChargeService from '../services/deliveryCharge.service.js';
import * as auditService from '../services/audit.service.js';
import * as auditRepo from '../repositories/audit.repository.js';

const dbOf = (req) => req.db || req.server?.db;
const cacheOf = (req) => req.cache || req.server?.cache;

const limits = () => ({ ...deliveryChargeService.CHARGE_LIMITS });

/** Public: the cart and Quick Buy show the charge before sign-in. Never fails (default on error). */
export async function getPublicPolicy(req, reply) {
  const policy = await deliveryChargeService.getPolicy(dbOf(req), cacheOf(req));
  return reply.send({ policy: { per_parcel_charge: policy.per_parcel_charge } });
}

export async function getAdminPolicy(req, reply) {
  const db = dbOf(req);
  const policy = await deliveryChargeService.getPolicy(db, cacheOf(req));

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
    history,
    can_update: Boolean(req.userPermissions?.has?.('platform.delivery.update')),
  });
}

export async function updateAdminPolicy(req, reply) {
  const body = req.body || {};
  const policy = await deliveryChargeService.updatePolicy(dbOf(req), cacheOf(req), auditService, {
    policy: { per_parcel_charge: body.per_parcel_charge },
    reason: body.reason,
    userId: req.user?.id ?? null,
    actorRole: req.user?.roles?.[0] ?? req.user?.role ?? null,
    reqContext: { traceId: req.traceId, ip: req.ip, userAgent: req.headers?.['user-agent'] },
  });

  return reply.send({
    policy,
    message_en: 'Delivery charge updated. New carts and orders use it now.',
    message_bn: 'ডেলিভারি চার্জ হালনাগাদ হয়েছে। নতুন কার্ট ও অর্ডারে এখন থেকেই এটি প্রযোজ্য।',
  });
}
