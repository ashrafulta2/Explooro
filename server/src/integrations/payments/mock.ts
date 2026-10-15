/**
 * mock.ts — Deterministic Mock Payment Gateway Driver (Prompt 5.3).
 *
 * Simulates:
 *  - Success flow
 *  - Failure / Insufficient balance flow
 *  - Gateway timeout
 *  - Delayed callback / Webhook verification
 *  - Refunds
 */

import { createHmac, randomBytes } from 'node:crypto';
import { hmacHexMatches, isLive, safeEqual, secretOrDevDefault } from '../webhookSecurity.ts';

export class MockPaymentDriver {
  config: any;
  webhookSecret: any;

  constructor(config: Record<string, any> = {}) {
    this.config = config;
    this.webhookSecret = config.webhookSecret || 'mock_webhook_secret_key_123';
  }

  /**
   * Masks sensitive identifier (phone or card number).
   */
  maskAccount(acc) {
    if (!acc) return '****';
    const str = String(acc).trim();
    if (str.length <= 6) return '****';
    return `${str.slice(0, 4)}****${str.slice(-4)}`;
  }

  /**
   * Initializes a payment session.
   */
  async createPayment({
    orderId,
    orderRef,
    amount,
    currency = 'BDT',
    customer = {} as Record<string, any>,
    returnUrl,
    callbackUrl,
    idempotencyKey,
  }) {
    const cleanPhone = String(customer.phone || '').trim();

    // Simulated failure scenarios based on phone prefix/suffix
    if (cleanPhone.endsWith('0000') || (customer.name && customer.name.includes('FAIL'))) {
      const err: any = new Error('GATEWAY_PAYMENT_REJECTED: Mock gateway declined transaction.');
      err.code = 'GATEWAY_REJECTED';
      err.statusCode = 402;
      throw err;
    }

    if (cleanPhone.endsWith('9999') || (customer.name && customer.name.includes('TIMEOUT'))) {
      const err: any = new Error('GATEWAY_TIMEOUT: Mock gateway timed out.');
      err.code = 'GATEWAY_TIMEOUT';
      err.statusCode = 504;
      throw err;
    }

    const paymentId = `MOCK-PAY-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const redirectUrl = `${returnUrl || '/checkout/success'}?paymentId=${paymentId}&status=success`;

    return {
      success: true,
      paymentId,
      gatewayRef: paymentId,
      amount: parseFloat(amount).toFixed(2),
      currency,
      status: 'INITIATED',
      redirectUrl,
      rawResponse: {
        paymentID: paymentId,
        createTime: new Date().toISOString(),
        orgLogo: 'https://cdn.explooro.com/logo.png',
        orgName: 'Explooro Commerce',
        transactionStatus: 'Initiated',
        amount: parseFloat(amount).toFixed(2),
        currency,
        intent: 'sale',
        merchantInvoiceNumber: orderRef || `ORD-${orderId}`,
      },
    };
  }

  /**
   * Executes / confirms a payment after customer PIN/OTP authorization.
   */
  async executePayment({ paymentId, trxId, otp, token }) {
    if (paymentId && paymentId.includes('FAIL_EXECUTE')) {
      const err: any = new Error('PAYMENT_EXECUTION_FAILED: Pin verification failed or user cancelled.');
      err.code = 'PAYMENT_EXECUTION_FAILED';
      err.statusCode = 400;
      throw err;
    }

    const transactionId = trxId || `TRX-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;

    return {
      success: true,
      paymentId,
      trxId: transactionId,
      gatewayRef: transactionId,
      status: 'SUCCESS',
      paidAt: new Date().toISOString(),
      rawResponse: {
        paymentID: paymentId,
        trxID: transactionId,
        transactionStatus: 'Completed',
        amount: '100.00',
        currency: 'BDT',
        paymentExecuteTime: new Date().toISOString(),
      },
    };
  }

  /**
   * Queries payment status directly from the gateway for reconciliation.
   */
  async queryPayment({ paymentId, gatewayRef }) {
    const id = gatewayRef || paymentId;
    if (id && id.includes('STUCK')) {
      return {
        paymentId: id,
        status: 'PENDING',
        isComplete: false,
        rawResponse: { transactionStatus: 'Pending' },
      };
    }

    return {
      paymentId: id,
      trxId: `TRX-QUERY-${id}`,
      status: 'SUCCESS',
      isComplete: true,
      rawResponse: {
        paymentID: id,
        trxID: `TRX-QUERY-${id}`,
        transactionStatus: 'Completed',
        queryTime: new Date().toISOString(),
      },
    };
  }

  /**
   * Initiates a refund through the gateway.
   */
  async refund({ gatewayRef, amount, reason, trxId }) {
    const refundId = `REFUND-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;

    return {
      success: true,
      refundTrxId: refundId,
      originalGatewayRef: gatewayRef || trxId,
      amount: parseFloat(amount).toFixed(2),
      status: 'REFUNDED',
      refundedAt: new Date().toISOString(),
      rawResponse: {
        refundTrxID: refundId,
        originalTrxID: gatewayRef || trxId,
        amount: parseFloat(amount).toFixed(2),
        transactionStatus: 'Completed',
      },
    };
  }

  /**
   * Generates a mock signature for testing webhooks.
   */
  generateWebhookSignature(payloadString, secret = this.webhookSecret) {
    return createHmac('sha256', secret).update(payloadString).digest('hex');
  }

  /**
   * Validates inbound webhook signature.
   */
  verifyWebhookSignature({ payload, rawBody, signature, secret = this.webhookSecret }) {
    // WHY: the mock secret is in the repo, so in production a "mock" webhook would be a forgery key.
    if (process.env.NODE_ENV === 'production') return false;
    return hmacHexMatches(secret, typeof rawBody === 'string' ? rawBody : payload, signature);
  }
}
