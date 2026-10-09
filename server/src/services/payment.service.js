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
import { withTransaction } from '../config/db.js';

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

// Checkout's payment methods mapped to the gateway driver that collects them. COD is absent on
// purpose: it never goes through a gateway. MOCK only appears on test fixtures.
const GATEWAY_BY_METHOD = {
  BKASH: 'BKASH',
  NAGAD: 'NAGAD',
  ROCKET: 'ROCKET',
  CARD: 'SSLCOMMERZ',
  SSLCOMMERZ: 'SSLCOMMERZ',
  MOCK: 'MOCK',
};

export function gatewayForPaymentMethod(method) {
  return GATEWAY_BY_METHOD[String(method || '').toUpperCase()] || null;
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
  let normGateway = String(gateway || 'MOCK').toUpperCase();

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

  // WHY the order decides the gateway, not the request: a shopper who picked bKash at checkout
  // must not be able to settle the order through another driver (in particular MOCK, which
  // approves everything). A COD order is paid in cash at the door and has no gateway at all.
  const orderGateway = gatewayForPaymentMethod(order.payment_method);
  if (!orderGateway) {
    throw new AppError(
      'PAYMENT_METHOD_UNSUPPORTED',
      `Order #${order.id} is paid by ${order.payment_method}, not through an online gateway.`,
      `অর্ডার #${order.id} ${order.payment_method} পদ্ধতিতে পরিশোধযোগ্য, অনলাইন গেটওয়েতে নয়।`
    );
  }
  normGateway = orderGateway;

  const { rows: [payable] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM sub_orders
     WHERE order_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED', 'REFUNDED')`,
    [order.id]
  );
  if (payable && payable.n === 0) {
    throw new AppError('CONFLICT', 'This order was cancelled and cannot be paid.', 'এই অর্ডারটি বাতিল হয়েছে, তাই পরিশোধ করা যাবে না।');
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

  // A shopper may only complete their own payment. Webhooks and the reconcile sweep call this
  // without an actor and are trusted through the gateway's own verification instead.
  if (actor?.id && txn.user_id && Number(actor.id) !== Number(txn.user_id)) {
    throw new AppError('FORBIDDEN', 'You do not have access to this payment.', 'এই পেমেন্টে আপনার অনুমতি নেই।');
  }

  // If already SUCCESS, return idempotently — after making sure its escrow exists. WHY: a paid
  // order whose escrow failed to lock (or that was paid before this was fixed) is healed by the
  // next webhook replay, reconcile sweep or execute retry, instead of staying unescrowed forever.
  if (txn.status === 'SUCCESS') {
    const paidOrder = await orderRepo.findOrderById(db, txn.order_id);
    if (paidOrder) await lockEscrowForPaidOrder(db, paidOrder);
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
      // WHY: orders has no status column — fulfilment state lives on sub_orders (updated below).
      `UPDATE orders SET payment_status = 'PAID', updated_at = now() WHERE id = $1;`,
      [order.id]
    );

    // Update child sub-orders to CONFIRMED
    await db.query(
      `UPDATE sub_orders SET status = 'CONFIRMED', updated_at = now() WHERE order_id = $1;`,
      [order.id]
    );

    await lockEscrowForPaidOrder(db, order);
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
 * Locks escrow for every sub-order of a paid gateway order, in one transaction.
 *
 * WHY this replaced the old inline loop: it passed `cache` as the second argument, but the
 * function takes (db, params). `cache` was read as the params, so subOrderId was undefined, the call
 * threw, and `.catch(() => {})` hid it — no bKash/Nagad/card order ever locked escrow, so suppliers
 * and the platform were never paid for them.
 *
 * The money came from the gateway, not from the shopper's Explooro wallet, so the external clearing
 * wallet funds the deposit (see vault.service.js resolveClearingWalletId). depositToEscrow is
 * idempotent per sub-order, so calling this again for an already-locked order changes nothing.
 * A failure is logged loudly and left for the next retry; it must not undo a payment the gateway
 * has already taken.
 */
async function lockEscrowForPaidOrder(db, order) {
  const run = (fn) => (typeof db.connect === 'function' ? withTransaction(db, fn) : fn(db));
  try {
    await run(async (client) => {
      // WHY the NOT EXISTS: an order refunded or clawed back has escrow rows in another state; a
      // late webhook replay must never lock its money again. Only never-escrowed sub-orders qualify.
      const { rows: subOrders } = await client.query(
        `SELECT s.id
         FROM sub_orders s
         JOIN orders o ON o.id = s.order_id
         WHERE s.order_id = $1
           AND o.payment_status = 'PAID'
           AND s.status NOT IN ('CANCELLED', 'RETURNED', 'REFUNDED')
           AND NOT EXISTS (SELECT 1 FROM escrow_entries e WHERE e.sub_order_id = s.id)
         ORDER BY s.id`,
        [order.id]
      );
      if (subOrders.length === 0) return;
      const clearingWalletId = await vaultService.resolveClearingWalletId(client);
      for (const so of subOrders) {
        await vaultService.depositToEscrow(db, {
          subOrderId: so.id,
          buyerWalletId: clearingWalletId,
          idempotencyKey: `escrow_lock_paid:${so.id}`,
          client,
        });
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[payment] Escrow lock failed for paid order #${order.id}: ${err.message}`);
  }
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
