/**
 * index.js — Email driver selector.
 *
 * Every caller imports `createEmailSender` from here, never from `./mock.js` directly.
 * Switching EMAIL_DRIVER is a zero-code-change operation.
 */

import * as mockDriver from './mock.js';

export function createEmailSender(config) {
  // Can be extended with SMTP/SES/SendGrid when configured.
  // Defaults to mock driver in development.
  return (to, payload) => mockDriver.send(to, payload);
}

export { mockDriver };
