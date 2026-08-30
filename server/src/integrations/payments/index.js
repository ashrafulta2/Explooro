/**
 * index.js — Payment Gateway Driver Factory (Prompt 5.3).
 */

import { MockPaymentDriver } from './mock.js';
import { BkashPaymentDriver } from './bkash.js';
import { NagadPaymentDriver } from './nagad.js';
import { SslcommerzPaymentDriver } from './sslcommerz.js';

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
    default:
      return new MockPaymentDriver(config);
  }
}

export const defaultPaymentGateway = createPaymentGateway();
