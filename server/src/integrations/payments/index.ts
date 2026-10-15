/**
 * index.ts — Payment Gateway Driver Factory (Prompt 5.3).
 */

import { MockPaymentDriver } from './mock.ts';
import { BkashPaymentDriver } from './bkash.ts';
import { NagadPaymentDriver } from './nagad.ts';
import { SslcommerzPaymentDriver } from './sslcommerz.ts';
import { AppError } from '../../plugins/errorHandler.ts';

export { MockPaymentDriver, BkashPaymentDriver, NagadPaymentDriver, SslcommerzPaymentDriver };

/**
 * What every payment driver exposes. The four driver classes do not share a base class, so without
 * this the checker sees a union and demands each method's arguments satisfy all four at once.
 */
export interface PaymentGateway {
  // WHY optional: the mock driver has none on purpose. A driver that approves without asking a real
  // gateway must never complete a payment from the public callback URL.
  isLive?: boolean;
  createPayment: (params: Record<string, any>) => Promise<any>;
  executePayment: (params: { paymentId?: string; trxId?: string; otp?: string; token?: string; valId?: string }) => Promise<any>;
  queryPayment: (params: { paymentId?: string; gatewayRef?: string }) => Promise<any>;
  refund: (params: { gatewayRef: string; amount: string | number; reason?: string; trxId?: string }) => Promise<any>;
  verifyWebhookSignature: (params: { payload?: any; rawBody?: any; signature?: string; secret?: string }) => boolean;
}

/**
 * @param {string} [gatewayName]
 * @param {object} [config]
 * @returns {PaymentGateway}
 */
export function createPaymentGateway(gatewayName: string = 'MOCK', config: any = {}): PaymentGateway {
  const norm = String(gatewayName || 'MOCK').trim().toUpperCase();
  const globalDriver = (process.env.PAYMENT_DRIVER || 'MOCK').toUpperCase();

  // WHY: /payments/webhook/mock and /payments/initiate with gateway=MOCK reach this factory from the
  // outside. In production the mock driver approves everything, so it is never handed out there.
  if (norm === 'MOCK' && process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_DRIVERS_IN_PRODUCTION !== 'true') {
    throw new AppError(
      'PAYMENT_METHOD_UNSUPPORTED',
      'The mock payment gateway is disabled in production.',
      'প্রোডাকশনে মক পেমেন্ট গেটওয়ে বন্ধ আছে।'
    );
  }

  // If PAYMENT_DRIVER is explicitly 'MOCK' or in non-production, allow MOCK driver
  if (globalDriver === 'MOCK' || norm === 'MOCK') {
    return new MockPaymentDriver(config);
  }

  switch (norm) {
    case 'BKASH':
      return new BkashPaymentDriver(config);
    case 'NAGAD':
      return new NagadPaymentDriver(config);
    case 'SSLCOMMERZ':
    case 'CARD':
    case 'CARDS':
      return new SslcommerzPaymentDriver(config);
    default: {
      // WHY not fall back to the mock driver: with live payments on, a gateway that has no driver
      // yet (Rocket) would be "paid" by a driver that approves everything, shipping goods for free.
      throw new AppError(
        'PAYMENT_METHOD_UNSUPPORTED',
        `No live payment driver for gateway ${norm}.`,
        `${norm} গেটওয়েতে এখনো অনলাইন পেমেন্ট চালু হয়নি।`
      );
    }
  }
}

export const defaultPaymentGateway = createPaymentGateway();
