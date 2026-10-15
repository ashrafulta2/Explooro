/**
 * index.ts — WhatsApp & Messenger Driver Selector (Prompt 8.3).
 *
 * Defaults to `mock` driver in development and testing.
 */

import * as mockDriver from './mock.ts';
import { createCloudApiClient } from './cloud-api.ts';

export function createWhatsAppSender(config: Record<string, any> = {}) {
  const driver = config.whatsapp?.driver || process.env.WHATSAPP_DRIVER || 'mock';

  if (driver === 'cloud_api') {
    return createCloudApiClient(config.whatsapp || {});
  }

  return mockDriver;
}
