/**
 * greenweb.js — Greenweb (greenweb.com.bd) SMS driver (Prompt 2.3).
 *
 * Real Bangladeshi SMS gateway, selected via SMS_DRIVER=greenweb. Never the default — mock is,
 * so development needs no paid account (docs/prompt.md Master Instructions §7).
 *
 * Endpoint and parameters (`to`, `message`, `token`, JSON output via `?json`) are Greenweb's
 * publicly documented HTTP API; their exact success/failure JSON shape is not published in detail,
 * so this treats any non-2xx response, or a response body containing an explicit failure
 * indicator, as delivery failure. Verify against a live Greenweb account before relying on this in
 * production — uses `fetch` only, per the Dependency Policy (no HTTP client library).
 */

const API_URL = 'http://api.greenweb.com.bd/api.php?json';

export async function send(phone, message, { apiKey, senderId } = {}) {
  const params = new URLSearchParams({
    to: phone.replace(/^\+/, ''), // Greenweb expects a bare national/international number, no '+'
    message,
    token: apiKey,
    ...(senderId ? { mask: senderId } : {}),
  });

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!response.ok) {
    throw new Error(`Greenweb SMS gateway returned HTTP ${response.status}`);
  }

  const body = await response.json().catch(() => null);
  if (body && typeof body === 'object' && 'error' in body) {
    throw new Error(`Greenweb SMS gateway error: ${JSON.stringify(body.error)}`);
  }

  return { delivered: true, provider: 'greenweb', raw: body };
}
