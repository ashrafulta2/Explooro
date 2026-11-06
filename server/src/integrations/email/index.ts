/**
 * index.ts — Email driver selector.
 *
 * Every caller imports `createEmailSender` from here, never from `./mock.js` directly.
 * Switching EMAIL_DRIVER is a zero-code-change operation.
 */

import * as mockDriver from './mock.ts';

export function createEmailSender(config) {
  // Can be extended with SMTP/SES/SendGrid when configured.
  // Defaults to mock driver in development.
  return (to, payload) => mockDriver.send(to, payload);
}

export { mockDriver };

/** Email drivers that send real mail. None is built yet; SMTP/SES/SendGrid land here. */
export const REAL_EMAIL_DRIVERS: readonly string[] = Object.freeze([]);

/**
 * Whether an email sent now reaches a person. In development the mock driver counts (the code is
 * shown in the API response). In production only a real driver does.
 * WHY this exists: with no real driver, an email sign-up or email sign-in code went to the mock and
 * nobody ever received it, so the person was stuck with an account they could not verify.
 */
export function emailDeliveryAvailable(env = process.env): boolean {
  const driver = String(env.EMAIL_DRIVER || 'mock').trim().toLowerCase();
  if (REAL_EMAIL_DRIVERS.includes(driver)) return true;
  return env.NODE_ENV !== 'production' || env.ALLOW_MOCK_DRIVERS_IN_PRODUCTION === 'true';
}
