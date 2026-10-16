/**
 * payment.routes.ts — Fastify Routes for Payments, Callbacks & Webhooks (Prompt 5.3).
 */

import { addRawJsonBody } from '../plugins/rawBody.ts';
import * as paymentCtrl from '../controllers/payment.controller.ts';
import * as webhookCtrl from '../controllers/paymentWebhook.controller.ts';

export default async function paymentRoutes(fastify) {
  // WHY: gateway webhook signatures cover the raw bytes (see plugins/rawBody.ts).
  addRawJsonBody(fastify);

  // 1. Payment Initiation (Authenticated customer)
  fastify.post('/payments/initiate', {
    preHandler: [fastify.authenticate],
  }, paymentCtrl.initiatePaymentHandler);

  // 2. Payment Execution (Authenticated customer)
  fastify.post('/payments/execute', {
    preHandler: [fastify.authenticate],
  }, paymentCtrl.executePaymentHandler);

  // 3. Transaction Status Query (Authenticated customer / staff)
  fastify.get('/payments/status/:ref', {
    preHandler: [fastify.authenticate],
  }, paymentCtrl.getTransactionStatusHandler);

  // 4. Inbound Webhook / IPN Endpoint (Public, Signature Verified)
  fastify.post('/payments/webhook/:gateway', webhookCtrl.handleWebhookHandler);

  // 5. Payment Return / Redirect Callback (Public)
  fastify.get('/payments/callback/:gateway', webhookCtrl.handlePaymentCallbackHandler);
  fastify.post('/payments/callback/:gateway', webhookCtrl.handlePaymentCallbackHandler);

  // 6. Admin Payment Reconciliation Sweep
  fastify.post('/admin/payments/reconcile', {
    preHandler: [fastify.authenticate, fastify.requirePermission('finance.escrow.view')],
  }, paymentCtrl.reconcilePaymentsHandler);
}
