/**
 * mock.js — In-memory Mock Email Driver (development default).
 *
 * Logs outgoing emails to console/debug in development and tracks them in memory.
 */

const sentEmails = [];

export async function send(to, { subject, text, html }) {
  const record = {
    to,
    subject,
    text,
    html,
    timestamp: new Date().toISOString(),
  };
  sentEmails.push(record);
  return { success: true, messageId: `mock-email-${Date.now()}` };
}

export function getSentEmails() {
  return sentEmails;
}

export function clearSentEmails() {
  sentEmails.length = 0;
}
