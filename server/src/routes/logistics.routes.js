/**
 * logistics.routes.js — Fastify Route definitions for 3PL Logistics Hub & Courier Webhooks (Prompt 7.1).
 */

import * as controller from '../controllers/courierWebhook.controller.js';

export default async function logisticsRoutes(app) {
  // 1. Inbound Webhooks per carrier (public, protected by HMAC / token in controller)
  app.post('/webhooks/courier/:carrier', {
    handler: controller.handleWebhook,
  });

  // 2. Tracking details by tracking number or sub_order_id (public / authenticated)
  app.get('/shipments/track/:trackingNumber', {
    handler: controller.getTracking,
  });

  // 3. Printable Shipping Label & Packing Slip (Authenticated supplier/admin)
  app.get('/shipments/:id/label', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: controller.getLabel,
  });

  // 4. Create Shipment / Book Consignment (Supplier / Admin)
  app.post('/shipments/create', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['sub_order_id'],
        properties: {
          sub_order_id: { type: 'integer' },
          carrier: { type: 'string' },
        },
      },
    },
    handler: controller.createShipment,
  });
}
