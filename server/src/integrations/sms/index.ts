/**
 * index.ts — SMS driver selector (Prompt 2.3).
 *
 * Every caller imports `sendSms` from here, never from `./mock.js` or `./greenweb.js` directly —
 * the same one-adapter-file pattern as config/cache.ts. Switching SMS_DRIVER is a zero-code-change
 * operation.
 */

import * as mockDriver from './mock.ts';
import * as greenwebDriver from './greenweb.ts';
import { storedCredential } from '../credentialStore.ts';

export function createSmsSender(config) {
  if (config.sms.driver === 'greenweb') {
    // WHY read per message: a token saved at /admin/platform/integrations (credentialStore.ts) must
    // apply without a restart. SMS_API_KEY stays required at boot (config/env.ts) as the fallback,
    // because sign-in codes must still go out if the saved one is ever unreadable.
    return (phone, message) =>
      greenwebDriver.send(phone, message, {
        apiKey: storedCredential('greenweb_sms', 'api_key') || config.sms.apiKey,
        senderId: storedCredential('greenweb_sms', 'sender_id') || config.sms.senderId,
      });
  }
  return (phone, message) => mockDriver.send(phone, message);
}
