/**
 * sms.js — SMS Notification Channel (Prompt 8.2).
 */

import { createSmsSender } from '../../integrations/sms/index.js';
import * as mockDriver from '../../integrations/sms/mock.js';
import { loadEnv } from '../../config/env.js';

let cachedSender = null;

function getSender() {
  if (!cachedSender) {
    try {
      const env = loadEnv();
      cachedSender = createSmsSender(env);
    } catch {
      cachedSender = (phone, message) => mockDriver.send(phone, message);
    }
  }
  return cachedSender;
}

export async function sendSms(phone, message) {
  if (!phone) {
    return { channel: 'SMS', status: 'FAILED', error: 'MISSING_PHONE' };
  }

  try {
    const sender = getSender();
    const result = await sender(phone, message);
    return {
      channel: 'SMS',
      status: result?.success !== false ? 'SENT' : 'FAILED',
      providerId: result?.messageId || null,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      channel: 'SMS',
      status: 'FAILED',
      error: err.message,
      timestamp: new Date().toISOString(),
    };
  }
}
