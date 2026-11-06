/**
 * logistics.routes.ts — Fastify Route definitions for 3PL Logistics Hub & Courier Webhooks (Prompt 7.1).
 */

import { addRawJsonBody } from '../plugins/rawBody.ts';
import * as controller from '../controllers/courierWebhook.controller.ts';

export default async function logisticsRoutes(app) {
  const reqPerm = (perm) => (app.requirePermission ? app.requirePermission(perm) : async () => {});
  const reqModule = (key) => (app.requireModule ? app.requireModule(key) : async () => {});

  // WHY: courier webhook signatures cover the raw bytes (see plugins/rawBody.ts).
  addRawJsonBody(app);

  // 1. Inbound Webhooks per carrier (public, protected by HMAC / token in controller)
  app.post('/webhooks/courier/:carrier', {
    handler: controller.handleWebhook,
  });

  // 2. Public tracking by the courier's tracking number only, with no personal data (see
  //    shipment.service getPublicShipmentTracking)
  app.get('/shipments/track/:trackingNumber', {
    handler: controller.getTracking,
  });

  // 3. Printable Shipping Label & Packing Slip (Authenticated supplier/admin)
  // WHY the permission and the owner check in the controller: a label carries the shopper's name,
  // phone and COD amount, and this route used to print one for any signed-in user.
  app.get('/shipments/:id/label', {
    preHandler: [app.authenticate, reqModule('courier_hub'), reqPerm('logistics.shipment.view')],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', pattern: '^[0-9]+$' } },
      },
    },
    handler: controller.getLabel,
  });

  // 4. Create Shipment / Book Consignment (the sub-order's own supplier)
  // WHY the permission and the owner check in the controller: any signed-in user could ship any
  // sub-order here (traceability row 131, open item d).
  app.post('/shipments/create', {
    preHandler: [app.authenticate, reqModule('courier_hub'), reqPerm('logistics.consignment.create')],
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
