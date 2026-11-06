/**
 * courierWebhook.controller.ts — HTTP Controller for Courier Webhooks & Shipment Tracking (Prompt 7.1).
 */

import * as shipmentService from '../services/shipment.service.ts';
import { getModes } from '../services/manualOperations.service.ts';
import { AppError } from '../plugins/errorHandler.ts';

export async function handleWebhook(req, reply) {
  const carrier = req.params.carrier || req.query.carrier || 'MOCK';
  const headers = req.headers || {};
  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const payload = req.body || {};

  const result = await shipmentService.handleCourierWebhook(req.server.db, req.server.cache, {
    carrier,
    headers,
    rawBody,
    payload,
  });

  return reply.status(200).send({
    success: true,
    data: result,
  });
}

export async function getTracking(req, reply) {
  const identifier = req.params.trackingNumber || req.query.trackingNumber;
  // WHY the public view: this route needs no login (see getPublicShipmentTracking).
  const data = await shipmentService.getPublicShipmentTracking(req.server.db, identifier);

  if (!data) {
    return reply.status(404).send({
      error: {
        code: 'SHIPMENT_NOT_FOUND',
        message_en: `No tracking information found for ${identifier}.`,
        message_bn: `${identifier}-এর জন্য কোনো ট্র্যাকিং তথ্য পাওয়া যায়নি।`,
      },
    });
  }

  return reply.send({
    data,
  });
}

export async function getLabel(req, reply) {
  const shipmentId = parseInt(req.params.id, 10);
  // WHY: a label prints the shopper's name, phone and COD amount; only the parcel's supplier or an
  // admin may print it.
  await shipmentService.assertCanReadShipment(req.server.db, shipmentId, req.user);
  const label: Record<string, any> = await shipmentService.generateShippingLabel(req.server.db, shipmentId);

  if (label.contentType === 'text/html' && label.html) {
    return reply.type('text/html').send(label.html);
  }

  return reply.send({
    data: label,
  });
}

export async function createShipment(req, reply) {
  const subOrderId = parseInt(req.body.sub_order_id, 10);
  const carrierOverride = req.body.carrier || null;

  // WHY: this route used to book a parcel for any sub-order for any signed-in user.
  await shipmentService.assertOwnSubOrder(req.server.db, subOrderId, req.user.id);

  // WHY refused while couriers are manual: the same rule as POST /supplier/fulfilment/consign. With
  // no courier API the booking would invent a tracking number; "Sent by hand" records the real one.
  const { courier_mode: courierMode } = await getModes(req.server.db, req.server.cache);
  if (courierMode === 'MANUAL') {
    throw new AppError('CONFLICT', 'Couriers are manual. Use "Sent by hand" and type the courier\'s tracking number.',
      'কুরিয়ার এখন ম্যানুয়াল। "হাতে পাঠিয়েছি" দিয়ে কুরিয়ারের ট্র্যাকিং নম্বর লিখুন।');
  }

  const result = await shipmentService.createShipmentForSubOrder(req.server.db, {
    subOrderId,
    carrierOverride,
    requestedBy: req.user?.id,
  });

  return reply.status(201).send({
    data: result,
  });
}
