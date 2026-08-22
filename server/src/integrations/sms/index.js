/**
 * index.js — SMS driver selector (Prompt 2.3).
 *
 * Every caller imports `sendSms` from here, never from `./mock.js` or `./greenweb.js` directly —
 * the same one-adapter-file pattern as config/cache.js. Switching SMS_DRIVER is a zero-code-change
 * operation.
 */

import * as mockDriver from './mock.js';
import * as greenwebDriver from './greenweb.js';

export function createSmsSender(config) {
  if (config.sms.driver === 'greenweb') {
    return (phone, message) =>
      greenwebDriver.send(phone, message, {
        apiKey: config.sms.apiKey,
        senderId: config.sms.senderId,
      });
  }
  return (phone, message) => mockDriver.send(phone, message);
}
