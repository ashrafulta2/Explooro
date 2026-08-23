/**
 * index.js — WhatsApp & Messenger Driver Selector (Prompt 8.3).
 *
 * Defaults to `mock` driver in development and testing.
 */

import * as mockDriver from './mock.js';
import { createCloudApiClient } from './cloud-api.js';

export function createWhatsAppSender(config = {}) {
  const driver = config.whatsapp?.driver || process.env.WHATSAPP_DRIVER || 'mock';

  if (driver === 'cloud_api') {
    return createCloudApiClient(config.whatsapp || {});
  }

  return mockDriver;
}
