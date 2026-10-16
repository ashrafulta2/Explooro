/**
 * paymentWebhook.controller.ts — Inbound Webhook & IPN Controller (Prompt 5.3).
 */

import * as paymentService from '../services/payment.service.ts';
import { AppError } from '../plugins/errorHandler.ts';

export async function handleWebhookHandler(req, reply) {
  const { gateway } = req.params;
  const payload = req.body || {};
  const signature = req.headers['x-signature'] || req.headers['x-webhook-signature'] || req.headers['verify-sign'] || req.query?.signature;

  const result = await paymentService.handleWebhook(req.server.db, req.server.cache, {
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
  const combined = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };

  const reference = combined.paymentID || combined.payment_ref_id || combined.sessionkey || combined.paymentId;
  const claimedStatus = combined.status || combined.transactionStatus;

  const result = await paymentService.handleGatewayReturn(req.server.db, req.server.cache, {
    gateway,
    reference,
    claimedStatus,
    log: req.log,
  });

  // A browser return lands on a page; an API caller gets JSON. Either way the status shown is the
  // transaction's real one, never the `status` the URL claimed.
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    // WHY URLSearchParams: the old redirect pasted raw query values into the URL.
    if (!result.found) return reply.redirect('/checkout?payment=unknown');
    if (result.status === 'PAID' && result.orderRef) return reply.redirect(`/orders/${encodeURIComponent(result.orderRef)}`);
    const q = new URLSearchParams({ payment: result.status.toLowerCase(), ref: result.transactionRef });
    return reply.redirect(`/checkout?${q.toString()}`);
  }

  if (!result.found) {
    throw new AppError('NOT_FOUND', 'Payment transaction record not found.', 'পেমেন্ট ট্রানজ্যাকশন রেকর্ড পাওয়া যায়নি।');
  }
  return reply.code(200).send({
    data: { gateway, transactionRef: result.transactionRef, status: result.status },
  });
}
