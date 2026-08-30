/**
 * paymentWebhook.controller.js — Inbound Webhook & IPN Controller (Prompt 5.3).
 */

import * as paymentService from '../services/payment.service.js';

export async function handleWebhookHandler(req, reply) {
  const { gateway } = req.params;
  const payload = req.body || {};
  const signature = req.headers['x-signature'] || req.headers['x-webhook-signature'] || req.headers['verify-sign'] || req.query?.signature;

  const result = await paymentService.handleWebhook(req.server.pg, req.server.cache, {
    gateway,
    payload,
    rawBody: req.rawBody || JSON.stringify(payload),
    signature,
    headers: req.headers,
  });

  return reply.code(200).send({ data: result });
}

export async function handlePaymentCallbackHandler(req, reply) {
  const { gateway } = req.params;
  const queryParams = req.query || {};
  const body = req.body || {};
  const combined = { ...queryParams, ...body };

  const paymentId = combined.paymentID || combined.payment_ref_id || combined.sessionkey || combined.paymentId;
  const status = combined.status || combined.transactionStatus;

  if (status === 'success' || status === 'Success' || status === 'VALID' || status === 'Completed') {
    try {
      await paymentService.executePayment(req.server.pg, req.server.cache, {
        paymentId,
        gateway,
        trxId: combined.trxID || combined.tran_id,
      });
    } catch {
      // Ignored if already executed
    }
  }

  // If browser redirect, redirect to client checkout completion page
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return reply.redirect(`/checkout/success?paymentId=${paymentId}&status=${status}`);
  }

  return reply.code(200).send({
    data: {
      gateway,
      paymentId,
      status,
      message: 'Callback processed successfully.',
    },
  });
}
