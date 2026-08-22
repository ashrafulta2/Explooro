/**
 * mock.js — Mock SMS driver (Prompt 2.3).
 *
 * Never calls a real gateway. Logs the message to the server console so a developer can read the
 * OTP without a phone. Default driver in development (SMS_DRIVER=mock in .env.example).
 */

export async function send(phone, message) {
  // eslint-disable-next-line no-console
  console.log(`[sms:mock] to=${phone} message="${message}"`);
  return { delivered: true, provider: 'mock' };
}
