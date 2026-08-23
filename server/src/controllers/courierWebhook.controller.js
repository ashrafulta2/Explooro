/**
 * courierWebhook.controller.js — HTTP Controller for Courier Webhooks & Shipment Tracking (Prompt 7.1).
 */

import * as shipmentService from '../services/shipment.service.js';

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
  const data = await shipmentService.getShipmentTracking(req.server.db, identifier);

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
  const label = await shipmentService.generateShippingLabel(req.server.db, shipmentId);

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

  const result = await shipmentService.createShipmentForSubOrder(req.server.db, {
    subOrderId,
    carrierOverride,
    requestedBy: req.user?.id,
  });

  return reply.status(201).send({
    data: result,
  });
}
