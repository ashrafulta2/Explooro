/**
 * greenweb.ts — Greenweb (greenweb.com.bd) SMS driver (Prompt 2.3).
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

export async function send(phone, message, { apiKey, senderId }: { apiKey?: string; senderId?: string } = {}) {
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

const BALANCE_URL = 'http://api.greenweb.com.bd/g_api.php?json';

/**
 * Test Connection (integration.service.ts): asks Greenweb for the account balance, which sends no
 * SMS and costs nothing. WHY POST and not the documented `?token=…&balance` GET: the token would
 * otherwise sit in the URL, which proxies and access logs keep. Same caveat as `send`: Greenweb's
 * reply shape is not documented in detail, so a reply that names an error, or carries no number at
 * all, counts as failure. Confirm against a live account before relying on it.
 */
export async function probeBalance(
  { apiKey }: { apiKey?: string },
  { fetchImpl = fetch, signal }: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
) {
  const response = await fetchImpl(BALANCE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: apiKey ?? '', balance: '' }),
    signal,
  });
  const text = (await response.text().catch(() => '')).trim();
  if (!response.ok) return { ok: false, detail: `Greenweb answered HTTP ${response.status}.` };
  if (/invalid|error|wrong|unauthori[sz]ed|denied/i.test(text) || !/\d/.test(text)) {
    return { ok: false, detail: `Greenweb refused the token: ${text.slice(0, 120) || 'empty reply'}` };
  }
  const balance = text.match(/\d+(?:\.\d+)?/)?.[0];
  return { ok: true, detail: `Greenweb accepted the token (balance ${balance}).` };
}
