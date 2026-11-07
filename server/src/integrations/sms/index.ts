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
    // apply without a restart. Either the saved token or SMS_API_KEY must exist: smsTokenProblem
    // stops the boot otherwise, and the integrations page refuses to remove the last one.
    return (phone, message) =>
      greenwebDriver.send(phone, message, {
        apiKey: storedCredential('greenweb_sms', 'api_key') || config.sms.apiKey,
        senderId: storedCredential('greenweb_sms', 'sender_id') || config.sms.senderId,
      });
  }
  return (phone, message) => mockDriver.send(phone, message);
}

/**
 * Why the API must not start, or null. Run once the saved credentials are loaded (app.ts onReady).
 * WHY a boot failure: with SMS_DRIVER=greenweb and no token at all, every sign-in code would fail.
 */
export function smsTokenProblem(config): string | null {
  if (config?.sms?.driver !== 'greenweb') return null;
  if (storedCredential('greenweb_sms', 'api_key') || config.sms.apiKey) return null;
  return 'SMS_DRIVER=greenweb but there is no SMS token: set SMS_API_KEY in .env or save one at /admin/platform/integrations.';
}
