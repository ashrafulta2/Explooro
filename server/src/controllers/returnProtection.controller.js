/**
 * returnProtection.controller.js — Handlers for return protection (supplier attraction, step 5b).
 * Thin on purpose: enrolment, cover and claims all live in the service.
 */

import * as service from '../services/returnProtection.service.js';
import { AppError } from '../plugins/errorHandler.js';

export async function getSupplierProtection(req, reply) {
  return reply.send({ data: await service.getSupplierView(req.server.db, req.user.id) });
}

export async function setSupplierEnrollment(req, reply) {
  const enrolled = req.body?.enrolled;
  if (typeof enrolled !== 'boolean') {
    throw new AppError('VALIDATION_FAILED', 'Say whether to enrol or withdraw.', 'নিবন্ধন করবেন নাকি প্রত্যাহার করবেন তা জানান।');
  }
  const view = await service.setEnrollment(req.server.db, { supplierId: req.user.id, enrolled, actor: req.user.id });
  return reply.send({ data: view });
}

export async function getSalerProtection(req, reply) {
  return reply.send({ data: await service.getSalerView(req.server.db, req.user.id) });
}
