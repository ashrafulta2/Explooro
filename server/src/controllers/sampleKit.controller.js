/**
 * sampleKit.controller.js — Handlers for sample requests and marketing kits (supplier attraction, step 4).
 * Thin on purpose: the rules, the money and the state machine all live in the service.
 */

import * as service from '../services/sampleKit.service.js';
import { AppError } from '../plugins/errorHandler.js';

function id(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError('VALIDATION_FAILED', `${label} is invalid.`, `${label} সঠিক নয়।`);
  return n;
}

// ---- supplier ---------------------------------------------------------------------------------------------

export async function getSupplierSamples(req, reply) {
  return reply.send({ data: await service.getSupplierView(req.server.db, req.user.id) });
}

export async function saveSampleOffer(req, reply) {
  const saved = await service.saveOffer(req.server.db, {
    supplierId: req.user.id, productId: id(req.params.productId, 'Product'), input: req.body, actor: req.user.id,
  });
  return reply.send({ data: saved });
}

export async function saveMarketingKit(req, reply) {
  const saved = await service.saveKit(req.server.db, {
    supplierId: req.user.id, productId: id(req.params.productId, 'Product'), input: req.body, actor: req.user.id,
  });
  return reply.send({ data: saved });
}

const SUPPLIER_ACTIONS = new Set(['accept', 'ship', 'decline']);

export async function respondToSample(req, reply) {
  const action = req.params.action;
  if (!SUPPLIER_ACTIONS.has(action)) throw new AppError('NOT_FOUND', 'Unknown action.', 'অজানা কাজ।');
  const body = req.body || {};
  const updated = await service.transition(req.server.db, {
    requestId: id(req.params.id, 'Request'),
    action,
    actor: 'supplier',
    who: req.user.id,
    trackingNote: typeof body.tracking_note === 'string' ? body.tracking_note.trim().slice(0, 300) : null,
    reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : null,
  });
  return reply.send({ data: updated });
}

// ---- saler ------------------------------------------------------------------------------------------------

export async function getSalerSamples(req, reply) {
  return reply.send({ data: await service.getSalerView(req.server.db, req.user.id) });
}

export async function requestSample(req, reply) {
  const body = req.body || {};
  const created = await service.requestSample(req.server.db, {
    salerId: req.user.id, productId: id(body.product_id, 'Product'), shipTo: body.ship_to, note: body.note,
  });
  return reply.status(201).send({ data: created });
}

const SALER_ACTIONS = new Set(['cancel', 'confirm']);

export async function actOnMySample(req, reply) {
  const action = req.params.action;
  if (!SALER_ACTIONS.has(action)) throw new AppError('NOT_FOUND', 'Unknown action.', 'অজানা কাজ।');
  const updated = await service.transition(req.server.db, {
    requestId: id(req.params.id, 'Request'), action, actor: 'saler', who: req.user.id,
  });
  return reply.send({ data: updated });
}

export async function getSalerKits(req, reply) {
  return reply.send({ data: await service.getKitsView(req.server.db) });
}
