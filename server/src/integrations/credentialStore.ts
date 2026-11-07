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
 * round trip. The store is filled when the app is ready, reloaded every
 * INTEGRATION_CREDENTIAL_REFRESH_SECONDS, and reloaded at once after a save on this node. Another API
 * node picks a save up at its next reload.
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

export async function startCredentialRefresh(db, encryptionKey: string | undefined, log: any = null, intervalSeconds = 60) {
  stopCredentialRefresh();
  await refreshIntegrationCredentials(db, encryptionKey, log);
  const ms = Math.max(5, Number(intervalSeconds) || 60) * 1000;
  refreshTimer = setInterval(() => {
    refreshIntegrationCredentials(db, encryptionKey, log);
  }, ms);
  // Never keep the process alive just for this.
  refreshTimer.unref?.();
}

export function stopCredentialRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

/** Tests only: forget everything, as on a fresh boot. */
export function resetCredentialStore() {
  stopCredentialRefresh();
  entries = new Map();
}
