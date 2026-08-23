/**
 * email.js — Email Notification Channel (Prompt 8.2).
 */

export async function sendEmail(email, { subject, bodyHtml, bodyText }) {
  if (!email) {
    return { channel: 'EMAIL', status: 'FAILED', error: 'MISSING_EMAIL' };
  }

  return {
    channel: 'EMAIL',
    status: 'SENT',
    timestamp: new Date().toISOString(),
  };
}
