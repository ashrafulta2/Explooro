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

  // WHY: PAYMENT_DRIVER=none is the launch setting, with no MFS merchant or card gateway signed yet.
  // Shoppers pay cash on delivery or from their vault, and neither path reaches this factory, so
  // anything that does is an online payment the platform cannot take. Refused in every environment,
  // so a developer can run the launch configuration locally.
  if (globalDriver === 'NONE') {
    throw new AppError(
      'PAYMENT_METHOD_UNSUPPORTED',
      'Online payment is not available yet. Pay cash on delivery or from your vault.',
      'অনলাইন পেমেন্ট এখনো চালু হয়নি। ক্যাশ অন ডেলিভারি বা আপনার ভল্ট থেকে পেমেন্ট করুন।'
    );
  }

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

/** Checkout method ids (`orders.payment_method`) that are paid through an online gateway. */
export const ONLINE_METHODS = Object.freeze(['BKASH', 'NAGAD', 'ROCKET', 'CARD']);

/**
 * The online methods this deployment can actually take money with, from PAYMENT_DRIVER alone.
 *   none → [] (launch: cash on delivery and the vault only)
 *   mock → all four (the mock driver simulates each)
 *   any live driver → every method that has a live driver; Rocket has none yet, so it is left out.
 */
export function onlineMethodsForDriver(driver: string | undefined = process.env.PAYMENT_DRIVER): string[] {
  const norm = String(driver || 'mock').trim().toLowerCase();
  if (norm === 'none') return [];
  if (norm === 'mock') return [...ONLINE_METHODS];
  return ONLINE_METHODS.filter((m) => m !== 'ROCKET');
}

// WHY no `defaultPaymentGateway = createPaymentGateway()` here any more: nothing used it, and it ran
// the factory at import time with the MOCK gateway, which throws in production. Every production
// boot crashed on importing this file, whatever PAYMENT_DRIVER said.
