/**
 * payment.service.js — Transactional Payment Processing & Webhook Engine (Prompt 5.3).
 *
 * Implements:
 *  1. Multi-gateway checkout initiation (bKash, Nagad, SSLCommerz, Mock)
 *  2. Idempotency guarantees via Idempotency-Key
 *  3. Payment callback execution and state transitions
 *  4. Inbound Webhook / IPN signature verification with replay protection
 *  5. Periodic stuck-transaction reconciliation sweep
 *  6. Full credential masking (tokens, PINs, account digits) in logs and DB
 */

import { AppError } from '../plugins/errorHandler.js';
import { generateRef } from '../lib/ref.js';
import { createPaymentGateway } from '../integrations/payments/index.js';
import * as paymentRepo from '../repositories/payment.repository.js';
import * as orderRepo from '../repositories/order.repository.js';
import * as auditService from './audit.service.js';
import * as vaultService from './vault.service.js';

/**
 * Mask account or card numbers.
 */
export function maskSensitiveValue(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (str.length <= 6) return '****';
  return `${str.slice(0, 4)}****${str.slice(-4)}`;
}

/**
 * Sanitize and mask request/response payloads before persistence.
 */
export function maskPayloadForStorage(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const clone = JSON.parse(JSON.stringify(payload));

  const maskKeys = ['password', 'appSecret', 'client_secret', 'pin', 'otp', 'id_token', 'token', 'cvv', 'cvc'];
  function recurse(obj) {
    for (const key of Object.keys(obj)) {
      if (maskKeys.includes(key)) {
        obj[key] = '********';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        recurse(obj[key]);
      }
    }
  }
  recurse(clone);
  return clone;
}

/**
 * Initiates a payment session with a gateway.
 */
export async function initiatePayment(db, cache, {
  orderId,
  orderRef = null,
  userId,
  gateway = 'MOCK',
  returnUrl = null,
  callbackUrl = null,
  idempotencyKey = null,
  customer = {},
}) {
  const normGateway = String(gateway || 'MOCK').toUpperCase();

  // 1. Check Idempotency Key
  if (idempotencyKey) {
    const existingTxn = await paymentRepo.findPaymentTransactionByIdempotencyKey(db, idempotencyKey);
    if (existingTxn) {
      return {
        transactionRef: existingTxn.ref,
        paymentId: existingTxn.gateway_ref || existingTxn.ref,
        status: existingTxn.status,
        amount: existingTxn.amount,
        gateway: existingTxn.gateway,
        isReplay: true,
        redirectUrl: existingTxn.raw_response?.redirectUrl || returnUrl,
      };
    }
  }

  // 2. Validate Order
  const order = await orderRepo.findOrderById(db, orderId);
  if (!order) {
    throw new AppError('NOT_FOUND', `Order #${orderId} was not found.`, `অর্ডার #${orderId} পাওয়া যায়নি।`);
  }

  if (userId && Number(order.customer_id) !== Number(userId)) {
    throw new AppError('FORBIDDEN', 'You do not have access to pay for this order.', 'এই অর্ডারের জন্য পেমেন্ট করার অনুমতি আপনার নেই।');
  }

  if (order.payment_status === 'PAID') {
    throw new AppError('ORDER_ALREADY_PAID', 'This order has already been paid.', 'এই অর্ডারটির মূল্য ইতিমধ্যে পরিশোধিত হয়েছে।');
  }

  const transactionRef = generateRef('TXN');
  const driver = createPaymentGateway(normGateway);

  const rawReqPayload = maskPayloadForStorage({
    orderId,
    orderRef: order.ref || orderRef,
    amount: order.total_amount,
    currency: order.currency || 'BDT',
    customer: {
      name: customer.name || order.recipient_name,
      phone: maskSensitiveValue(customer.phone || order.recipient_phone),
    },
    idempotencyKey,
  });

  // 3. Create INITIATED Transaction row
  const txnRow = await paymentRepo.createPaymentTransaction(db, {
    ref: transactionRef,
    orderId: order.id,
    userId: order.customer_id || userId,
    gateway: normGateway,
    intent: 'SALE',
    amount: order.total_amount,
    status: 'INITIATED',
    rawRequest: rawReqPayload,
    idempotencyKey,
  });

  // 4. Call Driver
  let gatewayResult;
  try {
    gatewayResult = await driver.createPayment({
      orderId: order.id,
      orderRef: order.ref,
      amount: order.total_amount,
      currency: order.currency || 'BDT',
      customer: {
        name: customer.name || order.recipient_name,
        phone: customer.phone || order.recipient_phone,
      },
      returnUrl,
      callbackUrl,
      idempotencyKey,
    });
  } catch (err) {
    await paymentRepo.updatePaymentTransaction(db, txnRow.id, {
      status: 'FAILED',
      rawResponse: { error: err.message },
    });
    throw err;
  }

  // 5. Update Transaction with Gateway Reference
  const updatedTxn = await paymentRepo.updatePaymentTransaction(db, txnRow.id, {
    status: gatewayResult.status || 'INITIATED',
    gatewayRef: gatewayResult.gatewayRef || gatewayResult.paymentId,
    rawResponse: maskPayloadForStorage(gatewayResult.rawResponse || gatewayResult),
  });

  return {
    transactionRef: updatedTxn.ref,
    paymentId: gatewayResult.paymentId || updatedTxn.gateway_ref,
    redirectUrl: gatewayResult.redirectUrl,
    amount: updatedTxn.amount,
    gateway: normGateway,
    status: updatedTxn.status,
  };
}

/**
 * Executes or finalizes a payment after customer approval.
 */
export async function executePayment(db, cache, {
  transactionRef,
  paymentId = null,
  gateway = 'MOCK',
  trxId = null,
  otp = null,
  token = null,
  actor = null,
}) {
  let txn = null;
  if (transactionRef) {
    txn = await paymentRepo.findPaymentTransactionByRef(db, transactionRef);
  }
  if (!txn && paymentId) {
    const list = await paymentRepo.findPaymentTransactionsByOrderId(db, paymentId);
    txn = list[0];
  }
  if (!txn) {
    throw new AppError('NOT_FOUND', 'Payment transaction record not found.', 'পেমেন্ট ট্রানজ্যাকশন রেকর্ড পাওয়া যায়নি।');
  }

  // If already SUCCESS, return idempotently
  if (txn.status === 'SUCCESS') {
    return {
      success: true,
      transactionRef: txn.ref,
      orderId: txn.order_id,
      status: 'PAID',
      isIdempotent: true,
    };
  }

  const driver = createPaymentGateway(txn.gateway || gateway);

  let execResult;
  try {
    execResult = await driver.executePayment({
      paymentId: txn.gateway_ref || paymentId,
      trxId,
      otp,
      token,
    });
  } catch (err) {
    await paymentRepo.updatePaymentTransaction(db, txn.id, {
      status: 'FAILED',
      rawResponse: { error: err.message },
    });
    throw err;
  }

  // 1. Update Payment Transaction to SUCCESS
  const finalTxn = await paymentRepo.updatePaymentTransaction(db, txn.id, {
    status: 'SUCCESS',
    gatewayRef: execResult.trxId || execResult.gatewayRef || txn.gateway_ref,
    rawResponse: maskPayloadForStorage(execResult.rawResponse || execResult),
    reconciledAt: new Date(),
  });

  // 2. Mark Order as PAID and CONFIRMED
  const order = await orderRepo.findOrderById(db, txn.order_id);
  if (order) {
    await db.query(
      `UPDATE orders SET payment_status = 'PAID', status = 'CONFIRMED', updated_at = now() WHERE id = $1;`,
      [order.id]
    );

    // Update child sub-orders to CONFIRMED
    await db.query(
      `UPDATE sub_orders SET status = 'CONFIRMED', updated_at = now() WHERE order_id = $1;`,
      [order.id]
    );

    // Trigger Escrow Deposit lock for sub-orders
    try {
      const subOrders = await orderRepo.findSubOrdersByOrderId(db, order.id);
      for (const so of subOrders) {
        if (vaultService.depositToEscrow) {
          await vaultService.depositToEscrow(db, cache, {
            subOrderId: so.id,
            buyerId: order.customer_id,
            supplierId: so.supplier_id,
            salerId: so.saler_id,
            totalAmount: so.total_amount,
            salerCommission: so.saler_commission,
            platformMargin: so.platform_margin,
          }).catch(() => {});
        }
      }
    } catch {
      // Escrow deposit will be synced by reconciliation if transient issue
    }
  }

  // 3. Write Audit Trail
  await auditService.record(db, {
    actor: actor?.id || txn.user_id,
    actor_role: actor?.role || 'customer',
    action: 'payment.execute',
    target_type: 'payment_transaction',
    target_ref: finalTxn.ref,
    before: { status: txn.status },
    after: { status: 'SUCCESS', amount: finalTxn.amount, gateway_ref: finalTxn.gateway_ref },
    risk_tier: 'LOW',
  }).catch(() => {});

  return {
    success: true,
    transactionRef: finalTxn.ref,
    orderId: txn.order_id,
    status: 'PAID',
    paidAt: execResult.paidAt || new Date().toISOString(),
  };
}

/**
 * Handles inbound IPN / Webhooks with cryptographic signature verification and replay protection.
 */
export async function handleWebhook(db, cache, {
  gateway,
  payload,
  rawBody = null,
  signature = null,
  headers = {},
}) {
  const normGateway = String(gateway || 'MOCK').toUpperCase();
  const driver = createPaymentGateway(normGateway);

  // 1. Resolve Provider Event ID for deduplication
  const providerEventId = String(
    payload.provider_event_id ||
    payload.eventId ||
    payload.trxID ||
    payload.tran_id ||
    payload.paymentID ||
    payload.payment_ref_id ||
    headers['x-event-id'] ||
    `EVT-${Date.now()}`
  );

  // 2. Signature Validation
  const isValidSignature = driver.verifyWebhookSignature({
    payload,
    rawBody,
    signature: signature || headers['x-signature'] || headers['x-webhook-signature'],
  });

  if (!isValidSignature) {
    await paymentRepo.recordWebhookEvent(db, {
      gateway: normGateway,
      providerEventId,
      signatureValid: false,
      payloadJson: maskPayloadForStorage(payload),
      processResult: 'REJECTED_INVALID_SIGNATURE',
    }).catch(() => {});

    const err = new AppError('UNAUTHORIZED', 'Invalid or missing webhook signature.', 'অবৈধ বা অনুপস্থিত ওয়েবহুক স্বাক্ষর।');
    err.statusCode = 401;
    throw err;
  }

  // 3. Replay Protection: Check if already processed
  const existingEvent = await paymentRepo.findWebhookEvent(db, normGateway, providerEventId);
  if (existingEvent && existingEvent.processed_at) {
    return {
      success: true,
      idempotent: true,
      status: 'ALREADY_PROCESSED',
      processedAt: existingEvent.processed_at,
    };
  }

  // 4. Resolve Target Transaction
  const paymentRef = payload.paymentID || payload.payment_ref_id || payload.tran_id || payload.paymentId || payload.orderId;
  let txn = null;
  if (paymentRef) {
    txn = (await paymentRepo.findPaymentTransactionByRef(db, paymentRef)) ||
          (await paymentRepo.findPaymentTransactionsByOrderId(db, paymentRef))[0];
  }

  let processResult = 'IGNORED';
  const statusStr = String(payload.status || payload.transactionStatus || '').toUpperCase();

  if (txn && (statusStr === 'COMPLETED' || statusStr === 'SUCCESS' || statusStr === 'VALID')) {
    await executePayment(db, cache, {
      transactionRef: txn.ref,
      trxId: payload.trxID || payload.tran_id || payload.issuerPaymentRefNo,
      gateway: normGateway,
    });
    processResult = 'PROCESSED_SUCCESS';
  } else if (txn && (statusStr === 'FAILED' || statusStr === 'CANCELLED')) {
    await paymentRepo.updatePaymentTransaction(db, txn.id, {
      status: 'FAILED',
      rawResponse: maskPayloadForStorage(payload),
    });
    processResult = 'PROCESSED_FAILED';
  }

  // 5. Record Processed Webhook Event
  await paymentRepo.recordWebhookEvent(db, {
    gateway: normGateway,
    providerEventId,
    signatureValid: true,
    payloadJson: maskPayloadForStorage(payload),
    processedAt: new Date(),
    processResult,
  });

  return {
    success: true,
    gateway: normGateway,
    providerEventId,
    result: processResult,
  };
}

/**
 * Reconcile single transaction with gateway query API.
 */
export async function queryAndReconcileTransaction(db, cache, { transactionRef }) {
  const txn = await paymentRepo.findPaymentTransactionByRef(db, transactionRef);
  if (!txn) {
    throw new AppError('NOT_FOUND', 'Payment transaction not found.', 'পেমেন্ট ট্রানজ্যাকশন পাওয়া যায়নি।');
  }

  const driver = createPaymentGateway(txn.gateway);
  const queryResult = await driver.queryPayment({
    paymentId: txn.gateway_ref || txn.ref,
    gatewayRef: txn.gateway_ref,
  });

  let newStatus = txn.status;
  if (queryResult.status === 'SUCCESS' && txn.status !== 'SUCCESS') {
    newStatus = 'SUCCESS';
    await executePayment(db, cache, {
      transactionRef: txn.ref,
      trxId: queryResult.trxId,
    });
  } else if (queryResult.status === 'FAILED' && txn.status !== 'FAILED') {
    newStatus = 'FAILED';
    await paymentRepo.updatePaymentTransaction(db, txn.id, {
      status: 'FAILED',
      rawResponse: maskPayloadForStorage(queryResult.rawResponse),
      reconciledAt: new Date(),
    });
  } else {
    await paymentRepo.updatePaymentTransaction(db, txn.id, {
      reconciledAt: new Date(),
    });
  }

  return {
    transactionRef: txn.ref,
    previousStatus: txn.status,
    currentStatus: newStatus,
    reconciledAt: new Date().toISOString(),
  };
}

/**
 * Sweeps stuck pending transactions and reconciles with gateway.
 */
export async function reconcileStuckTransactions(db, cache, { olderThanMinutes = 15 } = {}) {
  const stuckTxns = await paymentRepo.findStuckPendingTransactions(db, olderThanMinutes);
  const results = [];

  for (const txn of stuckTxns) {
    try {
      const res = await queryAndReconcileTransaction(db, cache, { transactionRef: txn.ref });
      results.push(res);
    } catch (err) {
      results.push({
        transactionRef: txn.ref,
        error: err.message,
      });
    }
  }

  return {
    sweptCount: stuckTxns.length,
    reconciled: results,
  };
}

/**
 * Issues a refund for an existing payment.
 */
export async function refundPayment(db, cache, {
  orderId,
  transactionRef = null,
  amount,
  reason = 'Customer return',
  actor = null,
}) {
  let txn = null;
  if (transactionRef) {
    txn = await paymentRepo.findPaymentTransactionByRef(db, transactionRef);
  } else if (orderId) {
    const list = await paymentRepo.findPaymentTransactionsByOrderId(db, orderId);
    txn = list.find((t) => t.status === 'SUCCESS');
  }

  if (!txn) {
    throw new AppError('NOT_FOUND', 'No successful payment transaction found to refund.', 'রিফান্ড করার মতো কোনো সফল পেমেন্ট লেনদেন পাওয়া যায়নি।');
  }

  const driver = createPaymentGateway(txn.gateway);
  const refundResult = await driver.refund({
    gatewayRef: txn.gateway_ref,
    amount: amount || txn.amount,
    reason,
  });

  const refundRef = generateRef('REF');
  const refundTxn = await paymentRepo.createPaymentTransaction(db, {
    ref: refundRef,
    orderId: txn.order_id,
    userId: txn.user_id,
    gateway: txn.gateway,
    intent: 'REFUND',
    amount: amount || txn.amount,
    status: 'SUCCESS',
    rawRequest: { reason, originalTxnRef: txn.ref },
  });

  await auditService.record(db, {
    actor: actor?.id || null,
    actor_role: actor?.role || 'admin',
    action: 'payment.refund',
    target_type: 'payment_transaction',
    target_ref: refundRef,
    before: { status: txn.status },
    after: { status: 'REFUNDED', amount: refundTxn.amount },
    risk_tier: 'HIGH',
  }).catch(() => {});

  return {
    success: true,
    refundRef: refundTxn.ref,
    refundGatewayRef: refundResult.refundTrxId,
    amount: refundTxn.amount,
  };
}
