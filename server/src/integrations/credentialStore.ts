/**
 * credentialStore.ts — the gateway credentials an admin saved at /admin/platform/integrations,
 * decrypted and held in memory for the drivers (migration 108).
 *
 * Every driver resolves a credential in the same order:
 *   1. a value saved here (integration_settings.credentials_encrypted),
 *   2. its .env variable,
 *   3. the driver's own development default, if it has one.
 * `credential(key, field, envName)` is steps 1 and 2.
 *
 * WHY in memory and not a query per call: drivers are built synchronously inside request handlers
 * (createPaymentGateway, getCourierAdapter, the SMS sender) and a payment must not wait on an extra
 * round trip. The store is filled when the app is ready and reloaded at once after any save, on
 * every API node: the saving node publishes on CHANGE_CHANNEL through the cache (Redis pub/sub with
 * CACHE_DRIVER=redis, an in-process bus with memory, which is single-node anyway) and each node
 * reloads when it hears it. INTEGRATION_CREDENTIAL_REFRESH_SECONDS is the backstop for a missed
 * message (a node that was reconnecting to Redis at that moment).
 *
 * WHY a failed reload keeps the previous values: a database hiccup must not swap every live
 * gateway back to its .env (or mock) credentials mid-day.
 */

import { decryptField } from '../lib/encryption.ts';
import * as integrationRepo from '../repositories/integration.repository.ts';

interface StoredIntegration {
  enabled: boolean;
  fields: Record<string, string>;
}

let entries: Map<string, StoredIntegration> = new Map();
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => unknown) | null = null;

export const CHANGE_CHANNEL = 'integrations:credentials:changed';

/**
 * Tells every API node to reload. Carries no credential, only a timestamp: anything subscribed to
 * the channel learns that something changed, never what. A failed publish is not an error for the
 * caller (its own node already reloaded); the interval reload covers the others.
 */
export async function announceCredentialChange(cache, log: any = null) {
  if (!cache?.publish) return;
  try {
    await cache.publish(CHANGE_CHANNEL, String(Date.now()));
  } catch (err) {
    log?.warn?.({ err: err?.message }, 'integration credential change not announced; other nodes reload on their interval');
  }
}

/** The saved value of one field, or undefined when nothing was saved for it. */
export function storedCredential(integrationKey: string, field: string): string | undefined {
  const value = entries.get(integrationKey)?.fields?.[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A saved value, else the .env variable. Undefined when neither is set. */
export function credential(integrationKey: string, field: string, envName: string): string | undefined {
  const stored = storedCredential(integrationKey, field);
  if (stored !== undefined) return stored;
  const fromEnv = process.env[envName];
  return fromEnv ? fromEnv : undefined;
}

/** True when an admin paused this service. A service with no row is never paused. */
export function isIntegrationPaused(integrationKey: string): boolean {
  return entries.get(integrationKey)?.enabled === false;
}

/** Replaces the store with these rows. Exported for the service (after a save) and for tests. */
export function applyIntegrationRows(rows: any[], encryptionKey: string | undefined, log: any = null) {
  const next: Map<string, StoredIntegration> = new Map();
  for (const row of rows ?? []) {
    let fields: Record<string, string> = {};
    if (row.credentials_encrypted) {
      try {
        if (!encryptionKey) throw new Error('PII_ENCRYPTION_KEY is not set');
        const parsed = JSON.parse(decryptField(row.credentials_encrypted, encryptionKey));
        if (parsed && typeof parsed === 'object') fields = parsed;
      } catch (err) {
        // WHY keep going: one unreadable row (the encryption key was rotated without re-saving) must
        // not take every other gateway's credentials with it. Its driver falls back to .env.
        log?.error?.({ err: err?.message, integration: row.integration_key }, 'integration credentials could not be decrypted');
      }
    }
    next.set(row.integration_key, { enabled: row.is_enabled !== false, fields });
  }
  entries = next;
}

export async function refreshIntegrationCredentials(db, encryptionKey: string | undefined, log: any = null) {
  try {
    applyIntegrationRows(await integrationRepo.listIntegrationRows(db), encryptionKey, log);
    return true;
  } catch (err) {
    // The table may not exist yet on a fresh clone that has not run migration 108.
    log?.warn?.({ err: err?.message }, 'integration credentials not reloaded; keeping the previous values');
    return false;
  }
}

export async function startCredentialRefresh(
  db,
  encryptionKey: string | undefined,
  log: any = null,
  intervalSeconds = 60,
  cache: any = null
) {
  stopCredentialRefresh();
  await refreshIntegrationCredentials(db, encryptionKey, log);
  const ms = Math.max(5, Number(intervalSeconds) || 60) * 1000;
  refreshTimer = setInterval(() => {
    refreshIntegrationCredentials(db, encryptionKey, log);
  }, ms);
  // Never keep the process alive just for this.
  refreshTimer.unref?.();

  if (cache?.subscribe) {
    try {
      unsubscribe = await cache.subscribe(CHANGE_CHANNEL, () => {
        refreshIntegrationCredentials(db, encryptionKey, log);
      });
    } catch (err) {
      // Redis unreachable at boot: the interval still reloads, only later.
      log?.warn?.({ err: err?.message }, 'integration credential changes not subscribed; relying on the reload interval');
    }
  }
}

export function stopCredentialRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (unsubscribe) {
    Promise.resolve(unsubscribe()).catch(() => {});
    unsubscribe = null;
  }
}

/** Tests only: forget everything, as on a fresh boot. */
export function resetCredentialStore() {
  stopCredentialRefresh();
  entries = new Map();
}
