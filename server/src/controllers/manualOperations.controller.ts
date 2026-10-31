/**
 * manualOperations.controller.ts — manual payouts and hand-sent parcels (migration 097).
 */

import * as manualOps from '../services/manualOperations.service.ts';
import * as auditService from '../services/audit.service.ts';
import * as auditRepo from '../repositories/audit.repository.ts';

const dbOf = (req) => req.db || req.server?.db;
const cacheOf = (req) => req.cache || req.server?.cache;
const roleOf = (req) => req.user?.roles?.[0] ?? req.user?.role ?? null;

export async function getAdminModes(req, reply) {
  const db = dbOf(req);
  const modes = await manualOps.getModes(db, cacheOf(req));

  let history = [];
  try {
    const result = await auditRepo.listAuditLogs(db, { action: 'platform.operations.update', limit: 10 });
    history = result?.items ?? [];
  } catch {
    // The page still works without history.
  }

  return reply.send({
    modes,
    options: { payout_mode: manualOps.PAYOUT_MODES, courier_mode: manualOps.COURIER_MODES },
    history,
    can_update: Boolean(req.userPermissions?.has?.('platform.operations.update')),
  });
}

export async function updateAdminModes(req, reply) {
  const body = req.body || {};
  const modes = await manualOps.updateModes(dbOf(req), cacheOf(req), auditService, {
    modes: { payout_mode: body.payout_mode, courier_mode: body.courier_mode },
    reason: body.reason,
    userId: req.user?.id ?? null,
    actorRole: roleOf(req),
    reqContext: { traceId: req.traceId, ip: req.ip, userAgent: req.headers?.['user-agent'] },
  });

  return reply.send({
    modes,
    message_en: 'Operations mode updated. It applies from the next action.',
    message_bn: 'অপারেশন মোড হালনাগাদ হয়েছে। পরের কাজ থেকেই এটি প্রযোজ্য।',
  });
}

export async function markPayoutPaid(req, reply) {
  const body = req.body || {};
  const result = await manualOps.completePayoutManually(dbOf(req), {
    payoutId: parseInt(req.params.id, 10),
    trxId: body.trx_id,
    note: body.note ?? null,
    executedBy: req.user.id,
    actorRole: roleOf(req) ?? 'super_admin',
  });
  return reply.send({ data: result });
}

export async function listOwnShipments(req, reply) {
  const db = dbOf(req);
  const q = req.query || {};
  const [page, modes] = await Promise.all([
    manualOps.listSupplierShipments(db, {
      supplierId: req.user.id,
      status: q.status || null,
      limit: q.limit,
      cursor: q.cursor ? parseInt(q.cursor, 10) : null,
    }),
    manualOps.getModes(db, cacheOf(req)),
  ]);
  return reply.send({ data: page.items, next_cursor: page.next_cursor, meta: { courier_mode: modes.courier_mode } });
}

export async function shipManually(req, reply) {
  const body = req.body || {};
  const result = await manualOps.bookManualShipment(dbOf(req), {
    subOrderId: body.sub_order_id,
    supplierId: req.user.id,
    courierName: body.courier_name,
    trackingNumber: body.tracking_number,
    note: body.note ?? null,
    actorId: req.user.id,
  });
  return reply.status(201).send({ data: result });
}

export async function setOwnShipmentStatus(req, reply) {
  const body = req.body || {};
  const result = await manualOps.updateManualShipmentStatus(dbOf(req), cacheOf(req), {
    shipmentId: parseInt(req.params.id, 10),
    supplierId: req.user.id,
    status: body.status,
    note: body.note ?? null,
    actorId: req.user.id,
  });
  return reply.send({ data: result });
}
