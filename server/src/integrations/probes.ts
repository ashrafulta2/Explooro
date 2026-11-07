/**
 * probes.ts — read-only checks Test Connection runs against a provider (integration.service.ts).
 *
 * One entry per catalog service whose live driver really calls the provider (`live_driver:
 * 'READY'` in config/integrations.ts). Each probe sends nothing to a customer and moves no money:
 * Greenweb is asked for its balance, Meta for the phone number's record.
 *
 * The probe gets the credentials the driver itself would use (saved value, else .env) and returns
 * `{ ok, detail }`. This file times it and enforces the timeout, so the latency shown on the card is
 * a real round trip.
 */

import { probeBalance } from './sms/greenweb.ts';
import { probePhoneNumber } from './whatsapp/cloud-api.ts';

export type ProbeOutcome = { ok: boolean; detail: string };
export type Probe = (
  creds: Record<string, string | undefined>,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal }
) => Promise<ProbeOutcome>;

export const PROBES: Readonly<Record<string, Probe>> = Object.freeze({
  greenweb_sms: (c, opts) => probeBalance({ apiKey: c.api_key }, opts),
  whatsapp_cloud: (c, opts) => probePhoneNumber({ phoneNumberId: c.phone_number_id, accessToken: c.access_token }, opts),
});

/** Runs a probe with a hard timeout. Never throws: a network error is a failed check. */
export async function runProbe(
  probe: Probe,
  creds: Record<string, string | undefined>,
  { timeoutMs, fetchImpl }: { timeoutMs: number; fetchImpl?: typeof fetch }
): Promise<ProbeOutcome & { latency_ms: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const outcome = await probe(creds, { fetchImpl, signal: controller.signal });
    return { ...outcome, latency_ms: Math.round(performance.now() - started) };
  } catch (err) {
    const timedOut = controller.signal.aborted;
    return {
      ok: false,
      detail: timedOut ? `No answer within ${timeoutMs} ms.` : `Could not reach the provider: ${err?.message ?? 'network error'}`,
      latency_ms: timedOut ? null : Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}
