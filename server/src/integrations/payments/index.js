/**
 * index.js — Payment Gateway Driver Factory (Prompt 5.3).
 */

import { MockPaymentDriver } from './mock.js';
import { BkashPaymentDriver } from './bkash.js';
import { NagadPaymentDriver } from './nagad.js';
import { SslcommerzPaymentDriver } from './sslcommerz.js';
import { AppError } from '../../plugins/errorHandler.js';

export { MockPaymentDriver, BkashPaymentDriver, NagadPaymentDriver, SslcommerzPaymentDriver };

export function createPaymentGateway(gatewayName = 'MOCK', config = {}) {
  const norm = String(gatewayName || 'MOCK').trim().toUpperCase();
  const globalDriver = (process.env.PAYMENT_DRIVER || 'MOCK').toUpperCase();

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
