/**
 * payment.controller.js — Payment Processing Controller (Prompt 5.3).
 */

import * as paymentService from '../services/payment.service.js';
import * as paymentRepo from '../repositories/payment.repository.js';
import { AppError } from '../plugins/errorHandler.js';

export async function initiatePaymentHandler(req, reply) {
  const { orderId, gateway = 'MOCK', returnUrl, callbackUrl, customer } = req.body || {};
  const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey || null;

  if (!orderId) {
    throw new AppError('BAD_REQUEST', 'orderId is required to initiate payment.', 'পেমেন্ট শুরু করার জন্য orderId আবশ্যক।');
  }

  const result = await paymentService.initiatePayment(req.server.pg, req.server.cache, {
    orderId,
    userId: req.user?.id,
    gateway,
    returnUrl,
    callbackUrl,
    idempotencyKey,
    customer,
  });

  return reply.code(200).send({ data: result });
}

export async function executePaymentHandler(req, reply) {
  const { transactionRef, paymentId, gateway = 'MOCK', trxId, otp, token } = req.body || {};

  if (!transactionRef && !paymentId) {
    throw new AppError('BAD_REQUEST', 'transactionRef or paymentId is required.', 'transactionRef অথবা paymentId আবশ্যক।');
  }

  const result = await paymentService.executePayment(req.server.pg, req.server.cache, {
    transactionRef,
    paymentId,
    gateway,
    trxId,
    otp,
    token,
    actor: req.user,
  });

  return reply.code(200).send({ data: result });
}

export async function getTransactionStatusHandler(req, reply) {
  const { ref } = req.params;
  const txn = await paymentRepo.findPaymentTransactionByRef(req.server.pg, ref);

  if (!txn) {
    throw new AppError('NOT_FOUND', 'Transaction not found.', 'লেনদেন পাওয়া যায়নি।');
  }

  return reply.code(200).send({ data: txn });
}

export async function reconcilePaymentsHandler(req, reply) {
  const { olderThanMinutes = 15 } = req.body || {};
  const result = await paymentService.reconcileStuckTransactions(req.server.pg, req.server.cache, {
    olderThanMinutes,
  });

  return reply.code(200).send({ data: result });
}
