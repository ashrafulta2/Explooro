/**
 * manualOperations.routes.ts — manual payouts and hand-sent parcels (migration 097).
 *
 *   GET  /admin/platform/operations              platform.operations.view    (LOW)
 *   PUT  /admin/platform/operations              platform.operations.update  (CRITICAL: super admin only)
 *   POST /admin/finance/payouts/:id/mark-paid    finance.payout.complete_manual (CRITICAL)
 *   GET  /supplier/shipments                     courier_hub + logistics.shipment.view
 *   POST /supplier/fulfilment/manual-ship        courier_hub + logistics.consignment.create
 *   POST /supplier/shipments/:id/status          courier_hub + logistics.shipment.mark_status (MEDIUM)
 *
 * WHY mark-paid is CRITICAL: it takes the money out of a partner's vault for good on the word of
 * whoever clicks. The owner sends these payouts, so super admin only, like the delivery charge.
 * WHY the supplier routes sit behind courier_hub: they are the fulfilment and shipments pages' own
 * endpoints, and those pages are gated by that module (client/src/main.ts).
 * WHY mark_status is MEDIUM and not LOW: DELIVERED starts escrow, i.e. the profit split.
 */

import * as controller from '../controllers/manualOperations.controller.ts';

export default async function manualOperationsRoutes(app) {
  const auth = app.authenticate || (async () => {});
  const reqPerm = (perm) => (app.requirePermission ? app.requirePermission(perm) : async () => {});
  const reqModule = (key) => (app.requireModule ? app.requireModule(key) : async () => {});
  const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9]+$' } } };

  app.get(
    '/admin/platform/operations',
    { config: { page: '/admin/platform/operations' }, preHandler: [auth, reqPerm('platform.operations.view')] },
    controller.getAdminModes
  );

  app.put(
    '/admin/platform/operations',
    {
      config: { page: '/admin/platform/operations' },
      preHandler: [auth, reqPerm('platform.operations.update')],
      schema: {
        body: {
          type: 'object',
          required: ['payout_mode', 'courier_mode', 'reason'],
          additionalProperties: false,
          properties: {
            // Type only: the allowed values are the service's rule.
            payout_mode: { type: 'string' },
            courier_mode: { type: 'string' },
            reason: { type: 'string', minLength: 10, maxLength: 500 },
          },
        },
      },
    },
    controller.updateAdminModes
  );

  app.post(
    '/admin/finance/payouts/:id/mark-paid',
    {
      config: { page: '/admin/finance/payouts' },
      preHandler: [auth, reqPerm('finance.payout.complete_manual')],
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['trx_id'],
          additionalProperties: false,
          properties: {
            trx_id: { type: 'string', maxLength: 60 },
            note: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    controller.markPayoutPaid
  );

  app.get(
    '/supplier/shipments',
    {
      config: { page: '/supplier/shipments' },
      preHandler: [auth, reqModule('courier_hub'), reqPerm('logistics.shipment.view')],
    },
    controller.listOwnShipments
  );

  app.post(
    '/supplier/fulfilment/manual-ship',
    {
      config: { page: '/supplier/fulfilment' },
      preHandler: [auth, reqModule('courier_hub'), reqPerm('logistics.consignment.create')],
      schema: {
        body: {
          type: 'object',
          required: ['sub_order_id', 'courier_name', 'tracking_number'],
          additionalProperties: false,
          properties: {
            sub_order_id: { type: 'integer' },
            courier_name: { type: 'string', maxLength: 100 },
            tracking_number: { type: 'string', maxLength: 100 },
            note: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    controller.shipManually
  );

  app.post(
    '/supplier/shipments/:id/status',
    {
      config: { page: '/supplier/shipments' },
      preHandler: [auth, reqModule('courier_hub'), reqPerm('logistics.shipment.mark_status')],
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: {
            status: { type: 'string' },
            note: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    controller.setOwnShipmentStatus
  );
}
